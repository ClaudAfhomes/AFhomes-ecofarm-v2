import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@jad/ui';

import { formatDate } from '../../../lib/format';
import { useRegistration } from '../hooks/useRegistration';
import { approveRegistration, rejectRegistration } from '../repositories/registrationRepository';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE } from '../status';
import { GovernmentIdPreview } from '../components/GovernmentIdPreview';
import styles from './RegistrationDetail.module.css';

const QUALIFICATION_QUESTION_LABELS: Record<string, string> = {
  'q-001': 'Are you at least 18 years old and able to enter into a binding contract?',
  'q-002': 'Do you understand this is a real estate brokerage and not a guaranteed investment?',
  'qual-dom-1': 'Are you at least 18 years old and able to enter into a binding contract?',
  'qual-dom-2':
    'Do you understand this is a real estate brokerage and not a guaranteed investment?',
  'qual-ab-1':
    'Are you at least 18 years old and legally able to enter into a contract in your country?',
  'qual-ab-2': 'Do you understand this is a real estate brokerage and not a guaranteed investment?',
};

function getQuestionText(questionId: string): string {
  return QUALIFICATION_QUESTION_LABELS[questionId] ?? questionId;
}

function getAge(dateOfBirth: string): number | null {
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/** Date with a friendly fallback for missing/invalid values. */
function formatDateSafe(value: string | null | undefined, placeholder = 'N/A'): string {
  if (!value) return placeholder;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return placeholder;
  return formatDate(value);
}

/** Renders a value, or a muted placeholder when the applicant left it blank. */
function FieldValue({
  value,
  placeholder,
  mono = false,
}: {
  value?: string | null;
  placeholder: string;
  mono?: boolean;
}) {
  const text = (value ?? '').trim();
  if (text) {
    return mono ? <span className={styles.mono}>{text}</span> : <>{text}</>;
  }
  return <span className={styles.emptyValue}>{placeholder}</span>;
}

export function RegistrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useRegistration(id ?? '');

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectChanges, setRejectChanges] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  if (isPending) {
    return (
      <section>
        <PageHeader title="Registration Detail" description="Review member application" />
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <Skeleton style={{ height: 120 }} />
          </div>
          <div className={styles.card}>
            <Skeleton style={{ height: 120 }} />
          </div>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section>
        <PageHeader title="Registration Detail" description="Review member application" />
        <ErrorState error={error as Error} />
      </section>
    );
  }

  if (!data) {
    return (
      <section>
        <PageHeader title="Registration Detail" description="Review member application" />
        <ErrorState
          title="Registration not found"
          message="The requested registration does not exist."
        />
      </section>
    );
  }

  const handleApprove = async () => {
    if (actionPending) return;
    setActionPending(true);
    try {
      await approveRegistration(data.id);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'registrations'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      navigate('/admin/registrations');
    } catch (e) {
      setFormError((e as Error).message);
      setActionPending(false);
    }
  };

  const handleReject = async () => {
    if (actionPending) return;
    if (!rejectReason.trim() || !rejectChanges.trim()) {
      setFormError('Both reason and required changes are required.');
      return;
    }
    setActionPending(true);
    try {
      await rejectRegistration(data.id, { reason: rejectReason, requiredChanges: rejectChanges });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'registrations'] });
      navigate('/admin/registrations');
    } catch (e) {
      setFormError((e as Error).message);
      setActionPending(false);
    }
  };

  const applicantName = `${data.firstName}${data.middleInitial ? ` ${data.middleInitial}.` : ''} ${data.lastName}${data.nameSuffix ? ` ${data.nameSuffix}` : ''}`;
  const age = getAge(data.dateOfBirth);

  return (
    <section>
      <PageHeader
        title={applicantName}
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
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-body-s)' }}>
              Submitted {formatDateSafe(data.submittedAt)}
              {data.countryName ? ` · ${data.countryName} (${data.countryCode})` : ''}
              {data.programCode ? ` · ${data.programCode}` : ''}
            </span>
            <span
              className={styles.mono}
              style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}
            >
              {data.id}
            </span>
          </span>
        }
        actions={
          <Link className={styles.backLink} to="/admin/registrations">
            Back to queue
          </Link>
        }
      />
      <div className={styles.detailGrid}>
        {/* Applicant Details - consolidated Personal + Address */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Applicant Details</h2>
          <dl className={styles.fieldGrid}>
            <div className={styles.field}>
              <dt>Full Name</dt>
              <dd>{applicantName}</dd>
            </div>
            <div className={styles.field}>
              <dt>Date of Birth</dt>
              <dd>
                {formatDateSafe(data.dateOfBirth)}
                {age !== null ? ` · ${age} years old` : ''}
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Email</dt>
              <dd>
                <FieldValue value={data.email} placeholder="No email provided" />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Gender</dt>
              <dd>
                <FieldValue value={data.gender} placeholder="Not specified" />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Phone</dt>
              <dd>
                <FieldValue value={data.phone} placeholder="No phone provided" />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Country</dt>
              <dd>
                {data.countryName || data.countryCode ? (
                  `${data.countryName ?? ''}${data.countryName && data.countryCode ? ' ' : ''}${
                    data.countryCode ? `(${data.countryCode})` : ''
                  }`
                ) : (
                  <span className={styles.emptyValue}>N/A</span>
                )}
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Address</dt>
              <dd>
                <FieldValue value={data.address} placeholder="No address provided" />
              </dd>
            </div>
          </dl>
        </div>

        {/* Program / Referral */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Program & Referral</h2>
          <dl className={styles.fieldGrid}>
            <div className={styles.field}>
              <dt>Program</dt>
              <dd>
                {data.programCode ? (
                  <>
                    <span style={{ fontWeight: 600 }}>{data.programCode}</span>
                    {data.programId ? (
                      <span
                        style={{
                          color: 'var(--color-text-muted)',
                          fontSize: 'var(--text-caption)',
                          marginLeft: 6,
                        }}
                      >
                        ({data.programId})
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className={styles.emptyValue}>N/A</span>
                )}
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Referral Code</dt>
              <dd>
                <FieldValue value={data.referralCode} placeholder="No sponsor code provided" mono />
              </dd>
              {!data.referralCode ? (
                <dd style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
                  Applicant registered without a sponsor
                </dd>
              ) : null}
            </div>
          </dl>
        </div>

        {/* Government ID */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Government ID</h2>
          {!data.governmentId ? (
            <p className={styles.mockNote}>No document on record for this application.</p>
          ) : (
            <dl className={styles.fieldGrid}>
              <div className={styles.field}>
                <dt>Document</dt>
                <dd className={styles.mono}>{data.governmentId.fileName}</dd>
                <dd style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
                  {(data.governmentId.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                  {data.governmentId.mimeType}
                </dd>
              </div>
              <div className={styles.field}>
                <dt>Preview</dt>
                <dd>
                  <GovernmentIdPreview
                    registrationId={data.id}
                    fileName={data.governmentId.fileName}
                    mimeType={data.governmentId.mimeType}
                    hasFile={
                      'storagePath' in data.governmentId && Boolean(data.governmentId.storagePath)
                    }
                  />
                </dd>
              </div>
            </dl>
          )}
        </div>

        {/* Qualification */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Qualification</h2>
          {data.qualificationAnswers.length === 0 ? (
            <p className={styles.mockNote}>No qualification answers submitted.</p>
          ) : (
            <dl className={styles.fieldGrid}>
              {data.qualificationAnswers.map((qa) => (
                <div key={qa.questionId} className={styles.field}>
                  <dt>{getQuestionText(qa.questionId)}</dt>
                  <dd>{qa.answer}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Review Information */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Review Information</h2>
          <dl className={styles.fieldGrid}>
            <div className={styles.field}>
              <dt>Submitted</dt>
              <dd>{formatDateSafe(data.submittedAt)}</dd>
            </div>
            <div className={styles.field}>
              <dt>Current Status</dt>
              <dd>
                <StatusChip
                  label={MEMBER_STATUS_LABEL[data.status]}
                  tone={MEMBER_STATUS_TONE[data.status]}
                />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Reviewer</dt>
              <dd>
                <FieldValue value={data.reviewedBy} placeholder="Not yet reviewed" />
              </dd>
            </div>
            <div className={styles.field}>
              <dt>Reviewed At</dt>
              <dd>{formatDateSafe(data.reviewedAt, 'Not yet reviewed')}</dd>
            </div>
            {data.rejectionNote ? (
              <>
                <div className={styles.field}>
                  <dt>Rejection Reason</dt>
                  <dd>{data.rejectionNote.reason}</dd>
                </div>
                <div className={styles.field}>
                  <dt>Required Changes</dt>
                  <dd>{data.rejectionNote.requiredChanges}</dd>
                </div>
              </>
            ) : data.status === 'REJECTED' ? (
              <div className={styles.field}>
                <dt>Rejection Note</dt>
                <dd>
                  <span className={styles.emptyValue}>No rejection note recorded</span>
                </dd>
              </div>
            ) : null}
            <div className={styles.field}>
              <dt>Application ID</dt>
              <dd className={styles.mono}>{data.id}</dd>
            </div>
          </dl>
        </div>

        {/* Actions */}
        {data.status === 'PENDING' ? (
          <div className={`${styles.card} ${styles.actionsCard}`}>
            <h2 className={styles.cardTitle}>Review Decision</h2>
            {formError ? (
              <p className={styles.errorText} role="alert">
                {formError}
              </p>
            ) : null}
            {!showRejectForm && !showAcceptConfirm ? (
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  onClick={() => setShowAcceptConfirm(true)}
                  disabled={actionPending}
                >
                  Accept Registration
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowRejectForm(true)}
                  disabled={actionPending}
                >
                  Reject Registration
                </Button>
              </div>
            ) : null}

            <ConfirmDialog
              open={showAcceptConfirm}
              onCancel={() => {
                if (!actionPending) setShowAcceptConfirm(false);
              }}
              onConfirm={handleApprove}
              title={`Accept ${applicantName}?`}
              message={`${applicantName} will be activated as a member and appear in Members. This action is audited.`}
              confirmLabel="Accept"
              cancelLabel="Cancel"
              danger={false}
              confirmDisabled={actionPending}
              confirmLoading={actionPending}
            />

            <Dialog
              open={showRejectForm}
              onClose={() => {
                if (!actionPending) {
                  setShowRejectForm(false);
                  setRejectReason('');
                  setRejectChanges('');
                  setFormError(undefined);
                }
              }}
              title={`Reject ${applicantName}?`}
              footer={
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowRejectForm(false);
                      setRejectReason('');
                      setRejectChanges('');
                      setFormError(undefined);
                    }}
                    disabled={actionPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleReject}
                    disabled={!rejectReason.trim() || !rejectChanges.trim() || actionPending}
                    loading={actionPending}
                  >
                    Confirm Rejection
                  </Button>
                </>
              }
            >
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label className={styles.rejectLabel} htmlFor="reject-reason">
                    Reason for rejection{' '}
                    <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                      *
                    </span>{' '}
                    <span
                      style={{
                        fontWeight: 400,
                        color: 'var(--color-text-muted)',
                        fontSize: 'var(--text-caption)',
                      }}
                    >
                      ({rejectReason.length}/500)
                    </span>
                  </label>
                  <textarea
                    id="reject-reason"
                    className={styles.rejectInput}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
                    placeholder="Why was this rejected? Be specific for the applicant"
                    rows={3}
                    required
                    aria-required="true"
                    aria-describedby="reject-reason-hint"
                    maxLength={500}
                  />
                  <span
                    id="reject-reason-hint"
                    style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}
                  >
                    Explain the rejection clearly; this is shown to the applicant on resubmit.
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label className={styles.rejectLabel} htmlFor="reject-changes">
                    Required changes{' '}
                    <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
                      *
                    </span>{' '}
                    <span
                      style={{
                        fontWeight: 400,
                        color: 'var(--color-text-muted)',
                        fontSize: 'var(--text-caption)',
                      }}
                    >
                      ({rejectChanges.length}/500)
                    </span>
                  </label>
                  <textarea
                    id="reject-changes"
                    className={styles.rejectInput}
                    value={rejectChanges}
                    onChange={(e) => setRejectChanges(e.target.value.slice(0, 500))}
                    placeholder="What must the applicant edit/correct? e.g., Upload clearer ID, fix phone"
                    rows={3}
                    required
                    aria-required="true"
                    aria-describedby="reject-changes-hint"
                    maxLength={500}
                  />
                  <span
                    id="reject-changes-hint"
                    style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}
                  >
                    List actionable steps; shown to applicant.
                  </span>
                </div>
                {formError ? (
                  <p
                    style={{
                      color: 'var(--color-danger)',
                      fontSize: 'var(--text-body-s)',
                      margin: 0,
                    }}
                    role="alert"
                  >
                    {formError}
                  </p>
                ) : null}
              </div>
            </Dialog>
          </div>
        ) : (
          <div className={styles.card} style={{ gridColumn: '1 / -1' }}>
            <h2 className={styles.cardTitle}>Status</h2>
            <p className={styles.mockNote}>
              This application has already been{' '}
              <strong>{MEMBER_STATUS_LABEL[data.status].toLowerCase()}</strong>. No further actions
              are available.
              {data.rejectionNote
                ? ` Reason: ${data.rejectionNote.reason} - Required: ${data.rejectionNote.requiredChanges}`
                : ''}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
