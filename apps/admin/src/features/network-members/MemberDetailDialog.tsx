import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  ConfirmDialog,
  DateField,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  Dialog,
  Select,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import {
  GOVERNMENT_ID_TYPE_LABELS,
  governmentIdTypeSchema,
  isPlausibleBirthDate,
  type Member,
} from '@afhomes/contracts';
import { toTitleCase } from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import { errorBlockers, errorFieldEntries } from '../../lib/api/errors';
import {
  filterGovernmentIdInput,
  filterHolderAddressInput,
  filterHolderNameInput,
  filterLandlineInput,
  filterMemberTinInput,
  filterMobileInput,
} from '../../lib/normalize';
import { deleteAfHomesStaff } from '../afhomes/services';
import {
  getMember,
  issueMemberAccreditation,
  networkMemberKeys,
  updateMember,
  AA_MANUAL_RE,
  withAaPrefix,
} from './services';
import styles from './MembersPage.module.css';

/** Address prose reads as entered, even on legacy UPPERCASE rows. */
const TITLE_CASED: ReadonlySet<keyof Member> = new Set([
  'streetNo',
  'cityMunicipality',
  'province',
  'employerAddress',
]);

function value(row: Member, key: keyof Member): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) return 'No Data';
  // Legacy rows stored these UPPERCASE; the record now reads as entered.
  return TITLE_CASED.has(key) ? toTitleCase(v) : v;
}

/**
 * One member's full record: read the profile, edit its fields, or delete the
 * account. Position, department and head stay fixed here: a head change is a
 * genealogy move and belongs to the upline desk.
 */
