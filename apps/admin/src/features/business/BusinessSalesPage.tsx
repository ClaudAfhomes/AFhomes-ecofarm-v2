import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import {
  SALE_STATUS_LABEL,
  SALE_STATUS_TONE,
  formatMoney,
  formatPoints,
  formatRate,
} from './format';
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

      <label style={{ display: 'block', marginBottom: 16, maxWidth: 260 }}>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value ? SALE_STATUS_LABEL[value] : 'All statuses'}
            </option>
          ))}
        </select>
      </label>

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
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Card</th>
                <th>Seller</th>
                <th>Status</th>
                <th>Total</th>
                <th>Min. down</th>
                <th>Points</th>
                <th>Commission</th>
                <th>Spot-cash deadline</th>
                <th>Activated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.saleNumber}</td>
                  <td>{sale.customerName}</td>
                  <td>{sale.productName}</td>
                  <td>{sale.sellerName ?? '—'}</td>
                  <td>
                    <StatusChip
                      label={SALE_STATUS_LABEL[sale.status] ?? sale.status}
                      tone={SALE_STATUS_TONE[sale.status] ?? 'neutral'}
                    />
                  </td>
                  <td>{formatMoney(sale.cashPrice)}</td>
                  <td>{formatMoney(sale.minimumDownPayment)}</td>
                  <td>{formatPoints(sale.yearlyPoints)}</td>
                  <td>
                    {formatMoney(sale.expectedCommission)}{' '}
                    <span style={{ opacity: 0.7 }}>({formatRate(sale.commissionRate)})</span>
                  </td>
                  <td>{sale.spotCashDeadline ? formatDateTime(sale.spotCashDeadline) : '—'}</td>
                  <td>{sale.activatedAt ? formatDateTime(sale.activatedAt) : '—'}</td>
                  <td>
                    <Button variant="secondary" onClick={() => setOpenId(sale.id)}>
                      Payments
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId ? <SaleDetail saleId={openId} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}

function SaleDetail({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const summary = useQuery({
    queryKey: ['business', 'sale-summary', saleId],
    queryFn: () => getSaleSummary(saleId),
  });
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', saleId],
    queryFn: () => getSalePayments(saleId),
  });

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Payment history</h2>
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : summary.data ? (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <dt>Cash price</dt>
            <dd>{formatMoney(summary.data.cashPrice)}</dd>
          </div>
          <div>
            <dt>Recorded (awaiting verification)</dt>
            <dd>{formatMoney(summary.data.recordedTotal)}</dd>
          </div>
          <div>
            <dt>Verified</dt>
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
            <dt>Minimum down payment met</dt>
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
        <div className="table-scroll" style={{ marginTop: 16 }}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Button variant="secondary" onClick={onClose} style={{ marginTop: 16 }}>
        Close
      </Button>
    </div>
  );
}
