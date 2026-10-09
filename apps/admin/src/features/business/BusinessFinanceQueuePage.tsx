import styles from './WorkflowCards.module.css';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useState } from 'react';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { useSession } from '../../lib/session';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentSchemeLabel, recordPaymentSchema } from '@afhomes/contracts';
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchField,
  StatusChip,
  TextField,
  notifyConfirm,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import type {
  FinanceCollectionQueueItem,
  FinanceQueueItem,
  PaymentType,
  PurchaseDocumentKind,
  ReservationFinanceSummary,
} from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { downloadFile } from '../../lib/download';
import { SPOT_CASH_LABEL, formatMoney } from './format';
import {
  exportPurchaseDocument,
  finalizeReservationPurchase,
  getFinanceQueue,
  getReservationPayments,
  getReservationFinance,
  recordReservationPayment,
  verifyReservationPayment,
  getSalePayments,
  getSaleSummary,
  recordPayment,
  verifyPayment,
} from './services';

/**
 * Finance payment queue.
 *
 * Finance records a payment and then verifies or rejects it. Only VERIFIED
 * money counts toward the price, and every total on this screen comes from
 * `sale_financial_summary`, so nobody can type a paid total or a balance.
 */
/**
 * Actions for an EXECUTED application-origin reservation.
 *
 * Four actions, and one rule: eligibility is whatever the SERVER last said.
 * The button is enabled from the queue's own figures and the call is still
 * refused server-side if the money changed in between — a stale "fully paid" in
 * a browser must never produce a sale.
 */
