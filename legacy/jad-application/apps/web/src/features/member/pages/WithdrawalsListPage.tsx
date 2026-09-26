import { Link } from 'react-router';
import { useMemo, useState } from 'react';

import { formatMoney } from '@jad/shared';
import { EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import type { WithdrawalStatus } from '@jad/contracts';

import { ButtonLink } from '../../../components/ButtonLink';
import { useWithdrawals } from '../hooks/useMember';
import {
  WITHDRAWAL_STATUS_TONE,
  formatDate,
  payoutMethodLabel,
  withdrawalStatusLabel,
} from '../lib/presentation';
import styles from './WithdrawalsListPage.module.css';

const FILTERS: { value: WithdrawalStatus | 'All'; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
];

/**
 * Withdrawals list (SCR-MEM-013). The member's withdrawal requests, newest
 * first, with the confirmed status vocabulary (BUSINESS-RULES §5). Completed
 * requests carry a record-only external reference (BR-BND-001).
 */
export function WithdrawalsListPage() {
  const withdrawalsQuery = useWithdrawals();
  const [filter, setFilter] = useState<WithdrawalStatus | 'All'>('All');

  const filteredWithdrawals = useMemo(() => {
    const data = withdrawalsQuery.data ?? [];
    if (filter === 'All') return data;
    return data.filter((withdrawal) => withdrawal.status === filter);
  }, [withdrawalsQuery.data, filter]);

  return (
    <section>
      <PageHeader
        title="Withdrawals"
        description="Your withdrawal requests and their progress."
        actions={
          <ButtonLink to="/member/withdrawals/new" className={styles.requestLink}>
            Request a withdrawal
          </ButtonLink>
        }
      />

      <div className={styles.filters} role="group" aria-label="Filter withdrawals by status">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? styles.filterActive : styles.filter}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {withdrawalsQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : withdrawalsQuery.isError ? (
        <ErrorState
          error={withdrawalsQuery.error}
          title="Could not load your withdrawals"
          onRetry={() => void withdrawalsQuery.refetch()}
        />
      ) : (withdrawalsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No withdrawals yet"
          description="Request your first withdrawal from your eWallet."
          action={
            <Link to="/member/withdrawals/new" className={styles.inlineLink}>
              Request a withdrawal
            </Link>
          }
        />
      ) : filteredWithdrawals.length === 0 ? (
        <EmptyState
          title="No withdrawals match this filter"
          description={`No ${withdrawalStatusLabel(filter as WithdrawalStatus)} withdrawals found. Try another filter.`}
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('All')}>
              Clear filter
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filteredWithdrawals.map((withdrawal) => (
            <li key={withdrawal.id}>
              <Link className={styles.card} to={`/member/withdrawals/${withdrawal.id}`}>
                <div className={styles.cardMain}>
                  <span className={styles.amount}>{formatMoney(withdrawal.amount)}</span>
                  <span className={styles.meta}>
                    {payoutMethodLabel(withdrawal.payoutAccount.method)} ·{' '}
                    {withdrawal.payoutAccount.accountIdentifier ??
                      withdrawal.payoutAccount.accountIdentifierMasked}{' '}
                    · requested {formatDate(withdrawal.createdAt)}
                  </span>
                </div>
                <StatusChip
                  label={withdrawalStatusLabel(withdrawal.status)}
                  tone={WITHDRAWAL_STATUS_TONE[withdrawal.status]}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
