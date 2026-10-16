import { useMemo, useState } from 'react';
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
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';
import type { GenealogyNode } from '@afhomes/contracts';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { getGenealogy } from './services';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { genealogyKeys } from '../business/queryKeys';
import styles from './GenealogyPage.module.css';

const ROLES = ['all', 'vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
const STATUSES = ['all', 'active', 'inactive', 'invited', 'suspended'];

/**
 * Head first. Search and filters narrow the list
 * without refetching; each card opens that seller's
 * genealogy record.
 */
export function GenealogyPage() {
  const query = useQuery({
    queryKey: genealogyKeys.tree,
    queryFn: getGenealogy,
    // The authorized network stays on screen while a background refresh reloads.
    placeholderData: keepPreviousData,
  });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
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
        <div className={styles.heads} aria-label="Network heads">
          {heads.length === 0
            ? rows.slice(0, 1).map((n) => <HeadCard key={n.staffId} node={n} />)
            : heads.map((n) => <HeadCard key={n.staffId} node={n} />)}
        </div>
      )}
    </section>
  );
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
