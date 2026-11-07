import { Skeleton } from '@afhomes/ui';

import styles from './CommissionSettingsPage.module.css';

/** Placeholder rows that mirror the seller and rule tables while they load. */
export function CommissionTableSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div className={styles.skeletonRows} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={styles.skelRow} />
      ))}
    </div>
  );
}

/** First paint: header, summary chips, tab strip and a table. */
export function CommissionPageSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading commission settings">
      <div className={styles.skeletonHead}>
        <Skeleton className={styles.skelTitle} />
        <Skeleton className={styles.skelLine} />
      </div>
      <ul className={styles.badges} aria-hidden="true">
        {[0, 1].map((index) => (
          <li key={index}>
            <Skeleton className={styles.skelChip} />
          </li>
        ))}
      </ul>
      <Skeleton className={styles.skelTabs} />
      <div className={styles.skeletonRows}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className={styles.skelRow} />
        ))}
      </div>
    </div>
  );
}
