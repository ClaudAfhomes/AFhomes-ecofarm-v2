import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  Alert,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  OverflowMenu,
  PageHeader,
  Pagination,
  SearchField,
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
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { getOstMembers } from './services';
import styles from './OstMembersPage.module.css';

const PAGE_SIZE = 10;

/** Query keys scoped to the OST member directory. */
const ostMemberKeys = {
  scope: ['ost', 'members'] as const,
  list: (search: string) => ['ost', 'members', search] as const,
};

const statusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

/**
 * OST members. Each row links into the genealogy screen, where the SM -> OST
 * edge is visible under the same authorization as the rest of the network.
 */
export function OstMembersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const settled = useDebouncedValue(search.trim(), 300, () => setPage(0));
  const query = useQuery({
    queryKey: ostMemberKeys.list(settled),
    queryFn: () => getOstMembers(settled),
    placeholderData: keepPreviousData,
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
  const rangeFrom = total === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeTo = Math.min(total, (safePage + 1) * PAGE_SIZE);
  const active = rows.filter((member) => member.status === 'active').length;

  // First load skeletonizes the whole page so no static content flashes before
  // the data it describes. Refetches keep the previous rows visible through
  // placeholderData and never reach this branch.
  if (query.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading members"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 260 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <Skeleton style={{ height: 40, maxWidth: 420 }} />
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading members…</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="OST Members"
        description="Approved OST sellers and the Sales Manager each one serves under."
      />

      <div className={styles.metrics} aria-label="Member summary">
        <MetricCard
          label="Listed members"
          value={formatCountOrDash(total)}
          description={settled ? 'Matching the current search.' : 'Approved OST sellers.'}
          icon="grid"
        />
        <MetricCard
          label="Active members"
          value={formatCountOrDash(active)}
          description="Members with an active status in this list."
          icon="check"
          chip={{ label: 'Active', tone: 'success' }}
        />
      </div>

      <FilterBar
        search={
          <SearchField
            label="Search OST members"
            placeholder="Name, OST number, or email"
            value={search}
            onChange={setSearch}
            busy={query.isFetching}
          />
        }
      />

      {query.isError ? (
        <ErrorState
          error={query.error}
          title="OST members could not be loaded"
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={settled ? 'No matching records.' : 'No OST members'}
          description="Approved applications create a member row here."
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
                <TableHeaderCell>OST number</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Sponsor</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Approved</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((member) => (
                <TableRow key={member.id}>
                  <TableCell label="OST number">
                    <span className={styles.memberRef}>{member.ostNumber}</span>
                  </TableCell>
                  <TableCell label="Name">{member.fullName}</TableCell>
                  <TableCell label="Email">{member.email}</TableCell>
                  <TableCell label="Sponsor">{member.sponsorName}</TableCell>
                  <TableCell label="Status">
                    <StatusChip
                      label={statusLabel(member.status)}
                      tone={member.status === 'active' ? 'success' : 'neutral'}
                    />
                  </TableCell>
                  <TableCell label="Approved">{formatDateTime(member.approvedAt)}</TableCell>
                  <TableCell
                    label="Actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                    }}
                  >
                    <span className={styles.actionCell}>
                      <Link to={`/admin/genealogy/${member.id}`}>Genealogy</Link>
                      {' · '}
                      <Link to={`/admin/ost/members/${member.id}`}>Validity / renewal</Link>
                      <OverflowMenu
                        label={`More actions for ${member.fullName}`}
                        items={[
                          {
                            label: 'Open genealogy',
                            icon: 'chevron-right',
                            onClick: () => navigate(`/admin/genealogy/${member.id}`),
                          },
                          {
                            label: 'Open validity and renewal',
                            icon: 'clock',
                            onClick: () => navigate(`/admin/ost/members/${member.id}`),
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
          Updating the member directory with the latest approvals.
        </Alert>
      ) : null}

      {total > 0 ? (
        <div className={styles.pagination}>
          <Pagination
            page={safePage + 1}
            pageCount={pageCount}
            onChange={(next) => setPage(next - 1)}
            label="OST members pagination"
          />
          <span role="status" aria-label="Member record range" className={styles.range}>
            Showing {rangeFrom} to {rangeTo} of {total}
          </span>
        </div>
      ) : null}
    </section>
  );
}
