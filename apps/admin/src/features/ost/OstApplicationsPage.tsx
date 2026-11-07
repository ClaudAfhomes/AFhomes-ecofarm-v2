import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  OverflowMenu,
  PageHeader,
  Pagination,
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
import { formatCountOrDash } from '@afhomes/shared';

import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { getOstApplications } from './services';
import styles from './OstApplicationsPage.module.css';

const STATUSES = [
  '',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
];

const PAGE_SIZE = 10;

/** Query keys scoped to the OST application queue. */
const ostApplicationKeys = {
  scope: ['ost', 'applications'] as const,
  list: (status: string, search: string) => ['ost', 'applications', status, search] as const,
};

const statusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

const statusTone = (status: string): 'success' | 'danger' | 'warning' | 'neutral' =>
  status === 'approved'
    ? 'success'
    : status === 'rejected'
      ? 'danger'
      : status === 'under_review' || status === 'changes_requested'
        ? 'warning'
        : 'neutral';

/**
 * OST application queue. Sellers see only the applications they sponsor (the
 * server scopes the list); reviewers see every reviewable application.
 * Approving or rejecting happens on the detail screen, never from this list.
 */
export function OstApplicationsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const canCreate = user?.afHomesPermissions.some(
    (p) => p.moduleKey === 'network.ost_registrations' && p.canCreate,
  );
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const settled = useDebouncedValue(search.trim());
  const query = useQuery({
    queryKey: ostApplicationKeys.list(status, settled),
    queryFn: () => (settled ? getOstApplications(status, settled) : getOstApplications(status)),
    placeholderData: keepPreviousData,
    // Reviews happen on the detail screen and in other sessions.
    refetchInterval: 30_000,
  });
  const rows = query.data ?? [];
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [prevTotal, setPrevTotal] = useState(total);
  if (prevTotal !== total) {
    setPrevTotal(total);
    if (page > pageCount - 1) setPage(pageCount - 1);
  }
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const needsReview = rows.filter((app) =>
    ['submitted', 'under_review', 'changes_requested'].includes(app.status),
  ).length;
  const approved = rows.filter((app) => app.status === 'approved').length;

  // First load skeletonizes the whole page so no static content flashes before
  // the data it describes. Refetches keep the previous rows visible through
  // placeholderData and never reach this branch.
  if (query.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading applications"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 460 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 180 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading applications…</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="OST Applications"
        description="Registration applications under your Sales Manager referral. The sponsor is frozen at submission and cannot be changed here."
        actions={
          <>
            {canCreate ? (
              <Button onClick={() => navigate('/admin/ost/applications/new')}>Register OST</Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => navigate('/admin/ost/applications/import-export')}
            >
              Import / export OST
            </Button>
          </>
        }
      />

      <div className={styles.badges} aria-label="Application summary">
        <StatusChip
          label={`Listed applications: ${formatCountOrDash(total)}`}
          tone="neutral"
          icon="grid"
        />
        <StatusChip
          label={`Needs review: ${formatCountOrDash(needsReview)}`}
          tone="warning"
          icon="clock"
        />
        <StatusChip
          label={`Approved: ${formatCountOrDash(approved)}`}
          tone="success"
          icon="check"
        />
      </div>

      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search OST applications"
            placeholder="Applicant name or email"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            busy={query.isFetching}
          />
        }
        filters={
          <label className={styles.filterLabel}>
            Status
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              options={STATUSES.map((value) => ({
                value,
                label: value ? statusLabel(value) : 'All statuses',
              }))}
            />
          </label>
        }
      />

      {query.isError ? (
        <ErrorState
          error={query.error}
          title="OST applications could not be loaded"
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={settled ? 'No matching records.' : 'No OST applications'}
          description="New registrations submitted with your referral code appear here."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Applicant</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Sponsor</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((app) => (
                <TableRow key={app.id}>
                  <TableCell label="Applicant">{app.applicantName}</TableCell>
                  <TableCell label="Email">{app.email}</TableCell>
                  <TableCell label="Sponsor">{app.sponsorName}</TableCell>
                  <TableCell label="Submitted">{formatDateTime(app.submittedAt)}</TableCell>
                  <TableCell label="Status">
                    <StatusChip label={statusLabel(app.status)} tone={statusTone(app.status)} />
                  </TableCell>
                  <TableCell
                    label="Actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                    }}
                  >
                    <span className={styles.actionCell}>
                      <Link to={`/admin/ost/applications/${app.id}`}>Review</Link>
                      <OverflowMenu
                        label={`More actions for ${app.applicantName}`}
                        items={[
                          {
                            label: 'Open review',
                            icon: 'chevron-right',
                            onClick: () => navigate(`/admin/ost/applications/${app.id}`),
                          },
                        ]}
                      />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {query.isFetching && !query.isPending ? (
        <Alert variant="info" title="Refreshing">
          Updating the queue with the latest reviews.
        </Alert>
      ) : null}

      {total > 0 ? (
        <div className={styles.pagination}>
          <Pagination
            page={safePage + 1}
            pageCount={pageCount}
            onChange={(next) => setPage(next - 1)}
            label="OST applications pagination"
          />
        </div>
      ) : null}
    </section>
  );
}
