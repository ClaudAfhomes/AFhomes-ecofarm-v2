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
 * Neither outcome issues an AA number by hand: the database allocates AAO from
 * the same monthly sequence every other accreditation uses.
 */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createOstMemberSchema,
  officialOstFormDefaults,
  parseOfficialOstFields,
} from '@afhomes/contracts';
import {
  Alert,
  Button,
  DateField,
  Dialog,
  OstOfficialFields,
  Select,
  TextField,
} from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { filterHolderNameInput, filterMobileInput } from '../../lib/normalize';
import { createOstMember, getMemberUplines } from './services';
import styles from './MembersPage.module.css';

const IDENTITY_FIELDS = [
  { name: 'firstName', label: 'First Name' },
  { name: 'middleName', label: 'Middle Name', optional: true },
  { name: 'lastName', label: 'Last Name' },
  { name: 'email', label: 'Email' },
  { name: 'phone', label: 'Mobile Number' },
  { name: 'line1', label: 'No. / Street' },
  { name: 'city', label: 'City / Municipality' },
  { name: 'province', label: 'Province' },
  { name: 'postalCode', label: 'ZIP Code', optional: true },
] as const;

type IdentityField = (typeof IDENTITY_FIELDS)[number]['name'] | 'birthDate';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearOn(start: string): string {
  const expires = new Date(`${start}T00:00:00Z`);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires.toISOString().slice(0, 10);
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
  const [official, setOfficial] = useState(officialOstFormDefaults);
  const [sponsorStaffId, setSponsorStaffId] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState(() => oneYearOn(today()));
  // One submission, one idempotency key: a retry after a lost response returns
  // the application already recorded instead of writing a second one.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const sponsors = useQuery({
    queryKey: ['network', 'members', 'uplines', 'sales_manager'],
    queryFn: () => getMemberUplines('sales_manager'),
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
    const form = parseOfficialOstFields(official);
    if (!form.success) {
      setError(form.error.issues[0]?.message ?? 'Check the official form.');
      return;
    }
    const parsed = createOstMemberSchema.safeParse({
      mode,
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
          city: fields.city ?? '',
          province: fields.province ?? '',
          postalCode: fields.postalCode || undefined,
          countryCode: 'PH',
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
            type="button"
            loading={create.isPending}
            loadingLabel="Creating…"
            onClick={submit}
          >
            {mode === 'complete' ? 'Create and accredit' : 'Save application'}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <section className={styles.formSection} aria-labelledby="create-ost-applicant">
          <h2 id="create-ost-applicant" className={styles.sectionTitle}>
            Applicant identity
          </h2>
          <p className={styles.sectionHint}>
            The official form's identity page. The email becomes the member's own login.
          </p>
          <div className={styles.formFields}>
            {IDENTITY_FIELDS.map(({ name, label, ...rest }) => (
              <TextField
                key={name}
                id={`create-ost-${name}`}
                name={`create-ost-${name}`}
                label={label}
                type={name === 'email' ? 'email' : 'text'}
                value={fields[name] ?? ''}
                onChange={onChange(name)}
                {...('optional' in rest && rest.optional ? { optional: true as const } : {})}
              />
            ))}
            <DateField
              id="create-ost-birthDate"
              name="create-ost-birthDate"
              label="Birth Date"
              max={today()}
              value={fields.birthDate ?? ''}
              onChange={onChange('birthDate')}
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
                    label: holder.fullName,
                  })) ?? []),
                ]}
              />
            </label>
          </div>
          {sponsors.isError ? (
            <p className={styles.sectionHint} role="alert">
              The Sales Manager list could not be loaded. Close the dialog and retry.
            </p>
          ) : null}
        </section>

        <OstOfficialFields
          values={official}
          onChange={(name, value) => setOfficial((current) => ({ ...current, [name]: value }))}
        />

        <section className={styles.formSection} aria-labelledby="create-ost-finish">
          <h2 id="create-ost-finish" className={styles.sectionTitle}>
            Finish
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
                <DateField
                  id="create-ost-starts-on"
                  name="create-ost-starts-on"
                  label="Approved Start"
                  value={startsOn}
                  onChange={(value) => {
                    setStartsOn(value);
                    setExpiresOn(oneYearOn(value));
                  }}
                />
                <DateField
                  id="create-ost-expires-on"
                  name="create-ost-expires-on"
                  label="Approved Expiry"
                  value={expiresOn}
                  onChange={setExpiresOn}
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

        {error ? (
          <Alert variant="danger" title="OST was not created">
            <p className={styles.alertText}>{error}</p>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
