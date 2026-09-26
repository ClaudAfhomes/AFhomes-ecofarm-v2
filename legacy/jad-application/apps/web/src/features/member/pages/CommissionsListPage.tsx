import { Link } from 'react-router';

import { formatMoney } from '@jad/shared';
import { EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import type { CommissionStatus } from '@jad/contracts';

import { ButtonLink } from '../../../components/ButtonLink';

import { useCommissions } from '../hooks/useMember';
import {
  COMMISSION_STATUS_TONE,
  commissionStatusLabel,
  commissionTypeLabel,
  formatDate,
} from '../lib/presentation';
import styles from './CommissionsListPage.module.css';

function formatRate(rate: string): string {
  try {
    const [whole = '0', frac = ''] = rate.split('.');
    const fracPadded = (frac + '0000').slice(0, 4);
    const fracNum = BigInt(fracPadded);
    const wholeNum = BigInt(whole);
    const percentWhole = wholeNum * 100n + fracNum / 100n;
    const percentFrac = fracNum % 100n;
    return `${percentWhole.toString()}.${percentFrac.toString().padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}

/**
 * Commissions list (SCR-MEM-015, FR-COM-001..012). The member's commission
 * records with the confirmed status vocabulary. Records are immutable
 * (BI-005); amounts are server snapshots (BI-006). Direct Commission (8%) and
 * Direct Referral (4%) can both apply to the same sale (BR-COM-001/002).
 * Full list for now - low volume (<100); future cursor pagination like Ledger
 * if NFR-SCAL-001 demands (API-SPECIFICATION §4).
 */
export function CommissionsListPage() {
  const commissionsQuery = useCommissions();

  return (
    <section>
      <PageHeader
        title="Commissions"
        description="Commissions earned on qualifying sales, newest first."
      />

      {commissionsQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : commissionsQuery.isError ? (
        <ErrorState
          error={commissionsQuery.error}
          title="Could not load your commissions"
          onRetry={() => void commissionsQuery.refetch()}
        />
      ) : (commissionsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No commissions yet"
          description="Commissions appear here once a qualifying sale is recorded."
          action={
            <div className={styles.emptyActions}>
              <ButtonLink to="/member/sales">View sales</ButtonLink>
              <ButtonLink to="/member/ewallet" variant="secondary">
                View eWallet
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <ul className={styles.list}>
          {(commissionsQuery.data ?? []).map((commission) => (
            <li key={commission.id} className={styles.card}>
              <div className={styles.cardMain}>
                <h3 className={styles.type}>{commissionTypeLabel(commission.commissionType)}</h3>
                <span className={styles.meta}>
                  <Link className={styles.saleLink} to={`/member/sales/${commission.saleId}`}>
                    {commission.salePropertyName}
                  </Link>{' '}
                  · created {formatDate(commission.createdAt)}
                  {commission.status === 'AVAILABLE' && commission.clearedAt ? (
                    <span> · cleared {formatDate(commission.clearedAt)}</span>
                  ) : null}
                  {commission.status === 'CANCELLED' && commission.cancelledAt ? (
                    <span> · cancelled {formatDate(commission.cancelledAt)}</span>
                  ) : null}
                  {commission.status === 'REVERSED' && commission.reversedAt ? (
                    <span> · reversed {formatDate(commission.reversedAt)}</span>
                  ) : null}
                </span>
                <span className={styles.snapshot}>
                  {formatMoney(commission.baseValue)} × {formatRate(commission.rate)}% ={' '}
                  <strong>{formatMoney(commission.amount)}</strong>
                </span>
              </div>
              <StatusChip
                label={commissionStatusLabel(commission.status)}
                tone={COMMISSION_STATUS_TONE[commission.status as CommissionStatus]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
