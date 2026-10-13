import { Icon, Spinner } from '@afhomes/ui';

import styles from './AfHomesDashboardPage.module.css';

/**
 * Loading placeholder for the sales-trend chart. Lives apart from
 * `AfHomesTrendChart` on purpose: the chart pulls in the charting library,
 * which loads on demand, while this skeleton must render immediately as the
 * Suspense fallback and the pending state.
 */
export function TrendChartSkeleton() {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHero} aria-hidden="true">
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name="list" size={18} />
        </span>
        <div className={styles.chartTitleWrap}>
          <span className={styles.skeletonLine} style={{ width: '9rem' }} />
          <span className={styles.skeletonLineShort} style={{ width: '14rem' }} />
        </div>
      </div>
      <div className={styles.kpis} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className={styles.kpi}>
            <span className={styles.skeletonLine} style={{ width: '70%' }} />
            <span className={styles.skeletonLineShort} style={{ width: '50%' }} />
          </div>
        ))}
      </div>
      <div className={styles.chartBox}>
        <div className={styles.chartState} role="status" aria-live="polite" aria-busy="true">
          <Spinner size="sm" /> Loading trend…
        </div>
      </div>
    </div>
  );
}
