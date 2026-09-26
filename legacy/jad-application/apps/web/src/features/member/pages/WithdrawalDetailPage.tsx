import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { formatMoney } from '@jad/shared';
import { ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { ButtonLink } from '../../../components/ButtonLink';
import { useWithdrawal } from '../hooks/useMember';
import {
  WITHDRAWAL_STATUS_TONE,
  formatDate,
  payoutMethodLabel,
  withdrawalStatusLabel,
} from '../lib/presentation';
import styles from './WithdrawalDetailPage.module.css';

const WITHDRAWAL_STEPS = [
  { key: 'REQUESTED', label: 'Requested' },
  { key: 'RESERVED', label: 'Reserved' },
  { key: 'COMPLETED', label: 'Completed' },
] as const;

function getWithdrawalStepIndex(status: string): number {
  if (status === 'REJECTED') return -1;
  return WITHDRAWAL_STEPS.findIndex((step) => step.key === status);
}

/**
 * Withdrawal detail (SCR-MEM-014, FR-WDR-001..005). One of the member's own
 * withdrawal requests. Rejected requests are NOT editable or resubmittable -
 * a new request is required (BR-WDR-005).
 */
export function WithdrawalDetailPage() {
  const { withdrawalId = '' } = useParams<{ withdrawalId: string }>();
  const withdrawalQuery = useWithdrawal(withdrawalId);
  const [copied, setCopied] = useState(false);

  if (withdrawalQuery.isLoading) {
    return (
      <section>
        <PageHeader
          title="Withdrawal detail"
          actions={
            <Link
              className={styles.backLink}
              to="/member/withdrawals"
              aria-label="Back to withdrawals"
            >
              ← Back to withdrawals
            </Link>
          }
        />

        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </section>
    );
  }

  if (withdrawalQuery.isError || !withdrawalQuery.data) {
    return (
      <section>
        <PageHeader
          title="Withdrawal detail"
          actions={
            <Link
              className={styles.backLink}
              to="/member/withdrawals"
              aria-label="Back to withdrawals"
            >
              ← Back to withdrawals
            </Link>
          }
        />

        <ErrorState
          error={withdrawalQuery.error}
          title="Could not load this withdrawal"
          onRetry={() => void withdrawalQuery.refetch()}
        />
      </section>
    );
  }

  const withdrawal = withdrawalQuery.data;

  const onCopyReference = async () => {
    const ref = withdrawal.externalReference;
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Withdrawal detail"
        actions={
          <Link
            className={styles.backLink}
            to="/member/withdrawals"
            aria-label="Back to withdrawals"
          >
            ← Back to withdrawals
          </Link>
        }
      />

      <dl className={styles.details}>
        <div className={styles.item}>
          <dt>Status</dt>
          <dd>
            <StatusChip
              label={withdrawalStatusLabel(withdrawal.status)}
              tone={WITHDRAWAL_STATUS_TONE[withdrawal.status]}
            />
          </dd>
        </div>
        <div className={styles.item}>
          <dt>Amount</dt>
          <dd>{formatMoney(withdrawal.amount)}</dd>
        </div>
        <div className={styles.item}>
          <dt>Payout account</dt>
          <dd>
            {payoutMethodLabel(withdrawal.payoutAccount.method)} ·{' '}
            {withdrawal.payoutAccount.accountIdentifier ??
              withdrawal.payoutAccount.accountIdentifierMasked}
          </dd>
        </div>
        <div className={styles.item}>
          <dt>Requested</dt>
          <dd>{formatDate(withdrawal.createdAt)}</dd>
        </div>
        {withdrawal.reservedAt ? (
          <div className={styles.item}>
            <dt>Reserved</dt>
            <dd>{formatDate(withdrawal.reservedAt)}</dd>
          </div>
        ) : null}
        {withdrawal.completedAt ? (
          <div className={styles.item}>
            <dt>Completed</dt>
            <dd>{formatDate(withdrawal.completedAt)}</dd>
          </div>
        ) : null}
        {withdrawal.rejectedAt ? (
          <div className={styles.item}>
            <dt>Rejected</dt>
            <dd>{formatDate(withdrawal.rejectedAt)}</dd>
          </div>
        ) : null}
        {withdrawal.externalReference ? (
          <div className={styles.item}>
            <dt>Reference</dt>
            <dd className={styles.referenceCell}>
              <code className={styles.referenceCode}>{withdrawal.externalReference}</code>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={onCopyReference}
                aria-label="Copy reference"
                aria-live="polite"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <span aria-live="polite" className={styles.srOnly}>
                {copied ? 'Reference copied to clipboard' : ''}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.progressCard}>
        <h3 className={styles.progressTitle}>Progress</h3>
        {getWithdrawalStepIndex(withdrawal.status) >= 0 ? (
          <ol className={styles.progression}>
            {WITHDRAWAL_STEPS.map((step, index) => {
              const current = getWithdrawalStepIndex(withdrawal.status);
              const isComplete = current > index;
              const isCurrent = current === index;
              return (
                <li
                  key={step.key}
                  className={`${styles.progressionStep} ${isComplete ? styles.stepComplete : ''} ${isCurrent ? styles.stepCurrent : ''}`}
                >
                  <span className={styles.stepIndicator}>{isComplete ? '✓' : index + 1}</span>
                  <span className={styles.stepLabel}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.statusNote}>
            This withdrawal was rejected - funds were released back to your Available Balance.
          </p>
        )}
        <Link className={styles.ledgerLink} to="/member/ewallet/ledger?type=WITHDRAWAL_RESERVATION">
          View in ledger →
        </Link>
      </div>

      {withdrawal.rejectionReason ? (
        <Alert variant="danger" title="This withdrawal was rejected">
          {withdrawal.rejectionReason}
        </Alert>
      ) : null}

      {withdrawal.status === 'REJECTED' ? (
        <div className={styles.actions}>
          <ButtonLink to="/member/withdrawals/new" className={styles.actionLink}>
            Request a new withdrawal
          </ButtonLink>
          <p className={styles.note}>
            Rejected withdrawals cannot be edited or resubmitted - please file a new request
            (BR-WDR-005).
          </p>
        </div>
      ) : null}
    </section>
  );
}
