import { useNavigate } from 'react-router';
import { Button, EmptyState, ErrorState } from '@afhomes/ui';
import type { CustomerNotification } from '@afhomes/contracts';

import { useMarkNotificationsRead, useNotificationsQuery } from './engagement';
import { Card } from './portal-ui';
import styles from './engagement.module.css';

export const formatDateTime = (value: string): string =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

/** Notices for the signed-in member. Opening one marks it read, then follows its link. */
export function CustomerNotificationsPage() {
  const query = useNotificationsQuery();
  const mark = useMarkNotificationsRead();
  const navigate = useNavigate();

  if (query.isLoading) return <p role="status">Loading your notifications…</p>;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="Notifications unavailable"
        message="We could not load your notifications. Please try again in a moment."
      />
    );
  }

  const { data: notices, meta } = query.data;

  const open = (notice: CustomerNotification) => {
    if (!notice.readAt) mark.mutate({ ids: [notice.id] });
    if (notice.link) void navigate(notice.link);
  };

  return (
    <Card
      title="Notifications"
      actions={
        <Button
          variant="secondary"
          disabled={meta.unreadCount === 0 || mark.isPending}
          onClick={() => mark.mutate({ all: true })}
          title={meta.unreadCount === 0 ? 'Nothing unread' : undefined}
        >
          Mark all as read
        </Button>
      }
    >
      {notices.length === 0 ? (
        <EmptyState title="No notifications" description="Updates from AF Homes appear here." />
      ) : (
        <ul className={styles.list}>
          {notices.map((notice) => (
            <li
              key={notice.id}
              className={`${styles.item} ${notice.readAt ? '' : styles.itemUnread}`}
            >
              <div className={styles.itemHead}>
                <button type="button" className={styles.linkButton} onClick={() => open(notice)}>
                  <strong>{notice.title}</strong>
                  {notice.readAt ? null : <span className={styles.meta}> (unread)</span>}
                </button>
                <span className={styles.meta}>{formatDateTime(notice.createdAt)}</span>
              </div>
              <p className={styles.body}>{notice.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
