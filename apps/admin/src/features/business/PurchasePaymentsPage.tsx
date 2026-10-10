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
 * Authorisation: this is the Operational Services Finance screen, and it is
 * deliberately NOT the VIP-card payment queue. Verifying an operational receipt
 * requires `operations.payments` UPDATE - its own key, not
 * `finance.payment_verification` - so the two payment workflows neither share a
 * permission nor can verify each other's money. `employee` (the GSD) holds no
 * row on this key at all, which is why the seller who records a receipt can
 * never be the person who accepts it.
 *
 * This screen is EXTENDED rather than duplicated: it already listed operational
 * purchases and their receipts, so the settlement figures and claim status were
 * added to it instead of building a second receipt-management page.
 *
 * Purchase receipts stay separate from the card-sale `public.payments` workflow:
 * this screen never touches a card sale, and `payments_purchase_origin_check`
 * admits only 'sale' and 'reservation', so an operational receipt cannot appear
 * on one even by accident.
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
  StatusChip,
  notifySuccess,
} from '@afhomes/ui';

import { formatMoney } from './format';
import { useSession } from '../../lib/session';
import styles from './points.module.css';
import {
  decideReceipt,
  getPurchaseSummary,
  getSettlement,
  listFinancePurchases,
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
  const purchases = useQuery({
    queryKey: ['earning', 'finance', 'purchases'],
    queryFn: listFinancePurchases,
    refetchInterval: 15_000,
  });
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'completed' | 'reversed'>(
    'all',
  );

  const rows = (purchases.data ?? []).filter(
    (p) => statusFilter === 'all' || p.status === statusFilter,
  );

  return (
    <>
      <PageHeader
        title="Operational Payment Verification"
        description="What was sold, to whom, at what price and discount, how much is verified, and whether the member has claimed their points. A recorded receipt is not money until it is verified."
      />

      {purchases.isLoading && (
        <div role="status" aria-label="Loading sales" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {purchases.isError && (
        <ErrorState
          title="Payments unavailable"
          message="The purchase list could not be loaded. Try again."
          onRetry={purchases.refetch}
        />
      )}
      {purchases.data && purchases.data.length === 0 && (
        <EmptyState
          title="No sales yet"
          description="A receipt is recorded against a purchase, so there is nothing to settle until a sale exists."
        />
      )}

      {purchases.data && purchases.data.length > 0 && (
        <section aria-label="Sales records">
          <label htmlFor="sales-status-filter">Status</label>
          <select
            id="sales-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All</option>
            <option value="draft">Pending</option>
            <option value="completed">Completed</option>
            <option value="reversed">Reversed</option>
          </select>

          {rows.length === 0 ? (
            <EmptyState title="No sales with that status" />
          ) : (
            // The shared `.table-scroll` contract: overflow stays inside this
            // region so the page never scrolls sideways, and `tabIndex` keeps the
            // scroller reachable by keyboard.
            <div
              role="region"
              aria-label="Scrollable sales records"
              tabIndex={0}
              className="table-scroll"
            >
              <table>
                <caption className={styles.hint}>
                  Gross, the VIP tier discount and any points discount are shown separately: neither
                  discount is a receipt, and the amount due is what must be collected.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Transaction</th>
                    <th scope="col">Date</th>
                    <th scope="col">Service</th>
                    <th scope="col">Customer</th>
                    <th scope="col">GSD</th>
                    <th scope="col">Tier</th>
                    <th scope="col">Gross</th>
                    <th scope="col">Tier discount</th>
                    <th scope="col">Net due</th>
                    <th scope="col">Verified</th>
                    <th scope="col">Status</th>
                    <th scope="col">Claim</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((purchase) => (
                    <tr key={purchase.id}>
                      <th scope="row">{purchase.purchaseNumber}</th>
                      <td>{purchase.createdAt ? purchase.createdAt.slice(0, 10) : '-'}</td>
                      <td>
                        {purchase.lines
                          .map((l) => `${l.quantity} x ${formatMoney(l.unitAmount)}`)
                          .join(', ') || '-'}
                      </td>
                      <td>{purchase.customerName ?? '-'}</td>
                      <td>{purchase.createdByName ?? '-'}</td>
                      <td>{purchase.tierSnapshot ?? '-'}</td>
                      <td>{formatMoney(purchase.grossAmount)}</td>
                      <td>
                        {purchase.tierDiscountAmount !== '0.00'
                          ? `- ${formatMoney(purchase.tierDiscountAmount)}`
                          : '-'}
                      </td>
                      <td>{formatMoney(purchase.netAmount)}</td>
                      <td>{formatMoney(purchase.verifiedTotal)}</td>
                      <td>
                        <StatusChip
                          tone={
                            purchase.status === 'completed'
                              ? 'success'
                              : purchase.status === 'reversed'
                                ? 'danger'
                                : 'warning'
                          }
                          label={purchase.status}
                        />
                      </td>
                      <td>{purchase.claimStatus ?? 'not issued'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* One receipt panel per sale, so a reviewer can accept or reject a
              specific receipt. */}
          {rows.map((purchase) => (
            <PurchasePaymentRow
              key={purchase.id}
              purchaseId={purchase.id}
              purchaseNumber={purchase.purchaseNumber}
              netAmount={purchase.netAmount}
            />
          ))}
        </section>
      )}
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
  const permissions = useSession().user?.afHomesPermissions ?? [];
  const mayVerify = permissions.some((p) => p.moduleKey === 'operations.payments' && p.canUpdate);
  const mayRecord = permissions.some((p) => p.moduleKey === 'operations.sales' && p.canCreate);
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
    void client.invalidateQueries({ queryKey: ['earning', 'finance', 'purchases'] });
    void client.invalidateQueries({ queryKey: ['earning', 'settlement'] });
  };

  /**
   * The authoritative settlement state, read from the database rather than
   * inferred from the receipt list on screen.
   *
   * Finance and the seller must see the SAME numbers: a screen that derived
   * "is this settled?" from its own rows could disagree with the gate that
   * actually decides it, and the disagreement would always favour settling.
   */
  const settlement = useQuery({
    queryKey: ['earning', 'settlement', purchaseId],
    queryFn: () => getSettlement(purchaseId),
  });

  return (
    <section aria-label={`Receipts for ${purchaseNumber}`}>
      <h2>{purchaseNumber}</h2>
      <p className={styles.hint}>Amount due {formatMoney(netAmount)}</p>

      {/* The single settlement answer, so Finance and the seller are never
          looking at different versions of the truth. */}
      {settlement.data && (
        <div aria-live="polite">
          <p>
            <StatusChip
              tone={settlement.data.status === 'completed' ? 'success' : 'warning'}
              label={settlement.data.status}
            />{' '}
            Outstanding {formatMoney(settlement.data.remainingAmount)}
            {settlement.data.pendingReceipts > 0 &&
              ` - ${settlement.data.pendingReceipts} receipt(s) awaiting verification`}
            {settlement.data.rejectedReceipts > 0 &&
              ` - ${settlement.data.rejectedReceipts} rejected`}
          </p>
          <p className={styles.hint}>
            Claim:{' '}
            {settlement.data.claimable
              ? 'claimable'
              : (settlement.data.claimStatus ?? 'not issued yet')}
            . Verified receipts {formatMoney(settlement.data.verifiedTotal)} of{' '}
            {formatMoney(settlement.data.netAmount)} due.
          </p>
          <Button
            variant="secondary"
            onClick={refresh}
            loading={settlement.isFetching}
            loadingLabel="Refreshing…"
          >
            Refresh settlement
          </Button>
        </div>
      )}

      {summary.isLoading && (
        <div role="status" aria-label="Loading the financial summary" aria-busy="true">
          <Skeleton />
        </div>
      )}
      {summary.isError && (
        <ErrorState
          title="Summary unavailable"
          message="The figures for this purchase could not be loaded."
        />
      )}
      {summary.data && (
        <table>
          <tbody>
            {/* Gross, each discount, then the net. Shown separately and in that
                order so the arithmetic is legible: a reviewer must be able to
                see WHY the amount due is less than the gross, and must be able
                to tell a VIP tier discount (a rate) from a points discount (a
                conversion). Neither is a receipt, and collapsing them into one
                figure is how a discount gets mistaken for cash. */}
            <tr>
              <th scope="row">Gross service value</th>
              <td>{formatMoney(summary.data.grossAmount)}</td>
            </tr>
            <tr>
              <th scope="row">VIP tier discount</th>
              <td>
                {summary.data.tierDiscountAmount && summary.data.tierDiscountAmount !== '0.00'
                  ? `- ${formatMoney(summary.data.tierDiscountAmount)}`
                  : 'None'}
              </td>
            </tr>
            <tr>
              <th scope="row">Points discount</th>
              <td>
                {summary.data.pointsDiscountAmount !== '0.00'
                  ? `- ${formatMoney(summary.data.pointsDiscountAmount)}`
                  : 'None'}
              </td>
            </tr>
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

      {receipts.isLoading && (
        <div role="status" aria-label="Loading receipts" aria-busy="true">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {receipts.isError && (
        <ErrorState
          title="Receipts unavailable"
          message="The receipts for this purchase could not be loaded."
        />
      )}
      {receipts.data?.length === 0 && <p className={styles.hint}>No payment recorded yet.</p>}
      {receipts.data && receipts.data.length > 0 && (
        <div role="region" aria-label="Scrollable receipts" tabIndex={0} className="table-scroll">
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
                    {receipt.status === 'recorded' && mayVerify && (
                      <VerifyActions paymentId={receipt.id} onDone={refresh} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button variant="secondary" disabled={!mayRecord} onClick={() => setRecording(true)}>
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
function VerifyActions({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
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
          loading={decide.isPending}
          loadingLabel="Rejecting…"
          disabled={!reason.trim()}
          onClick={() => decide.mutate({ decision: 'rejected', rejectionReason: reason.trim() })}
        >
          Confirm rejection
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
        loading={decide.isPending}
        loadingLabel="Verifying…"
        onClick={() => decide.mutate({ decision: 'verified', rejectionReason: null })}
      >
        Verify
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
        message: 'It is not money received yet. Verify it to count it toward the amount due.',
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
            disabled={!amount || !method}
            loading={save.isPending}
            loadingLabel="Recording…"
            onClick={() => save.mutate()}
          >
            Record payment
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

        {error && <ErrorState title="Not recorded" message={error} />}
      </div>
    </Dialog>
  );
}
