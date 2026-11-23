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
  type StatusTone,
} from '@afhomes/ui';
import { formatCount, formatCountOrDash } from '@afhomes/shared';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { membershipKeys } from '../business/queryKeys';
import { TierBadge } from '../business/TierBadge';
import { getMemberships } from './services';
import styles from './MembershipsPage.module.css';

const STATUSES = ['', 'active', 'expired', 'suspended', 'cancelled'];

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  expired: 'warning',
  suspended: 'warning',
  cancelled: 'danger',
};

/** Date on top, time underneath: the full instant without a wide column. */
function DateCell({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className={styles.muted}>—</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={styles.dateCell}>
      <span>{formatDate(iso)}</span>
      <span className={styles.muted}>
        {new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </time>
  );
}

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
      <section className={styles.page}>
        <div className={styles.skeleton} role="status" aria-label="Loading memberships">
          <span className="sr-only">Loading memberships…</span>
          <div className={styles.skeletonHead}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 320 }} />
          </div>
          <ul className={styles.badges} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index}>
                <Skeleton style={{ height: 24, width: '10rem', borderRadius: '999px' }} />
              </li>
            ))}
          </ul>
          <Skeleton style={{ height: 48 }} />
          <div className={styles.skeletonRows}>
            <Skeleton style={{ height: 64 }} />
            <Skeleton style={{ height: 64 }} />
            <Skeleton style={{ height: 64 }} />
            <Skeleton style={{ height: 64 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader title="Memberships" description="Issued member cards. Open one to manage." />

      {query.isError ? null : (
        <ul className={styles.badges} aria-label="Membership summary">
          <li>
            <StatusChip
              label={`Cards in view: ${formatCountOrDash(rows.length)}`}
              tone="neutral"
              icon="grid"
            />
          </li>
          <li>
            <StatusChip
              label={`Active cards: ${formatCountOrDash(activeCount)}`}
              tone="success"
              icon="user-check"
            />
          </li>
          <li>
            <StatusChip
              label={`Points held: ${formatCountOrDash(pointsTotal)}`}
              tone="info"
              icon="wallet"
            />
          </li>
        </ul>
      )}

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

      {!query.isError && rows.length > 0 ? (
        <div className={styles.resultsHead}>
          <h2 className={styles.resultsTitle}>
            {formatCount(rows.length)} {rows.length === 1 ? 'card' : 'cards'}
          </h2>
          <span className={styles.updating} aria-live="polite">
            {query.isPlaceholderData ? 'Updating results…' : ''}
          </span>
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Memberships could not be loaded"
          message={describeMembershipsLoadError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No memberships"
          description={
            needle || status ? 'Try another search or status.' : 'Activated cards appear here.'
          }
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Number</th>
                <th scope="col">Tier</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.numeric}>
                  Points
                </th>
                <th scope="col">Activated</th>
                <th scope="col">Valid until</th>
                <th scope="col">Card Issued</th>
                <th scope="col">Last Printed</th>
                <th scope="col" className={styles.numeric}>
                  Prints
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
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
                        <span className={styles.identityName} title={m.customerName}>
                          {m.customerName}
                        </span>
                      </span>
                    </td>
                    <td data-label="Number">
                      <span className={styles.numberRef}>{m.membershipNumber}</span>
                    </td>
                    <td data-label="Tier">
                      <TierBadge tier={tierCode || null} />
                    </td>
                    <td data-label="Category">{m.categoryName ?? '—'}</td>
                    <td data-label="Status">
                      <StatusChip label={humanizeCode(m.status)} tone={STATUS_TONE[m.status]} />
                    </td>
                    <td data-label="Points" className={`${styles.numeric} ${styles.points}`}>
                      {formatCountOrDash(m.pointsBalance)}
                    </td>
                    <td data-label="Activated">
                      <DateCell iso={m.activatedAt} />
                    </td>
                    <td data-label="Valid until">
                      <DateCell iso={m.expiresAt} />
                    </td>
                    <td data-label="Card Issued">
                      <DateCell iso={m.cardIssuedAt} />
                    </td>
                    <td data-label="Last Printed">
                      <DateCell iso={m.lastPrintedAt} />
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
                          {
                            label: 'Open customer record',
                            onClick: () => navigate(`/admin/customers/${m.customerId}`),
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
    return 'Check your connection and try again. If this continues, contact AFhomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open memberships right now. Contact an administrator.';
  return undefined;
}
