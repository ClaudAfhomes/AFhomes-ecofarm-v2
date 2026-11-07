import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommissionRosterPosition } from '@afhomes/contracts';
import {
  Alert,
  Button,
  DateField,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  Pagination,
  SearchField,
  Select,
  StatusChip,
  TextField,
  notifyConfirm,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import { formatCount } from '@afhomes/shared';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { CommissionTableSkeleton } from './CommissionSkeletons';
import { formatRate, percentToRate } from './format';
import { sharedScopes } from './queryKeys';
import { bulkSetCommissionRate, getCommissionRoster } from './services';
import styles from './CommissionSettingsPage.module.css';

const PAGE_SIZE = 25;
const today = () => new Date().toISOString().slice(0, 10);

const SOURCE: Record<
  'custom' | 'position' | 'none',
  { label: string; tone: 'info' | 'neutral' | 'warning' }
> = {
  custom: { label: 'Personal', tone: 'info' },
  position: { label: 'Position', tone: 'neutral' },
  none: { label: 'No rate', tone: 'warning' },
};

type SalesFilter = 'all' | 'with' | 'without' | 'needs';

/** Sellers with their applied rate. Tick sellers to give them a personal rate in one step. */
export function CommissionSellersTab({ positions }: { positions: CommissionRosterPosition[] }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('');
  const [salesFilter, setSalesFilter] = useState<SalesFilter>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [percent, setPercent] = useState('');
  const [from, setFrom] = useState(today());
  const [fetchingNeeds, setFetchingNeeds] = useState(false);
  const term = useDebouncedValue(search.trim(), 300, () => setPage(1));

  const query = {
    search: term || undefined,
    position: position || undefined,
    sales: salesFilter === 'needs' ? ('with' as const) : salesFilter,
    needsRate: salesFilter === 'needs',
  };
  const roster = useQuery({
    queryKey: sharedScopes.commissionRosterPage({ ...query, page }),
    queryFn: () => getCommissionRoster({ ...query, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    // Keep the table on screen while filters or a save refetch it.
    placeholderData: keepPreviousData,
  });

  const rate = percentToRate(percent);
  const bulk = useBusinessMutation({
    mutationFn: (input: { memberIds: string[]; rate: string; effectiveFrom: string }) =>
      bulkSetCommissionRate(input),
    onSuccess: async (result) => {
      setSelected(new Set());
      setDialogOpen(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: sharedScopes.commissionRoster }),
        client.invalidateQueries({ queryKey: sharedScopes.commissionRules }),
      ]);
      notifySuccess({
        title: 'Rates saved',
        message: `Saved for ${formatCount(result.created)} ${result.created === 1 ? 'seller' : 'sellers'}.`,
      });
    },
    // The dialog stays open so nothing typed is lost.
    onError: (error) => notifyError({ title: 'Rates not saved', message: error.message }),
  });
  const submit = async () => {
    if (!rate) return;
    const confirmed = await notifyConfirm({
      title: 'Set personal rate?',
      message: `${formatCount(selected.size)} ${selected.size === 1 ? 'seller' : 'sellers'} at ${formatRate(rate)}.`,
      confirmButtonText: 'Set rate',
    });
    if (confirmed) bulk.mutate({ memberIds: [...selected], rate, effectiveFrom: from });
  };

  const members = useMemo(() => roster.data?.members ?? [], [roster.data]);
  const pageIds = members.map((member) => member.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const selectNeedingRate = async () => {
    setFetchingNeeds(true);
    try {
      const all = await client.fetchQuery({
        queryKey: sharedScopes.commissionRosterPage({ needsRateAll: true }),
        queryFn: () => getCommissionRoster({ sales: 'with', needsRate: true, limit: 100 }),
        staleTime: 0,
      });
      setSelected(new Set(all.members.map((member) => member.id)));
      setDialogOpen(true);
    } catch (error) {
      notifyError({
        title: 'Sellers not loaded',
        message: error instanceof Error ? error.message : 'Try again.',
      });
    } finally {
      setFetchingNeeds(false);
    }
  };
  const closeDialog = () => {
    if (!bulk.isPending) setDialogOpen(false);
  };

  if (roster.isPending) return <CommissionTableSkeleton label="Loading sellers" />;
  if (roster.isError) return <ErrorState error={roster.error} onRetry={roster.refetch} />;

  const needsRateCount = roster.data.needsRateCount;
  const total = roster.data.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(term) || Boolean(position) || salesFilter !== 'all';
  const refetching = roster.isFetching;

  return (
    <div className={styles.tabBody}>
      {needsRateCount > 0 ? (
        <Alert
          variant="info"
          title={`${formatCount(needsRateCount)} ${needsRateCount === 1 ? 'seller has' : 'sellers have'} sales at 0%`}
        >
          <div className={styles.noticeActions}>
            <Button
              size="sm"
              loading={fetchingNeeds}
              loadingLabel="Loading…"
              onClick={selectNeedingRate}
            >
              Set their rate
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={fetchingNeeds}
              onClick={() => {
                setSalesFilter('needs');
                setPage(1);
              }}
            >
              Show them
            </Button>
          </div>
        </Alert>
      ) : null}

      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search sellers"
            placeholder="Seller name or position"
            value={search}
            onChange={setSearch}
            busy={refetching}
          />
        }
        filters={
          <>
            <label className={styles.field}>
              Position
              <Select
                aria-label="Filter by position"
                value={position}
                onChange={(event) => {
                  setPosition(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All positions' },
                  ...positions.map((item) => ({ value: item.slug, label: item.name })),
                ]}
              />
            </label>
            <label className={styles.field}>
              Sales
              <Select
                aria-label="Filter by sales"
                value={salesFilter}
                onChange={(event) => {
                  setSalesFilter(event.target.value as SalesFilter);
                  setPage(1);
                }}
                options={[
                  { value: 'all', label: 'All sellers' },
                  { value: 'with', label: 'Made a sale' },
                  { value: 'without', label: 'No sales yet' },
                  { value: 'needs', label: 'Needs a rate' },
                ]}
              />
            </label>
          </>
        }
      />

      <div className={styles.resultsBar}>
        <h3 className={styles.resultsTitle} aria-live="polite">
          {formatCount(total)} {total === 1 ? 'seller' : 'sellers'}
        </h3>
        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setPosition('');
              setSalesFilter('all');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className={styles.selectionBar} role="status">
          <strong>{formatCount(selected.size)} selected</strong>
          <span className={styles.actionGroup}>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Set rate
            </Button>
          </span>
        </div>
      ) : null}

      {members.length === 0 ? (
        <EmptyState
          title={filtered ? 'No matching sellers.' : 'No sellers yet'}
          description={filtered ? 'Try fewer filters.' : 'Active sellers appear here.'}
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          aria-busy={refetching || undefined}
          data-busy={refetching || undefined}
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
        >
          <table className={styles.queueTable}>
            <thead>
              <tr>
                <th scope="col" className={styles.selectHead}>
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={allOnPage}
                    ref={(node) => {
                      if (node) node.indeterminate = someOnPage && !allOnPage;
                    }}
                    onChange={togglePage}
                  />
                </th>
                <th scope="col">Seller</th>
                <th scope="col">Sales</th>
                <th scope="col" className={styles.numeric}>
                  Rate
                </th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} data-selected={selected.has(member.id) || undefined}>
                  <td className={styles.selectCell}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${member.name}`}
                      checked={selected.has(member.id)}
                      onChange={() => toggleOne(member.id)}
                    />
                  </td>
                  <td data-label="Seller" className={styles.targetCell}>
                    <span className={styles.primary}>{member.name}</span>
                    <span className={styles.secondary}>{member.positionName}</span>
                  </td>
                  <td data-label="Sales" className={styles.appliesCell}>
                    <span className={styles.primary}>{formatCount(member.salesCount)}</span>
                    <span className={styles.secondary}>
                      {member.lastSaleAt ? `Last ${member.lastSaleAt.slice(0, 10)}` : 'No sales yet'}
                    </span>
                  </td>
                  <td data-label="Rate" className={`${styles.numeric} ${styles.rateCell}`}>
                    {formatRate(member.rate)}
                  </td>
                  <td data-label="Source" className={styles.statusCell}>
                    <StatusChip
                      label={SOURCE[member.source].label}
                      tone={SOURCE[member.source].tone}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pageCount > 1 ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          onChange={setPage}
          label="Seller pages"
          disabled={refetching}
        />
      ) : null}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title="Set personal rate"
        footer={
          <>
            <Button variant="secondary" disabled={bulk.isPending} onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              loading={bulk.isPending}
              loadingLabel="Saving…"
              disabled={rate === null || !from || selected.size === 0}
              onClick={submit}
            >
              Save rate
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <p className={styles.panelNote}>
            Applies to {formatCount(selected.size)} {selected.size === 1 ? 'seller' : 'sellers'}.
            It replaces any personal rate. Future sales only.
          </p>
          <div className={styles.formGrid}>
            <TextField
              id="bulk-rate"
              name="bulkRate"
              label="Rate (%)"
              inputMode="decimal"
              value={percent}
              onChange={setPercent}
              disabled={bulk.isPending}
              error={percent && rate === null ? 'Use 0 to 100.' : undefined}
            />
            <DateField
              id="bulk-effective-from"
              name="bulkFrom"
              label="Effective from"
              value={from}
              onChange={setFrom}
              disabled={bulk.isPending}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
