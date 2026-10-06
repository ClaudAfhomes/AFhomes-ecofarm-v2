import { ErrorState } from '@afhomes/ui';

import { useCustomerPaymentsQuery } from './queries';
import { isForbidden } from './http';
import { Card, formatDate, styles } from './portal-ui';

/**
 * Read-only payment history: only this member's own card-sale payments, and
 * only the safe columns the server selects (amount, method, reference,
 * status, dates). Staff ids, receipt paths and finance notes never leave
 * the API, so there is nothing here to leak.
 */
export function CustomerPaymentsPage() {
  const payments = useCustomerPaymentsQuery();

  if (payments.isLoading) return <p role="status">Loading your payments…</p>;
  if (payments.isError) {
    return (
      <ErrorState
        title="Payments unavailable"
        message={
          isForbidden(payments.error)
            ? 'Your account is not active, so payments are not available. Contact AF Homes Ecofarm to restore access.'
            : 'We could not load your payments. Please try again in a moment.'
        }
      />
    );
  }

  const rows = payments.data ?? [];

  return (
    <Card title="Payment history">
      {rows.length === 0 ? (
        <p className={styles.notice}>No payments recorded yet.</p>
      ) : (
        <>
          <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Method</th>
                <th scope="col">Reference</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.numeric}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatDate(payment.recordedAt)}</td>
                  <td>{payment.paymentType ?? '—'}</td>
                  <td>{payment.method}</td>
                  <td className={styles.mono}>{payment.reference ?? '—'}</td>
                  <td>{payment.status}</td>
                  <td className={styles.numeric}>₱{payment.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className={styles.notice}>Showing the most recent {rows.length} payments.</p>
        </>
      )}
    </Card>
  );
}
