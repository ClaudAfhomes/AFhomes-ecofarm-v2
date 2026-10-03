import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentSchemeLabel } from '@jad/contracts';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchField,
  StatusChip,
} from '@jad/ui';
import type { PaymentType } from '@jad/contracts';

import { formatDateTime } from '../../lib/format';
import { SPOT_CASH_LABEL, SPOT_CASH_TONE, formatMoney } from './format';
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
  const [paying, setPaying] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

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
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Card</th>
                <th>Scheme</th>
                <th>Total</th>
                <th>Verified</th>
                <th>Balance</th>
                <th>Reservation</th>
                <th>Required initial</th>
                <th>Monthly target</th>
                <th>Required initial met</th>
                <th>First verified</th>
                <th>Spot cash</th>
                <th>Deadline</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((item) => (
                <tr key={item.saleId}>
                  <td>{item.saleNumber}</td>
                  <td>{item.customerName}</td>
                  <td>{item.productName}</td>
                  <td>{paymentSchemeLabel(item.paymentScheme)}</td>
                  <td>{formatMoney(item.cashPrice)}</td>
                  <td>{formatMoney(item.verifiedTotal)}</td>
                  <td>{formatMoney(item.remainingBalance)}</td>
                  <td>{formatMoney(item.reservationFee)}</td>
                  <td>{formatMoney(item.requiredInitial)}</td>
                  <td>
                    {item.installmentMonths && item.monthlyAmount
                      ? `${formatMoney(item.monthlyAmount)} × ${item.installmentMonths}`
                      : '—'}
                  </td>
                  <td>{item.downPaymentSatisfied ? 'Yes' : 'No'}</td>
                  <td>
                    {item.firstVerifiedPayment ? formatDateTime(item.firstVerifiedPayment) : '—'}
                  </td>
                  <td>
                    <StatusChip
                      label={SPOT_CASH_LABEL[item.spotCashState] ?? item.spotCashState}
                      tone={SPOT_CASH_TONE[item.spotCashState] ?? 'neutral'}
                    />
                  </td>
                  <td>{item.spotCashDeadline ? formatDateTime(item.spotCashDeadline) : '—'}</td>
                  <td>
                    <Button variant="secondary" onClick={() => setPaying(item.saleId)}>
                      Record payment
                    </Button>{' '}
                    <Button variant="secondary" onClick={() => setReviewing(item.saleId)}>
                      Verify
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
  const [type, setType] = useState<PaymentType>('installment');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');

  const summary = useQuery({
    queryKey: ['business', 'sale-summary', saleId],
    queryFn: () => getSaleSummary(saleId),
  });

  const save = useMutation({
    mutationFn: () =>
      recordPayment(saleId, {
        amount,
        paymentType: type,
        method,
        ...(reference ? { reference } : {}),
      }),
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
          <Button disabled={!amount || save.isPending} onClick={() => save.mutate()}>
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
        <label>
          Amount
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
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
                  variant="secondary"
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
