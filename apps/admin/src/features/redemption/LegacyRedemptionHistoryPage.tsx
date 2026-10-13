import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatCountOrDash } from '@afhomes/shared';
import {
  Button,
  DateField,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';

import { getRedemptionItems, getRedemptions } from './services';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { formatDateTime } from '../../lib/format';
import styles from './RedemptionHistory.module.css';

const capitalize = (value: string) =>
  value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Redemption history.
 *
 * Every filter is applied SERVER-SIDE. A client-side filter over an already
 * fetched page is not a filter: it silently hides rows that are in the database,
 * which for an auditable financial record is worse than showing too much.
 *
 * This is a read-only view. There is no void or reversal control, because the
 * authorization and accounting rule for a void is an unresolved business
 * decision, and inventing one here would quietly create the policy.
 *
 * Resolving a member (scanning or typing a code) is a read and never deducts
 * anything. Points move only inside the server redemption transaction; the
 * identifier authorizes nothing on its own.
 */
export function LegacyRedemptionHistoryPage() {
  const [membershipNumber, setMembershipNumber] = useState('');
  const [appliedNumber, setAppliedNumber] = useState('');
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Live search: the history follows the settled membership number; Apply
  // stays as an instant-apply fallback.
  void useDebouncedValue(membershipNumber.trim(), 300, (term) => setAppliedNumber(term));

  const items = useQuery({
    queryKey: ['redemption', 'items', 'all'],
    queryFn: () => getRedemptionItems(true),
  });

  const history = useQuery({
    queryKey: ['redemption', 'history', { appliedNumber, itemId, from, to }],
    queryFn: () =>
      getRedemptions({
        ...(appliedNumber ? { membershipNumber: appliedNumber } : {}),
        ...(itemId ? { itemId } : {}),
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
        limit: 100,
      }),
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every filter change.
    placeholderData: keepPreviousData,
    // Operational freshness: a redemption completed on another terminal
    // appears here without reload (same-session writes invalidate instantly).
    refetchInterval: 15_000,
  });

  const clear = () => {
    setMembershipNumber('');
    setAppliedNumber('');
    setItemId('');
    setFrom('');
    setTo('');
  };

  const rows = history.data ?? [];

  // First load skeletonizes the whole page - header, filters, and table - so
  // no static content flashes before the data it describes. Refetches keep the
  // previous list visible via placeholderData and never reach this branch.
  if (history.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading redemptions"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 300 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Legacy Points Transactions"
        description="Every points redemption, with the item name and price as they were at the time."
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedNumber(membershipNumber.trim());
        }}
      >
        <FilterBar
          filtersToggleLabel="Expand Filters"
          search={
            <SearchField
              id="filter-membership"
              label="Membership number"
              placeholder="MBS-…"
              value={membershipNumber}
              onChange={setMembershipNumber}
              busy={history.isFetching}
            />
          }
          filters={
            <>
              <Select
                aria-label="Item"
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
                options={[
                  { value: '', label: 'All items' },
                  ...(items.data ?? []).map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
              <DateField
                id="legacy-from"
                name="from"
                label="From"
                optional
                value={from}
                onChange={setFrom}
              />
              <DateField id="legacy-to" name="to" label="To" optional value={to} onChange={setTo} />
            </>
          }
          actions={
            <>
              <Button type="submit">Apply</Button>
              <Button variant="secondary" onClick={clear}>
                Clear
              </Button>
            </>
          }
        />
      </form>

      {history.isError ? (
        <ErrorState
          title="The history could not be loaded"
          error={history.error}
          onRetry={history.refetch}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No redemptions match" description="Adjust the filters and try again." />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Redemption</TableHeaderCell>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Member</TableHeaderCell>
              <TableHeaderCell>Membership</TableHeaderCell>
              <TableHeaderCell>Item (as charged)</TableHeaderCell>
              <TableHeaderCell align="right">Points</TableHeaderCell>
              <TableHeaderCell align="right">Balance after</TableHeaderCell>
              <TableHeaderCell>Served by</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell label="Redemption">
                  <span className={styles.mono}>{row.redemptionNumber}</span>
                </TableCell>
                <TableCell label="When">{formatDateTime(row.completedAt)}</TableCell>
                <TableCell label="Member">{row.customerDisplayName}</TableCell>
                <TableCell label="Membership">
                  <span className={styles.mono}>{row.membershipNumber}</span>
                </TableCell>
                <TableCell label="Item (as charged)">
                  {row.itemNameSnapshot}
                  {row.quantity > 1 && <span className={styles.muted}> × {row.quantity}</span>}
                  <span className={styles.muted}> ({row.itemCodeSnapshot})</span>
                </TableCell>
                <TableCell label="Points" align="right">
                  {formatCountOrDash(row.totalPoints)}
                </TableCell>
                <TableCell label="Balance after" align="right">
                  {formatCountOrDash(row.balanceAfterSnapshot)}
                </TableCell>
                <TableCell label="Served by">{row.redeemedByName}</TableCell>
                <TableCell label="Status">
                  <StatusChip label={capitalize(row.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!history.isError && rows.length > 0 && (
        <p className={styles.footnote}>
          Showing the most recent {rows.length} redemptions matching these filters.
        </p>
      )}
    </section>
  );
}
