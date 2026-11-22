import { useAnnouncementsQuery } from './engagement';
import { Card } from './portal-ui';
import styles from './engagement.module.css';

/** Compact announcement feed (server returns pinned first). Renders nothing when empty. */
export function DashboardAnnouncements() {
  const query = useAnnouncementsQuery();
  const items = query.data ?? [];
  if (items.length === 0) return null;
  return (
    <Card title="Announcements">
      <ul className={styles.list}>
        {items.map((a) => (
          <li key={a.id} className={styles.item}>
            <p className={styles.itemTitle}>
              {a.pinned ? 'Pinned: ' : ''}
              {a.title}
            </p>
            <p className={styles.body}>{a.body}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
