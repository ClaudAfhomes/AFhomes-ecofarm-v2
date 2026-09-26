import { Link } from 'react-router';

import { ErrorState, Icon, PageHeader, Skeleton } from '@jad/ui';
import { formatMoney } from '@jad/shared';

import { ButtonLink } from '@/components/ButtonLink';
import { useWallet } from '../hooks/useMember';
import styles from './TotalEarnedPage.module.css';

/**
 * Total Earned (SCR-MEM-019, FR-RPT-003) - final static content.
 *
 * Server-authoritative exact-decimal via `Wallet.totalEarned`
 * (`store.ts:1078 mem-001 → 240000.00`) rendered with `formatMoney` (`@jad/shared`,
 * `en-PH ₱`) in a `bg-surface-raised`/`border-strong` card (`tabular-nums`
 * `text-h2`). Ledger-defined, excludes pending (BR-RPT-003, BI-002). When the
 * dedicated `GET /me/reports/total-earned` (#76, OD-025) lands, swap
 * `useWallet` for `useTotalEarned` - no UI change needed.
 */
export function TotalEarnedPage() {
  const walletQuery = useWallet();

  return (
    <section>
      <PageHeader
        title="Total Earned"
        description="Your lifetime earnings - based on cleared commissions and referrals."
        actions={
          <div className={styles.headerActions}>
            <ButtonLink to="/member/commissions" variant="secondary">
              View Commissions
            </ButtonLink>
            <ButtonLink to="/member/ewallet/ledger" variant="ghost">
              View Ledger
            </ButtonLink>
          </div>
        }
      />

      <p className={styles.timeframe}>All time · Reporting only</p>

      {walletQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
        </div>
      ) : walletQuery.isError ? (
        <ErrorState
          error={walletQuery.error}
          title="Could not load your total earned"
          onRetry={() => void walletQuery.refetch()}
        />
      ) : walletQuery.data ? (
        <div className={styles.figureCard} role="status" aria-label="Total earned">
          <Icon name="clock" size={24} className={styles.figureIcon} aria-hidden="true" />
          <p className={styles.figure} aria-live="polite">
            {formatMoney(walletQuery.data.totalEarned ?? '0.00')}
          </p>
          <p className={styles.figureLabel}>Lifetime earnings</p>
          <p className={styles.figureHint}>
            Ledger-defined total based on credited commissions and referral earnings. Pending
            estimates are excluded.
          </p>
        </div>
      ) : (
        <div className={styles.figureCard} role="status" aria-label="Total earned">
          <Icon name="clock" size={24} className={styles.figureIcon} aria-hidden="true" />
          <p className={styles.figure} aria-hidden="true">
            -
          </p>
          <p className={styles.figureLabel}>No earnings yet</p>
          <p className={styles.figureHint}>
            Earnings appear here once sales are approved and commissions credited. Pending estimates
            are not included.
          </p>
        </div>
      )}

      <p className={styles.note}>
        Review your <Link to="/member/ewallet/ledger">ledger</Link> and{' '}
        <Link to="/member/commissions">commissions</Link> for a detailed breakdown.
      </p>
    </section>
  );
}
