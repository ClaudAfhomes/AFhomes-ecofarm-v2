/**
 * One member's full record: read the profile once for the identification
 * fields, edit it through the SAME form creation uses (`MemberFormDialog`),
 * issue a missing AA number, or delete the account.
 *
 * The edit form prefills every field from the record. Position and head ARE
 * editable here: the server re-resolves the role, re-checks the hierarchy and
 * audits a head move with its reason (the database trigger stays the final
 * authority). Secrets start blank and stay unchanged until typed; an issued
 * AA number reads as issued, a missing one offers the issue controls.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  ConfirmDialog,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  Dialog,
  Select,
  Spinner,
  StatusChip,
  TextField,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import {
  GOVERNMENT_ID_TYPE_LABELS,
  manualIstAaNumberSchema,
  toTitleCase,
  updateMemberProfileSchema,
  type Member,
  type UpdateMemberProfile,
} from '@afhomes/contracts';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useSession } from '../../lib/session';
import { canViewModule } from '../../app/navigation';
import { ApiError, errorBlockers, errorFieldEntries } from '../../lib/api/errors';
import { deleteAfHomesStaff } from '../afhomes/services';
import { MemberFormDialog, type MemberFormSeed, type MemberFormValues } from './MemberFormDialog';
import {
  getMember,
  issueMemberAccreditation,
  networkMemberKeys,
  normalizeAaEntry,
  updateMember,
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

/** The shared form's seed: the record as stored. Secrets stay blank. */
function seedFor(member: Member): MemberFormSeed {
  return {
    position: member.position,
    fullName: member.fullName,
    dateOfBirth: member.dateOfBirth ?? '',
    sex: member.sex ?? '',
    civilStatus: member.civilStatus ?? '',
    streetNo: member.streetNo ?? '',
    province: member.province ?? '',
    provinceCode: member.provinceCode ?? '',
    cityMunicipality: member.cityMunicipality ?? '',
    cityMunicipalityCode: member.cityMunicipalityCode ?? '',
    zipCode: member.zipCode ?? '',
    telNo: member.telNo ?? '',
    mobileNo: member.mobileNo ?? '',
    fbMessenger: member.fbMessenger ?? '',
    employerName: member.employerName ?? '',
    employerAddress: member.employerAddress ?? '',
    jobPosition: member.jobPosition ?? '',
    governmentIdType: member.governmentIdType ?? '',
    governmentIdNumber: '',
    tin: '',
    email: member.email,
    headStaffId: member.referrerStaffId ?? '',
    ostReferrerStaffId: member.ostReferrerStaffId ?? '',
  };
}

/**
 * Map the shared form's values onto the update contract. The full profile
 * travels; only real CHANGES travel for the fields that are separate actions
 * on the server: the position (its role and head rules re-run), the head
 * (with its mandatory reason), the email (the login identity), an
 * administrator password reset, and re-verified address codes.
 */
