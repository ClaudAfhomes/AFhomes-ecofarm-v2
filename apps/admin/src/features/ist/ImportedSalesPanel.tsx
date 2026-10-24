import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@afhomes/shared';
import {
  EmptyState,
  ErrorState,
  Pagination,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@afhomes/ui';
import { getImportedSales } from './services';

export function ImportedSalesPanel({
  team,
  from,
  to,
}: {
  team: boolean;
  from: string;
  to: string;
}) {
  const [page, setPage] = useState(1);
  const params = { view: team ? ('team-sales' as const) : ('my-sales' as const), from, to, page };
  const query = useQuery({
    queryKey: ['imported-sales', params],
    queryFn: ({ signal }) => getImportedSales(params, signal),
    refetchInterval: 30000,
  });
  return (
    <section aria-label="Imported customer records">
      <h2>Imported customer records</h2>
      <p>
        Recorded sales involvement, including applications and unpaid purchases. Fully paid and
        active history was settled before this system. This period uses the import date.
      </p>
      {query.isPending ? (
        <p role="status">Loading imported records…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.data.length ? (
        <>
          <Table>
            <TableHead>
              <TableRow>
                {[
                  'VIP card / Purchase reference',
                  'Customer',
                  'VIP tier',
                  'Status',
                  'Your involvement',
                  'Contract total',
                  'Commission treatment',
                ].map((h) => (
                  <TableHeaderCell key={h}>{h}</TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell label="VIP card / Purchase reference">{r.reference}</TableCell>
                  <TableCell label="Customer">
                    {r.customerName ?? 'Restricted'} · {r.customerNumber}
                  </TableCell>
                  <TableCell label="VIP tier">{r.tier}</TableCell>
                  <TableCell label="Status">{r.status.replaceAll('_', ' ')}</TableCell>
                  <TableCell label="Your involvement">{r.roles.join(', ')}</TableCell>
                  <TableCell label="Contract total">
                    {r.amount === null ? 'Not recorded' : formatMoney(r.amount)}
                  </TableCell>
                  <TableCell label="Commission treatment">
                    {r.commissionPolicy === 'settled_before_system'
                      ? 'Settled before system'
                      : 'Subject to normal qualification'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <EmptyState title="No imported customer records in this period" />
      )}
      {query.isSuccess && (query.data.meta.total > query.data.meta.pageSize || page > 1) ? (
        <Pagination
          page={page}
          pageCount={Math.max(page, Math.ceil(query.data.meta.total / query.data.meta.pageSize))}
          onChange={setPage}
        />
      ) : null}
    </section>
  );
}
