import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Sale } from '@jad/contracts';
import { useSession } from '../../lib/session';
import { RecordPaymentDialog, VerifyDialog } from './BusinessFinanceQueuePage';
import { paymentSchemeLabel } from '@jad/contracts';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Select,
  StatusChip,
} from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { SALE_STATUS_LABEL, SALE_STATUS_TONE, formatMoney } from './format';
import { getSalePayments, getSaleSummary, getSales } from './services';

const STATUSES = ['', ...Object.keys(SALE_STATUS_LABEL)];

/**
 * Card sales with their server-computed money state.
 *
 * "Paid", "balance" and the spot-cash window are read from
 * `GET /sales/:id/summary`, which totals the payment rows on the server. The
 * browser never adds anything up and never supplies a total.
 */
export function BusinessSalesPage() {
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['business', 'sales', status],
    queryFn: () => getSales(status ? { status } : {}),
  });

  return (
    <section>
      <PageHeader
        title="Card Sales"
        description="Applications and their financial state. Every amount below is calculated server-side from the payment records."
      />

      <FilterBar
        filters={
          <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 600 }}>
            Status
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={STATUSES.map((value) => ({
                value,
                label: value ? (SALE_STATUS_LABEL[value] ?? value) : 'All statuses',
              }))}
            />
          </label>
        }
      />

      {query.isPending ? (
        <p role="status">Loading sales…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState
          title="No card sales"
          description="Open an application from the Customers screen."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Card</th>
                <th>Scheme</th>
                <th>Seller</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Payment status</th>
                <th>Activation status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.saleNumber}</td>
                  <td>{sale.customerName}</td>
                  <td>{sale.productName}</td>
                  <td>{paymentSchemeLabel(sale.paymentScheme)}</td>
                  <td>{sale.sellerName ?? '—'}</td>
                  <td>{formatMoney(sale.cashPrice)}</td>
                  <td>{formatMoney(sale.paidAmount)}</td>
                  <td>{formatMoney(sale.balance)}</td>
                  <td>
                    <StatusChip
                      label={SALE_STATUS_LABEL[sale.status] ?? sale.status}
                      tone={SALE_STATUS_TONE[sale.status] ?? 'neutral'}
                    />
                  </td>
                  <td>{sale.activatedAt ? 'Active' : 'Not activated'}</td>
                  <td>{formatDateTime(sale.createdAt)}</td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(sale.id)}>
                      Payments
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId ? (
        <SaleDetail
          saleId={openId}
          sale={query.data?.find((sale) => sale.id === openId)}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </section>
  );
}

function SaleDetail({
  saleId,
  sale,
  onClose,
}: {
  saleId: string;
  sale?: Sale;
  onClose: () => void;
}) {
  const { user } = useSession();
  const client = useQueryClient();
  const [action, setAction] = useState<'record' | 'verify' | null>(null);
  const canHandle = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
  );
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['business'] }),
      client.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  };
  const summary = useQuery({
    queryKey: ['business', 'sale-summary', saleId],
    queryFn: () => getSaleSummary(saleId),
  });
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', saleId],
    queryFn: () => getSalePayments(saleId),
  });

  if (action === 'record')
    return <RecordPaymentDialog saleId={saleId} onDone={refresh} onClose={() => setAction(null)} />;
  if (action === 'verify')
    return <VerifyDialog saleId={saleId} onDone={refresh} onClose={() => setAction(null)} />;
  return (
    <Dialog open placement="right" onClose={onClose} title="Payment history">
      <p>
        {sale?.saleNumber} · {sale?.customerName} · {sale?.productName}
      </p>
      {canHandle ? (
        <p>
          <Button onClick={() => setAction('record')}>Record payment</Button>{' '}
          <Button onClick={() => setAction('verify')}>Verify payment</Button>
        </p>
      ) : null}
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : summary.data ? (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <div>
            <dt>Payment scheme</dt>
            <dd>{paymentSchemeLabel(summary.data.paymentScheme)}</dd>
          </div>
          <div>
            <dt>Frozen total</dt>
            <dd>{formatMoney(summary.data.cashPrice)}</dd>
          </div>
          <div>
            <dt>Reservation fee</dt>
            <dd>{formatMoney(summary.data.reservationFee)}</dd>
          </div>
          <div>
            <dt>Required initial</dt>
            <dd>{formatMoney(summary.data.requiredInitial)}</dd>
          </div>
          <div>
            <dt>Installments</dt>
            <dd>
              {summary.data.installmentMonths && summary.data.monthlyAmount
                ? `${formatMoney(summary.data.monthlyAmount)} × ${summary.data.installmentMonths}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Recorded (awaiting verification)</dt>
            <dd>{formatMoney(summary.data.recordedTotal)}</dd>
          </div>
          <div>
            <dt>Verified paid</dt>
            <dd>{formatMoney(summary.data.verifiedTotal)}</dd>
          </div>
          <div>
            <dt>Rejected</dt>
            <dd>{formatMoney(summary.data.rejectedTotal)}</dd>
          </div>
          <div>
            <dt>Remaining balance</dt>
            <dd>{formatMoney(summary.data.remainingBalance)}</dd>
          </div>
          <div>
            <dt>Overpaid</dt>
            <dd>{formatMoney(summary.data.overpaidAmount)}</dd>
          </div>
          <div>
            <dt>Required initial met</dt>
            <dd>{summary.data.downPaymentSatisfied ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Fully paid</dt>
            <dd>{summary.data.fullyPaid ? 'Yes' : 'No'}</dd>
          </div>
        </dl>
      ) : (
        <p role="status">Loading summary…</p>
      )}

      {payments.data && payments.data.length > 0 ? (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className="table-scroll"
          style={{ marginTop: 16 }}
        >
          <table>
            <thead>
              <tr>
                <th>Amount</th>
                <th>Type</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Recorded</th>
                <th>Verified</th>
                <th>Recorded by</th>
                <th>Verified by</th>
              </tr>
            </thead>
            <tbody>
              {payments.data.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatMoney(payment.amount)}</td>
                  <td>{payment.paymentType.replace(/_/g, ' ')}</td>
                  <td>{payment.method}</td>
                  <td>{payment.reference ?? '—'}</td>
                  <td>
                    <StatusChip
                      label={payment.status}
                      tone={
                        payment.status === 'verified'
                          ? 'success'
                          : payment.status === 'rejected'
                            ? 'danger'
                            : 'neutral'
                      }
                    />
                    {payment.rejectionReason ? (
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{payment.rejectionReason}</div>
                    ) : null}
                  </td>
                  <td>{formatDateTime(payment.recordedAt)}</td>
                  <td>{payment.verifiedAt ? formatDateTime(payment.verifiedAt) : '—'}</td>
                  <td>{payment.recordedBy}</td>
                  <td>{payment.verifiedBy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Button variant="secondary" onClick={onClose} style={{ marginTop: 16 }}>
        Close
      </Button>
    </Dialog>
  );
}