function updatePayload(member: Member, values: MemberFormValues): UpdateMemberProfile {
  const currentHead = member.referrerStaffId ?? '';
  const currentOst = member.ostReferrerStaffId ?? '';
  const positionChanged = values.position !== member.position;
  const headChanged = values.headStaffId !== currentHead;
  // The client settles the question "does the head link move?"; the server
  // re-answers it from its own copy of the record.
  const headDecision = positionChanged || headChanged;
  const headWillChange = headDecision && (values.headStaffId || null) !== (currentHead || null);
  const ostDecision = positionChanged || values.ostReferrerStaffId !== currentOst;
  const emailChanged = values.email.trim().toLowerCase() !== member.email.toLowerCase();
  const addressChanged =
    values.provinceCode !== (member.provinceCode ?? '') ||
    values.cityMunicipalityCode !== (member.cityMunicipalityCode ?? '');

  return {
    fullName: values.fullName.trim(),
    dateOfBirth: values.dateOfBirth,
    sex: values.sex as 'Male' | 'Female',
    civilStatus: values.civilStatus as 'Single' | 'Married' | 'Widowed' | 'Separated',
    streetNo: values.streetNo.trim(),
    cityMunicipality: values.cityMunicipality.trim(),
    province: values.province.trim(),
    zipCode: values.zipCode.trim(),
    mobileNo: values.mobileNo.trim(),
    telNo: values.telNo.trim() || undefined,
    fbMessenger: values.fbMessenger.trim() || undefined,
    employerName: values.employerName.trim(),
    employerAddress: values.employerAddress.trim(),
    jobPosition: values.jobPosition.trim(),
    // Secrets are write-only: a blank field keeps the stored value.
    ...(values.governmentIdNumber.trim()
      ? {
          governmentIdType: values.governmentIdType as
            'philippine_id' | 'drivers_license' | 'passport' | 'tax_id' | 'other',
          governmentIdNumber: values.governmentIdNumber.trim(),
        }
      : {}),
    ...(values.tin.trim() ? { tin: values.tin.trim() } : {}),
    ...(addressChanged && values.provinceCode && values.cityMunicipalityCode
      ? { provinceCode: values.provinceCode, cityMunicipalityCode: values.cityMunicipalityCode }
      : {}),
    ...(emailChanged ? { email: values.email.trim() } : {}),
    ...(values.temporaryPassword ? { temporaryPassword: values.temporaryPassword } : {}),
    ...(positionChanged ? { position: values.position } : {}),
    ...(headDecision ? { referrerStaffId: values.headStaffId || null } : {}),
    ...(headWillChange && values.headChangeReason.trim()
      ? { headChangeReason: values.headChangeReason.trim() }
      : {}),
    ...(ostDecision
      ? {
          ostReferrerStaffId:
            values.position === 'sales_manager' ? values.ostReferrerStaffId || null : null,
        }
      : {}),
  };
}

