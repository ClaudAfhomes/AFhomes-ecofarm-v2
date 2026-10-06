import { ErrorState } from '@afhomes/ui';

import { useCustomerLedgerQuery } from './queries';
import { isForbidden } from './http';
import { Card, formatDate, styles } from './portal-ui';

/**
 * Read-only redemption history, derived from the member's own points ledger:
 * only `redemption` entries, each carrying the frozen item snapshot the
 * transaction was charged with. No separate endpoint is needed and none is
 * called — the ledger is already scoped to this member server-side, so the
 * client-side filter cannot widen anything.
 */
export function CustomerRedemptionsPage() {
  const ledger = useCustomerLedgerQuery();

  if (ledger.isLoading) return <p role="status">Loading your redemptions…</p>;
  if (ledger.isError) {
    return (
      <ErrorState
        title="Redemptions unavailable"
        message={
          isForbidden(ledger.error)
            ? 'Your account is not active, so redemptions are not available. Contact AF Homes Ecofarm to restore access.'
            : 'We could not load your redemptions. Please try again in a moment.'
        }
      />
    );
  }

  const rows = (ledger.data ?? []).filter((entry) => entry.entryType === 'redemption');

  return (
    <Card title="Redemption history">
      {rows.length === 0 ? (
        <p className={styles.notice}>No redemptions yet. Points are spent with AF Homes Ecofarm staff.</p>
      ) : (
        <>
          <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Item</th>
                <th scope="col">Reference</th>
                <th scope="col" className={styles.numeric}>
                  Points spent
                </th>
                <th scope="col" className={styles.numeric}>
                  Balance after
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.occurredAt)}</td>
                  <td>
                    {entry.itemName ?? entry.reason ?? '—'}
                    {entry.quantity && entry.quantity > 1 ? ` × ${entry.quantity}` : ''}
                    {entry.itemCode ? ` (${entry.itemCode})` : ''}
                  </td>
                  <td className={styles.mono}>{entry.redemptionNumber ?? '—'}</td>
                  <td className={styles.numeric}>{Math.abs(entry.amount).toLocaleString('en-PH')}</td>
                  <td className={styles.numeric}>{entry.balanceAfter.toLocaleString('en-PH')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className={styles.notice}>Showing the most recent {rows.length} redemptions.</p>
        </>
      )}
    </Card>
  );
}
