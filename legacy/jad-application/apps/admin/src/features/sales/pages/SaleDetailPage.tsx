import { useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  notifyError,
  notifySuccess,
} from '@jad/ui';
import { formatMoney } from '@jad/shared';

import { useSale } from '../hooks/useSale';
import { useDeleteSale } from '../hooks/useDeleteSale';
import { transitionSale } from '../services/sales';
import { SALE_STATUS_LABEL, SALE_STATUS_TONE } from '../status';
import { SaleFormDialog } from '../components/SaleFormDialog';
import { formatDateTime } from '../../../lib/format';
import styles from './SaleDetail.module.css';

/**
 * Estimated commission from the configured rate (exact-decimal rate string,
 * up to 4 places). BigInt math - no float. PG round() half-away matches
 * `(x + 5000) / 10000` for these non-negative amounts.
 */
function estimateCommission(value: string, rate: string): string {
  try {
    const [valueWhole = '0', valueFrac = ''] = value.split('.');
    const cents = BigInt(valueWhole) * 100n + BigInt((valueFrac + '00').slice(0, 2));
    const [rateWhole = '0', rateFrac = ''] = rate.split('.');
    const rateBp = BigInt(rateWhole) * 10000n + BigInt((rateFrac + '0000').slice(0, 4));
    const estCents = (cents * rateBp + 5000n) / 10000n;
    const wholeEst = estCents / 100n;
    const fracEst = estCents % 100n;
    return `${wholeEst.toString()}.${fracEst.toString().padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}

/** Configured rate string → percent label (e.g. '0.0800' → '8.00%'). */
function rateLabel(rate: string): string {
  const num = Number(rate);
  if (Number.isNaN(num)) return rate;
  return `${(num * 100).toFixed(2)}%`;
}

/** Sale detail - status progression, approve/reject/verify actions (SCR-ADM-009).
 * Review: SUBMITTED → ADMIN_APPROVED → PAYMENT_VERIFIED → QUALIFYING_SALE.
 * Reject requires mandatory reason (BR-SAL-005). LOCKED after max resubmissions (BR-SAL-006).
 * Transitions persist via PATCH /admin/sales/:id (validated + audited server-side).
 */
export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteMut = useDeleteSale();
  const { data, isPending, isError, error } = useSale(id!);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [showQualifyConfirm, setShowQualifyConfirm] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [localRejectionReason, setLocalRejectionReason] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inFlight = useRef(false);

  const currentStatus =
    (localStatus as typeof data extends { status: infer S } ? S : string) ?? data?.status;
  const currentRejectionReason = localRejectionReason ?? data?.rejectionReason;

  const onCopySaleId = async () => {
    if (!data?.id) return;
    try {
      await navigator.clipboard.writeText(data.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const runTransition = async (
    status: 'ADMIN_APPROVED' | 'PAYMENT_VERIFIED' | 'QUALIFYING_SALE' | 'REJECTED',
    rejectionReason?: string,
  ): Promise<boolean> => {
    if (!data) return false;
    if (inFlight.current) return false;
    inFlight.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      const updated = await transitionSale(data.id, { status, rejectionReason });
      setLocalStatus(updated.status);
      if (updated.rejectionReason !== undefined) setLocalRejectionReason(updated.rejectionReason);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'sales'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'sale', data.id] });
      return true;
    } catch (e) {
      setActionError((e as Error).message || 'The status change failed. Please try again.');
      return false;
    } finally {
      setActionPending(false);
      inFlight.current = false;
    }
  };

  const handleApprove = async () => {
    const ok = await runTransition('ADMIN_APPROVED');
    if (ok) setShowApproveConfirm(false);
  };

  const handleVerifyPayment = async () => {
    const ok = await runTransition('PAYMENT_VERIFIED');
    if (ok) setShowVerifyConfirm(false);
  };

  const handleQualify = async () => {
    const ok = await runTransition('QUALIFYING_SALE');
    if (ok) setShowQualifyConfirm(false);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    const ok = await runTransition('REJECTED', rejectReason.trim());
    if (ok) {
      setLocalRejectionReason(rejectReason.trim());
      setShowRejectForm(false);
    }
  };

  const deletePending = deleteMut.isPending;
  const handleDelete = async () => {
    if (!data || deleteMut.isPending) return;
    try {
      await deleteMut.mutateAsync(data.id);
      notifySuccess({ title: 'Sale deleted', message: `${data.propertyName} removed` });
      setShowDeleteConfirm(false);
      navigate('/admin/sales');
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
    }
  };

  const statusSteps = [
    { key: 'SUBMITTED', label: 'Submitted' },
    { key: 'ADMIN_APPROVED', label: 'Admin Approved' },
    { key: 'PAYMENT_VERIFIED', label: 'Payment Verified' },
    { key: 'QUALIFYING_SALE', label: 'Qualifying Sale' },
  ];

  const getStepIndex = (status: string) => {
    if (status === 'REJECTED' || status === 'LOCKED') return -1;
    return statusSteps.findIndex((s) => s.key === status);
  };

  return (
    <section>
      <PageHeader
        title="Sale Detail"
        description="Review sale submission and manage approval workflow"
        actions={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {data ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowEdit(true)}
                  aria-label="Edit sale"
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label="Delete sale"
                >
                  Delete
                </Button>
              </>
            ) : null}
            <Link className={styles.backLink} to="/admin/sales">
              Back to queue
            </Link>
          </span>
        }
      />

      {isPending ? (
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <Skeleton className={styles.skeletonBlock} />
          </div>
        </div>
      ) : isError ? (
        <ErrorState error={error} />
      ) : !data ? (
        <ErrorState title="Sale not found" message="The requested sale does not exist." />
      ) : (
        <>
          <div className={styles.detailGrid}>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Sale Information</h2>
              <dl className={styles.fieldGrid}>
                <div className={styles.field}>
                  <dt>Sale reference</dt>
                  <dd className={styles.saleIdCell}>
                    <code className={styles.saleId}>{data.id}</code>
                    <button
                      type="button"
                      className={styles.copyBtn}
                      onClick={onCopySaleId}
                      aria-label="Copy sale reference"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Property</dt>
                  <dd>{data.propertyName}</dd>
                </div>
                <div className={styles.field}>
                  <dt>Property Value</dt>
                  <dd className={styles.money}>{formatMoney(data.propertyValue)}</dd>
                </div>
                <div className={styles.field}>
                  <dt>Est. commission</dt>
                  <dd className={styles.money}>
                    {data.commissionRates ? (
                      <>
                        <span>
                          {formatMoney(
                            estimateCommission(data.propertyValue, data.commissionRates.direct),
                          )}
                        </span>{' '}
                        Direct ·{' '}
                        <span>
                          {formatMoney(
                            estimateCommission(data.propertyValue, data.commissionRates.referral),
                          )}
                        </span>{' '}
                        Referral{' '}
                        <span className={styles.commissionNote}>
                          (estimated, {rateLabel(data.commissionRates.direct)}/
                          {rateLabel(data.commissionRates.referral)})
                        </span>
                      </>
                    ) : (
                      <span className={styles.commissionNote}>Rates not configured</span>
                    )}
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Customer</dt>
                  <dd>{data.customerName}</dd>
                </div>
                {data.referrerName ? (
                  <div className={styles.field}>
                    <dt>Referrer</dt>
                    <dd>{data.referrerName}</dd>
                  </div>
                ) : null}
                <div className={styles.field}>
                  <dt>Submitted by</dt>
                  <dd>
                    <span style={{ fontWeight: 600 }}>{data.sellerName}</span>
                    <br />
                    <span
                      style={{
                        fontSize: 'var(--text-caption)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {data.sellerId}
                    </span>
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Status</dt>
                  <dd>
                    <StatusChip
                      label={
                        SALE_STATUS_LABEL[currentStatus as keyof typeof SALE_STATUS_LABEL] ??
                        currentStatus
                      }
                      tone={
                        SALE_STATUS_TONE[currentStatus as keyof typeof SALE_STATUS_TONE] ??
                        'neutral'
                      }
                    />
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Submitted</dt>
                  <dd>{formatDateTime(data.submittedAt)}</dd>
                </div>
                {(data.approvedAt ||
                  currentStatus === 'ADMIN_APPROVED' ||
                  currentStatus === 'PAYMENT_VERIFIED' ||
                  currentStatus === 'QUALIFYING_SALE') && (
                  <div className={styles.field}>
                    <dt>Approved</dt>
                    <dd>{data.approvedAt ? formatDateTime(data.approvedAt) : 'Just now (mock)'}</dd>
                  </div>
                )}
                {(data.paymentVerifiedAt ||
                  currentStatus === 'PAYMENT_VERIFIED' ||
                  currentStatus === 'QUALIFYING_SALE') && (
                  <div className={styles.field}>
                    <dt>Payment Verified</dt>
                    <dd>
                      {data.paymentVerifiedAt
                        ? formatDateTime(data.paymentVerifiedAt)
                        : 'Just now (mock)'}
                    </dd>
                  </div>
                )}
                {data.lockedAt && (
                  <div className={styles.field}>
                    <dt>Locked</dt>
                    <dd>{formatDateTime(data.lockedAt)}</dd>
                  </div>
                )}
                <div className={styles.field}>
                  <dt>Resubmissions</dt>
                  <dd>
                    <span className={styles.attemptCount}>{data.resubmissionCount} / 3</span>
                    <span className={styles.attemptDots} aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className={
                            i < data.resubmissionCount ? styles.dotFilled : styles.dotEmpty
                          }
                        />
                      ))}
                    </span>
                    <span className="sr-only">{`${data.resubmissionCount} of 3 attempts used`}</span>
                  </dd>
                </div>
                {(data.rejectionReason || currentRejectionReason) && (
                  <div className={styles.field}>
                    <dt>Rejection Reason</dt>
                    <dd className={styles.rejectionReason}>
                      {currentRejectionReason ?? data.rejectionReason}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Status Progression</h2>
              <ol className={styles.progression}>
                {statusSteps.map((step, index) => {
                  const currentStepIndex = getStepIndex(currentStatus);
                  const isComplete = currentStepIndex >= 0 && index < currentStepIndex;
                  const isCurrent = currentStepIndex >= 0 && index === currentStepIndex;
                  return (
                    <li
                      key={step.key}
                      className={`${styles.progressionStep} ${isComplete ? styles.stepComplete : ''} ${isCurrent ? styles.stepCurrent : ''}`}
                    >
                      <span className={styles.stepIndicator}>{isComplete ? '✓' : index + 1}</span>
                      <span className={styles.stepLabel}>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
              {(currentStatus === 'REJECTED' || currentStatus === 'LOCKED') && (
                <p className={styles.statusNote}>
                  {currentStatus === 'REJECTED'
                    ? 'This sale was rejected. The seller may correct and resubmit.'
                    : 'This sale is locked after maximum resubmission attempts. Reopening requires Admin/Super Admin review.'}
                </p>
              )}
            </div>

            {(currentStatus === 'SUBMITTED' ||
              currentStatus === 'ADMIN_APPROVED' ||
              currentStatus === 'PAYMENT_VERIFIED') && (
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Actions</h2>
                {actionError ? (
                  <p
                    role="alert"
                    style={{
                      color: 'var(--color-danger)',
                      fontSize: 'var(--text-body-s)',
                      margin: '0 0 8px',
                    }}
                  >
                    {actionError}
                  </p>
                ) : null}
                <div className={styles.actions}>
                  {currentStatus === 'SUBMITTED' && (
                    <>
                      <button
                        type="button"
                        className={styles.approveBtn}
                        onClick={() => setShowApproveConfirm(true)}
                        disabled={actionPending}
                      >
                        Approve sale
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => setShowRejectForm(true)}
                        disabled={actionPending}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {currentStatus === 'ADMIN_APPROVED' && (
                    <>
                      <button
                        type="button"
                        className={styles.approveBtn}
                        onClick={() => setShowVerifyConfirm(true)}
                        disabled={actionPending}
                      >
                        Verify payment
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => setShowRejectForm(true)}
                        disabled={actionPending}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {currentStatus === 'PAYMENT_VERIFIED' && (
                    <>
                      <button
                        type="button"
                        className={styles.approveBtn}
                        onClick={() => setShowQualifyConfirm(true)}
                        disabled={actionPending}
                      >
                        Confirm qualifying sale
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => setShowRejectForm(true)}
                        disabled={actionPending}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {showRejectForm &&
                    (currentStatus === 'SUBMITTED' ||
                      currentStatus === 'ADMIN_APPROVED' ||
                      currentStatus === 'PAYMENT_VERIFIED') && (
                      <div className={styles.rejectForm}>
                        <label className={styles.rejectLabel} htmlFor="reject-reason">
                          Rejection reason (required)
                        </label>
                        <textarea
                          id="reject-reason"
                          className={styles.rejectInput}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
                          placeholder="Provide a reason for rejection (BR-SAL-005) - member sees it inline + via notification"
                          rows={3}
                          maxLength={500}
                        />
                        <div
                          style={{
                            fontSize: 'var(--text-caption)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {rejectReason.length}/500
                        </div>
                        <div className={styles.rejectActions}>
                          <button
                            type="button"
                            className={styles.confirmRejectBtn}
                            onClick={handleReject}
                            disabled={!rejectReason.trim() || actionPending}
                          >
                            Confirm rejection
                          </button>
                          <button
                            type="button"
                            className={styles.cancelBtn}
                            onClick={() => {
                              setShowRejectForm(false);
                              setRejectReason('');
                            }}
                            disabled={actionPending}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                </div>

                <ConfirmDialog
                  open={showApproveConfirm}
                  onCancel={() => setShowApproveConfirm(false)}
                  onConfirm={handleApprove}
                  title="Approve sale?"
                  message="This sale will move to Admin Approved and await payment verification."
                  confirmLabel="Approve"
                  cancelLabel="Cancel"
                  confirmDisabled={actionPending}
                  confirmLoading={actionPending}
                />
                <ConfirmDialog
                  open={showVerifyConfirm}
                  onCancel={() => setShowVerifyConfirm(false)}
                  onConfirm={handleVerifyPayment}
                  title="Verify payment?"
                  message="Payment will be marked verified. Next step is to confirm as Qualifying Sale."
                  confirmLabel="Verify"
                  cancelLabel="Cancel"
                  confirmDisabled={actionPending}
                  confirmLoading={actionPending}
                />
                <ConfirmDialog
                  open={showQualifyConfirm}
                  onCancel={() => setShowQualifyConfirm(false)}
                  onConfirm={handleQualify}
                  title="Confirm qualifying sale?"
                  message="This sale will become a Qualifying Sale and generate commissions."
                  confirmLabel="Confirm"
                  cancelLabel="Cancel"
                  confirmDisabled={actionPending}
                  confirmLoading={actionPending}
                />
              </div>
            )}

            {currentStatus !== 'SUBMITTED' &&
              currentStatus !== 'ADMIN_APPROVED' &&
              currentStatus !== 'PAYMENT_VERIFIED' && (
                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Status</h2>
                  <p className={styles.statusMessage}>
                    This sale is in{' '}
                    <strong>
                      {SALE_STATUS_LABEL[currentStatus as keyof typeof SALE_STATUS_LABEL] ??
                        currentStatus}
                    </strong>{' '}
                    status.{' '}
                    {currentStatus === 'ADMIN_APPROVED'
                      ? 'Awaiting payment verification.'
                      : currentStatus === 'QUALIFYING_SALE'
                        ? 'This sale has completed the full approval workflow.'
                        : currentStatus === 'REJECTED'
                          ? 'Rejected - reason shown above, member notified.'
                          : currentStatus === 'LOCKED'
                            ? 'Locked - reopen requires Admin/Super Admin review (audit).'
                            : 'No further actions are available.'}
                  </p>
                  {currentStatus !== data.status && (
                    <Button
                      variant="secondary"
                      onClick={() => navigate('/admin/sales')}
                      style={{ marginTop: 12 }}
                    >
                      Back to sales queue
                    </Button>
                  )}
                </div>
              )}
          </div>
        </>
      )}
      {data ? (
        <SaleFormDialog open={showEdit} onClose={() => setShowEdit(false)} sale={data} />
      ) : null}
      <ConfirmDialog
        open={showDeleteConfirm}
        onCancel={() => {
          if (!deletePending) setShowDeleteConfirm(false);
        }}
        onConfirm={handleDelete}
        title={data ? `Delete ${data.propertyName}?` : 'Delete sale?'}
        message="This sale will be permanently removed along with any uncredited commissions. Sales with credited commissions cannot be deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        confirmDisabled={deletePending}
        confirmLoading={deletePending}
      />
    </section>
  );
}
