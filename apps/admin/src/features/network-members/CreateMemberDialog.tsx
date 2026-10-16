import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  Combobox,
  DateField,
  Dialog,
  PasswordField,
  Select,
  TextField,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import {
  MEMBER_POSITION_LABELS,
  MEMBER_POSITIONS,
  MEMBER_UPLINE_ROLE,
  GOVERNMENT_ID_TYPE_LABELS,
  createMemberSchema,
  governmentIdTypeSchema,
  type MemberPosition,
} from '@afhomes/contracts';
import type { ComboboxOption } from '@afhomes/ui';
import {
  filterGovernmentIdInput,
  filterHolderAddressInput,
  filterHolderNameInput,
  filterLandlineInput,
  filterMemberTinInput,
  filterMobileInput,
} from '../../lib/normalize';
import { useLocalitiesQuery, useProvincesQuery } from '../address/useAddressHierarchy.js';
import { ApiError, errorFieldEntries } from '../../lib/api/errors';
import {
  createMember,
  getMemberDepartments,
  getMemberOstReferrers,
  getMemberUplines,
  AA_MANUAL_RE,
  withAaPrefix,
} from './services';
import styles from './MembersPage.module.css';

/** Reference-only age from a YYYY-MM-DD birth date. Never stored or sent. */
function ageOf(dateOfBirth: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const born = new Date(`${dateOfBirth}T00:00:00Z`).valueOf();
  if (!Number.isFinite(born)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - Number(dateOfBirth.slice(0, 4));
  const monthDay = dateOfBirth.slice(5);
  const todayMonthDay = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  if (todayMonthDay < monthDay) age -= 1;
  return age >= 0 ? age : null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// OST joins through OST registration, never here: the create picker offers
// hierarchy positions only (the server still validates the slug).
const CREATE_POSITIONS: readonly MemberPosition[] = MEMBER_POSITIONS.filter(
  (value) => value !== 'ost',
);

/**
 * Member onboarding form. Sections mirror the stated paper fields. The
 * department is fixed in Sales; every position except Vice Director names
 * its head; a Sales Manager may name an OST referrer. Age is derived and
 * read-only.
 */
export function CreateMemberDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const departments = useQuery({
    queryKey: ['network', 'members', 'departments'],
    queryFn: getMemberDepartments,
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const salesDepartment = useMemo(
    () =>
      (departments.data ?? []).find((d) => d.code === 'SALES' && d.isActive) ??
      (departments.data ?? []).find((d) => d.name.toLowerCase() === 'sales' && d.isActive) ??
      null,
    [departments.data],
  );

  const [position, setPosition] = useState<MemberPosition>('sales_manager');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState('');
  const [civilStatus, setCivilStatus] = useState('');
  const [streetNo, setStreetNo] = useState('');
  const [cityMunicipality, setCityMunicipality] = useState('');
  const [province, setProvince] = useState('');
  const [provinceCode, setProvinceCode] = useState('');
  const [localityCode, setLocalityCode] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [telNo, setTelNo] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [fbMessenger, setFbMessenger] = useState('');
  const [tin, setTin] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [employerAddress, setEmployerAddress] = useState('');
  const [jobPosition, setJobPosition] = useState('');
  const [governmentIdType, setGovernmentIdType] = useState('');
  const [governmentIdNumber, setGovernmentIdNumber] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [headStaffId, setHeadStaffId] = useState('');
  const [ostReferrerStaffId, setOstReferrerStaffId] = useState('');
  const [aaMode, setAaMode] = useState<'auto' | 'manual'>('auto');
  const [aaNumber, setAaNumber] = useState('');

  const uplineRole = MEMBER_UPLINE_ROLE[position];
  const heads = useQuery({
    queryKey: ['network', 'members', 'uplines', position],
    queryFn: () => getMemberUplines(position),
    placeholderData: keepPreviousData,
    enabled: open && uplineRole !== null,
  });
  const ostReferrers = useQuery({
    queryKey: ['network', 'members', 'ost-referrers'],
    queryFn: getMemberOstReferrers,
    placeholderData: keepPreviousData,
    enabled: open && position === 'sales_manager',
  });

  // Province and city come from the PSGC reference, never typed: the
  // combobox draft never commits, so state only ever holds a listed value.
  // The ZIP follows the chosen locality and locks; when the source publishes
  // no postal code the field stays hand-typed.
  const provinces = useProvincesQuery(open);
  const localities = useLocalitiesQuery(provinceCode || undefined);
  const selectedLocality =
    (localities.data ?? []).find((locality) => locality.code === localityCode) ?? null;
  const zipPublished = selectedLocality?.postalCode != null;

  const pickProvince = (option: ComboboxOption | null) => {
    setProvince(option?.name ?? '');
    setProvinceCode(option?.code ?? '');
    setCityMunicipality('');
    setLocalityCode('');
    setZipCode('');
  };
  const pickLocality = (option: ComboboxOption | null) => {
    const full = (localities.data ?? []).find((locality) => locality.code === option?.code);
    setCityMunicipality(full?.name ?? '');
    setLocalityCode(full?.code ?? '');
    setZipCode(full?.postalCode ?? '');
  };

  const age = ageOf(dateOfBirth);

  const save = useBusinessMutation({
    mutationFn: () => {
      // Client-side first net: the SAME contract the server enforces, so a
      // mistyped field is named before the request leaves (the server stays
      // authoritative and re-checks everything, including head, department
      // and duplicates, which only it can judge).
      const payload = {
        fullName: fullName.trim(),
        email: email.trim(),
        temporaryPassword,
        departmentId: salesDepartment?.id ?? '',
        position,
        dateOfBirth,
        sex: sex as 'Male' | 'Female',
        civilStatus: civilStatus as 'Single' | 'Married' | 'Widowed' | 'Separated',
        streetNo: streetNo.trim(),
        cityMunicipality: cityMunicipality.trim(),
        province: province.trim(),
        provinceCode,
        cityMunicipalityCode: localityCode,
        zipCode: zipCode.trim(),
        telNo: telNo.trim() || undefined,
        mobileNo: mobileNo.trim(),
        fbMessenger: fbMessenger.trim() || undefined,
        tin: tin.trim() || undefined,
        employerName: employerName.trim(),
        employerAddress: employerAddress.trim(),
        jobPosition: jobPosition.trim(),
        governmentIdType: governmentIdType as
          | 'philippine_id'
          | 'drivers_license'
          | 'passport'
          | 'tax_id'
          | 'other',
        governmentIdNumber: governmentIdNumber.trim(),
        referrerStaffId: headStaffId || null,
        ostReferrerStaffId: position === 'sales_manager' ? ostReferrerStaffId || null : null,
        aaNumberMode: aaMode,
        aaNumber: aaMode === 'manual' ? aaNumber.trim().toUpperCase() || undefined : undefined,
      };
      const checked = createMemberSchema.safeParse(payload);
      if (!checked.success) {
        const details: Record<string, string> = {};
        for (const issue of checked.error.issues.slice(0, 8))
          details[issue.path.map(String).join('.') || 'form'] = issue.message;
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          message: 'Some fields need attention',
          status: 400,
          details,
        });
      }
      return createMember(checked.data);
    },
    onSuccess: (created) => {
      notifySuccess({ title: 'Member created', message: `${created.fullName} was added.` });
      onCreated();
    },
    // A centered modal, not just an inline line: a failed save must be
    // impossible to miss, wherever the dialog has scrolled.
    onError: (error) => {
      const fields = errorFieldEntries(error);
      notifyError({
        title: 'Member not created',
        message: error.message,
        ...(fields.length > 0
          ? { detail: fields.map(([field, reason]) => `${field}: ${reason}`).join('\n') } : {}),
      });
    },
  });

  const requiredFilled =
    salesDepartment !== null &&
    fullName.trim().length > 1 &&
    dateOfBirth.length === 10 &&
    age !== null &&
    sex !== '' &&
    civilStatus !== '' &&
    streetNo.trim() !== '' &&
    cityMunicipality.trim() !== '' &&
    province.trim() !== '' &&
    zipCode.trim() !== '' &&
    mobileNo.trim() !== '' &&
    employerName.trim() !== '' &&
    employerAddress.trim() !== '' &&
    jobPosition.trim() !== '' &&
    governmentIdType !== '' &&
    governmentIdNumber.trim() !== '' &&
    email.trim() !== '' &&
    temporaryPassword.length >= 8 &&
    temporaryPassword === confirmPassword &&
    (uplineRole === null || headStaffId !== '');
  const manualAaOk = aaMode === 'auto' || AA_MANUAL_RE.test(aaNumber.trim().toUpperCase());
  const canSave = requiredFilled && manualAaOk && !save.isPending;

  // The Create button is gated, never silent: the first unmet requirement
  // reads as guidance so a dead button always explains itself.
  function disabledReason(): string | null {
    if (save.isPending || canSave) return null;
    if (departments.isPending) return 'Loading sales team…';
    if (salesDepartment === null)
      return departments.error instanceof ApiError && departments.error.status === 403
        ? 'Department access required.'
        : 'Sales team unavailable. Reload.';
    if (fullName.trim().length <= 1) return 'Enter the full name.';
    if (dateOfBirth.length !== 10 || age === null) return 'Enter a valid birth date.';
    if (sex === '') return 'Pick a sex.';
    if (civilStatus === '') return 'Pick a civil status.';
    if (
      streetNo.trim() === '' ||
      cityMunicipality.trim() === '' ||
      province.trim() === '' ||
      zipCode.trim() === ''
    )
      return 'Complete the home address.';
    if (mobileNo.trim() === '') return 'Enter the mobile number.';
    if (employerName.trim() === '' || employerAddress.trim() === '' || jobPosition.trim() === '')
      return 'Complete the work details.';
    if (governmentIdType === '' || governmentIdNumber.trim() === '')
      return 'Pick an ID type and number.';
    if (email.trim() === '') return 'Enter the email address.';
    if (temporaryPassword.length < 8) return 'Password needs 8+ characters.';
    if (temporaryPassword !== confirmPassword) return 'Passwords must match.';
    if (aaMode === 'manual' && !AA_MANUAL_RE.test(aaNumber.trim().toUpperCase()))
      return 'Type a valid AA number.';
    if (uplineRole !== null && headStaffId === '') return 'Pick a head to continue.';
    return null;
  }
  const blockedWhy = disabledReason();
  const serverFields = errorFieldEntries(save.error);

  const reset = () => {
    setPosition('sales_manager');
    setFullName('');
    setDateOfBirth('');
    setSex('');
    setCivilStatus('');
    setStreetNo('');
    setCityMunicipality('');
    setProvince('');
    setProvinceCode('');
    setLocalityCode('');
    setZipCode('');
    setTelNo('');
    setMobileNo('');
    setFbMessenger('');
    setTin('');
    setEmployerName('');
    setEmployerAddress('');
    setJobPosition('');
    setGovernmentIdType('');
    setGovernmentIdNumber('');
    setEmail('');
    setTemporaryPassword('');
    setConfirmPassword('');
    setHeadStaffId('');
    setOstReferrerStaffId('');
    setAaMode('auto');
    setAaNumber('');
    save.reset();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Create Member"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Assignment</legend>
          <div className={styles.formFields}>
            <div className={styles.inlinePair}>
              <label className={styles.fieldLabel}>
                Department
                <Select
                  aria-label="Department"
                  value={salesDepartment?.id ?? ''}
                  onChange={() => {}}
                  disabled
                  options={
                    salesDepartment
                      ? [{ value: salesDepartment.id, label: salesDepartment.name }]
                      : [{ value: '', label: 'Sales unavailable' }]
                  }
                />
              </label>
              <label className={styles.fieldLabel}>
                Position
                <Select
                  aria-label="Position"
                  value={position}
                  onChange={(e) => {
                    setPosition(e.target.value as MemberPosition);
                    setHeadStaffId('');
                    setOstReferrerStaffId('');
                  }}
                  options={CREATE_POSITIONS.map((value) => ({
                    value,
                    label: MEMBER_POSITION_LABELS[value],
                  }))}
                />
              </label>
            </div>
            {salesDepartment === null && !departments.isPending ? (
              <p role="alert">
                {departments.error instanceof ApiError && departments.error.status === 403
                  ? 'Department access required.'
                  : 'Sales team unavailable. Reload.'}
              </p>
            ) : null}
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Identity</legend>
          <div className={styles.formFields}>
            <TextField
              id="member-name"
              name="member-name"
              label="Full Name"
              value={fullName}
              suggestName
              normalize={filterHolderNameInput}
              onChange={setFullName}
              autoComplete="name"
            />
            <div className={styles.inlinePair}>
              <DateField
                id="member-dob"
                name="member-dob"
                label="Date of Birth"
                value={dateOfBirth}
                onChange={setDateOfBirth}
                max={todayIso()}
              />
              <TextField
                id="member-age"
                name="member-age"
                label="Age"
                value={age === null ? '' : String(age)}
                onChange={() => {}}
                readOnly
                optional
              />
            </div>
            <div className={styles.inlinePair}>
              <label className={styles.fieldLabel}>
                Sex
                <Select
                  aria-label="Sex"
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                  options={[
                    { value: '', label: 'Select' },
                    { value: 'Male', label: 'Male' },
                    { value: 'Female', label: 'Female' },
                  ]}
                />
              </label>
              <label className={styles.fieldLabel}>
                Civil Status
                <Select
                  aria-label="Civil Status"
                  value={civilStatus}
                  onChange={(e) => setCivilStatus(e.target.value)}
                  options={[
                    { value: '', label: 'Select' },
                    { value: 'Single', label: 'Single' },
                    { value: 'Married', label: 'Married' },
                    { value: 'Widowed', label: 'Widowed' },
                    { value: 'Separated', label: 'Separated' },
                  ]}
                />
              </label>
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Home Address</legend>
          <div className={styles.formFields}>
            <TextField
              id="member-street"
              name="member-street"
              label="No. / Street"
              value={streetNo}
              normalize={filterHolderAddressInput}
              onChange={setStreetNo}
              autoComplete="street-address"
            />
            <div className={styles.inlinePair}>
              <Combobox
                id="member-province"
                label="Province"
                required
                loading={provinces.isFetching}
                loadingLabel="Loading provinces"
                error={provinces.isError ? 'Unable to load provinces. Try again.' : null}
                onRetry={() => void provinces.refetch()}
                value={provinceCode ? { code: provinceCode, name: province } : null}
                options={provinces.data ?? []}
                onSelect={pickProvince}
              />
              <Combobox
                id="member-city"
                label="City / Municipality"
                required
                disabled={!provinceCode}
                loading={localities.isFetching}
                loadingLabel="Loading cities and municipalities"
                error={
                  provinceCode && localities.isError
                    ? 'Unable to load cities. Try again.'
                    : null
                }
                onRetry={() => void localities.refetch()}
                value={localityCode ? { code: localityCode, name: cityMunicipality } : null}
                options={localities.data ?? []}
                onSelect={pickLocality}
              />
            </div>
            <TextField
              id="member-zip"
              name="member-zip"
              label="ZIP Code"
              value={zipCode}
              onChange={(value) => {
                if (!zipPublished) setZipCode(value);
              }}
              autoComplete="postal-code"
              readOnly={zipPublished}
            />
            {localityCode && !zipPublished ? (
              <p className={styles.sectionHint}>No published ZIP. Type one.</p>
            ) : null}
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Contact</legend>
          <div className={styles.formFields}>
            <div className={styles.inlinePair}>
              <TextField
                id="member-tel"
                name="member-tel"
                label="Tel No."
                value={telNo}
                onChange={(value) => setTelNo(filterLandlineInput(value))}
                autoComplete="tel"
                optional
              />
              <TextField
                id="member-mobile"
                name="member-mobile"
                label="Mobile No."
                value={mobileNo}
                onChange={(value) => setMobileNo(filterMobileInput(value))}
                autoComplete="tel-national"
              />
            </div>
            <TextField
              id="member-fb"
              name="member-fb"
              label="FB / Messenger Name"
              value={fbMessenger}
              onChange={setFbMessenger}
              optional
            />
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Work</legend>
          <div className={styles.formFields}>
            <TextField
              id="member-employer"
              name="member-employer"
              label="Business / Employer Name"
              value={employerName}
              onChange={setEmployerName}
              autoComplete="organization"
            />
            <TextField
              id="member-employer-address"
              name="member-employer-address"
              label="Business / Employer Address"
              value={employerAddress}
              onChange={setEmployerAddress}
            />
            <TextField
              id="member-job"
              name="member-job"
              label="Job Position"
              value={jobPosition}
              onChange={setJobPosition}
              autoComplete="organization-title"
            />
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Government IDs</legend>
          <div className={styles.formFields}>
            <div className={styles.inlinePair}>
              <label className={styles.fieldLabel}>
                Government ID Type
                <Select
                  aria-label="Government ID Type"
                  value={governmentIdType}
                  onChange={(e) => setGovernmentIdType(e.target.value)}
                  options={[
                    { value: '', label: 'Select ID type' },
                    ...governmentIdTypeSchema.options.map((value) => ({
                      value,
                      label: GOVERNMENT_ID_TYPE_LABELS[value],
                    })),
                  ]}
                />
              </label>
              <TextField
                id="member-govid"
                name="member-govid"
                label="Government ID Number"
                value={governmentIdNumber}
                onChange={(value) => setGovernmentIdNumber(filterGovernmentIdInput(value))}
              />
            </div>
            <TextField
              id="member-tin"
              name="member-tin"
              label="TIN"
              value={tin}
              onChange={(value) => setTin(filterMemberTinInput(value))}
              optional
            />
          </div>
        </fieldset>

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>Account</legend>
          <p className={styles.sectionHint}>Member signs in with email.</p>
          <div className={styles.formFields}>
            <TextField
              id="member-email"
              name="member-email"
              label="Email"
              type="email"
              value={email}
              onChange={(value) => setEmail(value.toLowerCase().replace(/\s+/g, ''))}
              autoComplete="email"
            />
            <div className={styles.inlinePair}>
              <PasswordField
                id="member-temp-password"
                label="Temporary password"
                value={temporaryPassword}
                onChange={setTemporaryPassword}
                autoComplete="new-password"
              />
              <PasswordField
                id="member-temp-password-confirm"
                label="Confirm password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
            </div>
          </div>
        </fieldset>

        {uplineRole !== null ? (
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Head</legend>
            <p className={styles.sectionHint}>
              The {MEMBER_POSITION_LABELS[uplineRole]} this member serves under.
            </p>
            <div className={styles.formFields}>
              <label className={styles.fieldLabel}>
                {MEMBER_POSITION_LABELS[uplineRole]}
                <Select
                  aria-label="Head"
                  value={headStaffId}
                  onChange={(e) => setHeadStaffId(e.target.value)}
                  options={[
                    { value: '', label: 'Select head' },
                    ...(heads.data ?? []).map((u) => ({
                      value: u.id,
                      label: `${u.fullName}${u.employeeNumber ? ` · ${u.employeeNumber}` : ''}`,
                    })),
                  ]}
                />
              </label>
              {heads.isError ? <p role="alert">Heads failed to load. Retry.</p> : null}
              {!heads.isPending && !heads.isError && (heads.data ?? []).length === 0 ? (
                <Alert variant="info" title="No heads found">
                  Add a {MEMBER_POSITION_LABELS[uplineRole]} first.
                </Alert>
              ) : null}
            </div>
          </fieldset>
        ) : (
          <Alert variant="info" title="No head">
            A Vice Director has no head.
          </Alert>
        )}

        {position === 'sales_manager' ? (
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Referrer Details</legend>
            <p className={styles.sectionHint}>The OST referrer, when there is one.</p>
            <div className={styles.formFields}>
              <label className={styles.fieldLabel}>
                OST Referrer (Optional)
                <Select
                  aria-label="OST Referrer"
                  value={ostReferrerStaffId}
                  onChange={(e) => setOstReferrerStaffId(e.target.value)}
                  options={[
                    { value: '', label: 'No referrer' },
                    ...(ostReferrers.data ?? []).map((u) => ({
                      value: u.id,
                      label: `${u.fullName}${u.employeeNumber ? ` · ${u.employeeNumber}` : ''}`,
                    })),
                  ]}
                />
              </label>
            </div>
          </fieldset>
        ) : null}

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>AA Number</legend>
          <p className={styles.sectionHint}>System issues it, or type one.</p>
          <div className={styles.formFields}>
            <label className={styles.fieldLabel}>
              AA Number Source
              <Select
                aria-label="AA Number Source"
                value={aaMode}
                onChange={(e) => {
                  setAaMode(e.target.value as 'auto' | 'manual');
                  setAaNumber('AA');
                }}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: 'manual', label: 'Manual' },
                ]}
              />
            </label>
            {aaMode === 'manual' ? (
              <TextField
                id="member-aa-number"
                name="member-aa-number"
                label="AA Number"
                value={aaNumber}
                onChange={(value) => setAaNumber(withAaPrefix(value))}
                placeholder="AAXXXXXXXXXXXX"
              />
            ) : null}
          </div>
        </fieldset>

        <Alert variant="info" title="First login">
          First sign-in needs password change.
        </Alert>
        {blockedWhy ? <p className={styles.sectionHint}>{blockedWhy}</p> : null}
        {save.error ? (
          <div role="alert">
            <p>{save.error.message}</p>
            {serverFields.length > 0 ? (
              <ul>
                {serverFields.map(([field, reason]) => (
                  <li key={field}>
                    {field}: {reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
