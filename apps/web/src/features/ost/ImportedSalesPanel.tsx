import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@afhomes/shared';
import { Button, EmptyState } from '@afhomes/ui';
import { getImportedSales } from './services';
import { Card, styles } from '../customer/portal-ui';

export function ImportedSalesPanel() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['imported-sales', page],
    queryFn: ({ signal }) => getImportedSales(page, signal),
    refetchInterval: 30000,
  });
  return (
    <Card title="Imported customer records">
      <p>
        Purchases where you were the recorded referrer or VIP recommender. Fully paid and active
        history was settled before this system.
      </p>
      {query.isPending ? (
        <p role="status">Loading imported records…</p>
      ) : query.isError ? (
        <div role="alert">
          Unable to load imported records.{' '}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : query.data.data.length ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {[
                    'VIP card / Purchase reference',
                    'Customer',
                    'VIP tier',
                    'Status',
                    'Your involvement',
                    'Contract total',
                    'Commission treatment',
                  ].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reference}</td>
                    <td>
                      {r.customerName ?? 'Restricted'} · {r.customerNumber}
                    </td>
                    <td>{r.tier}</td>
                    <td>{r.status.replaceAll('_', ' ')}</td>
                    <td>{r.roles.join(', ')}</td>
                    <td>{r.amount === null ? 'Not recorded' : formatMoney(r.amount)}</td>
                    <td>
                      {r.commissionPolicy === 'settled_before_system'
                        ? 'Settled before system'
                        : 'Subject to normal qualification'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState title="No imported customer records" />
      )}
      {query.isSuccess && (query.data.meta.total > query.data.meta.pageSize || page > 1) ? (
        <nav aria-label="Imported records pagination">
          <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span> Page {page} </span>
          <Button
            disabled={page * query.data.meta.pageSize >= query.data.meta.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </Card>
  );
}
