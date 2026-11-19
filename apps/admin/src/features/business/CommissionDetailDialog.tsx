import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Commission, Payment } from '@afhomes/contracts';
import {
  Button,
  DetailField,
  DetailFieldGrid,
  Dialog,
  EmptyState,
  ErrorState,
  StatusChip,
} from '@afhomes/ui';
import { addMoney, formatMoneyOrDash, multiplyMoney } from '@afhomes/shared';

import { ApiError } from '../../lib/api/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatRate } from './format';
import { getSalePayments } from './services';
import { businessKeys } from './queryKeys';
import styles from './BusinessCommissionsPage.module.css';

/** The approved eligibility milestone. Display only: the server decides eligibility. */
const ELIGIBILITY_RATE = '0.40';

const toCents = (v: string) => {
  const [w = '0', f = ''] = v.split('.');
  return BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
};

/** Verified collections as a percentage of the frozen basis, floored to 0.1% (never overstated). */
export function collectionPercent(verified: string, basis: string): string {
  const b = toCents(basis);
  if (b === 0n) return '—';
  const tenths = (toCents(verified) * 1000n) / b;
  return `${tenths / 10n}.${tenths % 10n}%`;
}

function verifiedTotal(payments: readonly Payment[]): string {
  return payments
    .filter((p) => p.status === 'verified')
    .reduce((sum, p) => addMoney(sum, p.amount), '0.00');
}

/**
 * The server keeps this sale's payments from the viewer: no permission (403), or a sale
 * outside their scope (404; a commission's sale always exists). An answer about access,
 * not a fault, so it gets no error box and no retry.
 */
const isRefusal = (error: unknown) =>
  error instanceof ApiError && (error.status === 403 || error.status === 404);

