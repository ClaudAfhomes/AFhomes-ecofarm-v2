import { useQuery } from '@tanstack/react-query';

import { formatDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { getAnnouncementFeed } from './services';
import local from './Engagement.module.css';

/**
 * Compact notices for staff on the dashboard (published staff/everyone
 * announcements, pinned first). Renders nothing while empty, loading or on
 * error: a notice board must never get in the way of the dashboard.
 */
export function AnnouncementsFeedCard() {
  const { user } = useSession();
  const feed = useQuery({
    queryKey: ['announcements', 'feed'],
    queryFn: getAnnouncementFeed,
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const items = [...(feed.data ?? [])].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || b.publishedAt.localeCompare(a.publishedAt),
  );
  if (items.length === 0) return null;
  return (
    <section className={local.feedCard} aria-label="Announcements">
      <h2 className={local.feedTitle}>Announcements</h2>
      <ul className={local.feedList}>
        {items.map((item) => (
          <li key={item.id}>
            <h3>
              {item.pinned ? 'Pinned: ' : ''}
              {item.title}
            </h3>
            <p>{item.body}</p>
            <small>{formatDate(item.publishedAt)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
