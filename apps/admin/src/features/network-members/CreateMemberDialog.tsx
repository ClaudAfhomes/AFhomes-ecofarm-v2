import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  DateField,
  Dialog,
  PasswordField,
  Select,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import {
  MEMBER_POSITION_LABELS,
  MEMBER_POSITIONS,
  MEMBER_UPLINE_ROLE,
  governmentIdTypeSchema,
  type MemberPosition,
} from '@afhomes/contracts';
import { normalizeLiveHumanField } from '../../lib/normalize';
import {
  createMember,
  getMemberDepartments,
  getMemberOstReferrers,
  getMemberUplines,
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
    queryKey: ['afhomes', 'departments'],
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

  const age = ageOf(dateOfBirth);

  const save = useBusinessMutation({
    mutationFn: () =>
      createMember({
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
      }),
    onSuccess: (created) => {
      notifySuccess({ title: 'Member created', message: `${created.fullName} was added.` });
      onCreated();
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
  const canSave = requiredFilled && !save.isPending;

  const reset = () => {
    setPosition('sales_manager');
    setFullName('');
    setDateOfBirth('');
    setSex('');
    setCivilStatus('');
    setStreetNo('');
    setCityMunicipality('');
    setProvince('');
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
                  options={MEMBER_POSITIONS.map((value) => ({
                    value,
                    label: MEMBER_POSITION_LABELS[value],
                  }))}
                />
              </label>
            </div>
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
              normalize={(value) => normalizeLiveHumanField('fullName', value)}
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
              onChange={setStreetNo}
              autoComplete="street-address"
            />
            <div className={styles.inlinePair}>
              <TextField
                id="member-city"
                name="member-city"
                label="City / Municipality"
                value={cityMunicipality}
                onChange={setCityMunicipality}
                autoComplete="address-level2"
              />
              <TextField
                id="member-province"
                name="member-province"
                label="Province"
                value={province}
                onChange={setProvince}
                autoComplete="address-level1"
              />
            </div>
            <TextField
              id="member-zip"
              name="member-zip"
              label="ZIP Code"
              value={zipCode}
              onChange={setZipCode}
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
                onChange={setTelNo}
                autoComplete="tel"
                optional
              />
              <TextField
                id="member-mobile"
                name="member-mobile"
                label="Mobile No."
                value={mobileNo}
                onChange={setMobileNo}
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
                      label: value
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
                    })),
                  ]}
                />
              </label>
              <TextField
                id="member-govid"
                name="member-govid"
                label="Government ID Number"
                value={governmentIdNumber}
                onChange={setGovernmentIdNumber}
              />
            </div>
            <TextField
              id="member-tin"
              name="member-tin"
              label="TIN"
              value={tin}
              onChange={setTin}
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
              onChange={setEmail}
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

        <Alert variant="info" title="First login">
          First sign-in needs password change.
        </Alert>
        {save.error ? <p role="alert">{save.error.message}</p> : null}
      </div>
    </Dialog>
  );
}
