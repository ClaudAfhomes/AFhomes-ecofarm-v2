import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, MetricCard, StatusChip } from '@afhomes/ui';
import { formatMoney, formatCountOrDash } from '@afhomes/shared';

import { getOstCommissions } from './services';
import { formatDate, Card, styles as portalStyles } from '../customer/portal-ui';
import styles from './OstCommissionsPage.module.css';

/**
 * OST personal commissions page - self-only list of commissions.
 */
export function OstCommissionsPage() {
  const { data: commissionsData, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['ost', 'commissions', 'list'],
    queryFn: ({ pageParam }) => getOstCommissions({ offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.meta.offset + lastPage.meta.limit;
      return nextOffset < lastPage.meta.total ? nextOffset : undefined;
    },
    retry: false,
  });

  if (isLoading) return <p role="status" className={styles.loading}>Loading your commissions…</p>;
  if (isError) return <EmptyState title="Unable to load commissions" description="Please try again in a moment." />;

  const allCommissions = commissionsData?.pages.flatMap((page) => page.data) ?? [];
  const total = commissionsData?.pages[0]?.meta.total ?? 0;

  // KPI calculations
  const toEarn = allCommissions.filter((c) => ['pending', 'payment_verified', 'final_qualification_pending'].includes(c.status));
  const earned = allCommissions.filter((c) => c.status === 'earned');
  const paid = allCommissions.filter((c) => c.status === 'paid');
  const cancelled = allCommissions.filter((c) => c.status === 'cancelled');

  const sumAmount = (records: { amount: string | null }[]) => records.reduce((sum, r) => {
    const match = String(r.amount ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (match) {
      const whole = match[1] as string;
      const frac = ((match[2] ?? '') as string).padEnd(2, '0');
      return sum + BigInt(whole) * 100n + BigInt(frac);
    }
    return sum;
  }, 0n);

  const formatAmount = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

  const toEarnAmount = formatMoney(formatAmount(sumAmount(toEarn)));
  const earnedAmount = formatMoney(formatAmount(sumAmount(earned)));
  const paidAmount = formatMoney(formatAmount(sumAmount(paid)));
  const cancelledAmount = formatMoney(formatAmount(sumAmount(cancelled)));

  return (
    <>
      <Card title="My Commissions" actions={<span>Total: {formatCountOrDash(total)}</span>}>
        <div className={styles.kpiGrid}>
          <MetricCard
            label="Commission to Earn"
            value={toEarnAmount}
            description={`${formatCountOrDash(toEarn.length)} commission(s) pending qualification`}
            icon="dollar-sign"
          />
          <MetricCard
            label="Commission Earned"
            value={earnedAmount}
            description={`${formatCountOrDash(earned.length)} commission(s)`}
            icon="check"
          />
          <MetricCard
            label="Commission Paid"
            value={paidAmount}
            description={`${formatCountOrDash(paid.length)} commission(s)`}
            icon="wallet"
          />
          <MetricCard
            label="Cancelled"
            value={cancelledAmount}
            description={`${formatCountOrDash(cancelled.length)} commission(s)`}
            icon="alert"
          />
        </div>

        <div className={styles.tableWrap}>
          <table className={portalStyles.table}>
            <thead>
              <tr>
                <th>Sale Reference</th>
                <th>Commission</th>
                <th>Status</th>
                <th>Qualified</th>
                <th>Earned</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {allCommissions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                    No commission records yet.
                  </td>
                </tr>
              ) : (
                allCommissions.map((comm) => (
                  <tr key={comm.id}>
                    <td>{comm.saleNumber}</td>
                    <td className={portalStyles.numeric}>{formatMoney(comm.amount)}</td>
                    <td>
                      <StatusChip
                        label={comm.status.replaceAll('_', ' ')}
                        tone={
                          comm.status === 'earned' ? 'success' :
                          comm.status === 'paid' ? 'info' :
                          comm.status === 'pending' || comm.status === 'payment_verified' || comm.status === 'final_qualification_pending' ? 'warning' :
                          comm.status === 'cancelled' ? 'danger' :
                          'neutral'
                        }
                      />
                    </td>
                    <td>{comm.qualifiedAt ? formatDate(comm.qualifiedAt) : '—'}</td>
                    <td>{comm.earnedAt ? formatDate(comm.earnedAt) : '—'}</td>
                    <td>{comm.paidAt ? formatDate(comm.paidAt) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {hasNextPage && (
          <div className={styles.loadMore}>
            <Button
              variant="secondary"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}