import { useAnnouncementsQuery } from './engagement';
import { PortalSection, ui } from './portal-ui';
import styles from './dashboard.module.css';

/** Compact announcement feed (server returns pinned first). Renders nothing when empty. */
export function DashboardAnnouncements() {
  const query = useAnnouncementsQuery();
  const items = query.data ?? [];
  if (items.length === 0) return null;
  return (
    <PortalSection title="Announcements">
      <ul className={`${ui.surface} ${styles.panelPad} ${styles.news}`}>
        {items.map((a) => (
          <li key={a.id} className={styles.newsItem}>
            <div className={styles.newsHead}>
              {a.pinned ? <span className={styles.pinned}>Pinned</span> : null}
              <p className={styles.newsTitle}>{a.title}</p>
            </div>
            <p className={styles.newsBody}>{a.body}</p>
          </li>
        ))}
      </ul>
    </PortalSection>
  );
}
