import { Skeleton } from './Skeleton.js';
import styles from './PageSkeleton.module.css';

export interface PageSkeletonProps {
  /** Accessible name announced while the page loads. */
  label?: string;
  /** Placeholder list rows. */
  rows?: number;
}

/**
 * Route-level loading state shaped like a list page (title, toolbar, rows)
 * with a thin indeterminate bar on top, so the layout does not jump when the
 * real page arrives.
 */
export function PageSkeleton({ label = 'Loading page', rows = 5 }: PageSkeletonProps) {
  return (
    <div className={styles.page} role="status" aria-label={label}>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.barFill} />
      </div>
      <div className={styles.header} aria-hidden="true">
        <Skeleton className={styles.title} />
        <Skeleton className={styles.subtitle} />
      </div>
      <div className={styles.toolbar} aria-hidden="true">
        <Skeleton className={styles.search} />
        <Skeleton className={styles.filter} />
        <Skeleton className={styles.filter} />
      </div>
      <div className={styles.list} aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={styles.row}>
            <Skeleton className={styles.avatar} />
            <Skeleton className={styles.lineWide} />
            <Skeleton className={styles.lineNarrow} />
          </div>
        ))}
      </div>
    </div>
  );
}
