import { Button, EmptyState, ErrorState } from '@afhomes/ui';

import { useCustomerLedgerQuery } from './queries';
import { isForbidden } from './http';
import { ActivityList, ActivityListSkeleton, ActivityRow, formatDate, ui } from './portal-ui';
import { MoneyPanel } from './MoneyPanel';
import money from './money.module.css';

/**
 * Read-only redemption history, derived from the member's own points ledger:
 * only `redemption` entries, each carrying the frozen item snapshot the
 * transaction was charged with. No separate endpoint is needed and none is
 * called — the ledger is already scoped to this member server-side, so the
 * client-side filter cannot widen anything.
 */
export function CustomerRedemptionsPage() {
  const ledger = useCustomerLedgerQuery(true, true);

  if (ledger.isLoading)
    return (
      <MoneyPanel title="Redemption history">
        <ActivityListSkeleton rows={2} />
      </MoneyPanel>
    );
  if (ledger.isError) {
    return (
      <ErrorState
        onRetry={ledger.refetch}
        title="Redemptions unavailable"
        message={
          isForbidden(ledger.error)
            ? 'Your account is not active, so redemptions are not available. Contact AFhomes Ecofarm to restore access.'
            : 'We could not load your redemptions. Please try again in a moment.'
        }
      />
    );
  }

  const rows = (ledger.data ?? []).filter((entry) => entry.entryType === 'redemption');

  return (
    <MoneyPanel title="Redemption history">
      {rows.length === 0 ? (
        <EmptyState
          title="No redemptions yet."
          description="Points are spent with AFhomes Ecofarm staff."
        />
      ) : (
        <>
          <ActivityList label="Redemption history">
            {rows.map((entry) => {
              const reference = entry.referenceNumber ?? entry.redemptionNumber;
              return (
                <ActivityRow
                  key={entry.id}
                  icon="card"
                  title={`${entry.itemName ?? entry.reason ?? '—'}${
                    entry.quantity && entry.quantity > 1 ? ` × ${entry.quantity}` : ''
                  }${entry.itemCode ? ` (${entry.itemCode})` : ''}`}
                  meta={
                    <>
                      <time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time>
                      {reference ? (
                        <>
                          {' · '}
                          <span className={money.mono}>{reference}</span>
                        </>
                      ) : null}
                    </>
                  }
                  amount={`${Math.abs(entry.amount).toLocaleString('en-PH')} pts`}
                  direction="debit"
                  status={
                    <span className={money.balanceAfter}>
                      Balance after {entry.balanceAfter.toLocaleString('en-PH')}
                    </span>
                  }
                />
              );
            })}
          </ActivityList>
          <p className={`${ui.muted} ${money.footnote}`}>
            Showing {rows.length} redemptions on this page.
          </p>
        </>
      )}
      <nav className={money.pager} aria-label="Redemption history pages">
        <Button
          variant="secondary"
          disabled={!ledger.hasPrevious || ledger.isFetching}
          onClick={ledger.previousPage}
        >
          Newer redemptions
        </Button>
        <Button
          variant="secondary"
          disabled={!ledger.hasNext || ledger.isFetching}
          onClick={ledger.nextPage}
        >
          Older redemptions
        </Button>
      </nav>
    </MoneyPanel>
  );
}
