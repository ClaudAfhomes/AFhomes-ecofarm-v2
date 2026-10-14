import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, ErrorState, Skeleton, StatusChip } from '@afhomes/ui';
import type { AfHomesPermission } from '@afhomes/contracts';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { getMembership, getMembershipLedger, getMembershipPoints } from './services';
import { getSalePayments } from '../business/services';
import { getReport } from '../reports/services';
import { formatPaymentType, humanizeCode } from '../business/format';
import { businessKeys, membershipKeys } from '../business/queryKeys';
import { sharedScopes } from '../business/queryKeys';
import { formatDateTime } from '../../lib/format';
import styles from './MembershipActivity.module.css';

/**
 * Permission-scoped activity panels for one membership card.
 *
 * Lazy, read-only sections that reuse the existing authorized read APIs: the
 * points account and its ledger, the originating sale's payments, and the
 * member's service transactions. Nothing here spends, moves, or edits.
 */
export function MembershipActivity({
  id,
  number,
  permissions,
}: {
  id: string;
  number: string;
  permissions: readonly AfHomesPermission[];
}) {
  const [pointsOpen, setPointsOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [transactionsOpen, setTransactionsOpen] = useState(false);
  const can = (key: string) =>
    permissions.some((permission) => permission.moduleKey === key && permission.canView);
  const pointsAllowed = can('finance.points');
  const paymentsAllowed = can('finance.payment_verification');
  const transactionsAllowed = can('operations.redemption');
  const membership = useQuery({
    queryKey: membershipKeys.record(id),
    queryFn: () => getMembership(id),
    enabled: paymentsAllowed && paymentsOpen,
    placeholderData: keepPreviousData,
  });
  const account = useQuery({
    queryKey: membershipKeys.points(id),
    queryFn: () => getMembershipPoints(id),
    enabled: pointsAllowed && pointsOpen,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const ledger = useQuery({
    queryKey: membershipKeys.ledger(id, account.data?.id),
    queryFn: () => getMembershipLedger(account.data!.id),
    enabled: pointsAllowed && pointsOpen && Boolean(account.data),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const payments = useQuery({
    // Mirrors the sales-domain key so finance invalidations reach this panel.
    queryKey: businessKeys.salePayments(membership.data?.saleId ?? 'unknown'),
    queryFn: () => getSalePayments(membership.data!.saleId),
    enabled: paymentsAllowed && paymentsOpen && Boolean(membership.data),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const transactions = useQuery({
    queryKey: [...sharedScopes.reports, 'redemptions', number],
    queryFn: () => getReport('redemptions', { search: number, limit: 50 }),
    enabled: transactionsAllowed && transactionsOpen,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  return (
    <div className={styles.stack}>
      {pointsAllowed ? (
        <details className={styles.group} onToggle={(e) => setPointsOpen(e.currentTarget.open)}>
          <summary className={styles.groupTitle}>Points</summary>
          {account.isPending ? (
            <p role="status">
              <Skeleton style={{ height: 64 }} />
              <span className="sr-only">Loading points…</span>
            </p>
          ) : account.isError ? (
            <ErrorState
              error={account.error}
              title="Points could not be loaded"
              onRetry={() => void account.refetch()}
            />
          ) : (
            <>
              <div className={styles.metrics}>
                <StatusChip
                  label={`Balance: ${formatCountOrDash(account.data.balance)}`}
                  tone="neutral"
                  icon="wallet"
                />
                <StatusChip
                  label={`Lifetime allocated: ${formatCountOrDash(account.data.lifetimeAllocated)}`}
                  tone="neutral"
                  icon="plus"
                />
                <StatusChip
                  label={`Lifetime redeemed: ${formatCountOrDash(account.data.lifetimeRedeemed)}`}
                  tone="neutral"
                  icon="check"
                />
              </div>
            </>
          )}
          {account.data ? (
            ledger.isPending ? (
              <p role="status">
                <Skeleton style={{ height: 48 }} />
                <span className="sr-only">Loading points history…</span>
              </p>
            ) : ledger.isError ? (
              <ErrorState
                error={ledger.error}
                title="Points history could not be loaded"
                onRetry={() => void ledger.refetch()}
              />
            ) : ledger.data.length ? (
              <ol className={styles.entries}>
                {ledger.data.map((entry) => (
                  <li key={entry.id}>
                    <StatusChip label={humanizeCode(entry.entryType)} />
                    <span className={styles.entryMeta}>
                      {formatCountOrDash(entry.amount)} · {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.groupNote}>No points entries.</p>
            )
          ) : null}
        </details>
      ) : null}
      {paymentsAllowed ? (
        <details className={styles.group} onToggle={(e) => setPaymentsOpen(e.currentTarget.open)}>
          <summary className={styles.groupTitle}>Payments</summary>
          {membership.isError ? (
            <ErrorState
              error={membership.error}
              title="Membership could not be loaded"
              onRetry={() => void membership.refetch()}
            />
          ) : payments.isPending ? (
            <p role="status">
              <Skeleton style={{ height: 48 }} />
              <span className="sr-only">Loading membership payments…</span>
            </p>
          ) : payments.isError ? (
            <ErrorState
              error={payments.error}
              title="Payments could not be loaded"
              onRetry={() => void payments.refetch()}
            />
          ) : payments.data.length ? (
            <ol className={styles.entries}>
              {payments.data.map((payment) => (
                <li key={payment.id}>
                  {payment.paymentNumber ? (
                    <span className={styles.entryMeta}>{payment.paymentNumber}</span>
                  ) : null}
                  <span className={styles.entryMeta}>{formatMoneyOrDash(payment.amount)}</span>
                  <span className={styles.entryMeta}>{formatPaymentType(payment.paymentType)}</span>
                  <StatusChip label={humanizeCode(payment.status)} />
                  <span className={styles.entryMeta}>{formatDateTime(payment.recordedAt)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.groupNote}>No payments recorded.</p>
          )}
        </details>
      ) : null}
      {transactionsAllowed ? (
        <details
          className={styles.group}
          onToggle={(e) => setTransactionsOpen(e.currentTarget.open)}
        >
          <summary className={styles.groupTitle}>Transactions</summary>
          {transactions.isPending ? (
            <p role="status">
              <Skeleton style={{ height: 48 }} />
              <span className="sr-only">Loading service transactions…</span>
            </p>
          ) : transactions.isError ? (
            <ErrorState
              error={transactions.error}
              title="Service transactions could not be loaded"
              onRetry={() => void transactions.refetch()}
            />
          ) : (
            <>
              <p className={styles.groupNote}>
                Authorized service history · latest 50 matching records.
              </p>
              <ul className={styles.entries}>
                {transactions.data.data
                  .filter((row) => row.membershipNumber === number)
                  .map((row) => (
                    <li key={String(row.referenceNumber ?? row.id)}>
                      {String(row.referenceNumber ?? 'Redemption')} ·{' '}
                      {String(row.serviceItem ?? 'Service transaction')} ·{' '}
                      {String(row.pointsUsed ?? '')}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </details>
      ) : null}
      {!pointsAllowed && !paymentsAllowed && !transactionsAllowed ? (
        <Alert variant="info" title="No activity access">
          This account holds no activity permission for this card. The server still enforces every
          check.
        </Alert>
      ) : null}
    </div>
  );
}
