import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { formatMoney } from '@jad/shared';
import { ErrorState, notifySuccess, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import type { SaleStatus } from '@jad/contracts';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { useSession } from '../../../lib/session';
import { PROPERTY_RECORDS } from '../../public/content/properties';
import { useCustomers, useSale } from '../hooks/useMember';
import { requestReopenSale, resubmitSale } from '../services/member';
import { SALE_STATUS_TONE, formatDate, saleStatusLabel } from '../lib/presentation';
import { SelectField } from '../../auth/components/SelectField';
import styles from './SaleDetailPage.module.css';

const STATUS_STEPS = [
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'ADMIN_APPROVED', label: 'Admin Approved' },
  { key: 'PAYMENT_VERIFIED', label: 'Payment Verified' },
  { key: 'QUALIFYING_SALE', label: 'Qualifying Sale' },
] as const;

function getStepIndex(status: string) {
  if (status === 'REJECTED' || status === 'LOCKED') return -1;
  return STATUS_STEPS.findIndex((s) => s.key === status);
}

/** Fixed-value catalog units eligible for sale submission (OD-003 pending; mock baseline). */
function submittableProperties() {
  return PROPERTY_RECORDS.filter((property) => property.price !== undefined);
}

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

/**
 * Sale detail (SCR-MEM-007, FR-SAL-001..007). Renders one of the member's own
 * sales with its server state. Rejected sales can be corrected and resubmitted
 * (`POST /sales/:id/resubmit`) up to the configurable maximum (BR-SAL-006);
 * locked sales can be flagged for staff review (`POST /me/sales/:id/reopen-request`,
 * #89 PROPOSED). All actions carry the API envelope errors.
 */
