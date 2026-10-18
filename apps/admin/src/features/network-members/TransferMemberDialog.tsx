import { OstTeamTransferDialog } from './OstTeamTransferDialog';
import { getOstSponsors } from '../ost/services';
import { OstAddressFields, emptyOstAddress } from '@afhomes/ui';
import { useOstAddress } from '../address/useOstAddress';
/**
 * OST opens a genealogy-only team move. IST opens its distinct conversion
 * workflow, preserving the accreditation suffix and recording the signed form.
 */
import { useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  officialOstFormDefaults,
  ostAnnualExpiry,
  parseOfficialOstFields,
  transferMemberSchema,
  type Member,
  type MemberDetail,
} from '@afhomes/contracts';
import {
  Alert,
  Button,
  DateField,
  Dialog,
  OstOfficialFields,
  Select,
  Skeleton,
  TextField,
} from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { filterHolderNameInput, filterMobileInput } from '../../lib/normalize';
import { getMember, networkMemberKeys, transferMember } from './services';
import styles from './MembersPage.module.css';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What the member holds right now, before anything changes. */
function CurrentState({ member }: { member: Member }) {
  return (
    <section className={styles.formSection} aria-labelledby="transfer-current">
      <h2 id="transfer-current" className={styles.sectionTitle}>
        {member.position === 'ost' ? 'Current accreditation' : 'Current employee identity'}
      </h2>
      <div className={styles.formFields}>
        <p className={styles.sectionHint}>
          {member.fullName} — {member.positionLabel}
          {member.aaNumber ? `, ${member.aaNumber}` : ', no AA number yet'}
        </p>
        <p className={styles.sectionHint}>
          The held number is revoked — never renumbered — and stays resolvable in the accreditation
          history through its successor.
        </p>
      </div>
    </section>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <TextField
      id="transfer-reason"
      name="transfer-reason"
      label="Reason for transfer"
      value={value}
      onChange={onChange}
      hint="Recorded with the old and new numbers in the audit trail."
    />
  );
}

