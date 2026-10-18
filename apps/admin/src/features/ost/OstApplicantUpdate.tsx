import { useState } from 'react';
import {
  normalizePhilippinePhone,
  ostApplicantSnapshotSchema,
  updateOstApplicantSchema,
  type UpdateOstApplicant,
} from '@afhomes/contracts';
import type { z } from 'zod';
import {
  Alert,
  Button,
  DateField,
  DetailField,
  DetailFieldGrid,
  Dialog,
  OstAddressFields,
  Select,
  TextAreaField,
  TextField,
  emptyOstAddress,
  type OstAddressSelection,
} from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { updateOstApplicant } from './services';
import { useOstAddress } from '../address/useOstAddress';
import styles from './OstAccreditationPages.module.css';

type Applicant = z.infer<typeof ostApplicantSnapshotSchema>;

const NOT_RECORDED = 'Not recorded';
/** Identity fields whose change requires a recorded reason (server re-enforces). */
const SENSITIVE_FIELDS = ['fullName', 'birthDate', 'sex', 'civilStatus'] as const;
const SEX_OPTIONS = [
  { value: '', label: 'Choose…' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const CIVIL_STATUS_OPTIONS = [
  { value: '', label: 'Choose…' },
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
];
const sexValue = (value: string | null) =>
  SEX_OPTIONS.some((option) => option.value === value && value !== '') ? value! : '';
const civilStatusValue = (value: string | null) =>
  CIVIL_STATUS_OPTIONS.some((option) => option.value === value && value !== '') ? value! : '';

const text = (value: unknown) => (value == null || value === '' ? NOT_RECORDED : String(value));
const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const addressText = (value: unknown) => {
  const address = recordOf(value);
  const parts = [address?.line1, address?.barangay, address?.city, address?.province, address?.postalCode]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(', ') : 'No address recorded';
};
const hierarchyFrom = (address: Record<string, unknown> | null): OstAddressSelection => ({
  ...emptyOstAddress(),
  regionCode: String(address?.regionCode ?? ''),
  region: String(address?.region ?? ''),
  provinceCode: String(address?.provinceCode ?? ''),
  province: String(address?.province ?? ''),
  localityCode: String(address?.localityCode ?? ''),
  city: String(address?.city ?? ''),
  barangayCode: String(address?.barangayCode ?? ''),
  barangay: String(address?.barangay ?? ''),
  postalCode: String(address?.postalCode ?? ''),
});

type Change = { label: string; from: string; to: string };
/** The changes the server will record: only fields whose value actually differs. */
function proposedChanges(current: Applicant, next: UpdateOstApplicant): Change[] {
  const rows: Change[] = [];
  const add = (label: string, from: unknown, to: unknown) => {
    const before = text(from);
    const after = text(to);
    if (before !== after) rows.push({ label, from: before, to: after });
  };
  add('Full name', current.fullName, next.fullName);
  add('Date of birth', current.birthDate, next.birthDate);
  add('Mobile number', normalizePhilippinePhone(current.phone), next.phone);
  add('Sex', current.sex, next.sex);
  add('Civil status', current.civilStatus, next.civilStatus);
  add('Facebook name', current.messenger, next.messenger);
  add('Employer', current.employerName, next.employerName);
  add('Job position', current.jobPosition, next.jobPosition);
  if (next.address) add('Home address', addressText(current.address), addressText(next.address));
  return rows;
}

const isSensitiveChange = (current: Applicant, next: UpdateOstApplicant) =>
  SENSITIVE_FIELDS.some((field) => text(current[field]) !== text(next[field]));

/**
 * Address editor for a correction, mounted only while the operator opts in.
 * The cascade stays a reference-code control: an address without verified
 * region/province/locality/barangay codes can never be submitted.
 */
function ApplicantAddressEditor({
  value,
  onChange,
  line1,
  onLine1,
}: {
  value: OstAddressSelection;
  onChange: (next: OstAddressSelection) => void;
  line1: string;
  onLine1: (next: string) => void;
}) {
  const options = useOstAddress(value);
  const nameFor = (list: { code: string; name: string }[] | undefined, code: string) =>
    list?.find((item) => item.code === code)?.name ?? '';
  // Stored corrections carry codes but not every name; the loaded reference
  // lists fill the labels a control has to display.
  const shown: OstAddressSelection = {
    ...value,
    region: value.region || nameFor(options.regions.data, value.regionCode),
    province: value.province || nameFor(options.provinces.data, value.provinceCode),
    city: value.city || nameFor(options.localities.data, value.localityCode),
    barangay: value.barangay || nameFor(options.barangays.data, value.barangayCode),
  };
  return (
    <div className={styles.editorGrid}>
      <TextField
        id="applicant-line1"
        name="line1"
        label="House / street address"
        value={line1}
        onChange={onLine1}
      />
      <OstAddressFields value={shown} onChange={onChange} {...options} />
    </div>
  );
}

/**
 * Registered applicant panel (user request Phase 4.3). Values are read-only by
 * default; "Update Information" opens the controlled correction, shows the
 * proposed changes, and records old/new values with an audit reason for
 * identity changes. Email (login identity) and program/VIP state are never
 * editable here.
 */
export function OstApplicantUpdate({
  ostId,
  current,
  programState,
  canUpdate,
  onUpdated,
}: {
  ostId: string;
  current: Applicant;
  programState: string;
  canUpdate: boolean;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({
    fullName: '',
    birthDate: '',
    phone: '',
    sex: '',
    civilStatus: '',
    messenger: '',
    employerName: '',
    jobPosition: '',
    reason: '',
  });
  const [editAddress, setEditAddress] = useState(false);
  const [line1, setLine1] = useState('');
  const [geography, setGeography] = useState(emptyOstAddress);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const save = useBusinessMutation({
    mutationFn: (body: UpdateOstApplicant) => updateOstApplicant(ostId, body),
    onSuccess: () => {
      setOpen(false);
      setSaved(true);
      onUpdated();
    },
  });

  const setField = (name: keyof typeof fields, value: string) =>
    setFields((currentFields) => ({ ...currentFields, [name]: value }));
  const openDialog = () => {
    const address = recordOf(current.address);
    setFields({
      fullName: current.fullName,
      birthDate: current.birthDate ?? '',
      phone: current.phone ?? '',
      sex: sexValue(current.sex),
      civilStatus: civilStatusValue(current.civilStatus),
      messenger: current.messenger ?? '',
      employerName: current.employerName ?? '',
      jobPosition: current.jobPosition ?? '',
      reason: '',
    });
    setLine1(String(address?.line1 ?? ''));
    setGeography(hierarchyFrom(address));
    setEditAddress(false);
    setRequestId(crypto.randomUUID());
    setError('');
    setSaved(false);
    setOpen(true);
  };
  const buildBody = () => ({
    requestId,
    ...fields,
    ...(editAddress
      ? {
          address: {
            line1,
            city: geography.city,
            province: geography.province,
            barangay: geography.barangay || undefined,
            postalCode: geography.postalCode || undefined,
            countryCode: 'PH',
          },
          addressHierarchy: {
            regionCode: geography.regionCode,
            provinceCode: geography.provinceCode,
            localityCode: geography.localityCode,
            barangayCode: geography.barangayCode,
          },
        }
      : {}),
  });
  const parsed = updateOstApplicantSchema.safeParse(buildBody());
  const changes = parsed.success ? proposedChanges(current, parsed.data) : [];

  const submit = () => {
    if (editAddress && (!geography.regionCode || !geography.provinceCode || !geography.localityCode || !geography.barangayCode)) {
      setError('Pick region, province, city, barangay.');
      return;
    }
    if (!fields.birthDate) {
      setError('Provide the date of birth.');
      return;
    }
    if (!fields.sex || !fields.civilStatus) {
      setError('Choose sex and civil status.');
      return;
    }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the applicant details.');
      return;
    }
    if (isSensitiveChange(current, parsed.data) && parsed.data.reason.trim().length < 5) {
      setError('Reason needs five characters.');
      return;
    }
    setError('');
    save.mutate(parsed.data);
  };

  return (
    <section className={styles.panel} aria-labelledby="ost-applicant-heading">
      <h2 id="ost-applicant-heading" className={styles.panelTitle}>
        Registered applicant
      </h2>
      <p className={styles.panelNote}>
        Copied into future renewals. Snapshots are never rewritten.
      </p>
      <DetailFieldGrid className={styles.fieldColumns}>
        <DetailField label="Full name">{current.fullName}</DetailField>
        <DetailField label="Date of birth">{text(current.birthDate)}</DetailField>
        <DetailField label="Sex">{text(current.sex)}</DetailField>
        <DetailField label="Civil status">{text(current.civilStatus)}</DetailField>
        <DetailField label="Mobile number">{text(current.phone)}</DetailField>
        <DetailField label="Email">{current.email ?? NOT_RECORDED} (sign-in identity)</DetailField>
        <DetailField label="Facebook name">{text(current.messenger)}</DetailField>
        <DetailField label="Employer">{text(current.employerName)}</DetailField>
        <DetailField label="Job position">{text(current.jobPosition)}</DetailField>
        <DetailField label="Home address">{addressText(current.address)}</DetailField>
        <DetailField label="Program state">{programState}</DetailField>
        <DetailField label="TIN">{text(current.tinMasked)}</DetailField>
      </DetailFieldGrid>
      {canUpdate ? (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={openDialog}>
            Update information
          </Button>
        </div>
      ) : (
        <p className={styles.panelNote}>Member-profile update permission required.</p>
      )}
      {saved ? (
        <Alert variant="success" title="Applicant information updated">
          Recorded in the audit trail. Renewal snapshots stay frozen.
        </Alert>
      ) : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Update applicant information"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <p className={styles.panelNote}>Email, program, history locked.</p>
        <div className={styles.editorGrid}>
          <TextField
            id="applicant-fullName"
            name="fullName"
            label="Full name"
            value={fields.fullName}
            onChange={(value) => setField('fullName', value)}
          />
          <DateField
            id="applicant-birthDate"
            name="birthDate"
            label="Date of birth"
            max={new Date().toISOString().slice(0, 10)}
            value={fields.birthDate}
            onChange={(value) => setField('birthDate', value)}
          />
          <TextField
            id="applicant-phone"
            name="phone"
            label="Mobile number"
            type="tel"
            inputMode="tel"
            value={fields.phone}
            onChange={(value) => setField('phone', value)}
          />
          <label className={styles.filterLabel}>
            Sex
            <Select
              required
              value={fields.sex}
              onChange={(e) => setField('sex', e.target.value)}
              options={SEX_OPTIONS}
            />
          </label>
          <label className={styles.filterLabel}>
            Civil status
            <Select
              required
              value={fields.civilStatus}
              onChange={(e) => setField('civilStatus', e.target.value)}
              options={CIVIL_STATUS_OPTIONS}
            />
          </label>
          <TextField
            id="applicant-messenger"
            name="messenger"
            label="Facebook name"
            optional
            value={fields.messenger}
            onChange={(value) => setField('messenger', value)}
          />
          <TextField
            id="applicant-employerName"
            name="employerName"
            label="Employer name"
            optional
            value={fields.employerName}
            onChange={(value) => setField('employerName', value)}
          />
          <TextField
            id="applicant-jobPosition"
            name="jobPosition"
            label="Job position"
            optional
            value={fields.jobPosition}
            onChange={(value) => setField('jobPosition', value)}
          />
        </div>
        <TextAreaField
          id="applicant-reason"
          name="reason"
          label="Change reason"
          optional
          maxLength={500}
          value={fields.reason}
          onChange={(value) => setField('reason', value)}
        />
        <label className={styles.filterLabel}>
          <span>
            <input
              type="checkbox"
              checked={editAddress}
              onChange={(e) => setEditAddress(e.target.checked)}
            />{' '}
            Change home address
          </span>
        </label>
        {editAddress ? (
          <ApplicantAddressEditor
            value={geography}
            onChange={setGeography}
            line1={line1}
            onLine1={setLine1}
          />
        ) : (
          <p className={styles.panelNote}>Current address: {addressText(current.address)}</p>
        )}
        {parsed.success && changes.length > 0 ? (
          <section className={styles.changeBlock} aria-label="Proposed changes">
            <h3 className={styles.groupTitle}>Proposed changes</h3>
            <ul className={styles.changeList}>
              {changes.map((change) => (
                <li key={change.label}>{`${change.label}: ${change.from} → ${change.to}`}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className={styles.panelNote}>No changes to record yet.</p>
        )}
        {error ? (
          <Alert variant="danger" title="Check the new values">
            {error}
          </Alert>
        ) : null}
        {save.isError ? (
          <Alert variant="danger" title="Applicant update failed">
            {save.error.message}
          </Alert>
        ) : null}
      </Dialog>
    </section>
  );
}
