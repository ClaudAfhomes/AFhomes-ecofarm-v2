import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Payment as ContractPayment } from '@afhomes/contracts';
import { Button, Dialog, ErrorState, Select, StatusChip, notifyError } from '@afhomes/ui';
import { compareMoney } from '@afhomes/shared';
import styles from './BusinessFinanceQueuePage.module.css';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { formatMoney, paymentStatusBadge } from './format';
import {
  getPaymentAdjustments,
  getPaymentReferenceMatches,
  proposePaymentAdjustment,
} from './services';

/** Sale and reservation payments differ only in their owner ids, which are not used here. */
type Payment = Omit<ContractPayment, 'saleId'>;

const HOLD_PREFIX = 'This bank reference or OR number already appears on another contract';
const HOLD_CODE = 'PAYMENT_REFERENCE_REVIEW_REQUIRED';
export const REVIEW_NOTE_MIN = 5;

/** True when a verify failure is the duplicate-reference hold (not a generic failure). */
export function isDuplicateHold(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === HOLD_CODE || (typeof message === 'string' && message.startsWith(HOLD_PREFIX));
}

/** Local calendar date as YYYY-MM-DD (the date input's own format). */
export const todayIso = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

/** OR number, payment date, payer and posting period, when present. */
export function paymentDetailLine(payment: Payment): string {
  return [
    payment.orNumber ? `OR ${payment.orNumber}` : null,
    payment.paidOn ? `Paid ${payment.paidOn}` : null,
    payment.paidByName ? `By ${payment.paidByName}` : null,
    payment.postingPeriod ? `Period ${payment.postingPeriod}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** Hold panel: the other contract's payments plus a required reason to continue. */
export function DuplicateHoldPanel({
  paymentId,
  busy,
  onSave,
}: {
  paymentId: string;
  busy: boolean;
  onSave: (note: string) => void;
}) {
  const matches = useQuery({
    queryKey: ['business', 'payment-reference-matches', paymentId],
    queryFn: () => getPaymentReferenceMatches(paymentId),
  });
  const [note, setNote] = useState('');
  return (
    <section className={styles.detailSection} aria-label="Duplicate review">
      <h2 className={styles.detailTitle}>Held for duplicate review</h2>
      <p role="alert" className={styles.formAlert}>
        This reference or OR number is also on another contract. The payment stays Recorded.
      </p>
      {matches.isPending ? (
        <p role="status">Loading matches…</p>
      ) : matches.isError ? (
        <ErrorState error={matches.error} onRetry={matches.refetch} />
      ) : (
        <ul className={styles.timeline} aria-label="Matching payments">
          {matches.data.map((match) => (
            <li key={match.paymentId} className={styles.timelineItem}>
              <div className={styles.timelineTop}>
                <span className={styles.timelineAmount}>{formatMoney(match.amount)}</span>
                <StatusChip {...paymentStatusBadge(match.status)} />
              </div>
              <p className={styles.timelineMeta}>
                {match.reservationId ? 'Reservation' : 'Sale'} ·{' '}
                {[match.reference, match.orNumber ? `OR ${match.orNumber}` : null]
                  .filter(Boolean)
                  .join(' · ') || 'No reference'}{' '}
                · {formatDateTime(match.recordedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <label className={styles.field}>
        Why is this allocation correct?
        <textarea
          value={note}
          maxLength={500}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <Button
        disabled={busy || note.trim().length < REVIEW_NOTE_MIN}
        loading={busy}
        loadingLabel="Verifying…"
        onClick={() => onSave(note.trim())}
      >
        Save reason and verify
      </Button>
    </section>
  );
}

const KIND_OPTIONS = [
  { value: 'reversal', label: 'Reversal' },
  { value: 'returned_check', label: 'Returned check' },
  { value: 'refund', label: 'Refund' },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KIND_OPTIONS.map((option) => [option.value, option.label]),
);
const ADJUSTMENT_STATUS: Record<string, string> = {
  proposed: 'Proposed — awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** Existing proposals for one payment. Read-only: nothing here can approve. */
export function PaymentAdjustmentsList({ paymentId }: { paymentId: string }) {
  const list = useQuery({
    queryKey: ['business', 'payment-adjustments', paymentId],
    queryFn: () => getPaymentAdjustments(paymentId),
  });
  if (!list.data?.length) return null;
  return (
    <ul className={styles.timeline} aria-label="Adjustment proposals">
      {list.data.map((adjustment) => (
        <li key={adjustment.id} className={styles.timelineMeta}>
          {KIND_LABEL[adjustment.kind] ?? adjustment.kind} · {formatMoney(adjustment.amount)} ·{' '}
          {adjustment.effectiveDate} · {ADJUSTMENT_STATUS[adjustment.status] ?? adjustment.status}
          {' — '}
          {adjustment.reason}
        </li>
      ))}
    </ul>
  );
}

export function ProposeAdjustmentDialog({
  payment,
  onClose,
}: {
  payment: Payment;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [kind, setKind] = useState('reversal');
  const [amount, setAmount] = useState(payment.amount);
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const amountOk =
    /^\d+(\.\d{1,2})?$/.test(amount) &&
    compareMoney(amount, '0.00') > 0 &&
    compareMoney(amount, payment.amount) <= 0;
  const valid = amountOk && reason.trim().length >= REVIEW_NOTE_MIN && Boolean(effectiveDate);
  const propose = useBusinessMutation({
    mutationFn: () =>
      proposePaymentAdjustment(payment.id, {
        kind: kind as 'reversal' | 'returned_check' | 'refund',
        amount,
        reason: reason.trim(),
        effectiveDate,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['business', 'payment-adjustments', payment.id],
      });
      await client.invalidateQueries({ queryKey: ['business', 'queue', 'finance-summary'] });
    },
    onError: (error) =>
      notifyError({
        title: 'Proposal not saved',
        message: error instanceof Error ? error.message : 'The proposal was not saved.',
      }),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Propose adjustment"
      footer={
        <div className={styles.dialogFooter}>
          <span className={styles.dialogFooterSpacer} aria-hidden="true" />
          <Button variant="secondary" onClick={onClose}>
            {propose.isSuccess ? 'Close' : 'Cancel'}
          </Button>
          {propose.isSuccess ? null : (
            <Button
              disabled={!valid}
              loading={propose.isPending}
              loadingLabel="Saving…"
              onClick={() => propose.mutate()}
            >
              Propose
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.formGrid}>
        <p className={styles.formNote}>A proposal does not change the balance.</p>
        {propose.isSuccess ? (
          <p role="status" className={styles.formNote}>
            {ADJUSTMENT_STATUS.proposed}
          </p>
        ) : (
          <>
            <label className={styles.field}>
              Kind
              <Select
                aria-label="Kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                options={KIND_OPTIONS}
              />
            </label>
            <label className={styles.field}>
              Amount
              <input
                inputMode="decimal"
                value={amount}
                aria-invalid={!amountOk}
                onChange={(event) => setAmount(event.target.value.replace(/,/g, ''))}
              />
              {!amountOk ? (
                <span role="alert" className={styles.formAlert}>
                  Enter an amount above zero, at most {formatMoney(payment.amount)}.
                </span>
              ) : null}
            </label>
            <label className={styles.field}>
              Reason
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              Effective date
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </label>
          </>
        )}
        {propose.error ? (
          <p role="alert" className={styles.formAlert}>
            {propose.error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Payment ledger rows with receipt details, proposals and the propose action. */
export function PaymentLedgerList({ payments }: { payments: Payment[] }) {
  const { user } = useSession();
  // UX only: the server authorizes every proposal.
  const canPropose =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
    ) ?? false;
  const [proposing, setProposing] = useState<Payment | null>(null);
  return (
    <>
      <ol className={styles.timeline}>
        {payments.map((payment) => {
          const details = paymentDetailLine(payment);
          return (
            <li key={payment.id} className={styles.timelineItem}>
              <div className={styles.timelineTop}>
                <span className={styles.timelineAmount}>{formatMoney(payment.amount)}</span>
                <StatusChip {...paymentStatusBadge(payment.status)} />
              </div>
              <p className={styles.timelineMeta}>
                {payment.paymentType.replaceAll('_', ' ')} · {payment.method} ·{' '}
                {payment.reference ?? 'No reference'}
              </p>
              {details ? <p className={styles.timelineMeta}>{details}</p> : null}
              {payment.status === 'verified' ? (
                <>
                  <PaymentAdjustmentsList paymentId={payment.id} />
                  <div className={styles.timelineActions}>
                    <Button
                      variant="secondary"
                      disabled={!canPropose}
                      onClick={() => setProposing(payment)}
                    >
                      Propose adjustment
                    </Button>
                  </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
      {proposing ? (
        <ProposeAdjustmentDialog payment={proposing} onClose={() => setProposing(null)} />
      ) : null}
    </>
  );
}
