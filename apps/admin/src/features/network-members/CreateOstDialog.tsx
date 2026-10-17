import { getOstSponsors } from '../ost/services';
import { OstAddressFields, emptyOstAddress } from '@afhomes/ui';
import { useOstAddress } from '../address/useOstAddress';
/**
 * Create OST directly from the Members console.
 *
 * One form, two truthful outcomes, and both go through the same OST
 * application the sponsored pipeline uses:
 *
 * - Complete is used when the signed official form is in hand. The operator
 *   states both signature dates and the approved one-year validity, and
 *   management approves on the spot. The record does NOT claim a sponsor
 *   endorsement: only the sponsor can endorse, so the direct install leaves it
 *   empty instead of attributing consent nobody gave.
 * - Save pending records the application and its provenance and leaves the
 *   sponsored workflow (sponsor endorsement, management approval) to finish it.
 *
 * Completed members use a temporary-password login and automatic or manual AAO.
 */
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createOstMemberSchema,
  officialOstFormDefaults,
  ostAnnualExpiry,
  parseOfficialOstFields,
} from '@afhomes/contracts';
import {
  Alert,
  Button,
  DateField,
  Dialog,
  PasswordField,
  OstOfficialFields,
  Select,
  TextField,
} from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { filterHolderNameInput, filterMobileInput } from '../../lib/normalize';
import { createOstMember } from './services';
import styles from './MembersPage.module.css';

const IDENTITY_FIELDS = [
  { name: 'firstName', label: 'First Name' },
  { name: 'middleName', label: 'Middle Name', optional: true },
  { name: 'lastName', label: 'Last Name' },
  { name: 'phone', label: 'Mobile Number' },
] as const;

