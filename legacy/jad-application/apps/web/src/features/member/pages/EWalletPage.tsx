import { Link } from 'react-router';

import { compareMoney, formatMoney } from '@jad/shared';
import { ErrorState, Icon, PageHeader, Skeleton } from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ButtonLink } from '../../../components/ButtonLink';
import { usePayoutAccounts, useWallet } from '../hooks/useMember';
import styles from './EWalletPage.module.css';

/**
 * eWallet summary (SCR-MEM-001, FR-WAL-003/004). Available Balance is the
 * only amount that can be withdrawn; Pending shows the server-computed
 * pipeline estimate AND the reserved-withdrawal hold (`Wallet.pendingAmount`
 * - a withdrawal request moves money here immediately). Balances are
 * server-computed - the client never derives them.
 */
export function EWalletPage() {
  const walletQuery = useWallet();
  const payoutsQuery = usePayoutAccounts();

  // Pending is the server-computed estimate (open sales x rates), not the
  // sum of PENDING commissions (commissions now credit instantly on approval).
  const pendingCommissions = walletQuery.data?.pendingCommission ?? '0.00';
  const pendingWithdrawals = walletQuery.data?.pendingAmount ?? '0.00';
  const reservedWithdrawals = (() => {
    try {
      return compareMoney(pendingWithdrawals, '0.00') > 0;
    } catch {
      return false;
    }
  })();

  const available = walletQuery.data?.availableBalance ?? '0.00';
  const hasAvailable = (() => {
    try {
      return compareMoney(available, '0.00') > 0;
    } catch {
      return false;
    }
  })();
  const verifiedCount = (payoutsQuery.data ?? []).filter(
    (account) => account.status === 'CONFIRMED',
  ).length;
  const pendingPayoutCount = (payoutsQuery.data ?? []).filter(
    (account) => account.status === 'PENDING' || account.status === 'ADMIN_REVIEW',
  ).length;
  const hasVerified = payoutsQuery.isSuccess ? verifiedCount > 0 : false;
  const isCheckingEligibility = walletQuery.isLoading || payoutsQuery.isLoading;
  const canWithdraw =
    hasAvailable &&
    hasVerified &&
    !isCheckingEligibility &&
    !walletQuery.isError &&
    !walletQuery.isLoading &&
    !payoutsQuery.isError;

  return (
    <section>
      <PageHeader title="eWallet" description="Your commission balance and withdrawal access." />

      {walletQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
        </div>
      ) : walletQuery.isError ? (
        <ErrorState
          error={walletQuery.error}
          title="Could not load your wallet"
          onRetry={() => void walletQuery.refetch()}
        />
      ) : (
        <div className={styles.cards}>
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardLabel}>Available Balance</span>
              <span className={`${styles.cardIcon} ${styles.cardIconAvailable}`} aria-hidden="true">
                <Icon name="wallet" size={18} />
              </span>
            </div>
            <span className={styles.cardValue}>
              {formatMoney(walletQuery.data?.availableBalance ?? '0.00')}
            </span>
            <span className={styles.cardHint}>Ready to withdraw (BI-001).</span>
          </div>
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardLabel}>Pending</span>
              <span className={`${styles.cardIcon} ${styles.cardIconPending}`} aria-hidden="true">
                <Icon name="info" size={18} />
              </span>
            </div>
            <span className={styles.cardValue}>
              {walletQuery.isLoading ? '-' : formatMoney(pendingCommissions)}
            </span>
            <span className={styles.cardHint}>
              Awaiting admin approval of submitted sales.
              {reservedWithdrawals
                ? ` Reserved withdrawals (in Pending/Completed payments): ${formatMoney(pendingWithdrawals)}.`
                : ''}
            </span>
          </div>
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardLabel}>Total Withdrawals</span>
              <span
                className={`${styles.cardIcon} ${styles.cardIconWithdrawals}`}
                aria-hidden="true"
              >
                <Icon name="list" size={18} />
              </span>
            </div>
            <span className={styles.cardValue}>
              {formatMoney(walletQuery.data?.totalWithdrawals ?? '0.00')}
            </span>
            <span className={styles.cardHint}>Completed withdrawals • server-computed</span>
          </div>
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardLabel}>Total Earned</span>
              <span className={`${styles.cardIcon} ${styles.cardIconEarned}`} aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
            </div>
            <span className={styles.cardValue}>
              {formatMoney(walletQuery.data?.totalEarned ?? '0.00')}
            </span>
            <span className={styles.cardHint}>Ledger-defined total (BR-RPT-003)</span>
          </div>
        </div>
      )}

      <div className={styles.alertStack}>
        {!isCheckingEligibility && !walletQuery.isError && !hasAvailable ? (
          <Alert variant="info" title="No available balance">
            You have no available balance to withdraw. Commissions are credited when an admin
            approves your sale. <Link to="/member/commissions">View commissions</Link>.
          </Alert>
        ) : null}

        {payoutsQuery.isSuccess && !isCheckingEligibility && hasAvailable && verifiedCount === 0 ? (
          <Alert variant="warning" title="No verified payout account">
            Add a payout account and wait for Admin verification (Pending → Admin Review →
            Confirmed) before you can withdraw.{' '}
            <Link to="/member/payouts/new">Add payout account</Link> •{' '}
            <Link to="/member/payouts">View payout accounts</Link>.
          </Alert>
        ) : null}

        {payoutsQuery.isSuccess && pendingPayoutCount > 0 ? (
          <Alert variant="info" title="Payout verification pending">
            You have {pendingPayoutCount} payout account{pendingPayoutCount === 1 ? '' : 's'}{' '}
            pending verification - typically 24-48h.{' '}
            <Link to="/member/payouts">View payout accounts</Link>.
          </Alert>
        ) : null}

        {payoutsQuery.isError ? (
          <Alert variant="warning" title="Could not check payout accounts">
            We couldn’t verify your payout accounts. You can still view the ledger or try again.
          </Alert>
        ) : null}
      </div>

      <div className={styles.actions}>
        {canWithdraw ? (
          <ButtonLink to="/member/withdrawals/new" className={styles.linkButton}>
            Withdraw
          </ButtonLink>
        ) : (
          <Button
            disabled
            aria-disabled="true"
            title={
              payoutsQuery.isError
                ? 'Could not check payout accounts'
                : !hasAvailable
                  ? 'No available balance'
                  : verifiedCount === 0
                    ? 'No verified payout account'
                    : 'Checking eligibility'
            }
          >
            Withdraw
          </Button>
        )}
        <ButtonLink to="/member/ewallet/ledger" variant="secondary" className={styles.linkButton}>
          View ledger
        </ButtonLink>
      </div>

      <p className={styles.note}>
        JA&amp;D records commission amounts but never moves money on your behalf (BR-BND-001..003).
      </p>
    </section>
  );
}
