import { Link, useLocation } from 'react-router';

import { Icon } from '@jad/ui';

import { useMessagesSummary } from '../hooks/useMember';
import styles from './MessageFab.module.css';

const UNREAD_DISPLAY_CAP = 99;

/**
 * Floating message button (member panel). Replaces the sidebar "Messages"
 * navlink with a persistent, thumb-reachable entry point that carries the
 * unread badge. Hidden on the Messages page itself (the thread owns the
 * viewport there) and lifted above the mobile bottom nav.
 */
export function MessageFab() {
  const location = useLocation();
  const summary = useMessagesSummary();
  const unread = summary.data?.unreadCount ?? 0;
  const unreadLabel = unread > UNREAD_DISPLAY_CAP ? `${UNREAD_DISPLAY_CAP}+` : String(unread);

  if (location.pathname.startsWith('/member/messages')) return null;

  return (
    <Link
      to="/member/messages"
      className={styles.fab}
      aria-label={`Messages${unread > 0 ? `, ${unreadLabel} unread` : ''}`}
    >
      <Icon name="message" size={22} />
      {unread > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {unreadLabel}
        </span>
      ) : null}
    </Link>
  );
}
