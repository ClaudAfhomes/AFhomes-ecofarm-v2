import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Icon, IconButton, Skeleton, useDialogShell } from '@jad/ui';

import { useSession } from '../../../lib/session';
import { useBroadcasts } from '../hooks/useMember';
import { markAllNotificationsRead } from '../services/member';
import { formatDate } from '../lib/presentation';
import styles from './NotificationBell.module.css';

const NOTIFICATION_LIMIT = 5;
const UNREAD_DISPLAY_CAP = 99;

/**
 * Bell icon button in the topbar that toggles a notification dropdown.
 * Shows the 5 most recent notifications with unread indicator and a
 * "View all" link to the full notifications page.
 */
export function NotificationBell() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const query = useBroadcasts();

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useDialogShell({ open, onClose: () => setOpen(false), panelRef, lockScroll: false });

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const all = query.data ?? [];
  const notifications = all.slice(0, NOTIFICATION_LIMIT);
  // Unread count spans the FULL feed - the 5-item slice is display-only.
  const unreadCount = all.filter((n) => !n.readAt).length;
  const unreadLabel =
    unreadCount > UNREAD_DISPLAY_CAP ? `${UNREAD_DISPLAY_CAP}+` : String(unreadCount);

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', 'broadcasts', user?.id] });
    },
  });

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        type="button"
        className={styles.bellButton}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadLabel} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <Icon name="bell" size={20} />
      </button>
      {unreadCount > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          <span className={styles.badgeCount}>{unreadLabel}</span>
        </span>
      ) : null}
      {open ? (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            tabIndex={-1}
          >
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>Notifications</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    className={styles.markAllButton}
                    disabled={markAllMutation.isPending}
                    onClick={() => markAllMutation.mutate()}
                  >
                    {markAllMutation.isPending ? 'Marking…' : 'Mark all read'}
                  </button>
                ) : null}
                <Link
                  className={styles.viewAll}
                  to="/member/notifications"
                  onClick={() => setOpen(false)}
                >
                  View all
                </Link>
                <IconButton
                  icon="close"
                  label="Close notifications"
                  onClick={() => setOpen(false)}
                  size={16}
                />
              </div>
            </div>
            <div className={styles.panelBody}>
              {query.isLoading ? (
                <div className={styles.loading}>
                  <Skeleton />
                  <Skeleton />
                  <Skeleton />
                </div>
              ) : query.isError ? (
                <div className={styles.errorWrap}>
                  <p className={styles.errorText}>Could not load notifications.</p>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => void query.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <p className={styles.empty}>No notifications yet.</p>
              ) : (
                <ul className={styles.list}>
                  {notifications.map((notification) => {
                    const isUnread = !notification.readAt;
                    return (
                      <li key={notification.id} className={styles.listItem}>
                        <Link
                          className={styles.itemLink}
                          to="/member/notifications"
                          onClick={() => setOpen(false)}
                          aria-label={`${notification.title}${isUnread ? ' (unread)' : ''}`}
                        >
                          <span
                            className={`${styles.listTitle} ${isUnread ? styles.listTitleUnread : ''}`}
                          >
                            {isUnread ? (
                              <span className={styles.unreadDot} aria-hidden="true" />
                            ) : null}
                            {notification.title}
                          </span>
                          {notification.body ? (
                            <span className={styles.listMeta}>{notification.body}</span>
                          ) : null}
                          <span className={styles.listDate}>
                            {formatDate(notification.createdAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
