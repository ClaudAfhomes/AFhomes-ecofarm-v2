/**
 * The single Member form, shared by Create and Edit.
 *
 * One component renders the same sections, the same controls and the same
 * live filters in both dialogs, so the two can never drift apart. Create
 * posts everything; Edit sends the same values back with the changes the
 * operator made. Only the mode-specific facts are stated in the UI:
 *
 * - the temporary password is optional when editing (blank keeps the current
 *   credential; typing one resets it and forces a change at next sign-in);
 * - TIN and the government ID number start blank when editing and stay
 *   unchanged until typed (they are write-only);
 * - an issued AA number reads as issued - it can never be re-numbered - while
 *   a missing one offers the same issue controls the record view uses;
 * - a head move names its reason: the change is audited.
 *
 * Province and city come from the PSGC reference and the ZIP follows the
 * chosen city (a locality with no published code keeps a hand-typed ZIP).
 * Legacy rows saved before verification show their recorded text until the
 * operator picks from the list again; saving untouched text keeps it.
 */
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Combobox,
  DateField,
  Dialog,
  PasswordField,
  ProfilePhotoEditor,
  Select,
  Spinner,
  TextField,
} from '@afhomes/ui';
import {
  GOVERNMENT_ID_TYPE_LABELS,
  MEMBER_POSITION_LABELS,
  MEMBER_POSITIONS,
  MEMBER_UPLINE_ROLE,
  governmentIdTypeSchema,
  manualIstAaNumberSchema,
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
import { ApiError, errorFieldEntries } from '../../lib/api/errors';
import { useLocalitiesQuery, useProvincesQuery } from '../address/useAddressHierarchy.js';
import {
  getMemberDepartments,
  getMemberOstReferrers,
  getMemberUplines,
  normalizeAaEntry,
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
// hierarchy positions only. The edit picker shows the same levels and only
// renders OST as a disabled marker when the record already holds it (the
// server still validates the slug).
const CREATE_POSITIONS: readonly MemberPosition[] = MEMBER_POSITIONS.filter(
  (value) => value !== 'ost',
);

/** Every value the form edits, prefilled from the record when editing. */
export interface MemberFormSeed {
  position: MemberPosition;
  fullName: string;
  dateOfBirth: string;
  sex: string;
  civilStatus: string;
  streetNo: string;
  province: string;
  provinceCode: string;
  cityMunicipality: string;
  cityMunicipalityCode: string;
  zipCode: string;
  telNo: string;
  mobileNo: string;
  fbMessenger: string;
  employerName: string;
  employerAddress: string;
  jobPosition: string;
  governmentIdType: string;
  /** Write-only: blank keeps the stored value (edit) / is required (create). */
  governmentIdNumber: string;
  /** Write-only: blank keeps the stored value (edit) / optional (create). */
  tin: string;
  email: string;
  headStaffId: string;
  ostReferrerStaffId: string;
}

/** The form's submit payload: the seed plus everything else it owns. */
export interface MemberFormValues extends MemberFormSeed {
  profilePhotoBase64: string;
  departmentId: string;
  temporaryPassword: string;
  confirmPassword: string;
  headChangeReason: string;
  aaMode: 'auto' | 'manual';
  aaNumber: string;
}

/**
 * The shared member form dialog. The parent renders it only while open, so
 * the seed becomes the initial state exactly once per session; a polled
 * record refresh never yanks a half-typed field.
 */
export function MemberFormDialog({
  open,
  mode,
  title,
  seed,
  aaNumber = null,
  onSubmit,
  isSubmitting,
  submitError,
  onClose,
  onIssueAa,
  isIssuingAa = false,
  aaIssueError,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  title: string;
  seed: MemberFormSeed;
  /** Edit only: the issued AA number. Null renders the issue controls. */
  aaNumber?: string | null;
  onSubmit: (values: MemberFormValues) => void;
  isSubmitting: boolean;
  submitError: unknown;
  onClose: () => void;
  onIssueAa?: (input: { aaNumberMode: 'auto' | 'manual'; aaNumber?: string }) => void;
  isIssuingAa?: boolean;
  aaIssueError?: unknown;
}) {
  const editing = mode === 'edit';
  const [profilePhotoBase64, setProfilePhotoBase64] = useState('');

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

  const [position, setPosition] = useState<MemberPosition>(seed.position);
  const [fullName, setFullName] = useState(seed.fullName);
  const [dateOfBirth, setDateOfBirth] = useState(seed.dateOfBirth);
  const [sex, setSex] = useState(seed.sex);
  const [civilStatus, setCivilStatus] = useState(seed.civilStatus);
  const [streetNo, setStreetNo] = useState(seed.streetNo);
  const [cityMunicipality, setCityMunicipality] = useState(seed.cityMunicipality);
  const [province, setProvince] = useState(seed.province);
  const [provinceCode, setProvinceCode] = useState(seed.provinceCode);
  const [localityCode, setLocalityCode] = useState(seed.cityMunicipalityCode);
  const [zipCode, setZipCode] = useState(seed.zipCode);
  const [telNo, setTelNo] = useState(seed.telNo);
  const [mobileNo, setMobileNo] = useState(seed.mobileNo);
  const [fbMessenger, setFbMessenger] = useState(seed.fbMessenger);
  const [tin, setTin] = useState(seed.tin);
  const [employerName, setEmployerName] = useState(seed.employerName);
  const [employerAddress, setEmployerAddress] = useState(seed.employerAddress);
  const [jobPosition, setJobPosition] = useState(seed.jobPosition);
  const [governmentIdType, setGovernmentIdType] = useState(seed.governmentIdType);
  const [governmentIdNumber, setGovernmentIdNumber] = useState(seed.governmentIdNumber);
  const [email, setEmail] = useState(seed.email);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [headStaffId, setHeadStaffId] = useState(seed.headStaffId);
  const [ostReferrerStaffId, setOstReferrerStaffId] = useState(seed.ostReferrerStaffId);
  const [headChangeReason, setHeadChangeReason] = useState('');
  const [aaMode, setAaMode] = useState<'auto' | 'manual'>('auto');
  const [aaNumberInput, setAaNumberInput] = useState('');

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
  // The ZIP is the operator's: the chosen locality prefills it, but the
  // reference's own postal code is only a suggestion (PSGC answers 4018 for
  // Victoria, Laguna, whose ZIP is 4011), so it is never locked and the
  // server stores what was typed.
  const provinces = useProvincesQuery(open);
  const localities = useLocalitiesQuery(provinceCode || undefined);

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
  const headMoves = (headStaffId || null) !== (seed.headStaffId || null);
  // Create only: OST can never be picked, but a hand-crafted seed is still
  // displayed honestly.
  const positionOptions = useMemo(() => {
    const options = CREATE_POSITIONS.map((value) => ({
      value,
      label: MEMBER_POSITION_LABELS[value],
    }));
    if (editing && position === 'ost')
      return [{ value: 'ost', label: MEMBER_POSITION_LABELS.ost, disabled: true }, ...options];
    return options;
  }, [editing, position]);

  const manualAaOk = aaMode === 'auto' || manualIstAaNumberSchema.safeParse(aaNumberInput).success;
  const passwordFilled = temporaryPassword !== '' || confirmPassword !== '';
  const passwordOk = editing
    ? !passwordFilled || (temporaryPassword.length >= 8 && temporaryPassword === confirmPassword)
    : temporaryPassword.length >= 8 && temporaryPassword === confirmPassword;

  const requiredFilled =
    (editing || profilePhotoBase64 !== '') &&
    (editing || salesDepartment !== null) &&
    fullName.trim().length > 1 &&
    dateOfBirth.length === 10 &&
    age !== null &&
    sex !== '' &&
    civilStatus !== '' &&
    streetNo.trim() !== '' &&
    cityMunicipality.trim() !== '' &&
    province.trim() !== '' &&
    zipCode.trim() !== '' &&
    (!editing || (provinceCode !== '') === (localityCode !== '')) &&
    mobileNo.trim() !== '' &&
    employerName.trim() !== '' &&
    employerAddress.trim() !== '' &&
    jobPosition.trim() !== '' &&
    (editing
      ? governmentIdNumber.trim() === '' || governmentIdType !== ''
      : governmentIdType !== '' && governmentIdNumber.trim() !== '') &&
    email.trim() !== '' &&
    passwordOk &&
    (!editing || !headMoves || headChangeReason.trim().length >= 3) &&
    (uplineRole === null || headStaffId !== '') &&
    (editing || manualAaOk);
  const canSave = requiredFilled && !isSubmitting;

  // The submit button is gated, never silent: the first unmet requirement
  // reads as guidance so a dead button always explains itself.
  function disabledReason(): string | null {
    if (isSubmitting || canSave) return null;
    if (!editing) {
      if (departments.isPending) return 'Loading sales team…';
      if (salesDepartment === null)
        return departments.error instanceof ApiError && departments.error.status === 403
          ? 'Department access required.'
          : 'Sales team unavailable. Reload.';
    }
    if (fullName.trim().length <= 1) return 'Enter the full name.';
    if (dateOfBirth.length !== 10 || age === null) return 'Enter a valid birth date.';
    if (sex === '') return 'Pick a sex.';
    if (civilStatus === '') return 'Pick a civil status.';
    if (
      streetNo.trim() === '' ||
      cityMunicipality.trim() === '' ||
      province.trim() === '' ||
      zipCode.trim() === '' ||
      (editing && (provinceCode !== '') !== (localityCode !== ''))
    )
      return 'Complete the home address.';
    if (mobileNo.trim() === '') return 'Enter the mobile number.';
    if (employerName.trim() === '' || employerAddress.trim() === '' || jobPosition.trim() === '')
      return 'Complete the work details.';
    if (!editing && (governmentIdType === '' || governmentIdNumber.trim() === ''))
      return 'Pick ID type and number.';
    if (editing && governmentIdNumber.trim() !== '' && governmentIdType === '')
      return 'Pick an ID type.';
    if (email.trim() === '') return 'Enter the email address.';
    if (!passwordOk) {
      if (temporaryPassword.length < 8) return 'Password needs 8+ characters.';
      return 'Passwords must match.';
    }
    if (editing && headMoves && headChangeReason.trim().length < 3)
      return 'Explain the head change.';
    if (uplineRole !== null && headStaffId === '') return 'Pick a head to continue.';
    if (
      !editing &&
      aaMode === 'manual' &&
      !manualIstAaNumberSchema.safeParse(aaNumberInput).success
    )
      return 'Type a valid AA number.';
    if (!editing && !profilePhotoBase64) return 'Choose a profile photo.';
    return null;
  }
  const blockedWhy = disabledReason();
  const serverFields = errorFieldEntries(submitError);
  const aaFields = errorFieldEntries(aaIssueError);

  const submit = () => {
    onSubmit({
      profilePhotoBase64,
      position,
      fullName,
      dateOfBirth,
      sex,
      civilStatus,
      streetNo,
      province,
      provinceCode,
      cityMunicipality,
      cityMunicipalityCode: localityCode,
      zipCode,
      telNo,
      mobileNo,
      fbMessenger,
      employerName,
      employerAddress,
      jobPosition,
      governmentIdType,
      governmentIdNumber,
      tin,
      email,
      headStaffId,
      ostReferrerStaffId,
      headChangeReason,
      departmentId: salesDepartment?.id ?? '',
      temporaryPassword,
      confirmPassword,
      aaMode,
      aaNumber: aaNumberInput,
    });
  };

  // A save in flight owns the dialog: Cancel, the header X, Escape and the
  // backdrop all route through here, so an in-flight create/save can never
  // land after the operator appeared to cancel it.
  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title={title}
      footer={
        <>
          {/* The disabled-reason rides the always-visible footer: the Save
              button and its explanation can never scroll apart. */}
          {blockedWhy ? (
            <p className={styles.footerHint} role="status">
              {blockedWhy}
            </p>
          ) : null}
          <Button variant="secondary" onClick={requestClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            loading={isSubmitting}
            loadingLabel={editing ? 'Saving…' : 'Creating…'}
            onClick={submit}
          >
            {editing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody} aria-busy={isSubmitting || undefined}>
        {!editing ? (
          <ProfilePhotoEditor
            staged
            photo={{
              url: profilePhotoBase64 ? `data:image/jpeg;base64,${profilePhotoBase64}` : null,
              expiresAt: null,
              canUpload: !isSubmitting,
              notice: null,
            }}
            loading={false}
            onRefresh={() => {}}
            onUpload={async (value) => {
              setProfilePhotoBase64(value);
            }}
          />
        ) : null}
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
                      : [
                          {
                            value: '',
                            label: departments.isPending
                              ? 'Loading sales team…'
                              : 'Sales unavailable',
                          },
                        ]
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
                  options={positionOptions}
                />
              </label>
            </div>
            {!editing && salesDepartment === null && !departments.isPending ? (
              <Alert variant="danger" title="Sales team unavailable">
                {departments.error instanceof ApiError && departments.error.status === 403
                  ? 'You need department access.'
                  : 'Reload the page.'}
              </Alert>
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
                error={provinces.isError ? 'Provinces failed to load.' : null}
                onRetry={() => void provinces.refetch()}
                value={province ? { code: provinceCode, name: province } : null}
                options={provinces.data ?? []}
                onSelect={pickProvince}
              />
              <Combobox
                id="member-city"
                label="City / Municipality"
                required
                disabled={!provinceCode}
                disabledHint={province ? 'Pick a province first.' : undefined}
                loading={localities.isFetching}
                loadingLabel="Loading cities and municipalities"
                error={provinceCode && localities.isError ? 'Cities failed to load.' : null}
                onRetry={() => void localities.refetch()}
                value={cityMunicipality ? { code: localityCode, name: cityMunicipality } : null}
                options={localities.data ?? []}
                onSelect={pickLocality}
              />
            </div>
            <TextField
              id="member-zip"
              name="member-zip"
              label="ZIP Code"
              value={zipCode}
              onChange={(value) => setZipCode(value)}
              autoComplete="postal-code"
            />
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
              {heads.isPending ? (
                <p className={styles.inlineStatus} role="status">
                  <Spinner size="sm" />
                  Loading heads…
                </p>
              ) : heads.isError ? (
                <Alert variant="danger" title="Heads failed to load">
                  <p className={styles.alertText}>The head list is unavailable.</p>
                  <div className={styles.alertActions}>
                    <Button variant="secondary" size="sm" onClick={() => void heads.refetch()}>
                      Retry
                    </Button>
                  </div>
                </Alert>
              ) : (heads.data ?? []).length === 0 ? (
                <Alert variant="info" title="No heads found">
                  Add a {MEMBER_POSITION_LABELS[uplineRole]}.
                </Alert>
              ) : null}
              {editing && headMoves ? (
                <TextField
                  id="member-head-reason"
                  name="member-head-reason"
                  label="Reason for head change"
                  value={headChangeReason}
                  onChange={setHeadChangeReason}
                />
              ) : null}
            </div>
          </fieldset>
        ) : (
          <Alert variant="info" title="No head">
            SVDs have no head.
          </Alert>
        )}

        {position === 'sales_manager' ? (
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Referrer Details</legend>
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
              {ostReferrers.isPending ? (
                <p className={styles.inlineStatus} role="status">
                  <Spinner size="sm" />
                  Loading OST referrers…
                </p>
              ) : ostReferrers.isError ? (
                <Alert variant="danger" title="OST referrers failed to load">
                  <p className={styles.alertText}>The referrer list is unavailable.</p>
                  <div className={styles.alertActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void ostReferrers.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                </Alert>
              ) : (ostReferrers.data ?? []).length === 0 ? (
                <Alert variant="info" title="No OST referrers found">
                  Save without a referrer.
                </Alert>
              ) : null}
            </div>
          </fieldset>
        ) : null}

        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>AA Number</legend>
          <div className={styles.formFields}>
            {editing && aaNumber ? (
              <TextField
                id="member-aa-issued"
                name="member-aa-issued"
                label="AA Number"
                value={aaNumber}
                onChange={() => {}}
                readOnly
                optional
              />
            ) : editing && position === 'ost' ? null : (
              <>
                <label className={styles.fieldLabel}>
                  AA Number Source
                  <Select
                    aria-label="AA Number Source"
                    value={aaMode}
                    onChange={(e) => {
                      setAaMode(e.target.value as 'auto' | 'manual');
                      setAaNumberInput('');
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
                    value={aaNumberInput}
                    onChange={(value) => setAaNumberInput(normalizeAaEntry(value))}
                    placeholder="AAI26090001"
                  />
                ) : null}
                {editing ? (
                  <div>
                    <Button
                      disabled={isIssuingAa || !manualAaOk}
                      loading={isIssuingAa}
                      loadingLabel="Issuing…"
                      onClick={() =>
                        onIssueAa?.({
                          aaNumberMode: aaMode,
                          aaNumber:
                            aaMode === 'manual'
                              ? aaNumberInput.trim().toUpperCase() || undefined
                              : undefined,
                        })
                      }
                    >
                      Issue
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
          {aaIssueError ? (
            <Alert variant="danger" title="AA number not issued">
              <p className={styles.alertText}>
                {aaIssueError instanceof Error ? aaIssueError.message : 'Issue failed.'}
              </p>
              {aaFields.length > 0 ? (
                <ul className={styles.errorList}>
                  {aaFields.map(([field, reason]) => (
                    <li key={field}>
                      {field}: {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
        </fieldset>

        {!editing || passwordFilled ? (
          <Alert variant="info" title="First login">
            First sign-in needs password change.
          </Alert>
        ) : null}
        {submitError ? (
          <Alert variant="danger" title="Could not save">
            <p className={styles.alertText}>
              {submitError instanceof Error ? submitError.message : 'Save failed.'}
            </p>
            {serverFields.length > 0 ? (
              <ul className={styles.errorList}>
                {serverFields.map(([field, reason]) => (
                  <li key={field}>
                    {field}: {reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
