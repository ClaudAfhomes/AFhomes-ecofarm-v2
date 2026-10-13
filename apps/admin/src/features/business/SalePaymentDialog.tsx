import type { Payment } from '@afhomes/contracts';
import { EmptyState, StatusChip } from '@afhomes/ui';

import { formatDateTime } from '../../lib/format';
import { formatPaymentMethod, formatPaymentType } from './format';
import { formatMoneyOrDash } from '@afhomes/shared';

/**
 * Read-only payment history for one sale, shared by the payment dialog and
 * the customer detail sale cards. Pure presentation: fetching, record and
 * verify actions live with the callers.
 */
export function SalePaymentList({ payments }: { payments: Payment[] }) {
  if (payments.length === 0)
    return (
      <EmptyState
        title="No payments recorded."
        description="Record the first payment to start the ledger."
      />
    );
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
              <td data-label="Amount">{formatMoneyOrDash(payment.amount)}</td>
              <td data-label="Type">{formatPaymentType(payment.paymentType)}</td>
              <td data-label="Method">{formatPaymentMethod(payment.method)}</td>
              <td
                data-label="Reference"
                title={
                  payment.reference && payment.reference !== payment.paymentNumber
                    ? payment.reference
                    : undefined
                }
              >
                {payment.paymentNumber ?? payment.reference ?? '—'}
              </td>
              <td data-label="Status">
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
              <td data-label="Recorded">{formatDateTime(payment.recordedAt)}</td>
              <td data-label="Verified">
                {payment.verifiedAt ? formatDateTime(payment.verifiedAt) : '—'}
              </td>
              <td data-label="Recorded by">{payment.recordedByName ?? '—'}</td>
              <td data-label="Verified by">{payment.verifiedByName ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
