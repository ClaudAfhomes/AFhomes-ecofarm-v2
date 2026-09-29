import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import type { PaymentType } from '@jad/contracts';

import { formatDateTime } from '../../lib/format';
import {
  SPOT_CASH_LABEL,
  SPOT_CASH_TONE,
  formatMoney,
} from './format';
import { getFinanceQueue, getSalePayments, recordPayment, verifyPayment } from './services';

/**
 * Finance payment queue.
 *
 * Finance records a payment and then verifies or rejects it. Only VERIFIED
 * money counts toward the price, and every total on this screen comes from
 * `sale_financial_summary`, so nobody can type a paid total or a balance.
 */
export function BusinessFinanceQueuePage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['business', 'queue', 'finance'], queryFn: getFinanceQueue });
  const [paying, setPaying] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'queue'] });
  };

  return (
    <section>
      <PageHeader
        title="Finance Queue"
        description="Sales awaiting payment handling. Balances are computed from payment records, never entered by hand."
      />

      {query.isPending ? (
        <p role="status">Loading queue…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState title="Nothing to handle" description="No sale is awaiting payment." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Card</th>
                <th>Total</th>
                <th>Verified</th>
                <th>Balance</th>
                <th>Min. down met</th>
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
                  <td>{formatMoney(item.cashPrice)}</td>
                  <td>{formatMoney(item.verifiedTotal)}</td>
                  <td>{formatMoney(item.remainingBalance)}</td>
                  <td>{item.downPaymentSatisfied ? 'Yes' : 'No'}</td>
                  <td>{item.firstVerifiedPayment ? formatDateTime(item.firstVerifiedPayment) : '—'}</td>
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

      {paying ? <RecordPaymentDialog saleId={paying} onDone={refresh} onClose={() => setPaying(null)} /> : null}
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
          The payment is saved as <strong>recorded</strong> and does not count toward the price until it
          is verified. The resulting balance is recalculated on the server.
        </p>
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
    mutationFn: (input: { paymentId: string; decision: 'verified' | 'rejected'; reason?: string }) =>
      verifyPayment(input.paymentId, {
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog open onClose={onClose} title="Verify a payment" footer={<Button onClick={onClose}>Done</Button>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {pending.length === 0 ? (
          <p>No payment is awaiting verification.</p>
        ) : (
          pending.map((payment) => (
            <div key={payment.id} style={{ borderTop: '1px solid var(--color-border, #ddd)', paddingTop: 8 }}>
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
