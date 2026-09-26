import { useMemo, useState } from 'react';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jad/ui';
import type { Notification } from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { BroadcastFormDialog } from '../components/BroadcastFormDialog';
import { useAdminBroadcasts } from '../hooks/useAdminBroadcasts';
import styles from './BroadcastsPage.module.css';

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Title</TableHeaderCell>
          <TableHeaderCell>Message</TableHeaderCell>
          <TableHeaderCell>Sent</TableHeaderCell>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Admin Broadcasts - announcement feed composer (SCR-ADM-016, FEAT-063, FR-ADM-005). */
export function BroadcastsPage() {
  const { data, isPending, isError, error, refetch } = useAdminBroadcasts();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Notification | null>(null);

  const allItems = useMemo(() => [...(data ?? [])], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (b) => b.title.toLowerCase().includes(q) || (b.body ?? '').toLowerCase().includes(q),
    );
  }, [allItems, search]);

  const total = filtered.length;

  return (
    <section>
      <PageHeader
        title="Broadcasts"
        description="Announcements published to every member's notification feed"
        actions={<Button onClick={() => setShowCreate(true)}>New Broadcast</Button>}
      />

      <div className={styles.filters} role="search" aria-label="Search broadcasts">
        <label className={styles.searchWrap} aria-label="Search broadcasts">
          <input
            type="search"
            placeholder="Search broadcasts"
            aria-label="Search broadcasts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </label>
      </div>

      <p className={styles.count} aria-live="polite">
        {isPending
          ? 'Loading broadcasts…'
          : `Showing ${total} of ${allItems.length} ${allItems.length === 1 ? 'broadcast' : 'broadcasts'}`}
      </p>

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : allItems.length === 0 ? (
        <EmptyState
          title="No broadcasts"
          description="No announcements have been sent yet. Compose the first one."
        />
      ) : total === 0 ? (
        <EmptyState
          title="No matches"
          description="No broadcasts match your search."
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setSearch('')}>
              Clear search
            </button>
          }
        />
      ) : (
        <div className="table-scroll">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell>Message</TableHeaderCell>
                <TableHeaderCell>Sent</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((broadcast) => (
                <TableRow key={broadcast.id}>
                  <TableCell>
                    <button
                      type="button"
                      className={styles.titleButton}
                      onClick={() => setDetail(broadcast)}
                      aria-label={`View broadcast: ${broadcast.title}`}
                    >
                      {broadcast.title}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className={styles.messageCell} title={broadcast.body ?? undefined}>
                      {broadcast.body ?? '-'}
                    </span>
                  </TableCell>
                  <TableCell>{formatDate(broadcast.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <BroadcastFormDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Broadcast: ${detail.title}` : 'Broadcast'}
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <div className={styles.detailBody}>
            <p className={styles.detailTitle}>{detail.title}</p>
            {detail.body ? <p className={styles.detailText}>{detail.body}</p> : null}
            <p className={styles.detailMeta}>Sent {formatDate(detail.createdAt)}</p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
