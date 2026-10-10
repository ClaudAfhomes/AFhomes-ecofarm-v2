import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
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
import styles from './RedemptionHistory.module.css';

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

  return (
    <>
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
          search={
            <SearchField
              id="filter-membership"
              label="Membership number"
              placeholder="MBS-…"
              value={membershipNumber}
              onChange={setMembershipNumber}
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
              <input
                aria-label="From"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <input
                aria-label="To"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </>
          }
          actions={
            <>
              <Button type="submit">Apply</Button>
              <Button variant="ghost" onClick={clear}>
                Clear
              </Button>
            </>
          }
        />
      </form>

      {history.isLoading && <p role="status">Loading redemptions…</p>}
      {history.isError && <ErrorState title="The history could not be loaded" />}

      {history.data && history.data.length === 0 && (
        <EmptyState title="No redemptions match" description="Adjust the filters and try again." />
      )}

      {history.data && history.data.length > 0 && (
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
            {history.data.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className={styles.mono}>{row.redemptionNumber}</span>
                </TableCell>
                <TableCell>{new Date(row.completedAt).toLocaleString('en-PH')}</TableCell>
                <TableCell>{row.customerDisplayName}</TableCell>
                <TableCell>
                  <span className={styles.mono}>{row.membershipNumber}</span>
                </TableCell>
                <TableCell>
                  {row.itemNameSnapshot}
                  {row.quantity > 1 && <span className={styles.muted}> × {row.quantity}</span>}
                  <span className={styles.muted}> ({row.itemCodeSnapshot})</span>
                </TableCell>
                <TableCell align="right">{row.totalPoints.toLocaleString('en-PH')}</TableCell>
                <TableCell align="right">
                  {row.balanceAfterSnapshot.toLocaleString('en-PH')}
                </TableCell>
                <TableCell>{row.redeemedByName}</TableCell>
                <TableCell>
                  <StatusChip
                    label={row.status}
                    tone={row.status === 'completed' ? 'success' : 'neutral'}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {history.data && history.data.length > 0 && (
        <p className={styles.footnote}>
          Showing the most recent {history.data.length} redemptions matching these filters.
        </p>
      )}
    </>
  );
}
