import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  notifyError,
  notifySuccess,
} from '@jad/ui';

import { formatMoney } from '@jad/shared';
import type { Sale } from '@jad/contracts';
import { formatDate } from '../../../lib/format';
import { useSales } from '../hooks/useSales';
import { useDeleteSale } from '../hooks/useDeleteSale';
import { SALE_STATUS_LABEL, SALE_STATUS_TONE } from '../status';
import { SaleFormDialog } from '../components/SaleFormDialog';
import styles from './SalesPage.module.css';

const PAGE_SIZE = 10;

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Property</TableHeaderCell>
          <TableHeaderCell>Submitted by</TableHeaderCell>
          <TableHeaderCell>Value</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Submitted</TableHeaderCell>
          <TableHeaderCell>Actions</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 5 }, (_, i) => (
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

/** Sales queue - all sales across the state machine (SCR-ADM-009). */
export function SalesPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useSales();
  const deleteMut = useDeleteSale();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<null | { id: string; name: string }>(null);

  const filtered = useMemo(() => {
    const all = data ?? [];
    if (statusFilter === 'ALL') return all;
    return all.filter((s) => s.status === statusFilter);
  }, [data, statusFilter]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const deletePending = deleteMut.isPending;
  const handleDelete = async () => {
    if (!deleteTarget || deleteMut.isPending) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      notifySuccess({ title: 'Sale deleted', message: `${deleteTarget.name} removed` });
      // Adjust page if we deleted the last item on the page
      const remaining = total - 1;
      const newPageCount = Math.max(1, Math.ceil(remaining / PAGE_SIZE));
      if (page > newPageCount) setPage(newPageCount);
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <section>
      <PageHeader
        title="Sales"
        description="All sales submissions and their status"
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)} aria-label="Create sale">
            Create Sale
          </Button>
        }
      />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : total === 0 && statusFilter === 'ALL' ? (
        <EmptyState title="No sales" description="There are no sales records yet." />
      ) : (
        <>
          <div className={styles.filterBar}>
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'All statuses' },
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'ADMIN_APPROVED', label: 'Admin Approved' },
                { value: 'PAYMENT_VERIFIED', label: 'Payment Verified' },
                { value: 'QUALIFYING_SALE', label: 'Qualifying Sale' },
                { value: 'REJECTED', label: 'Rejected' },
                { value: 'LOCKED', label: 'Locked' },
              ]}
            />
            {statusFilter !== 'ALL' ? (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ALL');
                  setPage(1);
                }}
                className={styles.clearButton}
              >
                Clear
              </button>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState
              title="No sales match this filter"
              description="Try adjusting the filter or check back later."
            />
          ) : (
            <>
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Property</TableHeaderCell>
                      <TableHeaderCell>Submitted by</TableHeaderCell>
                      <TableHeaderCell align="right">Value</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Submitted</TableHeaderCell>
                      <TableHeaderCell align="right">Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => navigate(`/admin/sales/${row.id}`)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/admin/sales/${row.id}`);
                          }
                        }}
                        aria-label={`View sale ${row.propertyName}`}
                      >
                        <TableCell label="Property">
                          <span style={{ fontWeight: 600 }}>{row.propertyName}</span>
                        </TableCell>
                        <TableCell label="Submitted by">
                          <span style={{ fontWeight: 600 }}>{row.sellerName}</span>
                        </TableCell>
                        <TableCell label="Value" align="right">
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {formatMoney(row.propertyValue)}
                          </span>
                        </TableCell>
                        <TableCell label="Status">
                          <StatusChip
                            label={SALE_STATUS_LABEL[row.status]}
                            tone={SALE_STATUS_TONE[row.status]}
                          />
                        </TableCell>
                        <TableCell label="Submitted">{formatDate(row.submittedAt)}</TableCell>
                        <TableCell label="Actions" align="right">
                          <span
                            style={{ display: 'inline-flex', gap: 4 }}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <IconButton
                              icon="pencil"
                              label={`Edit sale ${row.propertyName}`}
                              onClick={() => setEditingSale(row)}
                            />
                            <IconButton
                              icon="trash"
                              label={`Delete sale ${row.propertyName}`}
                              onClick={() =>
                                setDeleteTarget({ id: row.id, name: row.propertyName })
                              }
                            />
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.tableFooter}>
                <span className={styles.captionText} role="status" aria-live="polite">
                  {total} sale{total === 1 ? '' : 's'} page {page} of {pageCount}
                </span>
                <Pagination page={page} pageCount={pageCount} onChange={setPage} />
              </div>
            </>
          )}
        </>
      )}
      <SaleFormDialog open={showCreate} onClose={() => setShowCreate(false)} sale={null} />
      <SaleFormDialog
        open={Boolean(editingSale)}
        onClose={() => setEditingSale(null)}
        sale={editingSale ?? undefined}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onCancel={() => {
          if (!deletePending) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete sale?'}
        message="This sale will be permanently removed along with any uncredited commissions. Sales with credited commissions cannot be deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        confirmDisabled={deletePending}
        confirmLoading={deletePending}
      />
    </section>
  );
}
