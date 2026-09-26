import { Link } from 'react-router';

import { EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import type { MemberStatus } from '@jad/contracts';

import { useDirectReferrals } from '../hooks/useMember';
import { orphanMessageFor } from '../../../lib/api/orphan';
import { MEMBER_STATUS_TONE, formatDate, memberStatusLabel } from '../lib/presentation';
import styles from './DirectReferralsPage.module.css';

/**
 * Direct Referrals (SCR-MEM-016, FR-RPT-001). The member's direct referrals -
 * strictly single-level (BR-REF-001/002); no deeper relationships or commissions
 * are shown or implied. Reporting only.
 */
export function DirectReferralsPage() {
  const referralsQuery = useDirectReferrals();

  return (
    <section>
      <PageHeader
        title="Direct Referrals"
        description="Members you directly referred, newest first."
      />

      {referralsQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : referralsQuery.isError ? (
        <ErrorState
          error={referralsQuery.error}
          title="Could not load your direct referrals"
          message={orphanMessageFor(referralsQuery.error)}
        />
      ) : (referralsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No direct referrals yet"
          description="When someone joins with your referral code, they appear here."
          action={
            <Link className={styles.inlineLink} to="/member/referrals">
              View your referral code
            </Link>
          }
        />
      ) : (
        <ul className={styles.list}>
          {(referralsQuery.data ?? []).map((referral) => (
            <li key={referral.id} className={styles.card}>
              <div className={styles.cardMain}>
                <span className={styles.name}>{referral.name}</span>
                <span className={styles.meta}>
                  {referral.isQualified ? 'Qualified' : 'Not qualified'} · joined{' '}
                  {formatDate(referral.joinedAt)}
                </span>
              </div>
              <StatusChip
                label={memberStatusLabel(referral.status)}
                tone={MEMBER_STATUS_TONE[referral.status as MemberStatus]}
              />
            </li>
          ))}
        </ul>
      )}

      <p className={styles.note}>
        Referrals are single-level only - commissions apply to members you directly referred
        (BR-REF-002).
      </p>
    </section>
  );
}
