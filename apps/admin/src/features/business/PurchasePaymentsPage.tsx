/**
 * Finance: recording and verifying purchase receipts.
 *
 * The minimum interface needed to SETTLE a service purchase, and nothing more.
 *
 * Two rules this screen exists to make visible, because both are easy to get
 * wrong at a till:
 *
 *  1. A RECORDED receipt is not money received. It sits in 'recorded' until
 *     someone verifies it, and only 'verified' counts toward the amount due. The
 *     UI never describes a recorded receipt as settled, and the summary is
 *     refreshed after every mutation so the figure on screen is real.
 *  2. The recorder and the verifier are DIFFERENT attributed acts. The row shows
 *     who recorded and who verified, separately.
 *
 * Rejection requires a reason, and a rejection removes the money from the
 * received figure rather than merely flagging it.
 *
 * Authorisation reuses the existing Finance controls: recording and verifying
 * both require `sales.customers` UPDATE, the same permission the payment queue
 * and the discount screen already use. No new module key and no new verb were
 * invented for this.
 *
 * Purchase receipts stay separate from the card-sale `public.payments` workflow:
 * this screen never touches a card sale, and a purchase receipt can never appear
 * on one.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Spinner,
  StatusChip,
  notifySuccess,
} from '@afhomes/ui';

import { formatMoney } from './format';
import styles from './points.module.css';
import {
  decideReceipt,
  getPurchaseSummary,
  listPurchases,
  listReceipts,
  recordReceipt,
} from './points-services';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  verified: 'success',
  recorded: 'warning',
  rejected: 'danger',
  voided: 'neutral',
};

export function PurchasePaymentsPage() {
  const purchases = useQuery({ queryKey: ['earning', 'purchases'], queryFn: listPurchases });

  return (
    <>
      <PageHeader
        title="Purchase Payments"
        description="Record cash received against a service purchase, then verify it. A recorded payment is not money until it is verified."
      />

      {purchases.isLoading && <Skeleton />}
      {purchases.isError && (
        <ErrorState
          title="Purchases unavailable"
          message="The purchase list could not be loaded, so a receipt cannot be recorded."
        />
      )}
      {purchases.data && purchases.data.length === 0 && (
        <EmptyState
          title="No purchases yet"
          description="A receipt is recorded against a purchase, so there is nothing to collect against yet."
        />
      )}

      {purchases.data?.map((purchase) => (
        <PurchasePaymentRow
          key={purchase.id}
          purchaseId={purchase.id}
          purchaseNumber={purchase.purchaseNumber}
          netAmount={purchase.netAmount}
        />
      ))}
    </>
  );
}

function PurchasePaymentRow({
  purchaseId,
  purchaseNumber,
  netAmount,
}: {
  purchaseId: string;
  purchaseNumber: string;
  netAmount: string;
}) {
  const client = useQueryClient();
  const [recording, setRecording] = useState(false);

  // Both are refetched after every mutation: a receipt changes what has actually
  // been received, and leaving a stale figure on screen is how a purchase gets
  // marked settled when no cash arrived.
  const summary = useQuery({
    queryKey: ['earning', 'purchase', purchaseId, 'summary'],
    queryFn: () => getPurchaseSummary(purchaseId),
  });
  const receipts = useQuery({
    queryKey: ['earning', 'purchase', purchaseId, 'receipts'],
    queryFn: () => listReceipts(purchaseId),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['earning', 'purchase', purchaseId] });
    void client.invalidateQueries({ queryKey: ['earning', 'purchases'] });
  };

  return (
    <section aria-label={`Receipts for ${purchaseNumber}`}>
      <h2>{purchaseNumber}</h2>
      <p className={styles.hint}>Amount due {formatMoney(netAmount)}</p>

      {summary.isLoading && <Skeleton />}
      {summary.isError && (
        <ErrorState title="Summary unavailable" message="The figures for this purchase could not be loaded." />
      )}
      {summary.data && (
        <table>
          <tbody>
            <tr>
              <th scope="row">Amount due</th>
              <td>{formatMoney(summary.data.netAmount)}</td>
            </tr>
            <tr>
              <th scope="row">Verified received</th>
              <td>{formatMoney(summary.data.verifiedTotal)}</td>
            </tr>
            <tr>
              <th scope="row">Still due</th>
              <td>
                {formatMoney(summary.data.remainingBalance)}{' '}
                <StatusChip
                  tone={summary.data.fullyPaid ? 'success' : 'warning'}
                  label={summary.data.fullyPaid ? 'Settled' : 'Outstanding'}
                />
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {receipts.isLoading && <Skeleton />}
      {receipts.isError && (
        <ErrorState title="Receipts unavailable" message="The receipts for this purchase could not be loaded." />
      )}
      {receipts.data?.length === 0 && (
        <p className={styles.hint}>No payment recorded yet.</p>
      )}
      {receipts.data && receipts.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Payment</th>
              <th scope="col">Amount</th>
              <th scope="col">Method</th>
              <th scope="col">Status</th>
              <th scope="col">Recorded by</th>
              <th scope="col">Verified by</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {receipts.data.map((receipt) => (
              <tr key={receipt.id}>
                <td>{receipt.paymentNumber}</td>
                <td>{formatMoney(receipt.amount)}</td>
                <td>{receipt.method}</td>
                <td>
                  <StatusChip
                    tone={STATUS_TONE[receipt.status] ?? 'neutral'}
                    label={receipt.status}
                  />
                  {receipt.rejectionReason && (
                    <span className={styles.hint}> {receipt.rejectionReason}</span>
                  )}
                </td>
                {/* Two DIFFERENT attributed acts. Recording and verifying are never
                    collapsed into one column, because "who took the money" and
                    "who confirmed it" are separate questions. */}
                <td>{receipt.recordedBy ?? '—'}</td>
                <td>{receipt.verifiedBy ?? '—'}</td>
                <td>
                  {receipt.status === 'recorded' && (
                    <VerifyActions paymentId={receipt.id} onDone={refresh} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Button variant="secondary" onClick={() => setRecording(true)}>
        Record a payment
      </Button>

      {recording && (
        <RecordDialog
          purchaseId={purchaseId}
          purchaseNumber={purchaseNumber}
          suggestedAmount={summary.data?.remainingBalance ?? netAmount}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}

/**
 * Verify or reject a recorded receipt.
 *
 * Both are single-use: the database refuses to move a receipt out of 'recorded'
 * twice, so a double click cannot accept the same money twice. The controls are
 * disabled while the decision is in flight for the same reason.
 */
function VerifyActions({
  paymentId,
  onDone,
}: {
  paymentId: string;
  onDone: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (input: { decision: 'verified' | 'rejected'; rejectionReason: string | null }) =>
      decideReceipt(paymentId, input),
    onSuccess: (result) => {
      setError(null);
      setRejecting(false);
      setReason('');
      notifySuccess({
        title: result.status === 'verified' ? 'Payment verified' : 'Payment rejected',
        message:
          result.status === 'verified'
            ? `${formatMoney(result.verifiedTotal)} is now verified against this purchase.`
            : 'This payment no longer counts as received money.',
      });
      onDone();
    },
    onError: (cause: unknown) => {
      // The typed reason SURVIVES, so a rejected attempt can be corrected and
      // resubmitted without retyping why.
      setError(cause instanceof Error ? cause.message : 'That payment could not be decided.');
    },
  });

  if (rejecting) {
    return (
      <div className={styles.inlineActions} aria-busy={decide.isPending}>
        <label htmlFor={`reason-${paymentId}`}>Reason for rejecting</label>
        <input
          id={`reason-${paymentId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={decide.isPending}
        />
        <Button
          variant="danger"
          size="sm"
          // A rejection with no reason is refused by the server; the button is
          // disabled first so the member is not shown an error for an empty box.
          disabled={decide.isPending || !reason.trim()}
          onClick={() =>
            decide.mutate({ decision: 'rejected', rejectionReason: reason.trim() })
          }
        >
          {decide.isPending ? 'Rejecting…' : 'Confirm rejection'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setRejecting(false)}>
          Cancel
        </Button>
        {error && (
          <p role="alert" className={styles.hint}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <span className={styles.inlineActions}>
      <Button
        size="sm"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ decision: 'verified', rejectionReason: null })}
      >
        {decide.isPending ? 'Verifying…' : 'Verify'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={decide.isPending}
        onClick={() => setRejecting(true)}
      >
        Reject
      </Button>
      {error && (
        <p role="alert" className={styles.hint}>
          {error}
        </p>
      )}
    </span>
  );
}

/**
 * Record a payment.
 *
 * There is NO points field, and no "method: points" escape hatch: a points
 * discount reduces the amount DUE and is not a receipt, so letting it be entered
 * here would be a way to double-count it as cash.
 */
function RecordDialog({
  purchaseId,
  purchaseNumber,
  suggestedAmount,
  onClose,
  onSaved,
}: {
  purchaseId: string;
  purchaseNumber: string;
  suggestedAmount: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(suggestedAmount);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      recordReceipt(purchaseId, {
        amount,
        method,
        reference: reference.trim() || null,
      }),
    onSuccess: (receipt) => {
      notifySuccess({
        title: `Payment ${receipt.paymentNumber} recorded`,
        message:
          'It is not money received yet. Verify it to count it toward the amount due.',
      });
      onSaved();
    },
    onError: (cause: unknown) => {
      // The entered amount, method and reference all SURVIVE a failure.
      setError(cause instanceof Error ? cause.message : 'That payment could not be recorded.');
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record a payment for ${purchaseNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !amount || !method}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </>
      }
    >
      <div aria-busy={save.isPending}>
        <label htmlFor={`amount-${purchaseId}`}>Amount</label>
        <input
          id={`amount-${purchaseId}`}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={save.isPending}
        />

        <label htmlFor={`method-${purchaseId}`}>Method</label>
        <select
          id={`method-${purchaseId}`}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          disabled={save.isPending}
        >
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
          <option value="cheque">Cheque</option>
        </select>

        <label htmlFor={`reference-${purchaseId}`}>Reference (optional)</label>
        <input
          id={`reference-${purchaseId}`}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          disabled={save.isPending}
        />

        <p className={styles.hint}>
          Recording is not the same as receiving. This payment only counts toward the amount due
          once it is verified.
        </p>

        {save.isPending && <Spinner label="Recording the payment" />}
        {error && <ErrorState title="Not recorded" message={error} />}
      </div>
    </Dialog>
  );
}
