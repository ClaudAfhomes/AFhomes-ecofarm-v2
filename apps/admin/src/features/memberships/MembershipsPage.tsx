import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  EmptyState,
  ErrorState,
  FilterBar,
  OverflowMenu,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { membershipKeys } from '../business/queryKeys';
import { TierBadge } from '../business/TierBadge';
import { getMemberships } from './services';
import styles from './MembershipsPage.module.css';

const STATUSES = ['', 'active', 'expired', 'suspended', 'cancelled'];

/**
 * Membership (card) management queue.
 *
 * Cards are identified by membership number and tier. Credential codes are
 * never listed here: hash-only storage means they cannot be recovered, only
 * rotated on the detail screen, where the new pair is shown exactly once.
 */
export function MembershipsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: membershipKeys.list(status),
    queryFn: () => getMemberships(status),
    // Keep the previous list visible while a status change or a background
    // refresh reloads: without this the data gap reads as an empty result.
    placeholderData: keepPreviousData,
    // Card status changes on the activation queue and detail screens.
    refetchInterval: 30_000,
  });
  const needle = debouncedSearch.trim().toLowerCase();
  const rows = (query.data ?? []).filter(
    (m) =>
      needle.length === 0 ||
      m.customerName.toLowerCase().includes(needle) ||
      m.membershipNumber.toLowerCase().includes(needle),
  );

  const activeCount = rows.filter((m) => m.status === 'active').length;
  const pointsTotal = rows.reduce((sum, m) => sum + m.pointsBalance, 0);

  // First load skeletonizes the whole page, header and table alike, so no
  // static content flashes before the data it describes. Refetches keep the
  // previous list visible via placeholderData and never reach this branch.
  // The sr-only line keeps the exact pending copy the earlier state used.
  if (query.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading memberships"
        >
          <span className="sr-only">Loading memberships…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 88 }} />
            <Skeleton style={{ height: 88 }} />
            <Skeleton style={{ height: 88 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
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
        title="Memberships"
        description="Issued member cards. Open a card to print it or to rotate its credentials."
      />

      <div className={styles.summary} aria-label="Membership summary">
        <StatusChip
          label={`Cards in view: ${formatCountOrDash(rows.length)}`}
          tone="neutral"
          icon="grid"
        />
        <StatusChip
          label={`Active cards: ${formatCountOrDash(activeCount)}`}
          tone="success"
          icon="user-check"
        />
        <StatusChip
          label={`Points held: ${formatCountOrDash(pointsTotal)}`}
          tone="neutral"
          icon="wallet"
        />
      </div>

      <FilterBar
        search={
          <SearchField
            label="Search member or number"
            placeholder="Name or MBS-…"
            value={search}
            onChange={setSearch}
            busy={query.isFetching}
          />
        }
        filters={
          <label className={styles.filterLabel}>
            Status
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                ...STATUSES.filter(Boolean).map((value) => ({
                  value,
                  label: humanizeCode(value),
                })),
              ]}
            />
          </label>
        }
      />

      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Memberships could not be loaded"
          message={describeMembershipsLoadError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No memberships" description="Activated cards appear here." />
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
                <th>Member</th>
                <th>Number</th>
                <th>Tier</th>
                <th>Category</th>
                <th>Status</th>
                <th>Points</th>
                <th>Activated</th>
                <th>Valid until</th>
                <th>Card Issued</th>
                <th>Last Printed</th>
                <th>Prints</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const tierCode = (m.productName ?? '').trim().toUpperCase();
                return (
                  <tr
                    key={m.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Manage card ${m.membershipNumber}`}
                    onClick={() => navigate(`/admin/memberships/${m.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ')
                        navigate(`/admin/memberships/${m.id}`);
                    }}
                    className={styles.clickable}
                  >
                    <td data-label="Member">
                      <span className={styles.identityCell}>
                        <span className={styles.identityAvatar} aria-hidden="true">
                          {(m.customerName.trim().charAt(0) || '•').toUpperCase()}
                        </span>
                        <span className={styles.identityName}>{m.customerName}</span>
                      </span>
                    </td>
                    <td data-label="Number">{m.membershipNumber}</td>
                    <td data-label="Tier">
                      <TierBadge tier={tierCode || null} />
                    </td>
                    <td data-label="Category">{m.categoryName ?? '—'}</td>
                    <td data-label="Status">
                      <StatusChip label={humanizeCode(m.status)} />
                    </td>
                    <td data-label="Points" className={styles.numeric}>
                      {formatCountOrDash(m.pointsBalance)}
                    </td>
                    <td data-label="Activated">
                      {m.activatedAt ? formatDateTime(m.activatedAt) : '—'}
                    </td>
                    <td data-label="Valid until">
                      {m.expiresAt ? formatDateTime(m.expiresAt) : '—'}
                    </td>
                    <td data-label="Card Issued">
                      {m.cardIssuedAt ? formatDateTime(m.cardIssuedAt) : '—'}
                    </td>
                    <td data-label="Last Printed">
                      {m.lastPrintedAt ? formatDateTime(m.lastPrintedAt) : '—'}
                    </td>
                    <td data-label="Prints" className={styles.numeric}>
                      {formatCountOrDash(m.printCount)}
                    </td>
                    <td
                      data-label="Actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // Only swallow the keys the row itself acts on. Escape
                        // (and Tab) must keep bubbling so the overflow menu's
                        // document-level dialog shell can close on Escape.
                        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                      }}
                    >
                      <OverflowMenu
                        label={`More actions for ${m.membershipNumber}`}
                        items={[
                          {
                            label: 'Manage card',
                            onClick: () => navigate(`/admin/memberships/${m.id}`),
                          },
                          {
                            label: 'Open printable card',
                            onClick: () => navigate(`/admin/memberships/${m.id}/card`),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Actionable list-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeMembershipsLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open memberships right now. Contact an administrator.';
  return undefined;
}
