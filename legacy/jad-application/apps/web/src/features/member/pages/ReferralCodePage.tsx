import { useState } from 'react';

import { useSession } from '../../../lib/session';
import { ErrorState, notifySuccess, PageHeader, Skeleton } from '@jad/ui';

import { useReferralCode } from '../hooks/useMember';
import styles from './ReferralCodePage.module.css';

/**
 * Referral code (SCR-MEM-003). The member's personal referral code - assigned
 * at registration and immutable (BR-REF-004). Presented read-only with a copy
 * button; the value is never invented or derived client-side.
 */
export function ReferralCodePage() {
  const { user } = useSession();
  const referralQuery = useReferralCode();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const code = referralQuery.data?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      notifySuccess({
        title: 'Code copied',
        message: 'Share it with people who want to join JA&D.',
      });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Referral code"
        description={`Share your code so new members can apply with you as sponsor, ${user?.name}.`}
      />

      {referralQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
        </div>
      ) : referralQuery.isError || !referralQuery.data ? (
        <ErrorState error={referralQuery.error} title="Could not load your referral code" />
      ) : (
        <div className={styles.panel}>
          <p className={styles.label}>Your referral code</p>
          <p className={styles.code}>{referralQuery.data.code}</p>
          <button type="button" className={styles.copyButton} onClick={onCopy}>
            {copied ? 'Copied' : 'Copy code'}
          </button>
          <p className={styles.note}>
            Your referral code is permanent and cannot be changed (BR-REF-004).
          </p>
        </div>
      )}
    </section>
  );
}
