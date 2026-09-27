import { ErrorState } from '@jad/ui';

import { useCustomerLedgerQuery, useCustomerPointsQuery } from './queries';
import { isForbidden } from './http';
import { Card, Field, FieldList, formatDate, humanEntryType, styles } from './portal-ui';

/**
 * Read-only points view.
 *
 * Balance, lifetime totals and the transaction history. There is no redemption
 * affordance anywhere on this screen, and nothing in the client can mutate
 * points: the API exposes no mutating verb on `/customer/points`, and the ledger
 * is written only by the server-side lifecycle functions.
 */
export function CustomerPointsPage() {
  const summary = useCustomerPointsQuery();
  const ledger = useCustomerLedgerQuery();

  if (summary.isLoading) return <p role="status">Loading your points…</p>;
  if (summary.isError) {
    return (
      <ErrorState
        title="Points unavailable"
        message={
          isForbidden(summary.error)
            ? 'Your account is not active, so points are not available. Contact AF Homes Ecofarm to restore access.'
            : 'We could not load your points. Please try again in a moment.'
        }
      />
    );
  }

  const entries = ledger.data ?? [];
  const hasRedemptions = entries.some((entry) => entry.entryType === 'redemption');

  return (
    <>
      <Card title="Balance">
        <p className={styles.balance}>{summary.data!.balance.toLocaleString('en-PH')}</p>
        <p className={styles.balanceCaption}>points currently on your card</p>
        <FieldList>
          <Field label="All time allocated" value={summary.data!.lifetimeAllocated.toLocaleString('en-PH')} />
          <Field label="All time redeemed" value={summary.data!.lifetimeRedeemed.toLocaleString('en-PH')} />
          <Field label="Last updated" value={formatDate(summary.data!.updatedAt)} />
        </FieldList>
        <p className={styles.notice}>
          Points accumulate automatically. Spending them is handled by AF Homes Ecofarm staff at
          any branch or desk that offers a redemption.
        </p>
      </Card>

      <Card title="Points activity">
        {ledger.isLoading && <p role="status">Loading your points activity…</p>}
        {ledger.isError && <p className={styles.notice}>Your points activity is not available right now.</p>}
        {ledger.data && ledger.data.length === 0 && (
          <p className={styles.notice}>No points activity yet.</p>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                {hasRedemptions && <th scope="col">Reference</th>}
                <th scope="col" className={styles.numeric}>
                  Points
                </th>
                <th scope="col" className={styles.numeric}>
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.data.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.occurredAt)}</td>
                  <td>{humanEntryType(entry.entryType)}</td>
                  {/* For a redemption the member sees WHAT they spent points on,
                      which is the joined item name, not an internal reason string. */}
                  <td>
                    {entry.itemName ??
                      (entry.quantity && entry.quantity > 1
                        ? `${entry.reason ?? humanEntryType(entry.entryType)}`
                        : (entry.reason ?? '—'))}
                  </td>
                  {hasRedemptions && (
                    <td className={styles.mono}>{entry.redemptionNumber ?? '—'}</td>
                  )}
                  <td
                    className={`${styles.numeric} ${entry.amount >= 0 ? styles.positive : styles.negative}`}
                  >
                    {entry.amount >= 0 ? '+' : ''}
                    {entry.amount.toLocaleString('en-PH')}
                  </td>
                  <td className={styles.numeric}>{entry.balanceAfter.toLocaleString('en-PH')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <p className={styles.notice}>
            Showing the most recent {ledger.data.length} entries.
          </p>
        )}
      </Card>
    </>
  );
}
