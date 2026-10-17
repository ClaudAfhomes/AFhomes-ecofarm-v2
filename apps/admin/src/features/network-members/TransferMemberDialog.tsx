/**
 * Transfer a member between the two accreditation kinds.
 *
 * A transfer is not a profile edit. The server retires the held AA number
 * into the accreditation history and issues a successor number for the new
 * kind in one transaction, so the client never sends a number and no residue
 * of the old kind survives:
 *
 * - IST -> OST creates the OST footprint (application, sponsor, member,
 *   term) and requires the signed official form, because the application is
 *   the same record the sponsored pipeline uses.
 * - OST -> IST retires the OST registration and issues a fresh one-year IST
 *   accreditation under the chosen position and its immediate head.
 *
 * Both directions demand a reason, which lands in the audit trail with the
 * before and after numbers.
 */
import { useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  MEMBER_POSITION_LABELS,
  MEMBER_UPLINE_ROLE,
  IST_POSITIONS,
  officialOstFormDefaults,
  parseOfficialOstFields,
  transferMemberSchema,
  type Member,
  type MemberDetail,
  type MemberPosition,
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
import { getMember, getMemberUplines, networkMemberKeys, transferMember } from './services';
import styles from './MembersPage.module.css';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearOn(start: string): string {
  const expires = new Date(`${start}T00:00:00Z`);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires.toISOString().slice(0, 10);
}

/** What the member holds right now, before anything changes. */
function CurrentState({ member }: { member: Member }) {
  return (
    <section className={styles.formSection} aria-labelledby="transfer-current">
      <h2 id="transfer-current" className={styles.sectionTitle}>
        Current accreditation
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

function TransferToIstForm({
  member,
  onClose,
  onTransferred,
}: {
  member: Member;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [targetPosition, setTargetPosition] = useState<MemberPosition>('sales_manager');
  const [headStaffId, setHeadStaffId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const headRole = MEMBER_UPLINE_ROLE[targetPosition];
  const heads = useQuery({
    queryKey: ['network', 'members', 'uplines', headRole],
    queryFn: () => getMemberUplines(headRole!),
    placeholderData: keepPreviousData,
    enabled: headRole !== null,
  });
  const transfer = useBusinessMutation({
    mutationFn: (input: Parameters<typeof transferMember>[1]) => transferMember(member.id, input),
  });
  const submit = () => {
    const parsed = transferMemberSchema.safeParse({
      direction: 'OST_TO_IST',
      reason,
      targetPosition,
      headStaffId: headRole === null ? null : headStaffId || null,
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
      title={`Transfer ${member.fullName} to IST`}
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
            Transfer to IST
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <CurrentState member={member} />
        <section className={styles.formSection} aria-labelledby="transfer-target">
          <h2 id="transfer-target" className={styles.sectionTitle}>
            New IST accreditation
          </h2>
          <p className={styles.sectionHint}>
            The OST registration and its current term end with this transfer; a fresh one-year IST
            accreditation is issued instead.
          </p>
          <div className={styles.formFields}>
            <label className={styles.fieldLabel}>
              Position
              <Select
                value={targetPosition}
                onChange={(e) => {
                  setTargetPosition(e.target.value as MemberPosition);
                  setHeadStaffId('');
                }}
                options={IST_POSITIONS.map((value) => ({
                  value,
                  label: MEMBER_POSITION_LABELS[value],
                }))}
              />
            </label>
            {headRole !== null ? (
              <label className={styles.fieldLabel}>
                Immediate head
                <Select
                  required
                  value={headStaffId}
                  onChange={(e) => setHeadStaffId(e.target.value)}
                  options={[
                    { value: '', label: `Choose an active ${MEMBER_POSITION_LABELS[headRole]}` },
                    ...(heads.data?.map((holder) => ({
                      value: holder.id,
                      label: holder.fullName,
                    })) ?? []),
                  ]}
                />
              </label>
            ) : null}
            <ReasonField value={reason} onChange={setReason} />
          </div>
          {heads.isError ? (
            <p className={styles.sectionHint} role="alert">
              The head list could not be loaded. Close the dialog and retry.
            </p>
          ) : null}
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
  const [expiresOn, setExpiresOn] = useState(() => oneYearOn(today()));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const sponsors = useQuery({
    queryKey: ['network', 'members', 'uplines', 'sales_manager'],
    queryFn: () => getMemberUplines('sales_manager'),
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
          city: fields.city ?? '',
          province: fields.province ?? '',
          postalCode: fields.postalCode || undefined,
          countryCode: 'PH',
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
      title={`Transfer ${member.fullName} to OST`}
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
            Transfer to OST
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
            <TextField
              id="transfer-city"
              name="transfer-city"
              label="City / Municipality"
              value={fields.city ?? ''}
              onChange={onChange('city')}
            />
            <TextField
              id="transfer-province"
              name="transfer-province"
              label="Province"
              value={fields.province ?? ''}
              onChange={onChange('province')}
            />
            <TextField
              id="transfer-postal-code"
              name="transfer-postal-code"
              label="ZIP Code"
              optional
              value={fields.postalCode ?? ''}
              onChange={onChange('postalCode')}
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
                setExpiresOn(oneYearOn(value));
              }}
            />
            <DateField
              id="transfer-expires-on"
              name="transfer-expires-on"
              label="Approved Expiry"
              value={expiresOn}
              onChange={setExpiresOn}
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
    return <TransferToIstForm member={member} onClose={onClose} onTransferred={onTransferred} />;
  if (detail.isPending)
    return (
      <Dialog open onClose={onClose} title={`Transfer ${member.fullName} to OST`}>
        <div className={styles.dialogBody} role="status" aria-label="Loading member record">
          <Skeleton style={{ height: 32 }} />
          <Skeleton style={{ height: 160 }} />
          <span className="sr-only">Loading member record…</span>
        </div>
      </Dialog>
    );
  if (detail.isError)
    return (
      <Dialog open onClose={onClose} title={`Transfer ${member.fullName} to OST`}>
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