function ReservationActions({
  item,
  canHandlePayments,
  onDone,
}: {
  item: Extract<FinanceCollectionQueueItem, { origin: 'reservation' }>;
  canHandlePayments: boolean;
  onDone: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<'record' | 'verify' | null>(null);
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: ['business', 'reservation-payments', item.reservationId],
    });
    await onDone();
  };
  const payments = useQuery({
    queryKey: ['business', 'reservation-payments', item.reservationId],
    queryFn: () => getReservationPayments(item.reservationId),
  });
  const print = async (kind: PurchaseDocumentKind) => {
    setBusy(true);
    setError(null);
    try {
      const file = await exportPurchaseDocument(item.reservationId, kind);
      downloadFile(file);
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Print failed');
    } finally {
      setBusy(false);
    }
  };
  const finalize = async () => {
    setBusy(true);
    setError(null);
    try {
      await finalizeReservationPurchase(item.reservationId, crypto.randomUUID());
      await client.invalidateQueries({ queryKey: ['business'] });
      await client.invalidateQueries({ queryKey: ['reports'] });
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Finalization failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span>
        {formatMoney(item.verifiedTotal)} verified of {formatMoney(item.totalPrice)} ·{' '}
        {(payments.data ?? []).length} payment(s)
      </span>{' '}
      <Button
        size="sm"
        variant="secondary"
        disabled={!canHandlePayments || busy}
        onClick={() => print('reservation')}
      >
        Print reservation
      </Button>{' '}
      <Button
        size="sm"
        disabled={!canHandlePayments || busy}
        onClick={() => setPaymentDialog('record')}
      >
        Record payment
      </Button>{' '}
      <Button
        size="sm"
        disabled={!canHandlePayments || busy}
        onClick={() => setPaymentDialog('verify')}
      >
        Verify
      </Button>{' '}
      {paymentDialog === 'record' ? (
        <RecordPaymentDialog
          saleId={item.reservationId}
          origin="reservation"
          customerName={item.customerName}
          recordLabel={item.reservationNumber}
          onDone={refresh}
          onClose={() => setPaymentDialog(null)}
        />
      ) : null}
      {paymentDialog === 'verify' ? (
        <VerifyDialog
          saleId={item.reservationId}
          origin="reservation"
          onDone={refresh}
          onClose={() => setPaymentDialog(null)}
        />
      ) : null}
      {item.fullyPaid ? (
        <Button
          size="sm"
          variant="primary"
          disabled={!canHandlePayments || busy}
          onClick={finalize}
        >
          Finalize purchase
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

export function BusinessFinanceQueuePage() {
  const { user } = useSession();
  const canHandlePayments =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
    ) ?? false;
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());
  const query = useQuery({
    queryKey: ['business', 'queue', 'finance', settled],
    queryFn: () => (settled ? getFinanceQueue(settled) : getFinanceQueue()),
    // Money moves from other sessions too: poll the queue (same-session
    // writes invalidate instantly).
    refetchInterval: 15_000,
  });
  const [detail, setDetail] = useState<Extract<
    FinanceCollectionQueueItem,
    { origin: 'sale' }
  > | null>(null);
  const [paying, setPaying] = useState<FinanceQueueItem | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const currentDetail = detail
    ? (query.data?.find((item) => item.origin === 'sale' && item.saleId === detail.saleId) ??
      detail)
    : null;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'queue'] });
    // Payment reports (verified/pending/rejected totals) stay fresh too.
    await client.invalidateQueries({ queryKey: ['reports'] });
    await client.invalidateQueries({ queryKey: ['business', 'sale-summary'] });
    await client.invalidateQueries({ queryKey: ['business', 'sale-payments'] });
    await client.invalidateQueries({ queryKey: ['business', 'sales'] });
  };

  return (
    <section>
      <PageHeader
        title="Finance Queue"
        description="Sales awaiting payment handling. Balances are computed from payment records, never entered by hand."
      />

      <SearchField label="Search payments" value={search} onChange={setSearch} />
      {query.isPending ? (
        <p role="status">Loading queue…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState
          title={settled ? 'No matching records.' : 'Nothing to handle'}
          description="No sale is awaiting payment."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Sale</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Card</TableHeaderCell>
                <TableHeaderCell>Scheme</TableHeaderCell>
                <TableHeaderCell>Total</TableHeaderCell>
                <TableHeaderCell>Verified</TableHeaderCell>
                <TableHeaderCell>Balance</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Next Action</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data?.map((item) => (
                <TableRow key={item.origin === 'sale' ? item.saleId : item.reservationId}>
                  <TableCell label="Sale">
                    {item.origin === 'sale' ? item.saleNumber : item.reservationNumber}
                  </TableCell>
                  <TableCell label="Customer">{item.customerName}</TableCell>
                  <TableCell label="VIP">{item.productName}</TableCell>
                  <TableCell label="Scheme">{paymentSchemeLabel(item.paymentScheme)}</TableCell>
                  <TableCell label="Total">
                    {formatMoney(item.origin === 'sale' ? item.cashPrice : item.totalPrice)}
                  </TableCell>
                  <TableCell label="Verified">{formatMoney(item.verifiedTotal)}</TableCell>
                  <TableCell label="Balance">{formatMoney(item.remainingBalance)}</TableCell>
                  <TableCell label="Status">
                    <StatusChip label={item.status} />
                  </TableCell>
                  <TableCell label="Next Action">
                    {item.origin === 'reservation'
                      ? item.fullyPaid
                        ? 'Finalize purchase'
                        : 'Handle payment'
                      : item.activatable
                        ? 'Activate membership'
                        : item.fullyPaid
                          ? 'Review activation'
                          : 'Handle payment'}
                  </TableCell>
                  <TableCell label="Actions">
                    {item.origin === 'reservation' ? (
                      <ReservationActions
                        item={item}
                        canHandlePayments={canHandlePayments}
                        onDone={refresh}
                      />
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setDetail(item)}>
                          View details
                        </Button>{' '}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canHandlePayments}
                          onClick={() => setPaying(item)}
                        >
                          Record payment
                        </Button>{' '}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canHandlePayments}
                          onClick={() => setReviewing(item.saleId)}
                        >
                          Verify
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {currentDetail && currentDetail.origin === 'sale' ? (
        <PaymentDetails
          canHandlePayments={canHandlePayments}
          item={currentDetail}
          onClose={() => setDetail(null)}
          onRecord={(item) => {
            setPaying(item);
            setDetail(null);
          }}
          onVerify={() => {
            setReviewing(currentDetail.saleId);
            setDetail(null);
          }}
        />
      ) : null}
      {paying ? (
        <RecordPaymentDialog
          saleId={paying.saleId}
          customerName={paying.customerName}
          recordLabel={paying.saleNumber}
          onDone={refresh}
          onClose={() => setPaying(null)}
        />
      ) : null}
      {reviewing ? (
        <VerifyDialog saleId={reviewing} onDone={refresh} onClose={() => setReviewing(null)} />
      ) : null}
    </section>
  );
}

/**
 * The two record-payment endpoints answer with different shapes: the reservation
 * one returns the recomputed finance summary (which carries the payment rows),
 * the sale one returns only the new id. This guard tells them apart by shape, so
 * the success alert can read the SERVER's stored row in both cases.
 */
function isReservationFinanceSummary(
  value: ReservationFinanceSummary | { id: string },
): value is ReservationFinanceSummary {
  return 'payments' in value;
}

export function RecordPaymentDialog({
  saleId,
  origin = 'sale',
  customerName,
  recordLabel,
  onDone,
  onClose,
}: {
  saleId: string;
  origin?: 'sale' | 'reservation';
  /** Shown in the confirmation so staff confirm the right customer. */
  customerName?: string;
  /** The sale or reservation number this payment belongs to. */
  recordLabel?: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [amountDirty, setAmountDirty] = useState(false);
  const [type, setType] = useState<PaymentType>('installment');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [confirming, setConfirming] = useState(false);
  const runPayment = useSingleFlight<
    Awaited<ReturnType<typeof recordPayment>> | Awaited<ReturnType<typeof recordReservationPayment>>
  >();
  const paymentRequest = useMutationRequest();
  const paymentInput = { amount, paymentType: type, method, ...(reference ? { reference } : {}) };
  const amountValid = recordPaymentSchema.shape.amount.safeParse(amount).success;
  const paymentValid = recordPaymentSchema.safeParse(paymentInput).success;

  const summary = useQuery({
    queryKey: [
      'business',
      origin === 'reservation' ? 'reservation-finance' : 'sale-summary',
      saleId,
    ],
    queryFn: async () => {
      if (origin === 'sale') return getSaleSummary(saleId);
      const finance = await getReservationFinance(saleId);
      return { ...finance, cashPrice: finance.totalPrice };
    },
  });

  const save = useMutation({
    mutationFn: async (input: typeof paymentInput) => {
      const confirmed = await notifyConfirm({
        title: 'Record this payment?',
        message:
          'The payment is saved as recorded and does not count toward the price until it is verified.',
        detail: [
          customerName ? `Customer: ${customerName}` : null,
          recordLabel
            ? `${origin === 'reservation' ? 'Reservation' : 'Sale'}: ${recordLabel}`
            : null,
          `Amount: ₱${input.amount}`,
          `Type: ${input.paymentType.replace(/_/g, ' ')}`,
          `Method: ${input.method}`,
          `Reference: ${input.reference ?? '—'}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
        confirmButtonText: 'Record Payment',
      });
      if (!confirmed) return null;
      setConfirming(true);
      const result = await runPayment(() => {
        const parsed = recordPaymentSchema.parse(input);
        const body = {
          ...parsed,
          requestId: paymentRequest.forPayload({ origin, saleId, ...parsed }),
        };
        return origin === 'reservation'
          ? recordReservationPayment(saleId, body)
          : recordPayment(saleId, body);
      });
      return { input, result };
    },
    // The alert reports the SERVER's stored row, never the browser's optimism.
    // An HTTP 201 alone proves nothing: the sale endpoint returns only the new
    // id, and the reservation endpoint returns the recomputed summary.
    onSuccess: async (recorded) => {
      if (!recorded) return;
      setConfirming(false);
      await onDone();
      paymentRequest.complete();
      // Captured in a const so the narrowing survives into the filter callback.
      const outcome = recorded.result;
      // The re-read reports the SERVER's row. If it fails the payment is still
      // recorded, so the confirmation must never be swallowed by it: the alert
      // falls back to the submitted figures and says the status is unconfirmed.
      let stored:
        | {
            amount: string;
            reference: string | null;
            // `paymentNumber` is nullish on the payment contract.
            paymentNumber?: string | null;
            id: string;
            status: string;
          }
        | undefined;
      try {
        const rows = isReservationFinanceSummary(outcome)
          ? outcome.payments
          : (await getSalePayments(saleId)).filter((row) => row.id === outcome.id);
        stored = [...rows].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      } catch {
        // Left undefined on purpose: the payment IS recorded, so the alert falls
        // back to the submitted figures rather than being swallowed.
      }
      notifySuccess({
        title: 'Payment Recorded Successfully',
        message: 'The payment has been recorded and the payment queue has been updated.',
        detail: [
          `Amount: ₱${stored?.amount ?? recorded.input.amount}`,
          `Reference: ${stored?.reference ?? recorded.input.reference ?? '—'}`,
          `Payment ID: ${stored?.paymentNumber ?? stored?.id ?? '—'}`,
          customerName ? `Customer: ${customerName}` : null,
          recordLabel
            ? `${origin === 'reservation' ? 'Reservation' : 'Sale'}: ${recordLabel}`
            : null,
          `Current payment status: ${stored?.status ?? 'recorded (confirmation unavailable)'}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      });
    },
    onError: (error) => {
      setConfirming(false);
      // `message` is the server's own domain envelope, already free of SQL,
      // stack traces and RPC internals.
      notifyError({
        title: 'Unable to Record Payment',
        message: error instanceof Error ? error.message : 'The payment was not recorded.',
      });
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record a payment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!paymentValid || save.isSuccess || confirming}
            loading={save.isPending}
            loadingLabel="Recording…"
            onClick={() => save.mutate(paymentInput)}
          >
            {confirming ? 'Recording…' : 'Record'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          The payment is saved as <strong>recorded</strong> and does not count toward the price
          until it is verified. The resulting balance is recalculated on the server.
        </p>
        {summary.data ? (
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 8,
              margin: 0,
              padding: 12,
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 8,
            }}
          >
            <div>
              <dt>Scheme</dt>
              <dd>{paymentSchemeLabel(summary.data.paymentScheme)}</dd>
            </div>
            <div>
              <dt>Frozen total</dt>
              <dd>{formatMoney(summary.data.cashPrice)}</dd>
            </div>
            <div>
              <dt>Reservation</dt>
              <dd>{formatMoney(summary.data.reservationFee)}</dd>
            </div>
            <div>
              <dt>Required initial</dt>
              <dd>{formatMoney(summary.data.requiredInitial)}</dd>
            </div>
            <div>
              <dt>Monthly target</dt>
              <dd>
                {summary.data.installmentMonths && summary.data.monthlyAmount
                  ? `${formatMoney(summary.data.monthlyAmount)} × ${summary.data.installmentMonths}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Verified paid</dt>
              <dd>{formatMoney(summary.data.verifiedTotal)}</dd>
            </div>
            <div>
              <dt>Remaining balance</dt>
              <dd>{formatMoney(summary.data.remainingBalance)}</dd>
            </div>
          </dl>
        ) : null}
        <TextField
          id="record-payment-amount"
          name="amount"
          label="Amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setAmountDirty(true);
          }}
          error={
            amountDirty && !amountValid
              ? 'Enter a valid amount greater than zero without letters or scientific notation.'
              : undefined
          }
        />
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as PaymentType)}>
            <option value="down_payment">Down payment</option>
            <option value="installment">Installment</option>
            <option value="full">Full payment</option>
          </select>
        </label>
        <label>
          Method
          <input value={method} onChange={(e) => setMethod(e.target.value)} />
        </label>
        <label>
          Payment reference
          <input
            aria-describedby="payment-reference-help"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <p id="payment-reference-help">
          Enter the transaction/reference number from the payment receipt, bank transfer, GCash/Maya
          transaction, deposit slip, or official receipt.
        </p>
        {save.error ? <p role="alert">The payment was not recorded. {save.error.message}</p> : null}
      </div>
    </Dialog>
  );
}

export function VerifyDialog({
  saleId,
  origin = 'sale',
  onDone,
  onClose,
}: {
  saleId: string;
  origin?: 'sale' | 'reservation';
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const payments = useQuery({
    queryKey: [
      'business',
      origin === 'reservation' ? 'reservation-payments' : 'sale-payments',
      saleId,
    ],
    queryFn: async () =>
      origin === 'reservation'
        ? await getReservationPayments(saleId)
        : await getSalePayments(saleId),
  });
  const pending = payments.data?.filter((p) => p.status === 'recorded') ?? [];

  const verificationRequest = useMutationRequest();
  const decide = useMutation({
    mutationFn: async (input: {
      paymentId: string;
      decision: 'verified' | 'rejected';
      reason?: string;
    }) =>
      origin === 'reservation'
        ? await verifyReservationPayment(saleId, input.paymentId, {
            requestId: verificationRequest.forPayload(input),
            decision: input.decision,
            ...(input.reason ? { reason: input.reason } : {}),
          })
        : await verifyPayment(input.paymentId, {
            decision: input.decision,
            ...(input.reason ? { reason: input.reason } : {}),
          }),
    onSuccess: async () => {
      await onDone();
      verificationRequest.complete();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Verify a payment"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {decide.isSuccess ? <p role="status">Payment {decide.variables?.decision}.</p> : null}
        {pending.length === 0 ? (
          <p>No payment is awaiting verification.</p>
        ) : (
          pending.map((payment) => (
            <div
              key={payment.id}
              style={{ borderTop: '1px solid var(--color-border, #ddd)', paddingTop: 8 }}
            >
              <strong>{formatMoney(payment.amount)}</strong> — {payment.method}{' '}
              {payment.reference ? `(${payment.reference})` : ''}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button
                  onClick={() => decide.mutate({ paymentId: payment.id, decision: 'verified' })}
                  loading={decide.isPending}
                  loadingLabel="Verifying…"
                >
                  Verify
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    decide.mutate({
                      paymentId: payment.id,
                      decision: 'rejected',
                      reason: reason || 'Rejected by Finance',
                    })
                  }
                  disabled={decide.isPending}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))
        )}
        <label>
          Reason (required to reject)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {decide.error ? <p role="alert">{decide.error.message}</p> : null}
      </div>
    </Dialog>
  );
}

function PaymentDetails({
  canHandlePayments,
  item,
  onClose,
  onRecord,
  onVerify,
}: {
  canHandlePayments: boolean;
  item: FinanceQueueItem;
  onClose: () => void;
  onRecord: (item: FinanceQueueItem) => void;
  onVerify: () => void;
}) {
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', item.saleId],
    queryFn: () => getSalePayments(item.saleId),
    refetchInterval: 15_000,
  });
  return (
    <Dialog
      open
      title={item.saleNumber}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <section>
        <h2>Sale summary</h2>
        <p>
          {item.customerName} · {item.productName} · {paymentSchemeLabel(item.paymentScheme)}
        </p>
        <p>Total: {formatMoney(item.cashPrice)}</p>
      </section>
      <section>
        <h2>Payment progress</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Reservation</dt>
            <dd>{formatMoney(item.reservationFee)}</dd>
          </div>
          <div>
            <dt>Required initial</dt>
            <dd>{formatMoney(item.requiredInitial)}</dd>
          </div>
          <div>
            <dt>Verified paid</dt>
            <dd>{formatMoney(item.verifiedTotal)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatMoney(item.remainingBalance)}</dd>
          </div>
          <div>
            <dt>Monthly target</dt>
            <dd>
              {formatMoney(item.monthlyAmount)}{' '}
              {item.installmentMonths ? '× ' + item.installmentMonths : ''}
            </dd>
          </div>
          <div>
            <dt>First verified date</dt>
            <dd>{item.firstVerifiedPayment ? formatDateTime(item.firstVerifiedPayment) : '—'}</dd>
          </div>
          <div>
            <dt>Spot cash</dt>
            <dd>{SPOT_CASH_LABEL[item.spotCashState]}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{item.spotCashDeadline ? formatDateTime(item.spotCashDeadline) : '—'}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h2>Payment timeline</h2>
        {payments.isPending ? (
          <p role="status">Loading payments…</p>
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : payments.data.length ? (
          <ol>
            {payments.data.map((payment) => (
              <li key={payment.id}>
                {payment.paymentType.replaceAll('_', ' ')} · {formatMoney(payment.amount)} ·{' '}
                <StatusChip label={payment.status} /> · {payment.reference ?? 'No reference'}
              </li>
            ))}
          </ol>
        ) : (
          <p>No payments recorded.</p>
        )}
      </section>
      <section>
        <h2>Status</h2>
        <p>Initial requirement met: {item.downPaymentSatisfied ? 'Yes' : 'No'}</p>
        <p>Fully paid: {item.fullyPaid ? 'Yes' : 'No'}</p>
        <p>Activation eligible: {item.activatable ? 'Yes' : 'No'}</p>
      </section>
      <div className={styles.actions}>
        <Button disabled={!canHandlePayments} onClick={() => onRecord(item)}>
          Record payment
        </Button>
        <Button disabled={!canHandlePayments} variant="secondary" onClick={onVerify}>
          Verify payment
        </Button>
      </div>
    </Dialog>
  );
}