function TransferToOstForm({
  member,
  detail,
  onClose,
  onTransferred,
}: {
  member: Member;
  detail: MemberDetail;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>(() => ({
    firstName: '',
    middleName: '',
    lastName: '',
    phone: member.mobileNo ?? '',
    birthDate: member.dateOfBirth ?? '',
    line1: member.streetNo ?? '',
    city: member.cityMunicipality ?? '',
    province: member.province ?? '',
    postalCode: member.zipCode ?? '',
  }));
  const [geography, setGeography] = useState(emptyOstAddress);
  const addressOptions = useOstAddress(geography, false);
  const [official, setOfficial] = useState<Record<string, string>>(() => ({
    ...officialOstFormDefaults(),
    sex: detail.sex?.toLowerCase() ?? '',
    civilStatus: detail.civilStatus?.toLowerCase() ?? '',
    telephone: detail.telNo ?? '',
    messenger: detail.fbMessenger ?? '',
    tin: detail.tin ?? '',
    employerName: detail.employerName ?? '',
    employerAddress: detail.employerAddress ?? '',
    jobPosition: detail.jobPosition ?? '',
    governmentIdType: detail.governmentIdType ?? '',
    governmentIdNumber: detail.governmentIdNumber ?? '',
  }));
  const [sponsorStaffId, setSponsorStaffId] = useState(member.ostReferrerStaffId ?? '');
  const [startsOn, setStartsOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState(() => ostAnnualExpiry(today()));
  const [reason, setReason] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const sponsors = useQuery({
    queryKey: ['ost', 'manual-sponsors'],
    queryFn: getOstSponsors,
    placeholderData: keepPreviousData,
  });
  const transfer = useBusinessMutation({
    mutationFn: (input: Parameters<typeof transferMember>[1]) => transferMember(member.id, input),
  });
  const onChange = (name: string) => (value: string) =>
    setFields((current) => ({
      ...current,
      [name]:
        name === 'phone'
          ? filterMobileInput(value)
          : name === 'firstName' || name === 'middleName' || name === 'lastName'
            ? filterHolderNameInput(value)
            : value,
    }));
  const submit = () => {
    const form = parseOfficialOstFields(official);
    if (!form.success) {
      setError(form.error.issues[0]?.message ?? 'Check the official form.');
      return;
    }
    const parsed = transferMemberSchema.safeParse({
      direction: 'IST_TO_OST',
      requestId,
      reason,
      sponsorStaffId,
      identity: {
        firstName: fields.firstName ?? '',
        middleName: fields.middleName || undefined,
        lastName: fields.lastName ?? '',
        // The member's own login: a different address would mint a second
        // identity for one person, and the server refuses it.
        email: member.email,
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
      startsOn,
      expiresOn,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Complete the transfer details.');
      return;
    }
    setError('');
    transfer.mutate(parsed.data, {
      onSuccess: onTransferred,
      onError: (failure) => setError(failure.message),
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Convert ${member.fullName} to OST`}
      footer={
        <>
          {!reason.trim() ? (
            <p className={styles.footerHint} role="status">
              Give a reason to transfer.
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={transfer.isPending}
            loadingLabel="Transferring…"
            onClick={submit}
          >
            Convert to OST
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <CurrentState member={member} />
        <section className={styles.formSection} aria-labelledby="transfer-applicant">
          <h2 id="transfer-applicant" className={styles.sectionTitle}>
            Applicant identity
          </h2>
          <p className={styles.sectionHint}>
            The official form's identity page. The application keeps {member.email}, the member's
            own login.
          </p>
          <div className={styles.formFields}>
            <TextField
              id="transfer-first-name"
              name="transfer-first-name"
              label="First Name"
              value={fields.firstName ?? ''}
              onChange={onChange('firstName')}
            />
            <TextField
              id="transfer-middle-name"
              name="transfer-middle-name"
              label="Middle Name"
              optional
              value={fields.middleName ?? ''}
              onChange={onChange('middleName')}
            />
            <TextField
              id="transfer-last-name"
              name="transfer-last-name"
              label="Last Name"
              value={fields.lastName ?? ''}
              onChange={onChange('lastName')}
            />
            <TextField
              id="transfer-phone"
              name="transfer-phone"
              label="Mobile Number"
              value={fields.phone ?? ''}
              onChange={onChange('phone')}
            />
            <DateField
              id="transfer-birth-date"
              name="transfer-birth-date"
              label="Birth Date"
              max={today()}
              value={fields.birthDate ?? ''}
              onChange={onChange('birthDate')}
            />
            <TextField
              id="transfer-line1"
              name="transfer-line1"
              label="No. / Street"
              value={fields.line1 ?? ''}
              onChange={onChange('line1')}
            />
            <OstAddressFields
              showRegion={false}
              value={geography}
              onChange={setGeography}
              {...addressOptions}
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
              The Sales Manager list could not be loaded. Close the dialog and retry.
            </p>
          ) : null}
        </section>
        <OstOfficialFields
          grouped
          className={`${styles.formSection} ${styles.officialFields}`}
          values={official}
          onChange={(name, value) => setOfficial((current) => ({ ...current, [name]: value }))}
        />
        <section className={styles.formSection} aria-labelledby="transfer-validity">
          <h2 id="transfer-validity" className={styles.sectionTitle}>
            Transfer validity
          </h2>
          <div className={styles.formFields}>
            <DateField
              id="transfer-starts-on"
              name="transfer-starts-on"
              label="Approved Start"
              value={startsOn}
              onChange={(value) => {
                setStartsOn(value);
                setExpiresOn(ostAnnualExpiry(value));
              }}
            />
            <DateField
              id="transfer-expires-on"
              name="transfer-expires-on"
              label="Approved Expiry"
              value={expiresOn}
              onChange={() => {}}
              disabled
            />
            <ReasonField value={reason} onChange={setReason} />
          </div>
          <p className={styles.sectionHint}>
            Both signatures and their dates are required: the record keeps the evidence you state
            and does not claim a sponsor endorsement.
          </p>
        </section>
        {error ? (
          <Alert variant="danger" title="Member was not transferred">
            <p className={styles.alertText}>{error}</p>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

export function TransferMemberDialog({
  member,
  onClose,
  onTransferred,
}: {
  member: Member;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const toOst = member.position !== 'ost';
  // The official form needs the recorded personal details; the read is the
  // same record the member view already shows, so it comes from cache.
  const detail = useQuery({
    queryKey: networkMemberKeys.detail(member.id),
    queryFn: () => getMember(member.id),
    enabled: toOst,
  }) as UseQueryResult<MemberDetail>;
  if (!toOst)
    return (
      <OstTeamTransferDialog member={member} onClose={onClose} onTransferred={onTransferred} />
    );
  if (detail.isPending)
    return (
      <Dialog open onClose={onClose} title={`Convert ${member.fullName} to OST`}>
        <div className={styles.dialogBody} role="status" aria-label="Loading member record">
          <Skeleton style={{ height: 32 }} />
          <Skeleton style={{ height: 160 }} />
          <span className="sr-only">Loading member record…</span>
        </div>
      </Dialog>
    );
  if (detail.isError)
    return (
      <Dialog open onClose={onClose} title={`Convert ${member.fullName} to OST`}>
        <div className={styles.dialogBody}>
          <Alert variant="danger" title="The member record could not be loaded">
            <p className={styles.alertText}>
              The official form needs the recorded details. Close the dialog and retry.
            </p>
          </Alert>
        </div>
      </Dialog>
    );
  return (
    <TransferToOstForm
      member={member}
      detail={detail.data}
      onClose={onClose}
      onTransferred={onTransferred}
    />
  );
}
