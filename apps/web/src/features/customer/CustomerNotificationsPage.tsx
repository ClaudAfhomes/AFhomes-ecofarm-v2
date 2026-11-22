import { useNavigate } from 'react-router';
import { Button, EmptyState, ErrorState, Icon, PageHeader } from '@afhomes/ui';
import type { CustomerNotification } from '@afhomes/contracts';

import { useMarkNotificationsRead, useNotificationsQuery } from './engagement';
import { ActivityListSkeleton, ui } from './portal-ui';
import styles from './engagement.module.css';

export const formatDateTime = (value: string): string =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

/** Notices for the signed-in member. Opening one marks it read, then follows its link. */
export function CustomerNotificationsPage() {
  const query = useNotificationsQuery();
  const mark = useMarkNotificationsRead();
  const navigate = useNavigate();

  if (query.isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Notifications" />
        <p role="status" className="sr-only">
          Loading your notifications…
        </p>
        <div className={`${ui.surface} ${styles.panel}`} aria-hidden="true">
          <ActivityListSkeleton rows={4} />
        </div>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className={styles.page}>
        <PageHeader title="Notifications" />
        <ErrorState
          title="Notifications unavailable"
          message="We could not load your notifications. Please try again in a moment."
        />
      </div>
    );
  }

  const { data: notices, meta } = query.data;

  const open = (notice: CustomerNotification) => {
    if (!notice.readAt) mark.mutate({ ids: [notice.id] });
    if (notice.link) void navigate(notice.link);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notifications"
        description={
          meta.unreadCount > 0
            ? `${meta.unreadCount} unread. Updates from AF Homes appear here.`
            : 'You are all caught up. Updates from AF Homes appear here.'
        }
        actions={
          <Button
            variant="secondary"
            className={styles.tap}
            disabled={meta.unreadCount === 0 || mark.isPending}
            onClick={() => mark.mutate({ all: true })}
            title={meta.unreadCount === 0 ? 'Nothing unread' : undefined}
          >
            Mark all as read
          </Button>
        }
      />

      {mark.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          <span>We could not update your notifications. Please try again.</span>
        </p>
      )}

      {notices.length === 0 ? (
        <div className={`${ui.surface} ${styles.panel}`}>
          <EmptyState
            title="No notifications"
            description="Updates from AF Homes appear here, inside the portal, when there is something to tell you."
          />
        </div>
      ) : (
        <ul className={`${ui.surface} ${styles.rows}`} aria-label="Notifications">
          {notices.map((notice) => {
            const unread = !notice.readAt;
            const tagId = `notice-${notice.id}-state`;
            return (
              <li
                key={notice.id}
                className={`${styles.rowItem} ${unread ? styles.rowItemUnread : ''}`}
              >
                <span className={styles.dotSlot} aria-hidden="true">
                  {unread ? <span className={styles.unreadDot} /> : null}
                </span>
                <div className={styles.rowMain}>
                  <div className={styles.rowHead}>
                    <button
                      type="button"
                      className={`${styles.rowButton} ${unread ? styles.rowButtonUnread : ''}`}
                      aria-describedby={unread ? tagId : undefined}
                      onClick={() => open(notice)}
                    >
                      {notice.title}
                    </button>
                    <time className={styles.rowTime} dateTime={notice.createdAt}>
                      {formatDateTime(notice.createdAt)}
                    </time>
                  </div>
                  {unread ? (
                    <span id={tagId} className={styles.unreadTag}>
                      Unread
                    </span>
                  ) : null}
                  <p className={styles.body}>{notice.body}</p>
                </div>
                {notice.link ? (
                  <span className={styles.chev} aria-hidden="true">
                    <Icon name="chevron-right" size={18} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
