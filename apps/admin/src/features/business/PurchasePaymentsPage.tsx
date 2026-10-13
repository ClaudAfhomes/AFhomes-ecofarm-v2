import { ServiceRefundPanel } from './ServiceRefundPanel';
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
import { PointRefundReview } from './PointRefundReview';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';

import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextField,
  notifySuccess,
} from '@afhomes/ui';

import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './PurchasePaymentsPage.module.css';
import { TierBadge } from './TierBadge';
import { humanizeCode } from './format';
import {
  decideReceipt,
  getPurchaseSummary,
  getSettlement,
  listFinancePurchases,
  listReceipts,
  recordReceipt,
} from './points-services';
import { earningKeys } from './queryKeys';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  verified: 'success',
  recorded: 'warning',
  rejected: 'danger',
  voided: 'neutral',
};

const PURCHASE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  completed: 'success',
  reversed: 'danger',
  draft: 'warning',
};

export function PurchasePaymentsPage() {
  const purchases = useQuery({
    queryKey: earningKeys.financePurchases,
    queryFn: listFinancePurchases,
    // Keep the previous list on screen while the next poll lands: refetches
    // then feel instant and the skeleton only ever appears on first load.
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'completed' | 'reversed'>(
    'all',
  );
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());

  const all = useMemo(() => purchases.data ?? [], [purchases.data]);
  // Headline counts from the loaded purchases.
  const summary = useMemo(() => {
    const draft = all.filter((p) => p.status === 'draft').length;
    const completed = all.filter((p) => p.status === 'completed').length;
    const reversed = all.filter((p) => p.status === 'reversed').length;
    return { total: all.length, draft, completed, reversed };
  }, [all]);
  // Client-side status and text filter over the loaded purchases.
  const rows = useMemo(() => {
    const term = settled.toLowerCase();
    return all.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!term) return true;
      return [p.purchaseNumber, p.customerName ?? '', p.createdByName ?? ''].some((value) =>
        value.toLowerCase().includes(term),
      );
    });
  }, [all, statusFilter, settled]);

  // First load skeletonizes the whole page: header, summary, filters and
  // table. Refetches keep the previous list visible via placeholderData and
  // never reach this branch.
  if (purchases.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading purchases"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 320 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Operational Payment Verification"
        description="Verify operational purchase receipts before settlement."
      />
      <Alert variant="warning" title="Recorded is not received">
        A recorded receipt is not money until it is verified. Only verified receipts count toward
        the amount due.
      </Alert>

      {purchases.isError ? (
        <ErrorState
          title="Payments unavailable"
          message="The purchase list could not be loaded. Try again."
          onRetry={purchases.refetch}
        />
      ) : (
        <>
          <ul className={styles.summary} aria-label="Purchase summary">
            <li>
              <MetricCard
                label="Open drafts"
                value={formatCountOrDash(summary.draft)}
                icon="clock"
                description="Draft purchases awaiting settlement"
              />
            </li>
            <li>
              <MetricCard
                label="Completed sales"
                value={formatCountOrDash(summary.completed)}
                icon="check"
                description="Settled purchases"
              />
            </li>
            <li>
              <MetricCard
                label="Reversed sales"
                value={formatCountOrDash(summary.reversed)}
                icon="close"
                description="Reversed purchases"
              />
            </li>
          </ul>

          <FilterBar
            filtersToggleLabel="Expand Filters"
            search={
              <SearchField
                label="Search purchases"
                placeholder="Transaction, customer, or seller"
                value={search}
                onChange={setSearch}
                busy={purchases.isFetching}
              />
            }
            filters={
              <label className={styles.filterLabel}>
                Status
                <Select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'draft', label: 'Pending' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'reversed', label: 'Reversed' },
                  ]}
                />
              </label>
            }
          />

          {all.length === 0 ? (
            <EmptyState
              title="No sales yet"
              description="A receipt is recorded against a purchase, so there is nothing to settle until a sale exists."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No sales with that status"
              description="No purchase matches the current filters."
            />
          ) : (
            <section aria-label="Sales records">
              {/* The shared `.table-scroll` contract: overflow stays inside this
                  region so the page never scrolls sideways, and `tabIndex` keeps the
                  scroller reachable by keyboard. */}
              <div
                role="region"
                aria-label="Scrollable sales records"
                tabIndex={0}
                className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
              >
                <Table className={styles.queueTable}>
                  <TableCaption>
                    Gross, the VIP tier discount and any points discount are shown separately:
                    neither discount is a receipt, and the amount due is what must be collected.
                  </TableCaption>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Transaction</TableHeaderCell>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Service</TableHeaderCell>
                      <TableHeaderCell>Customer</TableHeaderCell>
                      <TableHeaderCell>GSD</TableHeaderCell>
                      <TableHeaderCell>Tier</TableHeaderCell>
                      <TableHeaderCell align="right">Gross</TableHeaderCell>
                      <TableHeaderCell align="right">Tier discount</TableHeaderCell>
                      <TableHeaderCell align="right">Net due</TableHeaderCell>
                      <TableHeaderCell align="right">Verified</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Claim</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((purchase) => (
                      <TableRow key={purchase.id}>
                        <TableCell label="Transaction">
                          <span className={styles.recordRef}>
                            <span className={styles.recordRefDot} aria-hidden="true" />
                            {purchase.purchaseNumber}
                          </span>
                        </TableCell>
                        <TableCell label="Date">
                          {purchase.createdAt ? purchase.createdAt.slice(0, 10) : '-'}
                        </TableCell>
                        <TableCell label="Service">
                          {purchase.lines
                            .map((l) => `${l.quantity} x ${formatMoneyOrDash(l.unitAmount)}`)
                            .join(', ') || '-'}
                        </TableCell>
                        <TableCell label="Customer">{purchase.customerName ?? '-'}</TableCell>
                        <TableCell label="GSD">{purchase.createdByName ?? '-'}</TableCell>
                        <TableCell label="Tier">
                          <TierBadge tier={purchase.tierSnapshot} />
                        </TableCell>
                        <TableCell label="Gross" align="right" className={styles.numeric}>
                          {formatMoneyOrDash(purchase.grossAmount)}
                        </TableCell>
                        <TableCell label="Tier discount" align="right" className={styles.numeric}>
                          {purchase.tierDiscountAmount !== '0.00'
                            ? `- ${formatMoneyOrDash(purchase.tierDiscountAmount)}`
                            : '-'}
                        </TableCell>
                        <TableCell label="Net due" align="right" className={styles.numeric}>
                          {formatMoneyOrDash(purchase.netAmount)}
                        </TableCell>
                        <TableCell label="Verified" align="right" className={styles.numeric}>
                          {formatMoneyOrDash(purchase.verifiedTotal)}
                        </TableCell>
                        <TableCell label="Status">
                          <StatusChip
                            tone={PURCHASE_STATUS_TONE[purchase.status] ?? 'neutral'}
                            label={humanizeCode(purchase.status)}
                          />
                        </TableCell>
                        <TableCell label="Claim">
                          {purchase.claimStatus ? humanizeCode(purchase.claimStatus) : 'Not issued'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {rows
                .filter((purchase) => purchase.status === 'draft')
                .map((purchase) => (
                  <PointRefundReview key={purchase.id} purchase={purchase} />
                ))}
              {rows.map((purchase) => (
                <ServiceRefundPanel key={purchase.id} purchase={purchase} />
              ))}
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
      )}
    </section>
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
    queryKey: earningKeys.purchaseSummary(purchaseId),
    queryFn: () => getPurchaseSummary(purchaseId),
    placeholderData: keepPreviousData,
  });
  const receipts = useQuery({
    queryKey: earningKeys.purchaseReceipts(purchaseId),
    queryFn: () => listReceipts(purchaseId),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: earningKeys.purchase(purchaseId) });
    void client.invalidateQueries({ queryKey: earningKeys.purchasesScope });
    void client.invalidateQueries({ queryKey: earningKeys.financePurchases });
    void client.invalidateQueries({ queryKey: earningKeys.settlementScope });
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
    queryKey: earningKeys.settlement(purchaseId),
    queryFn: () => getSettlement(purchaseId),
    placeholderData: keepPreviousData,
  });

  return (
    <section aria-label={`Receipts for ${purchaseNumber}`} className={styles.panel}>
      <h2 className={styles.panelTitle}>{purchaseNumber}</h2>
      <p className={styles.hint}>Amount due {formatMoneyOrDash(netAmount)}</p>

      {/* The single settlement answer, so Finance and the seller are never
          looking at different versions of the truth. */}
      {settlement.data && (
        <div aria-live="polite" className={styles.settlement}>
          <p className={styles.settlementLine}>
            <StatusChip
              tone={settlement.data.status === 'completed' ? 'success' : 'warning'}
              label={settlement.data.status === 'completed' ? 'Settled' : 'Outstanding'}
            />{' '}
            Outstanding {formatMoneyOrDash(settlement.data.remainingAmount)}
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
            . Verified receipts {formatMoneyOrDash(settlement.data.verifiedTotal)} of{' '}
            {formatMoneyOrDash(settlement.data.netAmount)} due.
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

      {summary.isPending ? (
        <div role="status" aria-label="Loading the financial summary" aria-busy="true">
          <Skeleton />
        </div>
      ) : summary.isError ? (
        <ErrorState
          title="Summary unavailable"
          message="The figures for this purchase could not be loaded."
          onRetry={summary.refetch}
        />
      ) : summary.data ? (
        <table className={styles.factsTable}>
          <tbody>
            {/* Gross, each discount, then the net. Shown separately and in that
                order so the arithmetic is legible: a reviewer must be able to
                see WHY the amount due is less than the gross, and must be able
                to tell a VIP tier discount (a rate) from a points discount (a
                conversion). Neither is a receipt, and collapsing them into one
                figure is how a discount gets mistaken for cash. */}
            <tr>
              <th scope="row">Gross service value</th>
              <td>{formatMoneyOrDash(summary.data.grossAmount)}</td>
            </tr>
            <tr>
              <th scope="row">VIP tier discount</th>
              <td>
                {summary.data.tierDiscountAmount && summary.data.tierDiscountAmount !== '0.00'
                  ? `- ${formatMoneyOrDash(summary.data.tierDiscountAmount)}`
                  : 'None'}
              </td>
            </tr>
            <tr>
              <th scope="row">Points discount</th>
              <td>
                {summary.data.pointsDiscountAmount !== '0.00'
                  ? `- ${formatMoneyOrDash(summary.data.pointsDiscountAmount)}`
                  : 'None'}
              </td>
            </tr>
            <tr>
              <th scope="row">Amount due</th>
              <td>{formatMoneyOrDash(summary.data.netAmount)}</td>
            </tr>
            <tr>
              <th scope="row">Verified received</th>
              <td>{formatMoneyOrDash(summary.data.verifiedTotal)}</td>
            </tr>
            <tr>
              <th scope="row">Still due</th>
              <td>
                {formatMoneyOrDash(summary.data.remainingBalance)}{' '}
                <StatusChip
                  tone={summary.data.fullyPaid ? 'success' : 'warning'}
                  label={summary.data.fullyPaid ? 'Settled' : 'Outstanding'}
                />
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {receipts.isPending ? (
        <div role="status" aria-label="Loading receipts" aria-busy="true">
          <Skeleton />
          <Skeleton />
        </div>
      ) : receipts.isError ? (
        <ErrorState
          title="Receipts unavailable"
          message="The receipts for this purchase could not be loaded."
          onRetry={receipts.refetch}
        />
      ) : receipts.data?.length === 0 ? (
        <p className={styles.hint}>No payment recorded yet.</p>
      ) : receipts.data && receipts.data.length > 0 ? (
        <div
          role="region"
          aria-label="Scrollable receipts"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <Table className={styles.queueTable}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Payment</TableHeaderCell>
                <TableHeaderCell align="right">Amount</TableHeaderCell>
                <TableHeaderCell>Method</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Recorded by</TableHeaderCell>
                <TableHeaderCell>Verified by</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {receipts.data.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell label="Payment">{receipt.paymentNumber}</TableCell>
                  <TableCell label="Amount" align="right" className={styles.numeric}>
                    {formatMoneyOrDash(receipt.amount)}
                  </TableCell>
                  <TableCell label="Method">{receipt.method}</TableCell>
                  <TableCell label="Status">
                    <StatusChip
                      tone={STATUS_TONE[receipt.status] ?? 'neutral'}
                      label={receipt.status}
                    />
                    {receipt.rejectionReason && (
                      <span className={styles.hint}> {receipt.rejectionReason}</span>
                    )}
                  </TableCell>
                  {/* Two DIFFERENT attributed acts. Recording and verifying are never
                    collapsed into one column, because "who took the money" and
                    "who confirmed it" are separate questions. */}
                  <TableCell label="Recorded by">{receipt.recordedBy ?? '—'}</TableCell>
                  <TableCell label="Verified by">{receipt.verifiedBy ?? '—'}</TableCell>
                  <TableCell label="Actions">
                    {receipt.status === 'recorded' && mayVerify && (
                      <VerifyActions paymentId={receipt.id} onDone={refresh} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <div>
        <Button variant="secondary" disabled={!mayRecord} onClick={() => setRecording(true)}>
          Record a payment
        </Button>
      </div>

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

  const decide = useBusinessMutation({
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
            ? `${formatMoneyOrDash(result.verifiedTotal)} is now verified against this purchase.`
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
        <TextField
          id={`reason-${paymentId}`}
          name="rejectReason"
          label="Reason for rejecting"
          optional
          value={reason}
          onChange={setReason}
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

  const save = useBusinessMutation({
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
      <div aria-busy={save.isPending} className={styles.formGrid}>
        <TextField
          id={`amount-${purchaseId}`}
          name="amount"
          label="Amount"
          optional
          inputMode="decimal"
          value={amount}
          onChange={setAmount}
          disabled={save.isPending}
        />

        <label className={styles.field} htmlFor={`method-${purchaseId}`}>
          Method
          <Select
            id={`method-${purchaseId}`}
            aria-label="Method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            disabled={save.isPending}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'bank_transfer', label: 'Bank transfer' },
              { value: 'card', label: 'Card' },
              { value: 'cheque', label: 'Cheque' },
            ]}
          />
        </label>

        <TextField
          id={`reference-${purchaseId}`}
          name="reference"
          label="Reference"
          optional
          value={reference}
          onChange={setReference}
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
