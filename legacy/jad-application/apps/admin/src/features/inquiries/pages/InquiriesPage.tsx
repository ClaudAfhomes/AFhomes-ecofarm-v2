import { useMemo, useState } from 'react';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  notifyError,
  notifySuccess,
} from '@jad/ui';
import type { StatusTone } from '@jad/ui';
import type { ContactInquiry, ContactInquiryStatus } from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { useInquiries } from '../hooks/useInquiries';
import { useUpdateInquiry } from '../hooks/useUpdateInquiry';
import styles from './InquiriesPage.module.css';

const PAGE_SIZE = 10;

const STATUS_FILTERS: { value: ContactInquiryStatus | 'All'; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'READ', label: 'Read' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const STATUS_TONE: Record<ContactInquiryStatus, StatusTone> = {
  NEW: 'info',
  READ: 'neutral',
  ARCHIVED: 'success',
};

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Name</TableHeaderCell>
          <TableHeaderCell>Email</TableHeaderCell>
          <TableHeaderCell>Message</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Received</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 5 }, (_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Admin Inquiries - triage queue for the public Contact page form. */
export function InquiriesPage() {
  const { data, isPending, isError, error, refetch } = useInquiries();
  const updateInquiry = useUpdateInquiry();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContactInquiryStatus | 'All'>('All');
  const [viewTarget, setViewTarget] = useState<ContactInquiry | null>(null);

  const allItems = useMemo(() => [...(data ?? [])], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter(
      (item) =>
        (statusFilter === 'All' || item.status === statusFilter) &&
        (!q ||
          item.name.toLowerCase().includes(q) ||
          item.email.toLowerCase().includes(q) ||
          item.message.toLowerCase().includes(q)),
    );
  }, [allItems, search, statusFilter]);

  const newCount = allItems.filter((item) => item.status === 'NEW').length;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPage(1);
  };

  const handleStatusChange = async (item: ContactInquiry, status: ContactInquiryStatus) => {
    try {
      await updateInquiry.mutateAsync({ id: item.id, status });
      notifySuccess({
        title: status === 'ARCHIVED' ? 'Inquiry archived' : 'Inquiry marked as read',
        message: `Message from ${item.name} updated.`,
      });
      if (viewTarget?.id === item.id) setViewTarget({ ...item, status });
    } catch (e) {
      notifyError({ title: 'Update failed', message: (e as Error).message });
    }
  };

  return (
    <section>
      <PageHeader
        title="Inquiries"
        description={
          newCount > 0
            ? `${newCount} new ${newCount === 1 ? 'message' : 'messages'} from the public Contact page.`
            : 'Messages sent through the public Contact page.'
        }
      />

      <div className={styles.filters} role="search" aria-label="Search inquiries">
        <label className={styles.searchWrap} aria-label="Search inquiries">
          <input
            type="search"
            placeholder="Search name, email, or message"
            aria-label="Search inquiries"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={styles.searchInput}
          />
        </label>
        <div className={styles.statusFilters} role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={statusFilter === option.value ? styles.filterActive : styles.filter}
              aria-pressed={statusFilter === option.value}
              onClick={() => {
                setStatusFilter(option.value);
                setPage(1);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.count} aria-live="polite">
        {isPending
          ? 'Loading inquiries…'
          : `Showing ${rows.length} of ${total} ${total === 1 ? 'inquiry' : 'inquiries'}`}
      </p>

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : allItems.length === 0 ? (
        <EmptyState
          title="No inquiries"
          description="No one has used the public Contact form yet. New messages will appear here."
        />
      ) : total === 0 ? (
        <EmptyState
          title="No matches"
          description="No inquiries match your search or filter."
          action={
            <button type="button" className={styles.inlineLink} onClick={resetFilters}>
              Clear search and filters
            </button>
          }
        />
      ) : (
        <>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Message</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Received</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell label="Name">{row.name}</TableCell>
                    <TableCell label="Email">
                      <a href={`mailto:${row.email}`} onClick={(e) => e.stopPropagation()}>
                        {row.email}
                      </a>
                    </TableCell>
                    <TableCell label="Message">
                      <span className={styles.messagePreview}>{row.message}</span>
                    </TableCell>
                    <TableCell label="Status">
                      <StatusChip label={row.status} tone={STATUS_TONE[row.status]} />
                    </TableCell>
                    <TableCell label="Received">
                      <span className={styles.meta}>{formatDate(row.createdAt)}</span>
                    </TableCell>
                    <TableCell label="Actions">
                      <div className={styles.actions}>
                        <Button variant="secondary" onClick={() => setViewTarget(row)}>
                          View
                        </Button>
                        {row.status === 'NEW' ? (
                          <Button
                            variant="secondary"
                            onClick={() => void handleStatusChange(row, 'READ')}
                            disabled={updateInquiry.isPending}
                          >
                            Mark read
                          </Button>
                        ) : null}
                        {row.status !== 'ARCHIVED' ? (
                          <Button
                            variant="secondary"
                            onClick={() => void handleStatusChange(row, 'ARCHIVED')}
                            disabled={updateInquiry.isPending}
                          >
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className={styles.tableFooter}>
            <span className={styles.captionText} role="status" aria-live="polite">
              {total} {total === 1 ? 'inquiry' : 'inquiries'} · page {page} of {pageCount}
            </span>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        </>
      )}

      <Dialog
        open={viewTarget !== null}
        onClose={() => setViewTarget(null)}
        title={viewTarget ? `Message from ${viewTarget.name}` : ''}
        footer={
          <>
            {viewTarget?.status === 'NEW' ? (
              <Button
                variant="secondary"
                onClick={() => viewTarget && void handleStatusChange(viewTarget, 'READ')}
              >
                Mark read
              </Button>
            ) : null}
            {viewTarget && viewTarget.status !== 'ARCHIVED' ? (
              <Button
                variant="secondary"
                onClick={() => viewTarget && void handleStatusChange(viewTarget, 'ARCHIVED')}
              >
                Archive
              </Button>
            ) : null}
            <Button onClick={() => setViewTarget(null)}>Close</Button>
          </>
        }
      >
        {viewTarget ? (
          <dl className={styles.detailList}>
            <div>
              <dt>Name</dt>
              <dd>{viewTarget.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${viewTarget.email}`}>{viewTarget.email}</a>
              </dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{formatDate(viewTarget.createdAt)}</dd>
            </div>
            <div>
              <dt>Message</dt>
              <dd className={styles.detailMessage}>{viewTarget.message}</dd>
            </div>
          </dl>
        ) : null}
      </Dialog>
    </section>
  );
}
