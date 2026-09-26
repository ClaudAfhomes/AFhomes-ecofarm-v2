import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate, useBlocker } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  notifySuccess,
  notifyWarning,
} from '@jad/ui';

import { formatDate } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { useMember } from '../hooks/useMember';
import { useMemberRegistration } from '../hooks/useMemberRegistration';
import { GovernmentIdPreview } from '../../registrations/components/GovernmentIdPreview';
import {
  updateMember,
  deactivateMember,
  activateMember,
  archiveMember,
  deleteMemberPermanently,
  setMemberQualified,
  setMemberSponsor,
} from '../repositories/memberRepository';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE } from '../status';
import styles from './MemberDetail.module.css';

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error: fetchError } = useMember(id ?? '');
  const { data: application, isPending: applicationPending } = useMemberRegistration(
    data?.registrationId,
  );

  const [isEditing, setIsEditing] = useState(false);
  const [edit, setEdit] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    address: '',
    gender: '',
  });
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [showQualifyConfirm, setShowQualifyConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showPurgeDialog, setShowPurgeDialog] = useState(false);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgeEmailConfirm, setPurgeEmailConfirm] = useState('');
  const [purgePending, setPurgePending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sponsorCode, setSponsorCode] = useState('');
  const [sponsorPending, setSponsorPending] = useState(false);
  const [sponsorError, setSponsorError] = useState<string | undefined>();
  const { user } = useSession();
  const isSuperAdmin = user?.roleId === 'super_admin';

  const isDirty = useMemo(() => {
    if (!isEditing || !data) return false;
    return (
      edit.firstName !== data.firstName ||
      edit.lastName !== data.lastName ||
      edit.phone !== data.phone ||
      (edit.address ?? '') !== (data.address ?? '') ||
      edit.gender !== data.gender
    );
  }, [isEditing, edit, data]);

  // Prevent accidental loss of edits on navigation
  let blocker: unknown = null;
  try {
    blocker = useBlocker(isEditing && isDirty);
  } catch {
    blocker = null;
  }

  useEffect(() => {
    if (!blocker) return;
    const state = (blocker as unknown as { state?: string }).state;
    if (state === 'blocked') {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      const b = blocker as unknown as { proceed?: () => void; reset?: () => void };
      if (confirmed) b.proceed?.();
      else b.reset?.();
    }
  }, [blocker]);

  useEffect(() => {
    if (!isEditing || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isEditing, isDirty]);

  if (isPending) {
    return (
      <section>
        <PageHeader title="Member Detail" description="Member profile and status" />
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <Skeleton style={{ height: 200 }} />
          </div>
          <div className={styles.card}>
            <Skeleton style={{ height: 200 }} />
          </div>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section>
        <PageHeader title="Member Detail" description="Member profile and status" />
        <ErrorState error={fetchError as Error} />
      </section>
    );
  }

  if (!data) {
    return (
      <section>
        <PageHeader title="Member Detail" description="Member profile and status" />
        <ErrorState
          title="Member not found"
          message="The requested member does not exist or was archived."
        />
        <Link className={styles.backLink} to="/admin/members">
          Back to list
        </Link>
      </section>
    );
  }

  const startEdit = () => {
    setEdit({
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      address: data.address ?? '',
      gender: data.gender,
    });
    setIsEditing(true);
    setError(undefined);
  };

  const validateEdit = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!edit.firstName.trim()) errs.firstName = 'First name is required';
    if (!edit.lastName.trim()) errs.lastName = 'Last name is required';
    if (!edit.phone.trim()) errs.phone = 'Phone is required';
    else if (!/^\+?[\d\s\-()]{7,20}$/.test(edit.phone.trim()))
      errs.phone = 'Enter a valid phone number';
    if (!edit.gender.trim()) errs.gender = 'Gender is required';
    return errs;
  };

  const handleSave = async () => {
    if (actionPending) return;
    const errs = validateEdit();
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setActionPending(true);
    try {
      await updateMember(data.id, {
        firstName: edit.firstName.trim(),
        lastName: edit.lastName.trim(),
        phone: edit.phone.trim(),
        address: edit.address.trim() || undefined,
        gender: edit.gender.trim(),
      } as never);
      setIsEditing(false);
      setEditErrors({});
      await queryClient.invalidateQueries({ queryKey: ['admin', 'member', data.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionPending(false);
    }
  };

  const handleToggleActive = async () => {
    if (actionPending) return;
    setActionPending(true);
    try {
      if (data.accountStatus === 'ACTIVE') await deactivateMember(data.id);
      else await activateMember(data.id);
      setShowDeactivateConfirm(false);
      setError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'member', data.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionPending(false);
    }
  };

  const handleToggleQualified = async () => {
    if (actionPending) return;
    setActionPending(true);
    try {
      await setMemberQualified(data.id, !data.isQualified);
      setShowQualifyConfirm(false);
      setError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'member', data.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionPending(false);
    }
  };

  const handleLinkSponsor = async () => {
    const code = sponsorCode.trim();
    if (!code || sponsorPending) return;
    setSponsorPending(true);
    setSponsorError(undefined);
    try {
      await setMemberSponsor(data.id, code);
      setSponsorCode('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'member', data.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      notifySuccess({
        title: 'Sponsor linked',
        message: `${data.firstName} ${data.lastName} is now sponsored by ${code}.`,
      });
    } catch (e) {
      setSponsorError((e as Error).message);
    } finally {
      setSponsorPending(false);
    }
  };

  const handleUnlinkSponsor = async () => {
    if (sponsorPending) return;
    setSponsorPending(true);
    setSponsorError(undefined);
    try {
      await setMemberSponsor(data.id, null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'member', data.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      notifySuccess({
        title: 'Sponsor unlinked',
        message: `${data.firstName} ${data.lastName} no longer has a sponsor.`,
      });
    } catch (e) {
      setSponsorError((e as Error).message);
    } finally {
      setSponsorPending(false);
    }
  };

  const handleArchive = async () => {
    if (actionPending) return;
    setActionPending(true);
    try {
      await archiveMember(data.id);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'archived'] });
      notifySuccess({
        title: 'Member archived',
        message: `${data.firstName} ${data.lastName} moved to archives`,
      });
      navigate('/admin/members');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionPending(false);
    }
  };

  const resetPurgeForm = () => {
    setShowPurgeDialog(false);
    setPurgeReason('');
    setPurgeEmailConfirm('');
    setPurgePending(false);
  };

  const handlePurge = async () => {
    setPurgePending(true);
    try {
      const result = await deleteMemberPermanently(data.id, purgeReason.trim());
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'archived'] });
      if (result.authRemoved === false) {
        notifyWarning({
          title: 'Member deleted - auth account still exists',
          message: `${memberName} was removed, but their login is still active. Remove the auth user in Supabase Auth so the email can re-register cleanly.`,
        });
      } else {
        notifySuccess({
          title: 'Member permanently deleted',
          message: `${memberName} and all associated records were removed`,
        });
      }
      resetPurgeForm();
      navigate('/admin/members');
    } catch (e) {
      setPurgePending(false);
      setError((e as Error).message);
      setShowPurgeDialog(false);
    }
  };

  const memberName = `${data.firstName}${data.middleInitial ? ` ${data.middleInitial}.` : ''} ${data.lastName}${data.nameSuffix ? ` ${data.nameSuffix}` : ''}`;

  return (
    <section>
      <PageHeader
        title={memberName}
        description={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <StatusChip
              label={MEMBER_STATUS_LABEL[data.status]}
              tone={MEMBER_STATUS_TONE[data.status]}
            />
            <StatusChip
              label={data.accountStatus}
              tone={data.accountStatus === 'ACTIVE' ? 'success' : 'danger'}
            />
            {data.isQualified ? (
              <StatusChip label="Qualified" tone="success" />
            ) : data.status === 'APPROVED_ACTIVE' ? (
              <StatusChip label="Not Qualified" tone="neutral" />
            ) : null}
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-body-s)' }}>
              {data.program.name} · {data.email} · {formatDate(data.registeredAt)}
            </span>
          </span>
        }
        actions={
          <Link className={styles.backLink} to="/admin/members">
            Back to list
          </Link>
        }
      />
      <div className={styles.detailGrid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Member Details</h2>
          {isEditing ? (
            <div className={styles.editForm}>
              <label className={styles.editLabel} htmlFor="edit-firstName">
                First Name{' '}
                <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                  *
                </span>
              </label>
              <input
                id="edit-firstName"
                className={`${styles.editInput} ${editErrors.firstName ? styles.inputError : ''}`}
                value={edit.firstName}
                onChange={(e) => setEdit((s) => ({ ...s, firstName: e.target.value }))}
                aria-label="First Name"
                aria-invalid={Boolean(editErrors.firstName)}
                aria-describedby={editErrors.firstName ? 'edit-firstName-error' : undefined}
              />
              {editErrors.firstName ? (
                <span id="edit-firstName-error" className={styles.errorText}>
                  {editErrors.firstName}
                </span>
              ) : null}

              <label className={styles.editLabel} htmlFor="edit-lastName">
                Last Name{' '}
                <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                  *
                </span>
              </label>
              <input
                id="edit-lastName"
                className={`${styles.editInput} ${editErrors.lastName ? styles.inputError : ''}`}
                value={edit.lastName}
                onChange={(e) => setEdit((s) => ({ ...s, lastName: e.target.value }))}
                aria-label="Last Name"
                aria-invalid={Boolean(editErrors.lastName)}
                aria-describedby={editErrors.lastName ? 'edit-lastName-error' : undefined}
              />
              {editErrors.lastName ? (
                <span id="edit-lastName-error" className={styles.errorText}>
                  {editErrors.lastName}
                </span>
              ) : null}

              <label className={styles.editLabel} htmlFor="edit-phone">
                Phone{' '}
                <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                  *
                </span>
              </label>
              <input
                id="edit-phone"
                className={`${styles.editInput} ${editErrors.phone ? styles.inputError : ''}`}
                value={edit.phone}
                onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))}
                aria-label="Phone"
                aria-invalid={Boolean(editErrors.phone)}
                aria-describedby={editErrors.phone ? 'edit-phone-error' : undefined}
              />
              {editErrors.phone ? (
                <span id="edit-phone-error" className={styles.errorText}>
                  {editErrors.phone}
                </span>
              ) : null}

              <label className={styles.editLabel} htmlFor="edit-gender">
                Gender{' '}
                <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                  *
                </span>
              </label>
              <select
                id="edit-gender"
                className={`${styles.editInput} ${editErrors.gender ? styles.inputError : ''}`}
                value={edit.gender}
                onChange={(e) => setEdit((s) => ({ ...s, gender: e.target.value }))}
                aria-label="Gender"
                aria-invalid={Boolean(editErrors.gender)}
                aria-describedby={editErrors.gender ? 'edit-gender-error' : undefined}
              >
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="LGBT">LGBT</option>
                <option value="Others">Others</option>
              </select>
              {editErrors.gender ? (
                <span id="edit-gender-error" className={styles.errorText}>
                  {editErrors.gender}
                </span>
              ) : null}

              <label className={styles.editLabel} htmlFor="edit-address">
                Address
              </label>
              <input
                id="edit-address"
                className={styles.editInput}
                value={edit.address}
                onChange={(e) => setEdit((s) => ({ ...s, address: e.target.value }))}
                aria-label="Address"
              />

              <div className={styles.immutableField}>
                <span className={styles.immutableLabel}>Country - immutable</span>
                <div className={styles.immutableValue}>
                  {data.countryName} ({data.countryCode}) - cannot be changed
                </div>
              </div>
              {error ? (
                <p className={styles.errorText} role="alert">
                  {error}
                </p>
              ) : null}
              <div className={styles.editActions}>
                <Button onClick={handleSave} variant="primary" loading={actionPending}>
                  Save
                </Button>
                <Button
                  onClick={() => {
                    if (isDirty) setShowDiscardConfirm(true);
                    else setIsEditing(false);
                  }}
                  variant="secondary"
                  disabled={actionPending}
                >
                  Cancel
                </Button>
              </div>
              <ConfirmDialog
                open={showDiscardConfirm}
                onCancel={() => setShowDiscardConfirm(false)}
                onConfirm={() => {
                  setShowDiscardConfirm(false);
                  setIsEditing(false);
                  setEditErrors({});
                }}
                title="Discard changes?"
                message="You have unsaved changes. Are you sure you want to discard them?"
                confirmLabel="Discard"
                cancelLabel="Keep editing"
              />
            </div>
          ) : (
            <dl className={styles.fieldGrid}>
              <div className={styles.field}>
                <dt>Full Name</dt>
                <dd>{memberName}</dd>
              </div>
              <div className={styles.field}>
                <dt>Member ID</dt>
                <dd className={styles.mono}>{data.id}</dd>
              </div>
              <div className={styles.field}>
                <dt>Email</dt>
                <dd>{data.email}</dd>
              </div>
              <div className={styles.field}>
                <dt>Phone</dt>
                <dd>{data.phone}</dd>
              </div>
              <div className={styles.field}>
                <dt>Date of Birth</dt>
                <dd>
                  {formatDate(data.dateOfBirth)} · {data.age} years old
                </dd>
              </div>
              <div className={styles.field}>
                <dt>Gender</dt>
                <dd>{data.gender}</dd>
              </div>
              <div className={styles.field}>
                <dt>Country</dt>
                <dd>
                  {data.countryName} ({data.countryCode})
                </dd>
              </div>
              {data.address ? (
                <div className={styles.field}>
                  <dt>Address</dt>
                  <dd>{data.address}</dd>
                </div>
              ) : null}
              <div className={styles.field}>
                <dt>Sponsor</dt>
                <dd>
                  {data.sponsorReferralCode || data.sponsorId
                    ? `${data.sponsorName ?? 'Sponsor'} (${data.sponsorReferralCode ?? data.sponsorId})`
                    : 'No sponsor linked'}
                </dd>
              </div>
            </dl>
          )}
          {isSuperAdmin ? (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 'var(--text-body-s)',
                  fontWeight: 600,
                  marginBottom: 'var(--space-2)',
                }}
              >
                Link sponsor (super admin)
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={sponsorCode}
                  onChange={(e) => {
                    setSponsorCode(e.target.value);
                    setSponsorError(undefined);
                  }}
                  placeholder="Sponsor referral code"
                  aria-label="Sponsor referral code"
                  disabled={sponsorPending}
                  style={{
                    minHeight: 44,
                    padding: '10px 12px',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-body-s)',
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={handleLinkSponsor}
                  loading={sponsorPending}
                  disabled={!sponsorCode.trim()}
                >
                  Link sponsor
                </Button>
                {data.sponsorId ? (
                  <Button
                    variant="secondary"
                    onClick={handleUnlinkSponsor}
                    loading={sponsorPending}
                  >
                    Unlink
                  </Button>
                ) : null}
              </div>
              {sponsorError ? (
                <p
                  role="alert"
                  style={{ color: 'var(--color-danger)', marginTop: 'var(--space-2)' }}
                >
                  {sponsorError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Account Status</h2>
          <dl className={styles.fieldGrid}>
            <div className={styles.field}>
              <dt>Membership</dt>
              <dd>
                <StatusChip
                  label={MEMBER_STATUS_LABEL[data.status]}
                  tone={MEMBER_STATUS_TONE[data.status]}
                />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Account</dt>
              <dd>
                <StatusChip
                  label={data.accountStatus}
                  tone={data.accountStatus === 'ACTIVE' ? 'success' : 'danger'}
                />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Qualified</dt>
              <dd>
                <StatusChip
                  label={data.isQualified ? 'Qualified' : 'Not qualified'}
                  tone={data.isQualified ? 'success' : 'neutral'}
                />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Program</dt>
              <dd>
                {data.program.name} ({data.program.code})
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Referral Code</dt>
              <dd className={styles.mono}>{data.referralCode}</dd>
            </div>
            <div className={styles.field}>
              <dt>Registered</dt>
              <dd>{formatDate(data.registeredAt)}</dd>
            </div>
            <div className={styles.field}>
              <dt>Registration ID</dt>
              <dd className={styles.mono}>{data.registrationId}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Application Details</h2>
          {!data.registrationId ? (
            <p
              style={{
                fontSize: 'var(--text-body-s)',
                color: 'var(--color-text-muted)',
                margin: 0,
              }}
            >
              Direct-created member - no application on file.
            </p>
          ) : applicationPending ? (
            <p
              style={{
                fontSize: 'var(--text-body-s)',
                color: 'var(--color-text-muted)',
                margin: 0,
              }}
            >
              Loading application…
            </p>
          ) : !application ? (
            <p
              style={{
                fontSize: 'var(--text-body-s)',
                color: 'var(--color-text-muted)',
                margin: 0,
              }}
            >
              Approved - application {data.registrationId} was removed from the queue on approval.
            </p>
          ) : (
            <dl className={styles.fieldGrid}>
              <div className={styles.field}>
                <dt>Program</dt>
                <dd>
                  {application.programCode} ({application.programId})
                </dd>
              </div>
              <div className={styles.field}>
                <dt>Referral Code</dt>
                <dd className={styles.mono}>{application.referralCode ?? '-'}</dd>
              </div>
              <div className={styles.field}>
                <dt>Submitted</dt>
                <dd>{formatDate(application.submittedAt)}</dd>
              </div>
              {application.reviewedAt ? (
                <div className={styles.field}>
                  <dt>Reviewed</dt>
                  <dd>
                    {formatDate(application.reviewedAt)} ·{' '}
                    <span className={styles.mono}>{application.reviewedBy ?? '-'}</span>
                  </dd>
                </div>
              ) : null}
              {application.rejectionNote ? (
                <div className={styles.field}>
                  <dt>Rejection Note</dt>
                  <dd>
                    {application.rejectionNote.reason} - {application.rejectionNote.requiredChanges}
                  </dd>
                </div>
              ) : null}
              <div className={styles.field}>
                <dt>Qualification Answers</dt>
                <dd>
                  {application.qualificationAnswers.length === 0
                    ? '-'
                    : application.qualificationAnswers.map((qa) => (
                        <div key={qa.questionId}>
                          <span style={{ fontWeight: 600 }}>{qa.questionId}:</span> {qa.answer}
                        </div>
                      ))}
                </dd>
              </div>
              {application.governmentId ? (
                <>
                  <div className={styles.field}>
                    <dt>Government ID</dt>
                    <dd className={styles.mono}>{application.governmentId.fileName}</dd>
                    <dd
                      style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}
                    >
                      {(application.governmentId.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                      {application.governmentId.mimeType}
                    </dd>
                  </div>
                  <div className={styles.field}>
                    <dt>Preview</dt>
                    <dd>
                      <GovernmentIdPreview
                        registrationId={application.id}
                        fileName={application.governmentId.fileName}
                        mimeType={application.governmentId.mimeType}
                        hasFile={
                          'storagePath' in application.governmentId &&
                          Boolean(application.governmentId.storagePath)
                        }
                      />
                    </dd>
                  </div>
                </>
              ) : (
                <div className={styles.field}>
                  <dt>Government ID</dt>
                  <dd style={{ color: 'var(--color-text-muted)' }}>No document on record.</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        <div className={`${styles.card} ${styles.actionsCard}`}>
          <h2 className={styles.cardTitle}>Actions</h2>
          {error ? (
            <p className={styles.errorText} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            {!isEditing ? (
              <Button variant="secondary" onClick={startEdit} aria-label="Edit member">
                Edit
              </Button>
            ) : null}
            {data.status === 'APPROVED_ACTIVE' ? (
              <Button
                variant="secondary"
                onClick={() => setShowQualifyConfirm(true)}
                aria-label={data.isQualified ? 'Revoke qualification' : 'Grant qualification'}
              >
                {data.isQualified ? 'Revoke Qualification' : 'Grant Qualification'}
              </Button>
            ) : null}
            <Button
              variant={data.accountStatus === 'ACTIVE' ? 'danger' : 'secondary'}
              onClick={() => setShowDeactivateConfirm(true)}
              aria-label={data.accountStatus === 'ACTIVE' ? 'Deactivate member' : 'Activate member'}
            >
              {data.accountStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="danger"
              onClick={() => setShowArchiveConfirm(true)}
              aria-label="Archive member"
            >
              Archive
            </Button>
            {isSuperAdmin ? (
              <Button
                variant="danger"
                onClick={() => setShowPurgeDialog(true)}
                aria-label="Delete member permanently"
              >
                Delete Permanently
              </Button>
            ) : null}
          </div>

          <Dialog
            open={showPurgeDialog}
            onClose={() => {
              if (!purgePending) resetPurgeForm();
            }}
            title={`Permanently delete ${memberName}?`}
            footer={
              <>
                <Button variant="secondary" onClick={resetPurgeForm} disabled={purgePending}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handlePurge}
                  disabled={
                    !purgeReason.trim() ||
                    purgeEmailConfirm.trim().toLowerCase() !== data.email.toLowerCase() ||
                    purgePending
                  }
                  loading={purgePending}
                >
                  Delete Permanently
                </Button>
              </>
            }
          >
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <p style={{ margin: 0, fontSize: 'var(--text-body-s)' }}>
                This permanently deletes <strong>{memberName}</strong> and every associated record -
                wallet, ledger, commissions, sales, customers, withdrawals, payout accounts,
                vouchers, and their login. <strong>This cannot be undone.</strong> Prefer{' '}
                <strong>Archive</strong> unless the record must be destroyed (e.g. test data or a
                lawful erasure request).
              </p>
              <div style={{ display: 'grid', gap: 4 }}>
                <label className={styles.editLabel} htmlFor="purge-reason">
                  Reason{' '}
                  <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                    *
                  </span>
                </label>
                <textarea
                  id="purge-reason"
                  className={styles.editInput}
                  value={purgeReason}
                  onChange={(e) => setPurgeReason(e.target.value.slice(0, 500))}
                  placeholder="Why is this member being permanently deleted?"
                  rows={3}
                  required
                  aria-required="true"
                  maxLength={500}
                />
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <label className={styles.editLabel} htmlFor="purge-email-confirm">
                  Type the member's email ({data.email}) to confirm{' '}
                  <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                    *
                  </span>
                </label>
                <input
                  id="purge-email-confirm"
                  className={styles.editInput}
                  value={purgeEmailConfirm}
                  onChange={(e) => setPurgeEmailConfirm(e.target.value)}
                  placeholder={data.email}
                  autoComplete="off"
                  required
                  aria-required="true"
                />
              </div>
            </div>
          </Dialog>

          <ConfirmDialog
            open={showQualifyConfirm}
            onCancel={() => {
              if (!actionPending) setShowQualifyConfirm(false);
            }}
            onConfirm={handleToggleQualified}
            title={
              data.isQualified
                ? `Revoke qualification from ${memberName}?`
                : `Grant qualification to ${memberName}?`
            }
            message={
              data.isQualified
                ? 'Revoking qualification removes member_qualified status and blocks sales submission and sponsorship until it is re-granted.'
                : 'Granting qualification marks the member as Active + Qualified, unlocking sales submission and sponsorship.'
            }
            confirmLabel={data.isQualified ? 'Revoke' : 'Grant'}
            cancelLabel="Cancel"
            danger={data.isQualified}
            confirmDisabled={actionPending}
            confirmLoading={actionPending}
          />

          <ConfirmDialog
            open={showDeactivateConfirm}
            onCancel={() => {
              if (!actionPending) setShowDeactivateConfirm(false);
            }}
            onConfirm={handleToggleActive}
            title={
              data.accountStatus === 'ACTIVE'
                ? `Deactivate ${memberName}?`
                : `Activate ${memberName}?`
            }
            message={
              data.accountStatus === 'ACTIVE'
                ? 'Deactivate this member? Account will become INACTIVE but not deleted. Member will need reactivation to access the platform.'
                : 'Activate this member? Account will become ACTIVE and regain access.'
            }
            confirmLabel={data.accountStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            cancelLabel="Cancel"
            danger={data.accountStatus === 'ACTIVE'}
            confirmDisabled={actionPending}
            confirmLoading={actionPending}
          />

          <ConfirmDialog
            open={showArchiveConfirm}
            onCancel={() => {
              if (!actionPending) setShowArchiveConfirm(false);
            }}
            onConfirm={handleArchive}
            title={`Archive ${memberName}?`}
            message="Archive this member? Record will be moved to Archives and removed from active Members. Original data retained for audit."
            confirmLabel="Archive"
            cancelLabel="Cancel"
            danger
            confirmDisabled={actionPending}
            confirmLoading={actionPending}
          />
        </div>
      </div>
    </section>
  );
}
