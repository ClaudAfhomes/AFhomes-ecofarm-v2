import { useState } from 'react';

import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jad/ui';
import { formatMoney } from '@jad/shared';

import { formatDate } from '../../../lib/format';
import { useAdjustments } from '../hooks/useAdjustments';
import type { StatusTone } from '@jad/ui';

const PAGE_SIZE = 10;

const ADJUSTMENT_TYPE_LABEL: Record<string, string> = {
  FINANCIAL_ADJUSTMENT: 'Financial Adjustment',
  COMMISSION_REVERSAL: 'Commission Reversal',
  WITHDRAWAL_REVERSAL: 'Withdrawal Reversal',
};

const ADJUSTMENT_TYPE_TONE: Record<string, StatusTone> = {
  FINANCIAL_ADJUSTMENT: 'info',
  COMMISSION_REVERSAL: 'warning',
  WITHDRAWAL_REVERSAL: 'danger',
};

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Member</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Direction</TableHeaderCell>
          <TableHeaderCell>Amount</TableHeaderCell>
          <TableHeaderCell>Reason</TableHeaderCell>
          <TableHeaderCell>Created</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 3 }, (_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
            <TableCell>
              <Skeleton />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Adjustments list - read-only view of ledger adjustments. PROPOSED shape. */
export function AdjustmentsPage() {
  const { data, isPending, isError, error, refetch } = useAdjustments();
  const [page, setPage] = useState(1);

  const total = data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];

  return (
    <section>
      <PageHeader
        title="Adjustments"
        description="Manual ledger adjustments and commission reversals"
      />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : total === 0 ? (
        <EmptyState
          title="No adjustments"
          description="No manual adjustments have been recorded."
        />
      ) : (
        <>
          <div className="table-scroll">
            <Table>
              <TableCaption>
                {total} adjustment{total === 1 ? '' : 's'} - page {page} of {pageCount}
              </TableCaption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Member</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Direction</TableHeaderCell>
                  <TableHeaderCell>Amount</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell label="Member">
                      <span style={{ fontWeight: 600 }}>{row.memberName}</span>
                    </TableCell>
                    <TableCell label="Type">
                      <StatusChip
                        label={
                          ADJUSTMENT_TYPE_LABEL[
                            row.entryType as keyof typeof ADJUSTMENT_TYPE_LABEL
                          ] ?? row.entryType
                        }
                        tone={
                          ADJUSTMENT_TYPE_TONE[
                            row.entryType as keyof typeof ADJUSTMENT_TYPE_TONE
                          ] ?? 'neutral'
                        }
                      />
                    </TableCell>
                    <TableCell label="Direction">
                      <StatusChip
                        label={row.direction}
                        tone={row.direction === 'CREDIT' ? 'success' : 'danger'}
                      />
                    </TableCell>
                    <TableCell label="Amount" align="right">
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 600,
                          color:
                            row.direction === 'CREDIT'
                              ? 'var(--color-success-strong)'
                              : 'var(--color-danger)',
                        }}
                      >
                        {formatMoney(row.amount)}
                      </span>
                    </TableCell>
                    <TableCell label="Reason">
                      <span
                        title={row.reason}
                        style={{
                          display: 'block',
                          maxWidth: '32ch',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.reason}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 'var(--text-caption)',
                          color: 'var(--color-text-muted)',
                          marginTop: '2px',
                        }}
                      >
                        by {row.createdBy}
                      </span>
                    </TableCell>
                    <TableCell label="Created">{formatDate(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {total > PAGE_SIZE ? (
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          ) : null}
        </>
      )}
    </section>
  );
}