/** A calendar date (`YYYY-MM-DD`) shown as recorded, never shifted by the viewer's time zone. */
function formatCalendarDate(day: string): string {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * No eligibility date means "not reached" only while the commission is still expected
 * (`pending`). Every later status comes after the eligibility step in the lifecycle, so a
 * missing date there was simply not recorded (for example on an imported commission).
 */
function eligibleSince(commission: Commission): ReactNode {
  if (commission.eligibleAt) return formatDateTime(commission.eligibleAt);
  if (commission.status === 'pending') return <StatusChip label="Not yet eligible" tone="warning" />;
  return commission.status === 'cancelled' ? '—' : 'Date not recorded';
}

interface Props {
  commission: Commission;
  /** The single next action the viewer may take, already permission- and state-checked. */
  action?: ReactNode;
  /**
   * The viewer records external commission payments. Only then is an empty evidence field
   * meaningful ("not recorded"); other viewers may simply not be shown it (seller scope).
   */
  recordsPayouts?: boolean;
  /** The effective hold: the server's, overridden by a hold placed or released in this session. */
  heldReason: string | null;
  onClose: () => void;
}

/**
 * Read-only commission detail: calculation from frozen terms, collection progress against
 * the 40% eligibility milestone, approval and external payment history. Nothing here
 * computes or changes an amount.
 */
export function CommissionDetailDialog({
  commission,
  action,
  recordsPayouts = false,
  heldReason,
  onClose,
}: Props) {
  const payments = useQuery({
    queryKey: [...businessKeys.commissionsScope, commission.id, 'sale-payments'],
    queryFn: () => getSalePayments(commission.saleId),
  });
  const verified = payments.data ? verifiedTotal(payments.data) : null;
  const refused = payments.isError && isRefusal(payments.error);
  const threshold = multiplyMoney(commission.basisAmount, ELIGIBILITY_RATE);
  /** A figure derived from the verified payments: never a guess while loading or after a failure. */
  const fromPayments = (render: (total: string) => string) =>
    verified !== null
      ? render(verified)
      : refused
        ? 'Not shown'
        : payments.isError
          ? 'Unavailable'
          : '…';

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Commission ${commission.commissionNumber ?? ''}`.trim()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {action}
        </>
      }
    >
      <div className={styles.formGrid}>
        <h3 className={`${styles.fullRow} ${styles.primary}`}>Calculation (frozen at sale)</h3>
        <DetailFieldGrid className={styles.facts}>
          <DetailField label="Recipient">
            {commission.beneficiaryName} ({commission.beneficiaryType === 'ost' ? 'OST' : 'Staff'})
          </DetailField>
          <DetailField label="Type">{commission.commissionType ?? 'DSC'}</DetailField>
          <DetailField label="Sale">{commission.saleNumber}</DetailField>
          <DetailField label="Basis (contract price)">
            {formatMoneyOrDash(commission.basisAmount)}
          </DetailField>
          <DetailField label="Frozen rate">{formatRate(commission.rate)}</DetailField>
          <DetailField label="Commission amount">
            <strong className={styles.factAmount}>{formatMoneyOrDash(commission.amount)}</strong>
          </DetailField>
        </DetailFieldGrid>

        <h3 className={`${styles.fullRow} ${styles.primary}`}>Eligibility (40% verified)</h3>
        <DetailFieldGrid className={styles.facts}>
          <DetailField label="Verified collections">{fromPayments(formatMoneyOrDash)}</DetailField>
          <DetailField label="Collection progress">
            {fromPayments((total) => collectionPercent(total, commission.basisAmount))}
          </DetailField>
          <DetailField label="40% milestone">{formatMoneyOrDash(threshold)}</DetailField>
          <DetailField label="Eligible since">{eligibleSince(commission)}</DetailField>
        </DetailFieldGrid>
        <p className={styles.formNote}>
          Eligibility is not approval or payment. Qualification and payout are separate recorded
          decisions.
        </p>

        <h3 className={`${styles.fullRow} ${styles.primary}`}>Approval and payment</h3>
        <DetailFieldGrid className={styles.facts}>
          <DetailField label="Created">{formatDate(commission.createdAt)}</DetailField>
          <DetailField label="Qualified">
            {commission.qualifiedAt ? formatDateTime(commission.qualifiedAt) : '—'}
          </DetailField>
          <DetailField label="Decision notes">{commission.qualificationNotes ?? '—'}</DetailField>
          <DetailField label="On hold">{heldReason ?? 'No'}</DetailField>
          <DetailField label="Paid on">
            {commission.paidOn
              ? formatCalendarDate(commission.paidOn)
              : commission.paidAt
                ? formatDate(commission.paidAt)
                : '—'}
          </DetailField>
          <DetailField label="Method">{commission.paidMethod ?? '—'}</DetailField>
          <DetailField label="External reference">{commission.paidReference ?? '—'}</DetailField>
          {commission.paidEvidenceReference || recordsPayouts ? (
            <DetailField label="Payout evidence">{commission.paidEvidenceReference ?? '—'}</DetailField>
          ) : null}
        </DetailFieldGrid>

        <h3 className={`${styles.fullRow} ${styles.primary}`}>Verified payment evidence</h3>
        {refused ? (
          <p className={styles.formNote}>
            Payment records for this sale are not shown to your account. Finance can confirm the
            verified collections.
          </p>
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : payments.isPending ? (
          <p className={styles.formNote}>Loading payments…</p>
        ) : payments.data.filter((p) => p.status === 'verified').length === 0 ? (
          <EmptyState title="No verified payments" description="Recorded payments count only once verified." />
        ) : (
          <ul className={styles.fullRow} aria-label="Verified payments">
            {payments.data
              .filter((p) => p.status === 'verified')
              .map((p) => (
                <li key={p.id}>
                  <strong>{formatMoneyOrDash(p.amount)}</strong> · {p.paymentNumber ?? '—'} · verified{' '}
                  {p.verifiedAt ? formatDate(p.verifiedAt) : '—'}
                  {p.verifiedByName ? ` by ${p.verifiedByName}` : ''}
                </li>
              ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
