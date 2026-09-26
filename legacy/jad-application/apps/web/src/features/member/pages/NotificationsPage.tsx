import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@jad/ui';
import type { Notification } from '@jad/contracts';

import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/ButtonLink';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { useSession } from '../../../lib/session';
import { useBroadcasts } from '../hooks/useMember';
import { markAllNotificationsRead, markNotificationRead } from '../services/member';
import { formatDate } from '../lib/presentation';
import styles from './NotificationsPage.module.css';

type ReadFilter = 'ALL' | 'READ' | 'UNREAD';

const READ_FILTERS: { value: ReadFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'UNREAD', label: 'Unread' },
  { value: 'READ', label: 'Read' },
];

/**
 * Notifications (SCR-MEM-024, FR-ADM-005). The member's broadcast/announcement
 * feed (own + broadcast rows). Read state is a per-member server receipt:
 * opening the Viewer marks the item read, with explicit per-item and
 * mark-all actions. Broadcast rows are shared - receipts never touch them.
 */
export function NotificationsPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const broadcastsQuery = useBroadcasts();
  const [filter, setFilter] = useState<ReadFilter>('ALL');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | undefined>();

  const broadcastsKey = ['member', 'broadcasts', user?.id];

  /**
   * Optimistic read receipts: the chip/count/badge flip instantly from the
   * cache; the server round-trip confirms underneath. On error the previous
   * cache is restored and the inline Alert explains (no ToastProvider on web).
   */
  type BroadcastsCache = Notification[];
  const setReadOptimistic = (ids: Set<string> | 'all', readAt: string) => {
    queryClient.setQueryData<BroadcastsCache>(broadcastsKey, (previous) => {
      if (!previous) return previous;
      const markAll = ids === 'all';
      return previous.map((item) =>
        markAll || (ids as Set<string>).has(item.id)
          ? item.readAt
            ? item
            : { ...item, readAt }
          : item,
      );
    });
  };

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (notificationId: string) => {
      setMutationError(undefined);
      await queryClient.cancelQueries({ queryKey: broadcastsKey });
      const previous = queryClient.getQueryData<BroadcastsCache>(broadcastsKey);
      setReadOptimistic(new Set([notificationId]), new Date().toISOString());
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(broadcastsKey, context.previous);
      setMutationError(apiErrorMessage(error, 'We could not mark this notification read.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: broadcastsKey });
    },
  });
  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      setMutationError(undefined);
      await queryClient.cancelQueries({ queryKey: broadcastsKey });
      const previous = queryClient.getQueryData<BroadcastsCache>(broadcastsKey);
      setReadOptimistic('all', new Date().toISOString());
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(broadcastsKey, context.previous);
      setMutationError(apiErrorMessage(error, 'We could not mark all notifications read.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: broadcastsKey });
    },
  });

  const markRead = (notificationId: string) => {
    markReadMutation.mutate(notificationId);
  };

  const openViewer = (notification: Notification) => {
    setViewerId(notification.id);
    if (!notification.readAt) {
      markRead(notification.id);
    }
  };

  const markAll = () => {
    markAllMutation.mutate(undefined);
  };

  const items = broadcastsQuery.data ?? [];
  const viewer = viewerId ? (items.find((n) => n.id === viewerId) ?? null) : null;
  const unreadCount = items.filter((n) => !n.readAt).length;
  const filtered = useMemo(() => {
    if (filter === 'ALL') return items;
    if (filter === 'READ') return items.filter((n) => Boolean(n.readAt));
    return items.filter((n) => !n.readAt);
  }, [items, filter]);

  const total = items.length;
  const visible = filtered.length;

  return (
    <section>
      <PageHeader
        title="Notifications"
        description="Updates and announcements from JA&D - latest first."
        actions={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              disabled={unreadCount === 0 || markAllMutation.isPending}
              onClick={markAll}
            >
              {markAllMutation.isPending ? 'Marking…' : 'Mark all as read'}
            </Button>
            <ButtonLink to="/member/marketing-tools" variant="secondary">
              View Marketing Tools
            </ButtonLink>
          </div>
        }
      />

      <p className={styles.timeframe}>Latest first · Announcements</p>

      {mutationError ? (
        <Alert variant="danger" title="Something went wrong">
          {mutationError}
        </Alert>
      ) : null}

      <div className={styles.filters} role="group" aria-label="Filter by read state">
        {READ_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? styles.filterActive : styles.filter}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className={styles.count} aria-live="polite">
        {broadcastsQuery.isLoading
          ? 'Loading notifications…'
          : `Showing ${visible} of ${total} ${total === 1 ? 'notification' : 'notifications'}${filter !== 'ALL' ? ` · ${filter === 'READ' ? 'Read' : 'Unread'}` : ''}`}
      </p>

      {broadcastsQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : broadcastsQuery.isError ? (
        <ErrorState
          error={broadcastsQuery.error}
          title="Could not load notifications"
          onRetry={() => void broadcastsQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="No notifications" description="Updates from JA&D will appear here." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`No ${filter === 'READ' ? 'read' : 'unread'} notifications match this filter.`}
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('ALL')}>
              Clear filter
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filtered.map((notification) => {
            const isUnread = !notification.readAt;
            return (
              <li
                key={notification.id}
                className={`${styles.card} ${isUnread ? styles.cardUnread : ''}`}
              >
                <span className={styles.iconWrap} aria-hidden="true">
                  <Icon name="bell" size={18} className={styles.icon} />
                </span>
                <div className={styles.cardMain}>
                  <button
                    type="button"
                    className={`${styles.titleButton} ${isUnread ? styles.titleUnread : ''}`}
                    onClick={() => openViewer(notification)}
                    aria-label={`View notification: ${notification.title}`}
                  >
                    {notification.title}
                  </button>
                  {notification.body ? (
                    <span className={styles.body}>{notification.body}</span>
                  ) : null}
                  <span className={styles.meta}>{formatDate(notification.createdAt)}</span>
                </div>
                <div className={styles.cardActions}>
                  <StatusChip
                    label={isUnread ? 'Unread' : 'Read'}
                    tone={isUnread ? 'info' : 'neutral'}
                  />
                  {isUnread ? (
                    <button
                      type="button"
                      className={styles.viewButton}
                      disabled={markReadMutation.isPending}
                      onClick={() => markRead(notification.id)}
                      aria-label={`Mark as read: ${notification.title}`}
                    >
                      Mark as read
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={Boolean(viewer)}
        onClose={() => setViewerId(null)}
        title={viewer ? `Notification: ${viewer.title}` : 'Notification'}
        footer={
          <Button variant="secondary" onClick={() => setViewerId(null)}>
            Close
          </Button>
        }
      >
        {viewer ? (
          <div className={styles.viewerBody}>
            <p className={styles.viewerTitle}>{viewer.title}</p>
            {viewer.body ? <p className={styles.viewerText}>{viewer.body}</p> : null}
            <p className={styles.viewerMeta}>Published {formatDate(viewer.createdAt)}</p>
            <StatusChip
              label={viewer.readAt ? 'Read' : 'Unread'}
              tone={viewer.readAt ? 'neutral' : 'info'}
            />
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