export function MemberDetailDialog({
  member,
  onClose,
  onChanged,
}: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
}) {
  const client = useQueryClient();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [mobileNo, setMobileNo] = useState(member.mobileNo ?? '');
  const [telNo, setTelNo] = useState(member.telNo ?? '');
  const [fbMessenger, setFbMessenger] = useState(member.fbMessenger ?? '');
  const [streetNo, setStreetNo] = useState(member.streetNo ?? '');
  const [cityMunicipality, setCityMunicipality] = useState(member.cityMunicipality ?? '');
  const [province, setProvince] = useState(member.province ?? '');
  const [zipCode, setZipCode] = useState(member.zipCode ?? '');
  const [employerName, setEmployerName] = useState(member.employerName ?? '');
  const [employerAddress, setEmployerAddress] = useState(member.employerAddress ?? '');
  const [jobPosition, setJobPosition] = useState(member.jobPosition ?? '');
  const [fullName, setFullName] = useState(member.fullName);
  const [dateOfBirth, setDateOfBirth] = useState(member.dateOfBirth ?? '');
  const [sex, setSex] = useState(member.sex ?? '');
  const [civilStatus, setCivilStatus] = useState(member.civilStatus ?? '');
  const [governmentIdType, setGovernmentIdType] = useState(member.governmentIdType ?? '');
  const [governmentIdNumber, setGovernmentIdNumber] = useState('');
  const [tin, setTin] = useState('');
  const [aaMode, setAaMode] = useState<'auto' | 'manual'>('auto');
  const [aaNumber, setAaNumber] = useState('');

  const invalidate = () => client.invalidateQueries({ queryKey: networkMemberKeys.scope });

  // The list row carries masks; the record view reads the member once more so
  // the identification fields show in clear for verification.
  const detail = useQuery({
    queryKey: networkMemberKeys.detail(member.id),
    queryFn: () => getMember(member.id),
  });

  const save = useBusinessMutation({
    mutationFn: () =>
      updateMember(member.id, {
        fullName: fullName.trim(),
        mobileNo: mobileNo.trim(),
        telNo: telNo.trim() || undefined,
        fbMessenger: fbMessenger.trim() || undefined,
        streetNo: streetNo.trim(),
        cityMunicipality: cityMunicipality.trim(),
        province: province.trim(),
        zipCode: zipCode.trim(),
        employerName: employerName.trim(),
        employerAddress: employerAddress.trim(),
        jobPosition: jobPosition.trim(),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(sex ? { sex: sex as 'Male' | 'Female' } : {}),
        ...(civilStatus
          ? { civilStatus: civilStatus as 'Single' | 'Married' | 'Widowed' | 'Separated' }
          : {}),
        // Secrets are write-only: a blank field keeps the stored value.
        ...(governmentIdNumber.trim()
          ? {
              governmentIdType: governmentIdType as
                'philippine_id' | 'drivers_license' | 'passport' | 'tax_id' | 'other',
              governmentIdNumber: governmentIdNumber.trim(),
            }
          : {}),
        ...(tin.trim() ? { tin: tin.trim() } : {}),
      }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      notifySuccess({ title: 'Member updated', message: 'Member record saved.' });
      onChanged();
    },
  });

  const remove = useBusinessMutation({
    mutationFn: () => deleteAfHomesStaff(member.id),
    onSuccess: async () => {
      await invalidate();
      onChanged();
      onClose();
      notifySuccess({ title: 'Member deleted', message: 'Member removed.' });
    },
  });

  // Issue a missing AA number. Members that already hold one never reach
  // this mutation: the section below renders only when aaNumber is null,
  // and the server refuses renumbers.
  const issue = useBusinessMutation({
    mutationFn: () =>
      issueMemberAccreditation(member.id, {
        aaNumberMode: aaMode,
        aaNumber: aaMode === 'manual' ? aaNumber.trim().toUpperCase() || undefined : undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      onChanged();
      onClose();
      notifySuccess({ title: 'AA number issued', message: 'Accreditation is active.' });
    },
  });
  const issueFields = errorFieldEntries(issue.error);

  const canDelete = user?.roleSlug === 'super_admin' && user.id !== member.id;
  const deleteBlockers = errorBlockers(remove.error);

  return (
    <>
      <Dialog
        open={!editing && !confirmDelete}
        onClose={onClose}
        title={member.fullName}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {canDelete ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </>
        }
      >
        <div className={styles.dialogBody}>
          <div className={styles.heroChips}>
            <StatusChip label={member.positionLabel} tone="neutral" />
            <StatusChip
              label={member.status}
              tone={member.status === 'active' ? 'success' : 'neutral'}
            />
            {member.aaNumber ? <StatusChip label={member.aaNumber} tone="info" /> : null}
          </div>
          <DetailCard>
            <DetailCardTitle>Identity</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Code">
                <span
                  className={
                    member.employeeNumber
                      ? styles.codeChip
                      : `${styles.codeChip} ${styles.codeEmpty}`
                  }
                >
                  {value(member, 'employeeNumber')}
                </span>
              </DetailField>
              <DetailField label="Email">{value(member, 'email')}</DetailField>
              <DetailField label="Birth date">{value(member, 'dateOfBirth')}</DetailField>
              <DetailField label="Sex">{value(member, 'sex')}</DetailField>
              <DetailField label="Civil status">{value(member, 'civilStatus')}</DetailField>
              <DetailField label="Department">{value(member, 'departmentName')}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <DetailCardTitle>Address and contact</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="No. / Street">{value(member, 'streetNo')}</DetailField>
              <DetailField label="City">{value(member, 'cityMunicipality')}</DetailField>
              <DetailField label="Province">{value(member, 'province')}</DetailField>
              <DetailField label="ZIP">{value(member, 'zipCode')}</DetailField>
              <DetailField label="Tel">{value(member, 'telNo')}</DetailField>
              <DetailField label="Mobile">{value(member, 'mobileNo')}</DetailField>
              <DetailField label="FB / Messenger">{value(member, 'fbMessenger')}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <DetailCardTitle>Work and IDs</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Employer">{value(member, 'employerName')}</DetailField>
              <DetailField label="Employer address">{value(member, 'employerAddress')}</DetailField>
              <DetailField label="Job position">{value(member, 'jobPosition')}</DetailField>
              <DetailField label="ID type">
                {member.governmentIdType
                  ? (GOVERNMENT_ID_TYPE_LABELS[
                      member.governmentIdType as keyof typeof GOVERNMENT_ID_TYPE_LABELS
                    ] ?? member.governmentIdType)
                  : 'No Data'}
              </DetailField>
              <DetailField label="ID number">
                {detail.data?.governmentIdNumber ?? member.governmentIdMasked ?? 'No Data'}
              </DetailField>
              <DetailField label="TIN">
                {detail.data?.tin ?? member.tinMasked ?? 'No Data'}
              </DetailField>
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <DetailCardTitle>Network</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Head">{member.referrerName ?? 'No Data'}</DetailField>
              <DetailField label="OST referrer">{member.ostReferrerName ?? 'No Data'}</DetailField>
              <DetailField label="AA number">{value(member, 'aaNumber')}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
          {!member.aaNumber && member.position !== 'ost' ? (
            <DetailCard>
              <DetailCardTitle>Accreditation</DetailCardTitle>
              <p className={styles.sectionHint}>No number yet. Issue one.</p>
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
                    id="member-issue-aa-number"
                    name="member-issue-aa-number"
                    label="AA Number"
                    value={aaNumber}
                    onChange={(value) => setAaNumber(withAaPrefix(value))}
                    placeholder="AAXXXXXXXXXXXX"
                  />
                ) : null}
                <div>
                  <Button
                    disabled={
                      issue.isPending ||
                      (aaMode === 'manual' && !AA_MANUAL_RE.test(aaNumber.trim().toUpperCase()))
                    }
                    onClick={() => issue.mutate()}
                  >
                    {issue.isPending ? 'Issuing…' : 'Issue'}
                  </Button>
                </div>
              </div>
              {issue.error ? (
                <div role="alert">
                  <p>{issue.error.message}</p>
                  {issueFields.length > 0 ? (
                    <ul>
                      {issueFields.map(([field, reason]) => (
                        <li key={field}>
                          {field}: {reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </DetailCard>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${member.fullName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                save.isPending ||
                fullName.trim().length <= 1 ||
                mobileNo.trim() === '' ||
                (dateOfBirth !== '' && !isPlausibleBirthDate(dateOfBirth))
              }
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <p className={styles.sectionHint}>
            Position, department, head and email stay fixed here.
          </p>
          <div className={styles.formFields}>
            <TextField
              id="member-edit-name"
              name="member-edit-name"
              label="Full Name"
              value={fullName}
              suggestName
              normalize={filterHolderNameInput}
              onChange={setFullName}
              autoComplete="name"
            />
            <div className={styles.inlinePair}>
              <DateField
                id="member-edit-dob"
                name="member-edit-dob"
                label="Date of Birth"
                value={dateOfBirth}
                onChange={setDateOfBirth}
              />
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
            </div>
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
            <div className={styles.inlinePair}>
              <TextField
                id="member-edit-mobile"
                name="member-edit-mobile"
                label="Mobile No."
                value={mobileNo}
                onChange={(value) => setMobileNo(filterMobileInput(value))}
              />
              <TextField
                id="member-edit-tel"
                name="member-edit-tel"
                label="Tel No."
                value={telNo}
                onChange={(value) => setTelNo(filterLandlineInput(value))}
                optional
              />
            </div>
            <TextField
              id="member-edit-fb"
              name="member-edit-fb"
              label="FB / Messenger Name"
              value={fbMessenger}
              onChange={setFbMessenger}
              optional
            />
            <TextField
              id="member-edit-street"
              name="member-edit-street"
              label="No. / Street"
              value={streetNo}
              normalize={filterHolderAddressInput}
              onChange={setStreetNo}
            />
            <div className={styles.inlinePair}>
              <TextField
                id="member-edit-city"
                name="member-edit-city"
                label="City / Municipality"
                value={cityMunicipality}
                onChange={setCityMunicipality}
              />
              <TextField
                id="member-edit-province"
                name="member-edit-province"
                label="Province"
                value={province}
                onChange={setProvince}
              />
            </div>
            <TextField
              id="member-edit-zip"
              name="member-edit-zip"
              label="ZIP Code"
              value={zipCode}
              onChange={setZipCode}
            />
            <TextField
              id="member-edit-employer"
              name="member-edit-employer"
              label="Business / Employer Name"
              value={employerName}
              onChange={setEmployerName}
            />
            <TextField
              id="member-edit-employer-address"
              name="member-edit-employer-address"
              label="Business / Employer Address"
              value={employerAddress}
              onChange={setEmployerAddress}
            />
            <TextField
              id="member-edit-job"
              name="member-edit-job"
              label="Job Position"
              value={jobPosition}
              onChange={setJobPosition}
            />
            <p className={styles.sectionHint}>Blank ID fields stay unchanged.</p>
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
                id="member-edit-govid"
                name="member-edit-govid"
                label="Government ID Number"
                value={governmentIdNumber}
                onChange={(value) => setGovernmentIdNumber(filterGovernmentIdInput(value))}
                optional
              />
            </div>
            <TextField
              id="member-edit-tin"
              name="member-edit-tin"
              label="TIN"
              value={tin}
              onChange={(value) => setTin(filterMemberTinInput(value))}
              optional
            />
          </div>
          {save.error ? <p role="alert">{save.error.message}</p> : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteConfirmation('');
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete member?"
        message={
          <div>
            <p>Delete {member.fullName}? This cannot be undone.</p>
            <TextField
              id="member-delete-confirm"
              name="member-delete-confirm"
              label="Type DELETE to confirm"
              value={deleteConfirmation}
              onChange={setDeleteConfirmation}
            />
            {remove.error ? (
              <div role="alert">
                <p>{remove.error.message}</p>
                {deleteBlockers.length > 0 ? (
                  <ul>
                    {deleteBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        danger
        confirmLabel="Delete"
        confirmDisabled={deleteConfirmation !== 'DELETE'}
        confirmLoading={remove.isPending}
      />
    </>
  );
}
