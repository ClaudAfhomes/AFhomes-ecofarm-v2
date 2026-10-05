import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, StatusChip } from '@jad/ui';
import type { AfHomesPermission } from '@jad/contracts';
import { getMembership, getMembershipLedger, getMembershipPoints } from './services';
import { getSalePayments } from '../business/services';
import { getReport } from '../reports/services';
import { formatMoney } from '../business/format';
import { formatDateTime } from '../../lib/format';

/** Lazy, permission-scoped sections reuse existing authorized read APIs. */
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
    queryKey: ['memberships', id],
    queryFn: () => getMembership(id),
    enabled: paymentsAllowed && paymentsOpen,
  });
  const account = useQuery({
    queryKey: ['memberships', id, 'points'],
    queryFn: () => getMembershipPoints(id),
    enabled: pointsAllowed && pointsOpen,
    refetchInterval: 15_000,
  });
  const ledger = useQuery({
    queryKey: ['memberships', id, 'ledger', account.data?.id],
    queryFn: () => getMembershipLedger(account.data!.id),
    enabled: pointsAllowed && pointsOpen && Boolean(account.data),
    refetchInterval: 15_000,
  });
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', membership.data?.saleId],
    queryFn: () => getSalePayments(membership.data!.saleId),
    enabled: paymentsAllowed && paymentsOpen && Boolean(membership.data),
    refetchInterval: 15_000,
  });
  const transactions = useQuery({
    queryKey: ['reports', 'redemptions', number],
    queryFn: () => getReport('redemptions', { search: number, limit: 50 }),
    enabled: transactionsAllowed && transactionsOpen,
    refetchInterval: 30_000,
  });
  return (
    <>
      {pointsAllowed ? (
        <details onToggle={(e) => setPointsOpen(e.currentTarget.open)}>
          <summary>Points</summary>
          {account.isPending ? (
            <p role="status">Loading points…</p>
          ) : account.isError ? (
            <ErrorState error={account.error} onRetry={account.refetch} />
          ) : (
            <p>
              Balance: {account.data.balance.toLocaleString('en-PH')} · Lifetime allocated:{' '}
              {account.data.lifetimeAllocated.toLocaleString('en-PH')} · Redeemed:{' '}
              {account.data.lifetimeRedeemed.toLocaleString('en-PH')}
            </p>
          )}
          {account.data ? (
            ledger.isPending ? (
              <p role="status">Loading points history…</p>
            ) : ledger.isError ? (
              <ErrorState error={ledger.error} onRetry={ledger.refetch} />
            ) : ledger.data.length ? (
              <ol>
                {ledger.data.map((entry) => (
                  <li key={entry.id}>
                    {entry.entryType.replaceAll('_', ' ')} · {entry.amount.toLocaleString('en-PH')}{' '}
                    · {formatDateTime(entry.createdAt)}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No points entries.</p>
            )
          ) : null}
        </details>
      ) : null}
      {paymentsAllowed ? (
        <details onToggle={(e) => setPaymentsOpen(e.currentTarget.open)}>
          <summary>Payments</summary>
          {membership.isError ? (
            <ErrorState error={membership.error} onRetry={membership.refetch} />
          ) : payments.isPending ? (
            <p role="status">Loading membership payments…</p>
          ) : payments.isError ? (
            <ErrorState error={payments.error} onRetry={payments.refetch} />
          ) : payments.data.length ? (
            <ol>
              {payments.data.map((payment) => (
                <li key={payment.id}>
                  {payment.paymentNumber ? `${payment.paymentNumber} · ` : null}
                  {formatMoney(payment.amount)} · {payment.paymentType.replaceAll('_', ' ')} ·{' '}
                  <StatusChip label={payment.status} /> · {formatDateTime(payment.recordedAt)}
                </li>
              ))}
            </ol>
          ) : (
            <p>No payments recorded.</p>
          )}
        </details>
      ) : null}
      {transactionsAllowed ? (
        <details onToggle={(e) => setTransactionsOpen(e.currentTarget.open)}>
          <summary>Transactions</summary>
          {transactions.isPending ? (
            <p role="status">Loading service transactions…</p>
          ) : transactions.isError ? (
            <ErrorState error={transactions.error} onRetry={transactions.refetch} />
          ) : (
            <>
              <p>Authorized service history · latest 50 matching records.</p>
              <ul>
                {transactions.data.data
                  .filter((row) => row.membershipNumber === number)
                  .map((row) => (
                    <li key={String(row.referenceNumber ?? row.id)}>
                      {String(row.referenceNumber ?? row.id ?? 'Redemption')} ·{' '}
                      {String(row.serviceItem ?? 'Service transaction')} ·{' '}
                      {String(row.pointsUsed ?? '')}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </details>
      ) : null}
    </>
  );
}
