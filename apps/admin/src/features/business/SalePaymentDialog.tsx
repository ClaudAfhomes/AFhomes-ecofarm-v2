import type { Payment } from '@afhomes/contracts';
import { StatusChip } from '@afhomes/ui';

import { formatDateTime } from '../../lib/format';
import { formatMoney, formatPaymentMethod, formatPaymentType } from './format';

/**
 * Read-only payment history for one sale, shared by the payment dialog and
 * the customer detail sale cards. Pure presentation: fetching, record and
 * verify actions live with the callers.
 */
export function SalePaymentList({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return <p>No payments recorded.</p>;
  return (
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
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>{formatMoney(payment.amount)}</td>
              <td>{formatPaymentType(payment.paymentType)}</td>
              <td>{formatPaymentMethod(payment.method)}</td>
              <td
                title={
                  payment.reference && payment.reference !== payment.paymentNumber
                    ? payment.reference
                    : undefined
                }
              >
                {payment.paymentNumber ?? payment.reference ?? '—'}
              </td>
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
              <td>{payment.recordedByName ?? '—'}</td>
              <td>{payment.verifiedByName ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
