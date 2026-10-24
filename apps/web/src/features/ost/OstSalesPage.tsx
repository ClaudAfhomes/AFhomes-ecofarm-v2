import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, MetricCard, StatusChip } from '@afhomes/ui';
import { formatMoney, formatCountOrDash } from '@afhomes/shared';

import { getOstSales } from './services';
import { formatDate, Card, styles as portalStyles } from '../customer/portal-ui';
import styles from './OstSalesPage.module.css';
import { ImportedSalesPanel } from './ImportedSalesPanel';

/**
 * OST personal sales page - self-only list of qualifying sales.
 */
export function OstSalesPage() {
  const { data: salesData, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['ost', 'sales', 'list'],
    queryFn: ({ pageParam }) => getOstSales({ offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.meta.offset + lastPage.meta.limit;
      return nextOffset < lastPage.meta.total ? nextOffset : undefined;
    },
    retry: false,
  });

  if (isLoading) return <p role="status" className={styles.loading}>Loading your sales…</p>;
  if (isError) return <EmptyState title="Unable to load sales" description="Please try again in a moment." />;

  const allSales = salesData?.pages.flatMap((page) => page.data) ?? [];
  const total = salesData?.pages[0]?.meta.total ?? 0;

  return (
    <>
      <Card title="My Sales" actions={<span>Total: {formatCountOrDash(total)}</span>}>
        <div className={styles.kpiGrid}>
          <MetricCard
            label="Total Sales"
            value={formatCountOrDash(total)}
            icon="grid"
          />
          <MetricCard
            label="Qualifying Sales"
            value={formatCountOrDash(allSales.filter((s) => s.status === 'active').length)}
            icon="check"
          />
        </div>

        <div className={styles.tableWrap}>
          <table className={portalStyles.table}>
            <thead>
              <tr>
                <th>Sale Ref</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Status</th>
                <th className={portalStyles.numeric}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {allSales.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                    No sales records yet.
                  </td>
                </tr>
              ) : (
                allSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.saleNumber}</td>
                    <td>
                      {sale.customerName ? (
                        <>
                          {sale.customerName}
                          {sale.customerNumber && <span className={styles.customerNumber}>{sale.customerNumber}</span>}
                        </>
                      ) : (
                        <span className={portalStyles.mono}>{sale.saleNumber}</span>
                      )}
                    </td>
                    <td>{formatDate(sale.createdAt)}</td>
                    <td>
                      <StatusChip
                        label={sale.status.replaceAll('_', ' ')}
                        tone={
                          sale.status === 'active' ? 'success' :
                          sale.status === 'cancelled' ? 'danger' :
                          'warning'
                        }
                      />
                    </td>
                    <td className={portalStyles.numeric}>{formatMoney(sale.cashPriceSnapshot)}</td>
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
      <ImportedSalesPanel />
    </>
  );
}