type IdentityField = (typeof IDENTITY_FIELDS)[number]['name'] | 'birthDate' | 'email' | 'line1';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CreateOstDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<'complete' | 'pending'>('complete');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [geography, setGeography] = useState(emptyOstAddress);
  const addressOptions = useOstAddress(geography, false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [aaNumberMode, setAaNumberMode] = useState<'auto' | 'manual'>('auto');
  const [aaNumber, setAaNumber] = useState('');
  const [official, setOfficial] = useState(officialOstFormDefaults);
  const [sponsorStaffId, setSponsorStaffId] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState(() => ostAnnualExpiry(today()));
  // One submission, one idempotency key: a retry after a lost response returns
  // the application already recorded instead of writing a second one.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const sponsors = useQuery({
    queryKey: ['ost', 'manual-sponsors'],
    queryFn: getOstSponsors,
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const create = useBusinessMutation({ mutationFn: createOstMember });
  const onChange = (name: IdentityField) => (value: string) => {
    const filtered =
      name === 'phone'
        ? filterMobileInput(value)
        : name === 'firstName' || name === 'middleName' || name === 'lastName'
          ? filterHolderNameInput(value)
          : value;
    setFields((current) => ({ ...current, [name]: filtered }));
  };

  const submit = () => {
    if (mode === 'complete' && temporaryPassword !== confirmPassword) {
      setError('Passwords must match.');
      return;
    }
    const form = parseOfficialOstFields(official);
    if (!form.success) {
      setError(form.error.issues[0]?.message ?? 'Check the official form.');
      return;
    }
    const parsed = createOstMemberSchema.safeParse({
      mode,
      ...(mode === 'complete'
        ? { temporaryPassword, aaNumberMode, ...(aaNumberMode === 'manual' ? { aaNumber } : {}) }
        : {}),
      requestId,
      sponsorStaffId,
      identity: {
        firstName: fields.firstName ?? '',
        middleName: fields.middleName || undefined,
        lastName: fields.lastName ?? '',
        email: fields.email ?? '',
        phone: fields.phone ?? '',
        birthDate: fields.birthDate ?? '',
        address: {
          line1: fields.line1 ?? '',
          city: geography.city,
          province: geography.province,
          barangay: geography.barangay,
          postalCode: geography.postalCode || undefined,
          countryCode: 'PH',
        },
        addressHierarchy: {
          provinceCode: geography.provinceCode,
          localityCode: geography.localityCode,
          barangayCode: geography.barangayCode,
        },
      },
      form: form.data,
      startsOn: mode === 'complete' ? startsOn : null,
      expiresOn: mode === 'complete' ? expiresOn : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Complete the applicant details.');
      return;
    }
    setError('');
    create.mutate(parsed.data, {
      onSuccess: () => {
        // The same idempotency key can never describe a second application.
        setRequestId(crypto.randomUUID());
        onCreated();
      },
      onError: (failure) => setError(failure.message),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create OST"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-ost-form"
            loading={create.isPending}
            loadingLabel="Creating…"
          >
            {mode === 'complete' ? 'Create and accredit' : 'Save application'}
          </Button>
        </>
      }
    >
      <form
        id="create-ost-form"
        className={styles.dialogBody}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        aria-busy={create.isPending}
      >
        <p className={styles.sectionHint}>
          Create the OST login, choose an active Sales Manager, and record the signed accreditation
          form. Fields marked * are required.
        </p>
        {error ? (
          <div ref={errorRef} tabIndex={-1}>
            <Alert variant="danger" title="Review the form">
              <p className={styles.alertText}>{error}</p>
            </Alert>
          </div>
        ) : null}
        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Personal information</legend>
          <div className={styles.formFields}>
            <div className={styles.inlinePair}>
              {IDENTITY_FIELDS.map(({ name, label, ...rest }) => (
                <TextField
                  key={name}
                  id={`create-ost-${name}`}
                  name={`create-ost-${name}`}
                  label={label}
                  value={fields[name] ?? ''}
                  onChange={onChange(name)}
                  {...('optional' in rest && rest.optional ? { optional: true as const } : {})}
                />
              ))}
            </div>
            <DateField
              id="create-ost-birthDate"
              name="create-ost-birthDate"
              label="Birth Date"
              max={today()}
              value={fields.birthDate ?? ''}
              onChange={onChange('birthDate')}
            />
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Home address</legend>
          <div className={styles.formFields}>
            <TextField
              id="create-ost-line1"
              name="create-ost-line1"
              label="No. / Street"
              value={fields.line1 ?? ''}
              onChange={onChange('line1')}
            />
            <div className={styles.inlinePair}>
              <OstAddressFields
                showRegion={false}
                value={geography}
                onChange={setGeography}
                {...addressOptions}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Assignment</legend>
          <div className={styles.formFields}>
            <TextField
              id="create-ost-role"
              name="position"
              label="Position"
              value="OST"
              onChange={() => {}}
              readOnly
            />
            <label className={styles.fieldLabel}>
              Sponsor (active Sales Manager)
              <Select
                required
                value={sponsorStaffId}
                onChange={(e) => setSponsorStaffId(e.target.value)}
                options={[
                  { value: '', label: 'Choose an active Sales Manager' },
                  ...(sponsors.data?.map((holder) => ({
                    value: holder.id,
                    label: holder.name,
                  })) ?? []),
                ]}
              />
            </label>
          </div>
          {sponsors.isError ? (
            <p className={styles.sectionHint} role="alert">
              The Sales Manager list could not be loaded.
              <Button type="button" variant="secondary" onClick={() => void sponsors.refetch()}>
                Retry Sales Managers
              </Button>
            </p>
          ) : null}
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Account</legend>
          <div className={styles.formFields}>
            <TextField
              id="create-ost-email"
              name="email"
              label="Email"
              type="email"
              value={fields.email ?? ''}
              onChange={onChange('email')}
            />
            {mode === 'complete' ? (
              <>
                <div className={styles.inlinePair}>
                  <PasswordField
                    id="create-ost-password"
                    label="Temporary password"
                    value={temporaryPassword}
                    onChange={setTemporaryPassword}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    id="create-ost-confirm-password"
                    label="Confirm password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                  />
                </div>
                <p className={styles.sectionHint}>
                  The member must change this password at first sign-in. No invitation email is
                  sent.
                </p>
              </>
            ) : null}
          </div>
        </fieldset>

        <OstOfficialFields
          grouped
          className={`${styles.formSection} ${styles.officialFields}`}
          values={official}
          onChange={(name, value) => setOfficial((current) => ({ ...current, [name]: value }))}
        />

        <section className={styles.formSection} aria-labelledby="create-ost-finish">
          <h2 id="create-ost-finish" className={styles.sectionTitle}>
            Accreditation and completion
          </h2>
          <div className={styles.formFields}>
            <label className={styles.fieldLabel}>
              Outcome
              <Select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'complete' | 'pending')}
                options={[
                  { value: 'complete', label: 'Complete now — the signed form is in hand' },
                  {
                    value: 'pending',
                    label: 'Save as pending — the sponsored workflow finishes it',
                  },
                ]}
              />
            </label>
            {mode === 'complete' ? (
              <>
                <label className={styles.fieldLabel}>
                  AA number mode
                  <Select
                    value={aaNumberMode}
                    onChange={(e) => setAaNumberMode(e.target.value as 'auto' | 'manual')}
                    options={[
                      { value: 'auto', label: 'Automatic' },
                      { value: 'manual', label: 'Manual input' },
                    ]}
                  />
                </label>
                {aaNumberMode === 'manual' ? (
                  <TextField
                    id="create-ost-aa-number"
                    name="aaNumber"
                    label="AA number"
                    value={aaNumber}
                    onChange={(value) => setAaNumber(value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="AAO26100001"
                  />
                ) : null}
                <DateField
                  id="create-ost-starts-on"
                  name="create-ost-starts-on"
                  label="Approved Start"
                  value={startsOn}
                  onChange={(value) => {
                    setStartsOn(value);
                    setExpiresOn(ostAnnualExpiry(value));
                  }}
                />
                <DateField
                  id="create-ost-expires-on"
                  name="create-ost-expires-on"
                  label="Approved Expiry"
                  value={expiresOn}
                  onChange={() => {}}
                  disabled
                />
              </>
            ) : null}
          </div>
          <p className={styles.sectionHint}>
            {mode === 'complete'
              ? 'Approves the accreditation now. The record keeps the signature dates you state and does not claim a sponsor endorsement.'
              : 'Records the application only. The sponsor endorses it, then management approves it in the OST queue.'}
          </p>
        </section>
      </form>
    </Dialog>
  );
}
