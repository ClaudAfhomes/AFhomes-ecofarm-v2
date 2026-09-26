import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, Icon, PageHeader, Skeleton } from '@jad/ui';

import { usePolicies } from '../../../hooks/usePolicies';
import { formatDate } from '../lib/presentation';
import styles from './PoliciesPage.module.css';

/**
 * Policies (SCR-MEM-023, FR-ADM-004). Policies, program guidelines, and Terms
 * and Conditions (BR-NOT-001). Public endpoint (#69); titles/types come from the
 * API - never invented in the UI. Production static mock, no dev preview.
 */
export function PoliciesPage() {
  const policiesQuery = usePolicies();
  const [search, setSearch] = useState('');

  const items = policiesQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) => p.title.toLowerCase().includes(q) || p.type.toLowerCase().includes(q),
    );
  }, [items, search]);

  const latest = Array.isArray(items)
    ? items.reduce<string | null>((acc, p) => {
        if (!acc || (p as { updatedAt: string }).updatedAt > acc)
          return (p as { updatedAt: string }).updatedAt;
        return acc;
      }, null)
    : null;

  return (
    <section>
      <PageHeader title="Policies" description="JA&D policies, program guidelines, and terms." />

      {latest ? (
        <p className={styles.timeframe}>Official · Updated {formatDate(latest)}</p>
      ) : (
        <p className={styles.timeframe}>Official · Updated</p>
      )}

      <div className={styles.filters} role="group" aria-label="Filter policies">
        <button
          type="button"
          className={styles.filterActive}
          aria-pressed="true"
          onClick={() => setSearch('')}
        >
          All
        </button>
        <label className={styles.searchWrap} aria-label="Search policies">
          <input
            type="search"
            placeholder="Search policies"
            aria-label="Search policies"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </label>
      </div>

      <p className={styles.count} aria-live="polite">
        {policiesQuery.isLoading
          ? 'Loading policies…'
          : `Showing ${filtered.length} of ${items.length} ${items.length === 1 ? 'policy' : 'policies'}`}
      </p>

      {policiesQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : policiesQuery.isError ? (
        <ErrorState
          error={policiesQuery.error}
          title="Could not load policies"
          onRetry={() => void policiesQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="No policies yet" description="Published policies will appear here." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matches"
          description="No policies match your search."
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setSearch('')}>
              Clear search
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filtered.map((policy) => (
            <li key={policy.id}>
              <Link className={styles.card} to={`/member/policies/${policy.slug}`}>
                <span className={styles.cardMain}>
                  <span className={styles.kind}>
                    <Icon
                      name="file-text"
                      size={14}
                      className={styles.kindIcon}
                      aria-hidden="true"
                    />
                    {policy.type}
                  </span>
                  <span className={styles.title}>{policy.title}</span>
                  <span className={styles.meta}>updated {formatDate(policy.updatedAt)}</span>
                </span>
                <span className={styles.viewLink}>View</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
