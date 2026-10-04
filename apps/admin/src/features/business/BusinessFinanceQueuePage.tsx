import styles from './WorkflowCards.module.css';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useState } from 'react';
import { useSession } from '../../lib/session';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentSchemeLabel, recordPaymentSchema } from '@jad/contracts';
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
} from '@jad/ui';
import type { FinanceQueueItem, PaymentType } from '@jad/contracts';

import { formatDateTime } from '../../lib/format';
import { SPOT_CASH_LABEL, formatMoney } from './format';
import {
  getFinanceQueue,
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
  const [detail, setDetail] = useState<FinanceQueueItem | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const currentDetail = detail
    ? (query.data?.find((item) => item.saleId === detail.saleId) ?? detail)
    : null;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'queue'] });
    // Payment reports (verified/pending/rejected totals) stay fresh too.
    await client.invalidateQueries({ queryKey: ['reports'] });
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
                <TableRow key={item.saleId}>
                  <TableCell label="Sale">{item.saleNumber}</TableCell>
                  <TableCell label="Customer">{item.customerName}</TableCell>
                  <TableCell label="VIP">{item.productName}</TableCell>
                  <TableCell label="Scheme">{paymentSchemeLabel(item.paymentScheme)}</TableCell>
                  <TableCell label="Total">{formatMoney(item.cashPrice)}</TableCell>
                  <TableCell label="Verified">{formatMoney(item.verifiedTotal)}</TableCell>
                  <TableCell label="Balance">{formatMoney(item.remainingBalance)}</TableCell>
                  <TableCell label="Status">
                    <StatusChip label={item.status} />
                  </TableCell>
                  <TableCell label="Next Action">
                    {item.activatable
                      ? 'Activate membership'
                      : item.fullyPaid
                        ? 'Review activation'
                        : 'Handle payment'}
                  </TableCell>
                  <TableCell label="Actions">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(item)}>
                      View details
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canHandlePayments}
                      onClick={() => setPaying(item.saleId)}
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {currentDetail ? (
        <PaymentDetails
          canHandlePayments={canHandlePayments}
          item={currentDetail}
          onClose={() => setDetail(null)}
          onRecord={() => {
            setPaying(currentDetail.saleId);
            setDetail(null);
          }}
          onVerify={() => {
            setReviewing(currentDetail.saleId);
            setDetail(null);
          }}
        />
      ) : null}
      {paying ? (
        <RecordPaymentDialog saleId={paying} onDone={refresh} onClose={() => setPaying(null)} />
      ) : null}
      {reviewing ? (
        <VerifyDialog saleId={reviewing} onDone={refresh} onClose={() => setReviewing(null)} />
      ) : null}
    </section>
  );
}

function RecordPaymentDialog({
  saleId,
  onDone,
  onClose,
}: {
  saleId: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [amountDirty, setAmountDirty] = useState(false);
  const [type, setType] = useState<PaymentType>('installment');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const paymentInput = { amount, paymentType: type, method, ...(reference ? { reference } : {}) };
  const amountValid = recordPaymentSchema.shape.amount.safeParse(amount).success;
  const paymentValid = recordPaymentSchema.safeParse(paymentInput).success;

  const summary = useQuery({
    queryKey: ['business', 'sale-summary', saleId],
    queryFn: () => getSaleSummary(saleId),
  });

  const save = useMutation({
    mutationFn: () => recordPayment(saleId, recordPaymentSchema.parse(paymentInput)),
    onSuccess: onDone,
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
          <Button disabled={!paymentValid || save.isPending} onClick={() => save.mutate()}>
            Record
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
              <dt>Verified so far</dt>
              <dd>{formatMoney(summary.data.verifiedTotal)}</dd>
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
          Reference (must be unique for this sale)
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        {save.error ? <p role="alert">{save.error.message}</p> : null}
      </div>
    </Dialog>
  );
}

function VerifyDialog({
  saleId,
  onDone,
  onClose,
}: {
  saleId: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', saleId],
    queryFn: () => getSalePayments(saleId),
  });
  const pending = payments.data?.filter((p) => p.status === 'recorded') ?? [];

  const decide = useMutation({
    mutationFn: (input: {
      paymentId: string;
      decision: 'verified' | 'rejected';
      reason?: string;
    }) =>
      verifyPayment(input.paymentId, {
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Verify a payment"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
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
                  disabled={decide.isPending}
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
  onRecord: () => void;
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
        <Button disabled={!canHandlePayments} onClick={onRecord}>
          Record payment
        </Button>
        <Button disabled={!canHandlePayments} variant="secondary" onClick={onVerify}>
          Verify payment
        </Button>
      </div>
    </Dialog>
  );
}
