import styles from './ReportsPage.module.css';
import { useCallback, useState } from 'react';
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
} from '@afhomes/ui';

import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { REPORT_DEFS, availableReports } from './reports';
import { downloadExport, exportReport, formatCell, getReport } from './services';

const PAGE_SIZE = 50;

/**
 * Role-scoped reports. The selector only offers reports the session's
 * permissions allow (UX only); every table, total, and export below is the
 * server's scoped answer, paginated server-side.
 *
 * The redemptions report doubles as the employee's personal service history:
 * for a scoped caller the server returns only the transactions that caller
 * handled, with per-employee summary cards, presets, and a detail view.
 */
export function ReportsPage() {
  const { user } = useSession();
  const defs = availableReports(user?.afHomesPermissions, user?.roleSlug);
  const [type, setType] = useState(defs[0]?.type ?? 'sales');
  const def = REPORT_DEFS.find((d) => d.type === type) ?? REPORT_DEFS[0]!;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const resetPage = useCallback(() => {
    setOffset(0);
    setSelected(null);
  }, []);
  // Live search: keystrokes stay instant, the query follows the pause, and a
  // settled term always restarts at the first page.
  const debouncedSearch = useDebouncedValue(search, 300, resetPage);
  const debouncedStatus = useDebouncedValue(status, 300, resetPage);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(debouncedStatus ? { status: debouncedStatus } : {}),
    ...(type === 'ost' && kind ? { kind } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(type === 'redemptions' && transactionType ? { transactionType } : {}),
    limit: PAGE_SIZE,
    offset,
  };
  const query = useQuery({
    queryKey: [
      'reports',
      type,
      from,
      to,
      debouncedStatus,
      kind,
      debouncedSearch,
      transactionType,
      offset,
    ],
    queryFn: () => getReport(type, filters),
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every page turn.
    placeholderData: keepPreviousData,
    // Operational freshness without reload: same-scoped refetch every 30s.
    // Mutation invalidation stays the primary mechanism; this covers changes
    // made from another session (e.g. a redemption completed at the POS while
    // this report is open).
    refetchInterval: 30_000,
  });

  const runExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format);
    setExportError(null);
    try {
      const envelope = await exportReport(type, { ...filters, limit: 5000, offset: 0 }, format);
      downloadExport(envelope);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  // A settled search term always restarts at the first page: staying on page
  // 3 of a previous term would show a slice that no longer exists. Runs
  // inside the debounce timeout via the hook, never synchronously in render.

  const dayString = (date: Date) => date.toISOString().slice(0, 10);
  const applyPreset = (preset: 'today' | 'week' | 'month' | 'custom') => {
    const now = new Date();
    if (preset === 'custom') {
      setFrom('');
      setTo('');
    } else if (preset === 'today') {
      const day = dayString(now);
      setFrom(day);
      setTo(day);
    } else if (preset === 'week') {
      const start = new Date(now);
      const dow = (now.getUTCDay() + 6) % 7;
      start.setUTCDate(now.getUTCDate() - dow);
      setFrom(dayString(start));
      setTo(dayString(now));
    } else {
      setFrom(dayString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))));
      setTo(dayString(now));
    }
    resetPage();
  };

  const switchType = (next: string) => {
    setType(next);
    setTransactionType('');
    setSelected(null);
    resetPage();
  };

  const summary = query.data?.summary as Record<string, unknown> | undefined;
  const summaryNumber = (key: string): string => {
    const value = summary?.[key];
    if (typeof value === 'number') return formatCountOrDash(value);
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
  };
  const summaryKeyLabel = (key: string): string => {
    if (key === 'grossFrozenValue') return 'Gross Sales Value';
    if (key === 'verifiedPaid') return 'Verified Paid';
    if (key === 'remaining') return 'Remaining Balance';
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  };

  // First load skeletonizes the whole page - header, filters, and table - so
  // no static content flashes before the data it describes. Refetches keep the
  // previous page visible via placeholderData and never reach this branch.
  if (query.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading report"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
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
        title="Reports"
        description="Operational reports. Every figure is computed server-side from your authorized scope."
      />

      <FilterBar
        search={
          <SearchField
            label="Search report"
            placeholder={
              type === 'redemptions' ? 'customer / membership / reference / item' : 'name / number'
            }
            value={search}
            onChange={(value) => {
              setSearch(value);
            }}
            busy={query.isFetching && !query.isPending}
          />
        }
        filters={
          <>
            <Select
              aria-label="Report"
              value={type}
              onChange={(e) => {
                switchType(e.target.value);
              }}
              options={defs.map((d) => ({ value: d.type, label: d.label }))}
            />
            <DateField
              id="reports-from"
              name="from"
              label="From"
              optional
              value={from}
              onChange={(value) => {
                setFrom(value);
                resetPage();
              }}
            />
            <DateField
              id="reports-to"
              name="to"
              label="To"
              optional
              value={to}
              onChange={(value) => {
                setTo(value);
                resetPage();
              }}
            />
            <SearchField
              label="Status"
              placeholder="exact status"
              value={status}
              onChange={(value) => {
                setStatus(value);
              }}
            />
            {type === 'redemptions' ? (
              <Select
                aria-label="Transaction type"
                value={transactionType}
                onChange={(e) => {
                  setTransactionType(e.target.value);
                  resetPage();
                }}
                options={[
                  { value: '', label: 'All types' },
                  { value: 'redemption', label: 'Redemption' },
                ]}
              />
            ) : null}
            {type === 'ost' ? (
              <Select
                aria-label="Kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  resetPage();
                }}
                options={[
                  { value: '', label: 'Applications' },
                  { value: 'members', label: 'Members' },
                ]}
              />
            ) : null}
          </>
        }
        actions={
          <>
            {(['today', 'week', 'month', 'custom'] as const).map((preset) => (
              <Button key={preset} variant="ghost" onClick={() => applyPreset(preset)}>
                {preset === 'today'
                  ? 'Today'
                  : preset === 'week'
                    ? 'This week'
                    : preset === 'month'
                      ? 'This month'
                      : 'Custom'}
              </Button>
            ))}
            {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
              <Button
                key={format}
                variant="secondary"
                disabled={exporting !== null}
                onClick={() => void runExport(format)}
              >
                {exporting === format
                  ? `Exporting ${format.toUpperCase()}…`
                  : `Export ${format.toUpperCase()}`}
              </Button>
            ))}
          </>
        }
      />

      <p className={styles.muted}>{def.description}</p>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !query.data || query.data.data.length === 0 ? (
        <EmptyState
          title={type === 'redemptions' ? 'No service transactions yet.' : 'No rows in scope'}
          description={
            type === 'redemptions'
              ? 'Nothing you have served matches these filters yet.'
              : 'Nothing matches these filters within your authorized scope.'
          }
        />
      ) : (
        <>
          {type === 'redemptions' && summary ? (
            <ul className={styles.badges} aria-label="Personal service summary">
              {(
                [
                  ['customersServed', 'Customers served'],
                  ['completedTransactions', 'Completed transactions'],
                  ['pointsRedeemed', 'Points redeemed'],
                  ['todayTransactions', "Today's transactions"],
                  ['monthTransactions', "This month's transactions"],
                ] as const
              ).map(([key, label]) => (
                <li key={key}>
                  <StatusChip
                    label={`${label}: ${summaryNumber(key)}`}
                    tone="neutral"
                    icon="file-text"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className={styles.badges} aria-label="Report summary">
              {Object.entries(query.data.summary).map(([key, value]) => (
                <li key={key}>
                  <StatusChip
                    label={`${summaryKeyLabel(key)}: ${formatCell(key, value)}`}
                    tone="neutral"
                    icon="file-text"
                  />
                </li>
              ))}
            </ul>
          )}
          <p className={styles.muted}>
            Scope: {query.data.scope.label} · {query.data.meta.total} rows
          </p>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <table>
              <thead>
                <tr>
                  {def.columns.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((row, i) => {
                  const record = row as Record<string, unknown>;
                  const reference = String(
                    record.referenceNumber ?? record.redemptionNumber ?? `row-${i}`,
                  );
                  return (
                    <tr
                      key={reference}
                      onClick={() =>
                        setSelected(selected?.referenceNumber === reference ? null : record)
                      }
                      className={styles.clickableRow}
                    >
                      {def.columns.map((col) => (
                        <td key={col.key} data-label={col.label}>
                          {formatCell(col.key, record[col.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected ? (
            <section aria-label="Transaction detail" className={styles.detailSection}>
              <h3>Transaction {String(selected.referenceNumber ?? '')}</h3>
              <dl className={styles.detailGrid}>
                {(
                  [
                    ['customer', 'Customer'],
                    ['membershipNumber', 'Membership'],
                    ['tier', 'VIP tier'],
                    ['servedBy', 'Served by'],
                    ['serviceItem', 'Item'],
                    ['quantity', 'Quantity'],
                    ['pointsUsed', 'Points'],
                    ['balanceBefore', 'Previous balance'],
                    ['balanceAfter', 'Balance after'],
                    ['date', 'Date / time'],
                    ['status', 'Status'],
                    ['referenceNumber', 'Reference'],
                    ['transactionType', 'Transaction type'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt className={styles.summaryLabel}>{label}</dt>
                    <dd>
                      <strong>{formatCell(key, selected[key])}</strong>
                    </dd>
                  </div>
                ))}
              </dl>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close detail
              </Button>
            </section>
          ) : null}
          <div className={styles.actionsRow}>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= query.data.meta.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </>
      )}

      {exportError ? (
        <ErrorState error={new Error(exportError)} onRetry={() => setExportError(null)} />
      ) : null}
    </section>
  );
}
