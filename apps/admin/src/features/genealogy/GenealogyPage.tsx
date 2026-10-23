import { useMemo, useState, useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  DateField,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { getGenealogy, getTeamSalesOverview, teamSalesKeys, type GenealogyNode } from './services';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { genealogyKeys } from '../business/queryKeys';
import { useSession } from '../../lib/session';
import { GenealogyTree } from './GenealogyTree';
import styles from './GenealogyPage.module.css';

const ROLES = ['all', 'vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
const STATUSES = ['all', 'active', 'inactive', 'invited', 'suspended'];

/**
 * Head first. Search and filters narrow the list
 * without refetching; each card opens that seller's
 * genealogy record.
 */
export function GenealogyPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');

  // Date filter state
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Quick presets
  const presets = [
    { label: 'Today', days: 0 },
    { label: 'Past 7 Days', days: 7 },
    { label: 'Past 28 Days', days: 28 },
    { label: 'Past 6 Months', days: 180 },
  ] as const;

  // Compute today's date once per render cycle
  const today = useMemo(() => new Date(), []);
  const todayStr = today.toISOString().slice(0, 10);

  const applyPreset = useCallback((days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    setDateTo(to.toISOString().slice(0, 10));
    setDateFrom(from.toISOString().slice(0, 10));
  }, []);

  const isPresetActive = useCallback(
    (days: number) => {
      const expectedFrom = new Date();
      expectedFrom.setDate(today.getDate() - days);
      return dateFrom === expectedFrom.toISOString().slice(0, 10) && dateTo === todayStr;
    },
    [dateFrom, dateTo, today, todayStr]
  );

  const query = useQuery({
    queryKey: genealogyKeys.tree,
    queryFn: getGenealogy,
    placeholderData: keepPreviousData,
  });

  const overviewQuery = useQuery({
    queryKey: teamSalesKeys.overview('month', dateFrom, dateTo),
    queryFn: () => getTeamSalesOverview('month', dateFrom, dateTo),
    enabled: user?.roleSlug === 'admin' || user?.roleSlug === 'super_admin',
    placeholderData: keepPreviousData,
  });

  // Determine the genealogy root for the current user
  // VD: self (top-level)
  // SSM: self, with VD as read-only head reference
  // SM: self, with SSM/VD as read-only head references
  // OST: self, with SM/SSM/VD as read-only head references
  // Admin/Super Admin: all heads (existing behavior)
  const isSellerRole = !!user && ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(user.roleSlug ?? '');
  const isAdmin = !!user && (user.roleSlug === 'admin' || user.roleSlug === 'super_admin');

  // Build upline chain for the current user (for seller roles)
  const uplineChain = useMemo(() => {
    if (!user || !user.id || !isSellerRole) return [];
    const allNodes = query.data ?? [];
    const nodeMap = new Map(allNodes.map(n => [n.staffId, n]));
    const chain: GenealogyNode[] = [];
    let currentId = user.id;
    // Walk up the upline chain (max 4 levels for VD->SSM->SM->OST)
    for (let i = 0; i < 4; i++) {
      const node = nodeMap.get(currentId);
      if (!node || !node.uplineStaffId) break;
      const upline = nodeMap.get(node.uplineStaffId);
      if (!upline) break;
      chain.unshift(upline); // Add to beginning so VD is first
      currentId = upline.staffId;
    }
    return chain;
  }, [query.data, user?.id, user?.roleSlug]);

  // Determine the root node for the genealogy tree
  // For sellers: their own node
  // For admin: first head (existing behavior)
  const treeRoot = useMemo(() => {
    if (!user || !user.id) return null;
    if (isSellerRole) {
      // For sellers, find their own node in the data
      return (query.data ?? []).find(n => n.staffId === user.id) ?? null;
    }
    // Admin: use existing heads logic
    const ids = new Set((query.data ?? []).map((n) => n.staffId));
    const heads = (query.data ?? []).filter((n) => !n.uplineStaffId || !ids.has(n.uplineStaffId));
    return heads[0] ?? null;
  }, [query.data, user?.id, user?.roleSlug]);

  const debouncedSearch = useDebouncedValue(search);
  const filtering = debouncedSearch.trim() !== '' || role !== 'all' || status !== 'all';
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

  const heads = useMemo(() => {
    const ids = new Set((query.data ?? []).map((n) => n.staffId));
    return (query.data ?? []).filter((n) => !n.uplineStaffId || !ids.has(n.uplineStaffId));
  }, [query.data]);

  // First load skeletonizes the whole page so no static content flashes
  // before the list it describes. Refetches keep the list visible and never
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
      <PageHeader title="Sales Network" description="Head first. Open a seller." />

      <div className={styles.badges} aria-label="Network summary">
        <StatusChip
          label={`In view: ${formatCountOrDash(rows.length)}`}
          tone="neutral"
          icon="users"
        />
        <StatusChip
          label={`Active: ${formatCountOrDash(activeCount)}`}
          tone="success"
          icon="user-check"
        />
        <StatusChip
          label={`Total: ${formatCountOrDash(sellerCount)}`}
          tone="neutral"
          icon="users"
        />
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
      {overviewQuery.data && (
        <section className={styles.adminSalesSection} aria-label="Global team sales analytics">
          {/* Date Filters */}
          <div className={styles.dateFilterSection}>
            <h2 className={styles.sectionTitle}>Team Sales Activity</h2>

            {/* Quick preset buttons */}
            <div className={styles.presetButtons} role="group" aria-label="Quick date presets">
              {presets.map((p) => (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  onClick={() => applyPreset(p.days)}
                  className={isPresetActive(p.days) ? styles.presetActive : ''}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            {/* Custom date range pickers */}
            <div className={styles.dateRangeInputs}>
              <div className={styles.dateInputGroup}>
                <label htmlFor="admin-date-from" className={styles.dateLabel}>
                  Start Date
                </label>
                <DateField
                  id="admin-date-from"
                  name="admin-date-from"
                  label="Start Date"
                  value={dateFrom}
                  onChange={setDateFrom}
                  max={dateTo || todayStr}
                  hint="Optional — defaults to period start"
                  optional
                />
              </div>
              <div className={styles.dateInputGroup}>
                <label htmlFor="admin-date-to" className={styles.dateLabel}>
                  End Date
                </label>
                <DateField
                  id="admin-date-to"
                  name="admin-date-to"
                  label="End Date"
                  value={dateTo}
                  onChange={setDateTo}
                  min={dateFrom || undefined}
                  max={todayStr}
                  hint="Optional — defaults to today"
                  optional
                />
              </div>
            </div>

            {/* Validation message */}
            {dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo) && (
              <div className={styles.validationError} role="alert">
                End date must be on or after start date
              </div>
            )}
          </div>

          {/* KPI Cards */}
          <div className={styles.adminKpiGrid}>
            <article className={styles.kpiCard}>
              <div className={styles.kpiIcon} style={{ background: 'var(--color-brand-primary)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
                </svg>
              </div>
              <dt>Total Sales</dt>
              <dd>{formatCountOrDash(overviewQuery.data.totalSales)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <div className={styles.kpiIcon} style={{ background: 'var(--color-brand-secondary)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <dt>Eligible Sellers</dt>
              <dd>{formatCountOrDash(overviewQuery.data.totalEligibleSellers)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <div className={styles.kpiIcon} style={{ background: 'var(--color-success)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <dt>With Sales</dt>
              <dd>{formatCountOrDash(overviewQuery.data.sellersWithSales)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <div className={styles.kpiIcon} style={{ background: 'var(--color-error)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <dt>No Sales</dt>
              <dd>{formatCountOrDash(overviewQuery.data.sellersNoSales)}</dd>
            </article>
          </div>

          {/* Team Comparison Table */}
          <div className={styles.tableWrap}>
            <table className={styles.teamTable}>
              <thead>
                <tr>
                  <th className={styles.colNum}>#</th>
                  <th className={styles.colName}>Team Head</th>
                  <th className={styles.colCenter}>Members</th>
                  <th className={styles.colCenter}>Total Sales</th>
                  <th className={styles.colCenter}>With Sales</th>
                  <th className={styles.colCenter}>No Sales</th>
                  <th className={styles.colCenter}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overviewQuery.data.teams.map((team, index) => (
                  <tr key={team.teamHead.staffId}>
                    <td className={styles.colNum}>{index + 1}</td>
                    <td className={styles.colName}>
                      <Link to={`/admin/genealogy/${team.teamHead.staffId}`} className={styles.teamLink}>
                        {team.teamHead.fullName}
                      </Link>
                    </td>
                    <td className={styles.colCenter}>{formatCountOrDash(team.memberCount)}</td>
                    <td className={styles.colCenter}>{formatCountOrDash(team.totalSales)}</td>
                    <td className={styles.colCenter}>{formatCountOrDash(team.membersWithSales)}</td>
                    <td className={styles.colCenter}>{formatCountOrDash(team.membersNoSales)}</td>
                    <td className={styles.colCenter}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/admin/genealogy/${team.teamHead.staffId}`)}
                      >
                        View Genealogy
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Sales network could not be loaded"
          message={describeGenealogyLoadError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No matching records." description="Adjust the current filters." />
      ) : filtering ? (
        <ul className={styles.flatList} aria-label="Matching sellers">
          {rows.map((n) => (
            <li key={n.staffId}>
              <NodeCard node={n} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* Genealogy Tree View */}
          <section className={styles.genealogyTreeSection} aria-label="Genealogy tree">
            {treeRoot && (
              <>
                {/* Upline Chain (read-only for sellers) */}
                {uplineChain.length > 0 && (
                  <div className={styles.uplineChain} aria-label="Upline chain">
                    <h3 className={styles.uplineTitle}>Your Upline</h3>
                    <div className={styles.uplineList}>
                      {uplineChain.map((upline, index) => (
                        <div key={upline.staffId} className={styles.uplineItem}>
                          <span className={styles.uplineConnector} aria-hidden="true">{index < uplineChain.length - 1 ? '▼' : ''}</span>
                          <div className={styles.uplineInfo}>
                            <span className={styles.uplineRole}>{humanizeCode(upline.role)}</span>
                            <span className={styles.uplineName}>{upline.fullName}</span>
                            <StatusChip label={humanizeCode(upline.ostStatus ?? upline.status)} tone="neutral" />
                          </div>
                          <span className={styles.uplineLabel}>Your Head</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Current User as Root */}
                <div className={styles.treeRoot}>
                  <GenealogyTree
                    rootStaffId={treeRoot.staffId}
                    viewerRole={user?.roleSlug ?? ''}
                    viewerId={user?.id ?? ''}
                    onMemberClick={(member) => navigate(`/admin/genealogy/${member.staffId}`)}
                  />
                </div>
              </>
            )}
            {!treeRoot && (
              <EmptyState title="No genealogy data" description="Your genealogy record could not be found." />
            )}
          </section>

          {/* Admin: Traditional heads view (for admin/super_admin) */}
          {isAdmin && (
            <div className={styles.heads} aria-label="Network heads">
              {heads.length === 0
                ? rows.slice(0, 1).map((n) => <HeadCard key={n.staffId} node={n} />)
                : heads.map((n) => <HeadCard key={n.staffId} node={n} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Short failure guidance per cause. Raw server
 * internals never render, only next steps.
 */
function describeGenealogyLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError) return 'Check connection. Try again.';
  if (error instanceof ApiError && error.status === 401) return 'Session expired. Sign in again.';
  if (error instanceof ApiError && error.status === 403) return 'No access. Ask administrator.';
  return undefined;
}

function HeadCard({ node }: { node: GenealogyNode }) {
  const navigate = useNavigate();
  return (
    <article className={styles.headCard} aria-label="Network head">
      <span className={styles.headAvatar} aria-hidden="true">
        {node.fullName.trim().charAt(0).toUpperCase() || '•'}
      </span>
      <div className={styles.headText}>
        <p className={styles.headEyebrow}>Network head</p>
        <Link to={`/admin/genealogy/${node.staffId}`} className={styles.headName}>
          {node.fullName}
        </Link>
        <p className={styles.headMeta}>
          {humanizeCode(node.role)} | {formatCountOrDash(node.directDownlineCount)} direct |{' '}
          {formatCountOrDash(node.totalDescendantCount)} total
        </p>
      </div>
      <div className={styles.headChips}>
        <StatusChip label={humanizeCode(node.ostStatus ?? node.status)} />
        <Button
          size="sm"
          variant="secondary"
          aria-label={`View genealogy of ${node.fullName}`}
          onClick={() => navigate(`/admin/genealogy/${node.staffId}`)}
        >
          View Genealogy
        </Button>
      </div>
    </article>
  );
}

function NodeCard({ node }: { node: GenealogyNode }) {
  const navigate = useNavigate();
  return (
    <article className={styles.nodeCard}>
      <span className={styles.nodeAvatar} aria-hidden="true">
        {node.fullName.trim().charAt(0).toUpperCase() || '•'}
      </span>
      <div className={styles.nodeText}>
        <Link to={`/admin/genealogy/${node.staffId}`} className={styles.nodeName}>
          {node.fullName}
        </Link>
        <p className={styles.nodeMeta}>
          {humanizeCode(node.role)} | {formatCountOrDash(node.directDownlineCount)} direct
        </p>
      </div>
      <div className={styles.nodeActions}>
        <StatusChip label={humanizeCode(node.ostStatus ?? node.status)} />
        <Button
          size="sm"
          variant="secondary"
          aria-label={`View genealogy of ${node.fullName}`}
          onClick={() => navigate(`/admin/genealogy/${node.staffId}`)}
        >
          View Genealogy
        </Button>
      </div>
    </article>
  );
}