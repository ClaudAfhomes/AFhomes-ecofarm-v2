import { EmptyState, ErrorState, Icon, PageHeader, Skeleton } from '@jad/ui';

import { ButtonLink } from '@/components/ButtonLink';
import { orphanMessageFor } from '../../../lib/api/orphan';
import { useGroupNetwork } from '../hooks/useMember';
import styles from './GroupNetworkPage.module.css';

const numberFmt = new Intl.NumberFormat('en-PH');

/**
 * Group Network (SCR-MEM-017, FR-RPT-002). Reporting/network summary ONLY -
 * never implies or computes multi-level commission entitlement (BI-004,
 * BR-RPT-002). All counts are server-provided.
 */
export function GroupNetworkPage() {
  const networkQuery = useGroupNetwork();

  return (
    <section>
      <PageHeader
        title="Group Network"
        description="A reporting overview of your network."
        actions={
          <div className={styles.headerActions}>
            <ButtonLink to="/member/referrals/direct" variant="secondary">
              View Direct Referrals
            </ButtonLink>
            <ButtonLink to="/member/referrals/genealogy" variant="ghost">
              View Genealogy
            </ButtonLink>
            <ButtonLink to="/member/referrals/earned" variant="ghost">
              View Total Earned
            </ButtonLink>
          </div>
        }
      />
      <p className={styles.timeframe}>All time · Reporting only</p>
      {networkQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : networkQuery.isError ? (
        <ErrorState
          error={networkQuery.error}
          title="Could not load your group network"
          message={orphanMessageFor(networkQuery.error)}
          onRetry={() => void networkQuery.refetch()}
        />
      ) : networkQuery.data && networkQuery.data.totalMembers === 0 ? (
        <EmptyState
          title="No network members yet"
          description="When someone joins with your referral code, they appear here."
          action={
            <ButtonLink to="/member/referrals" variant="secondary">
              View your referral code
            </ButtonLink>
          }
        />
      ) : networkQuery.data ? (
        <dl className={styles.cards}>
          <div className={`${styles.card} ${styles.cardTotal}`}>
            <dt className={styles.cardLabel}>
              <Icon name="users" size={18} className={styles.cardIcon} />
              Total members
            </dt>
            <dd className={styles.cardValue}>{numberFmt.format(networkQuery.data.totalMembers)}</dd>
          </div>
          <div className={styles.card}>
            <dt className={styles.cardLabel}>
              <Icon name="user-plus" size={18} className={styles.cardIcon} />
              Direct referrals
            </dt>
            <dd className={styles.cardValue}>
              {numberFmt.format(networkQuery.data.directReferrals)}
            </dd>
          </div>
          <div className={styles.card}>
            <dt className={styles.cardLabel}>
              <Icon name="user-check" size={18} className={styles.cardIcon} />
              Qualified
            </dt>
            <dd className={styles.cardValue}>{numberFmt.format(networkQuery.data.qualified)}</dd>
          </div>
          <div className={styles.card}>
            <dt className={styles.cardLabel}>
              <Icon name="clock" size={18} className={styles.cardIcon} />
              Pending
            </dt>
            <dd className={styles.cardValue}>{numberFmt.format(networkQuery.data.pending)}</dd>
          </div>
          <div className={styles.card}>
            <dt className={styles.cardLabel}>
              <Icon name="user-x" size={18} className={styles.cardIcon} />
              Rejected
            </dt>
            <dd className={styles.cardValue}>{numberFmt.format(networkQuery.data.rejected)}</dd>
          </div>
        </dl>
      ) : null}{' '}
      {/* close the initial { at line 41 */}
      <p className={styles.note}>
        This is a network view only. It does not represent or compute multi-level commission
        entitlement (BR-RPT-002).
      </p>
    </section>
  );
}
