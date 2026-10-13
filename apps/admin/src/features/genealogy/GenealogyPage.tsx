import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { getGenealogy } from './services';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { genealogyKeys } from '../business/queryKeys';
import styles from './GenealogyPage.module.css';

const ROLES = ['all', 'vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
const STATUSES = ['all', 'active', 'inactive', 'invited', 'suspended'];

/**
 * Authorized sales network: VD to SSM to SM to OST genealogy.
 *
 * The tree loads once and every control filters locally, so typing never
 * refetches. Historical sales attribution is unchanged by anything here.
 */
export function GenealogyPage() {
  const query = useQuery({
    queryKey: genealogyKeys.tree,
    queryFn: getGenealogy,
    // The authorized tree stays on screen while a background refresh reloads.
    placeholderData: keepPreviousData,
  });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const debouncedSearch = useDebouncedValue(search);
  const rows = useMemo(
    () =>
      (query.data ?? []).filter(
        (n) =>
          (role === 'all' || n.role === role) &&
          (status === 'all' || n.status === status) &&
          [n.fullName, n.staffId, n.role, n.role.replace(/_/g, ' ')].some((value) =>
            value.toLowerCase().includes(debouncedSearch.trim().toLowerCase()),
          ),
      ),
    [query.data, debouncedSearch, role, status],
  );

  const sellerCount = query.data?.length ?? 0;
  const activeCount = (query.data ?? []).filter((n) => n.status === 'active').length;

  // First load skeletonizes the whole page so no static content flashes
  // before the tree it describes. Refetches keep the tree visible and never
  // reach this branch. The sr-only line keeps the exact pending copy.
  if (query.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading genealogy"
        >
          <span className="sr-only">Loading genealogy…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 460 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 88 }} />
            <Skeleton style={{ height: 88 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
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
        title="Sales Network"
        description="Authorized VD to SSM to SM to OST genealogy. Historical sales attribution is unchanged."
      />

      <div className={styles.summary} aria-label="Network summary">
        <MetricCard label="Sellers in view" value={formatCountOrDash(rows.length)} />
        <MetricCard label="Active sellers" value={formatCountOrDash(activeCount)} />
        <MetricCard label="Total sellers" value={formatCountOrDash(sellerCount)} />
      </div>

      <FilterBar
        search={
          <SearchField
            label="Search genealogy"
            placeholder="Search seller"
            value={search}
            onChange={setSearch}
            busy={query.isFetching}
          />
        }
        filters={
          <>
            <label className={styles.filterLabel}>
              Role
              <Select
                aria-label="Filter role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                options={ROLES.map((v) => ({
                  value: v,
                  label: v === 'all' ? 'All roles' : humanizeCode(v),
                }))}
              />
            </label>
            <label className={styles.filterLabel}>
              Status
              <Select
                aria-label="Filter status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={STATUSES.map((v) => ({
                  value: v,
                  label: v === 'all' ? 'All statuses' : humanizeCode(v),
                }))}
              />
            </label>
          </>
        }
      />
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Sales network could not be loaded"
          message={describeGenealogyLoadError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No matching records." description="Adjust the current filters." />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Role</th>
                <th>Status</th>
                <th>Direct</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.staffId}>
                  <td data-label="Seller" className={styles.sellerCell}>
                    <Link to={`/admin/genealogy/${n.staffId}`}>{n.fullName}</Link>
                  </td>
                  <td data-label="Role">{humanizeCode(n.role)}</td>
                  <td data-label="Status">
                    <StatusChip label={humanizeCode(n.ostStatus ?? n.status)} />
                  </td>
                  <td data-label="Direct" className={styles.numeric}>
                    {formatCountOrDash(n.directDownlineCount)}
                  </td>
                  <td data-label="Total" className={styles.numeric}>
                    {formatCountOrDash(n.totalDescendantCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Actionable tree-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeGenealogyLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open the sales network right now. Contact an administrator.';
  return undefined;
}