export function SaleDetailPage() {
  const { saleId = '' } = useParams<{ saleId: string }>();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const saleQuery = useSale(saleId);
  const customersQuery = useCustomers();
  const [resubmitting, setResubmitting] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [serverError, setServerError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `idem-${Date.now()}`,
  );
  const [resubmitErrors, setResubmitErrors] = useState<Record<string, string>>({});

  const properties = useMemo(() => submittableProperties(), []);

  useEffect(() => {
    if (saleQuery.data) {
      queueMicrotask(() => {
        setCustomerId(saleQuery.data.customerId);
        setPropertyId(saleQuery.data.propertyId);
      });
    }
  }, [saleQuery.data?.id, saleQuery.data?.customerId, saleQuery.data?.propertyId]);

  const regenerateKey = () =>
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random()}`;

  const resubmitMutation = useMutation({
    mutationFn: () => resubmitSale(saleId, { customerId, propertyId }, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', 'sales'] });
      void queryClient.invalidateQueries({ queryKey: ['member', 'sales', saleId] });
      setIdempotencyKey(regenerateKey());
      setServerError(undefined);
      notifySuccess({ title: 'Sale resubmitted', message: 'Now awaiting approval.' });
      setResubmitting(false);
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => requestReopenSale(saleId),
    onSuccess: () => {
      setServerError(undefined);
      notifySuccess({
        title: 'Request recorded',
        message: 'JA&D staff will review the locked sale.',
      });
    },
    onError: (error) => {
      setServerError(apiErrorMessage(error, 'We could not request a reopen. Please try again.'));
    },
  });

  const onCopySaleId = async () => {
    if (!saleQuery.data?.id) return;
    try {
      await navigator.clipboard.writeText(saleQuery.data.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  // Focus alert stack when an error appears for screen-reader announcement.
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (serverError && alertRef.current) {
      alertRef.current.focus();
    }
  }, [serverError]);

  const customerOptions = (customersQuery.data ?? []).map((customer) => ({
    value: customer.id,
    label: `${customer.fullName} · ${customer.phone}`,
  }));
  const propertyOptions = properties.map((property) => ({
    value: property.id,
    label: `${property.name} - ${formatMoney(property.price!)}`,
  }));
  const selectedResubmitProperty = useMemo(
    () => properties.find((property) => property.id === propertyId),
    [properties, propertyId],
  );

  if (saleQuery.isLoading) {
    return (
      <section>
        <PageHeader
          title="Sale detail"
          actions={
            <Link className={styles.backLink} to="/member/sales" aria-label="Back to sales">
              ← Back to sales
            </Link>
          }
        />
        <div className={styles.detailGrid} aria-busy="true" aria-live="polite">
          <div className={styles.detailsCard}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
          <div className={styles.detailsCard}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
          <div className={styles.detailsCard}>
            <Skeleton />
            <Skeleton />
          </div>
        </div>
      </section>
    );
  }

  if (saleQuery.isError || !saleQuery.data) {
    return (
      <section>
        <PageHeader
          title="Sale detail"
          actions={
            <Link className={styles.backLink} to="/member/sales" aria-label="Back to sales">
              ← Back to sales
            </Link>
          }
        />
        <ErrorState
          error={saleQuery.error}
          title="Could not load this sale"
          onRetry={() => void saleQuery.refetch()}
        />
      </section>
    );
  }

  const sale = saleQuery.data;

  // Referrers can open a sale that earned them a referral commission, but all
  // mutations (resubmit, reopen) stay seller-only - server and UI enforced.
  const isSeller = sale.sellerId === user?.id;

  const onResubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!customerId) nextErrors.customerId = 'Select a customer.';
    if (!propertyId) nextErrors.propertyId = 'Select a property from the catalog.';
    if (customerId === sale.customerId && propertyId === sale.propertyId) {
      nextErrors.propertyId = 'Change at least one field before resubmitting.';
    }
    setResubmitErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.customerId) document.getElementById('sale-resubmit-customerId')?.focus();
      else document.getElementById('sale-resubmit-propertyId')?.focus();
      return;
    }
    setServerError(undefined);
    resubmitMutation.mutate(undefined, {
      onError: (error) => {
        setServerError(apiErrorMessage(error, 'We could not resubmit the sale. Please try again.'));
      },
    });
  };

  const canResubmit = sale.status === 'REJECTED' && sale.resubmissionCount < 3;
  const maxedOut = sale.status === 'REJECTED' && sale.resubmissionCount >= 3;

  return (
    <section>
      <PageHeader
        title="Sale detail"
        actions={
          <Link className={styles.backLink} to="/member/sales" aria-label="Back to sales">
            ← Back to sales
          </Link>
        }
      />

      <div className={styles.pageStack}>
        <div ref={alertRef} tabIndex={-1} className={styles.alertStack} aria-live="polite">
          {serverError ? (
            <Alert variant="danger" title="We could not complete that action">
              {serverError}
            </Alert>
          ) : null}
        </div>

        <div className={styles.detailGrid}>
          <div className={styles.detailsCard}>
            <h2 className={styles.detailsTitle}>Sale overview</h2>
            <dl className={styles.details}>
              <div className={styles.item}>
                <dt>Sale reference</dt>
                <dd className={styles.saleIdCell}>
                  <code className={styles.saleId}>{sale.id}</code>
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
              <div className={styles.item}>
                <dt>Status</dt>
                <dd>
                  <StatusChip
                    label={saleStatusLabel(sale.status)}
                    tone={SALE_STATUS_TONE[sale.status as SaleStatus]}
                  />
                </dd>
              </div>
              <div className={styles.item}>
                <dt>Property</dt>
                <dd className={styles.propertyName}>{sale.propertyName}</dd>
              </div>
              <div className={styles.item}>
                <dt>Property value</dt>
                <dd className={styles.money}>{formatMoney(sale.propertyValue)}</dd>
              </div>
              <div className={styles.item}>
                <dt>Est. commission</dt>
                <dd className={styles.commissionPreview} aria-label="Estimated commission preview">
                  {sale.commissionRates ? (
                    <>
                      <span>
                        {formatMoney(
                          estimateCommission(sale.propertyValue, sale.commissionRates.direct),
                        )}
                      </span>{' '}
                      Direct ·{' '}
                      <span>
                        {formatMoney(
                          estimateCommission(sale.propertyValue, sale.commissionRates.referral),
                        )}
                      </span>{' '}
                      Referral{' '}
                      <span className={styles.commissionNote}>
                        (estimated, {rateLabel(sale.commissionRates.direct)}/
                        {rateLabel(sale.commissionRates.referral)})
                      </span>
                    </>
                  ) : (
                    <span className={styles.commissionNote}>Rates not configured</span>
                  )}
                </dd>
              </div>
              <div className={styles.item}>
                <dt>Customer</dt>
                <dd>{sale.customerName}</dd>
              </div>
              {sale.referrerName ? (
                <div className={styles.item}>
                  <dt>Referrer</dt>
                  <dd>{sale.referrerName}</dd>
                </div>
              ) : null}
              {sale.rejectionReason ? (
                <div className={styles.item}>
                  <dt>Rejection reason</dt>
                  <dd className={styles.reason}>{sale.rejectionReason}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div className={styles.detailsCard}>
            <h2 className={styles.detailsTitle}>Timeline</h2>
            <dl className={styles.details}>
              <div className={styles.item}>
                <dt>Submitted</dt>
                <dd>{formatDate(sale.submittedAt)}</dd>
              </div>
              {sale.approvedAt ? (
                <div className={styles.item}>
                  <dt>Admin approved</dt>
                  <dd>{formatDate(sale.approvedAt)}</dd>
                </div>
              ) : null}
              {sale.paymentVerifiedAt ? (
                <div className={styles.item}>
                  <dt>Payment verified</dt>
                  <dd>{formatDate(sale.paymentVerifiedAt)}</dd>
                </div>
              ) : null}
              {sale.lockedAt ? (
                <div className={styles.item}>
                  <dt>Locked</dt>
                  <dd>{formatDate(sale.lockedAt)}</dd>
                </div>
              ) : null}
              <div className={styles.item}>
                <dt>Resubmissions</dt>
                <dd>
                  <span className={styles.attemptCount}>{sale.resubmissionCount} / 3</span>
                  <span className={styles.attemptDots} aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={i < sale.resubmissionCount ? styles.dotFilled : styles.dotEmpty}
                      />
                    ))}
                  </span>
                  <span className="sr-only">{`${sale.resubmissionCount} of 3 attempts used`}</span>
                </dd>
              </div>
            </dl>
          </div>

          <div className={styles.detailsCard}>
            <h2 className={styles.detailsTitle}>Progress</h2>
            {getStepIndex(sale.status) >= 0 ? (
              <ol className={styles.progression}>
                {STATUS_STEPS.map((step, index) => {
                  const current = getStepIndex(sale.status);
                  const isComplete = current > index;
                  const isCurrent = current === index;
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
            ) : (
              <p className={styles.statusNote}>
                {sale.status === 'REJECTED'
                  ? 'This sale was rejected. Correct the details below and resubmit - you have ' +
                    `${3 - sale.resubmissionCount} attempt${3 - sale.resubmissionCount === 1 ? '' : 's'} remaining.`
                  : 'This sale is locked after maximum resubmission attempts. Request a reopen for Admin review.'}
              </p>
            )}
          </div>
        </div>

        <div className={styles.belowGrid}>
          {sale.status === 'SUBMITTED' ? (
            <Alert variant="info" title="Awaiting admin approval">
              Your sale is in the queue for JA&amp;D Admin approval. You’ll be notified once it’s
              reviewed.
            </Alert>
          ) : null}
          {sale.status === 'ADMIN_APPROVED' ? (
            <Alert variant="info" title="Awaiting payment verification">
              Admin approved - now awaiting payment verification by JA&amp;D Finance.
            </Alert>
          ) : null}
          {sale.status === 'PAYMENT_VERIFIED' ? (
            <Alert variant="info" title="Awaiting qualification">
              Payment verified - awaiting confirmation as a qualifying sale.
            </Alert>
          ) : null}
          {sale.status === 'QUALIFYING_SALE' ? (
            <Alert variant="success" title="Qualifying sale">
              This sale is qualifying - commission has been credited to your Available Balance.{' '}
              <Link className={styles.inlineLink} to="/member/commissions">
                View commissions
              </Link>
            </Alert>
          ) : null}
          {!isSeller ? (
            <Alert variant="info" title="Referred sale">
              You are viewing this sale as its selected referrer. It earned your referral commission
              - sale actions are unavailable.
            </Alert>
          ) : null}

          {maxedOut ? (
            <Alert variant="warning" title="This sale is locked">
              The maximum resubmission attempts have been reached. Contact JA&amp;D support to have
              the sale reviewed.
            </Alert>
          ) : null}

          {sale.status === 'LOCKED' && isSeller ? (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                loading={reopenMutation.isPending}
                disabled={reopenMutation.isPending || reopenMutation.isSuccess}
                onClick={() => reopenMutation.mutate()}
              >
                {reopenMutation.isSuccess ? 'Request sent' : 'Request reopen'}
              </Button>
              {reopenMutation.isSuccess ? (
                <span className={styles.inlineHint} role="status">
                  JA&amp;D will review - you’ll be notified.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {canResubmit && isSeller ? (
          <div className={styles.resubmit}>
            <h2 className={styles.subtitle}>Resubmit sale</h2>
            <p className={styles.lead}>
              Correct the details below to resubmit this sale for approval. You have{' '}
              {3 - sale.resubmissionCount} resubmission{3 - sale.resubmissionCount === 1 ? '' : 's'}{' '}
              remaining.
            </p>
            {resubmitting ? (
              <form className={styles.form} onSubmit={onResubmit} noValidate>
                {customersQuery.isLoading ? (
                  <div role="status" aria-live="polite">
                    <Skeleton />
                  </div>
                ) : customersQuery.isError ? (
                  <Alert variant="danger" title="Could not load customers">
                    We couldn’t load your customers. Please refresh or try again.
                  </Alert>
                ) : (
                  <>
                    <SelectField
                      id="sale-resubmit-customerId"
                      name="customerId"
                      label="Customer"
                      value={customerId}
                      onChange={(value) => {
                        setCustomerId(value);
                        setResubmitErrors((prev) => {
                          if (!prev.customerId) return prev;
                          const next = { ...prev };
                          delete next.customerId;
                          delete next.propertyId;
                          return next;
                        });
                        setServerError(undefined);
                      }}
                      options={customerOptions}
                      error={resubmitErrors.customerId}
                    />
                    <SelectField
                      id="sale-resubmit-propertyId"
                      name="propertyId"
                      label="Catalog property"
                      value={propertyId}
                      onChange={(value) => {
                        setPropertyId(value);
                        setResubmitErrors((prev) => {
                          if (!prev.propertyId) return prev;
                          const next = { ...prev };
                          delete next.propertyId;
                          return next;
                        });
                        setServerError(undefined);
                      }}
                      options={propertyOptions}
                      error={resubmitErrors.propertyId}
                      hint="The property value is snapshotted by JA&D at submission and never changes (BI-006)."
                    />
                  </>
                )}
                {selectedResubmitProperty ? (
                  <div className={styles.snapshotPreview} role="status" aria-live="polite">
                    Snapshot value:{' '}
                    <span className={styles.snapshotValue}>
                      {formatMoney(selectedResubmitProperty.price!)}
                    </span>{' '}
                    - this amount will be recorded and never changes.
                    {selectedResubmitProperty.id !== sale.propertyId ? (
                      <span className={styles.snapshotDiff}>
                        {' '}
                        · Different from current sale property
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className={styles.actions}>
                  <Button
                    type="submit"
                    loading={resubmitMutation.isPending}
                    disabled={resubmitMutation.isPending}
                  >
                    Resubmit sale
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setResubmitting(false)}
                    disabled={resubmitMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => setResubmitting(true)}>
                  Resubmit sale
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