export function MemberDetailDialog({
  member,
  onClose,
  onChanged,
  onTransfer,
}: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
  onTransfer?: (member: Member) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  // The record view's own issue controls; the edit form carries the same ones.
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
    mutationFn: (values: MemberFormValues) => {
      // Client-side first net: the SAME contract the server enforces, so a
      // mistyped field is named before the request leaves (the server stays
      // authoritative and re-checks everything, including the hierarchy,
      // duplicates and the head reason, which only it can judge).
      const payload = updatePayload(member, values);
      const checked = updateMemberProfileSchema.safeParse(payload);
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
      return updateMember(member.id, checked.data);
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      notifySuccess({ title: 'Member updated', message: 'Member record saved.' });
      onChanged();
    },
    // A centered modal, not just an inline line: a failed save must be
    // impossible to miss, wherever the dialog has scrolled.
    onError: (error) => {
      const fields = errorFieldEntries(error);
      notifyError({
        title: 'Member not saved',
        message: error.message,
        ...(fields.length > 0
          ? { detail: fields.map(([field, reason]) => `${field}: ${reason}`).join('\n') }
          : {}),
      });
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
    // Parity with a failed save: the refusal is impossible to miss, and the
    // blocker list stays readable in the confirm dialog once the modal closes.
    onError: (error) => {
      const blockers = errorBlockers(error);
      notifyError({
        title: 'Member not deleted',
        message: error.message,
        ...(blockers.length > 0 ? { detail: blockers.join('\n') } : {}),
      });
    },
  });

  // Issue a missing AA number. Members that already hold one never reach this
  // mutation: the controls render only when aaNumber is null, and the server
  // refuses renumbers.
  const issue = useBusinessMutation({
    mutationFn: (input: { aaNumberMode: 'auto' | 'manual'; aaNumber?: string }) =>
      issueMemberAccreditation(member.id, input),
    onSuccess: async () => {
      await invalidate();
      onChanged();
      notifySuccess({ title: 'AA number issued', message: 'Accreditation is active.' });
    },
  });
  const issueFields = errorFieldEntries(issue.error);

  const canDelete = user?.roleSlug === 'super_admin' && user.id !== member.id;
  const canViewRenewal =
    member.position === 'ost' &&
    canViewModule(user?.afHomesPermissions, 'network.ost_registrations') &&
    canViewModule(user?.afHomesPermissions, 'network.ost_members');
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
            {canViewRenewal ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  navigate(`/admin/ost/members/${member.id}`);
                }}
              >
                Validity / renewal
              </Button>
            ) : null}
            {onTransfer ? (
              <Button variant="secondary" onClick={() => onTransfer(member)}>
                {member.position === 'ost' ? 'Transfer team' : 'Convert to OST'}
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={() => {
                save.reset();
                issue.reset();
                setEditing(true);
              }}
            >
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
            {detail.isPending ? (
              <p className={styles.inlineStatus} role="status">
                <Spinner size="sm" />
                Loading full IDs…
              </p>
            ) : detail.isError ? (
              <Alert variant="warning">Full IDs failed to load. Showing masked values.</Alert>
            ) : null}
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
                      setAaNumber('');
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
                    hint="AAI plus the two-digit year, month and sequence, or an existing AA- number."
                    value={aaNumber}
                    onChange={(value) => setAaNumber(normalizeAaEntry(value))}
                    placeholder="AAI26090001"
                  />
                ) : null}
                <div>
                  <Button
                    disabled={
                      issue.isPending ||
                      (aaMode === 'manual' && !manualIstAaNumberSchema.safeParse(aaNumber).success)
                    }
                    loading={issue.isPending}
                    loadingLabel="Issuing…"
                    onClick={() =>
                      issue.mutate({
                        aaNumberMode: aaMode,
                        aaNumber:
                          aaMode === 'manual'
                            ? aaNumber.trim().toUpperCase() || undefined
                            : undefined,
                      })
                    }
                  >
                    Issue
                  </Button>
                </div>
              </div>
              {issue.error ? (
                <Alert variant="danger" title="AA number not issued">
                  <p className={styles.alertText}>{issue.error.message}</p>
                  {issueFields.length > 0 ? (
                    <ul className={styles.errorList}>
                      {issueFields.map(([field, reason]) => (
                        <li key={field}>
                          {field}: {reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Alert>
              ) : null}
            </DetailCard>
          ) : null}
        </div>
      </Dialog>

      {editing ? (
        <MemberFormDialog
          open
          mode="edit"
          title={`Edit ${member.fullName}`}
          seed={seedFor(member)}
          aaNumber={member.aaNumber}
          onSubmit={(values) => save.mutate(values)}
          isSubmitting={save.isPending}
          submitError={save.error}
          onClose={() => {
            save.reset();
            setEditing(false);
          }}
          onIssueAa={(input) => issue.mutate(input)}
          isIssuingAa={issue.isPending}
          aaIssueError={issue.error}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => {
          // An in-flight delete owns the dialog: Escape and the backdrop route
          // here too, and must not hide a request that is still running.
          if (remove.isPending) return;
          setConfirmDelete(false);
          setDeleteConfirmation('');
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete member?"
        message={
          <div className={styles.deleteBody}>
            <p className={styles.deleteQuestion}>
              Delete {member.fullName}? This cannot be undone.
            </p>
            <TextField
              id="member-delete-confirm"
              name="member-delete-confirm"
              label="Type DELETE to confirm"
              value={deleteConfirmation}
              onChange={setDeleteConfirmation}
            />
            {remove.error ? (
              <Alert variant="danger" title="Cannot delete">
                <p className={styles.alertText}>{remove.error.message}</p>
                {deleteBlockers.length > 0 ? (
                  <ul className={styles.errorList}>
                    {deleteBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
              </Alert>
            ) : null}
          </div>
        }
        danger
        confirmLabel="Delete"
        confirmDisabled={deleteConfirmation !== 'DELETE'}
        confirmLoading={remove.isPending}
        confirmLoadingLabel="Deleting…"
      />
    </>
  );
}
