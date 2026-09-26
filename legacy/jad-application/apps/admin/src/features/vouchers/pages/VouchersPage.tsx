import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
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
import type { VoucherTemplate } from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { useVouchers } from '../hooks/useVouchers';
import { useAllVoucherAssignments } from '../hooks/useVoucherAssignments';
import { useDeleteVoucherTemplate } from '../hooks/useDeleteVoucherTemplate';
import { VoucherCreateDialog } from '../components/VoucherCreateDialog';
import { VoucherEditDialog } from '../components/VoucherEditDialog';
import styles from './VouchersPage.module.css';

const PAGE_SIZE = 10;

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Title</TableHeaderCell>
          <TableHeaderCell align="right">Value</TableHeaderCell>
          <TableHeaderCell align="right">Assigned</TableHeaderCell>
          <TableHeaderCell>Created</TableHeaderCell>
          <TableHeaderCell>Actions</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 4 }, (_, i) => (
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Vouchers - voucher definitions (title + value) that admins assign to members. */
export function VouchersPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useVouchers();
  const { data: allAssignments } = useAllVoucherAssignments();
  const deleteTemplateMutation = useDeleteVoucherTemplate();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VoucherTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoucherTemplate | null>(null);

  const assignmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of allAssignments ?? [])
      counts.set(a.templateId, (counts.get(a.templateId) ?? 0) + 1);
    return counts;
  }, [allAssignments]);

  const total = data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = (data ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => setCreateOpen(true);

  const handleDeleteTemplate = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteTemplateMutation.mutateAsync(target.id);
      notifySuccess({ title: 'Voucher deleted', message: `"${target.title}" was removed.` });
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
    }
  };

  return (
    <section>
      <PageHeader
        title="Vouchers"
        description="Voucher definitions you create and assign to members"
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/admin/vouchers/scan')}>
              Scan QR
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Create Voucher
            </Button>
          </>
        }
      />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : total === 0 ? (
        <EmptyState
          title="No vouchers yet"
          description="Create a voucher, then assign it to members to generate unique codes and QR codes."
          action={
            <Button variant="primary" onClick={openCreate}>
              Create First Voucher
            </Button>
          }
        />
      ) : (
        <>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell align="right">Value</TableHeaderCell>
                  <TableHeaderCell align="right">Assigned</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row: VoucherTemplate) => {
                  const count = assignmentCounts.get(row.id) ?? 0;
                  return (
                    <TableRow
                      key={row.id}
                      onClick={() => navigate(`/admin/vouchers/${row.id}`)}
                      style={{ cursor: 'pointer' }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/admin/vouchers/${row.id}`);
                        }
                      }}
                      aria-label={`View ${row.title}`}
                    >
                      <TableCell label="Title">
                        <span style={{ fontWeight: 600 }}>{row.title}</span>
                      </TableCell>
                      <TableCell label="Value" align="right">
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {formatMoney(row.originalValue)}
                        </span>
                      </TableCell>
                      <TableCell label="Assigned" align="right">
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                      </TableCell>
                      <TableCell label="Created">{formatDate(row.createdAt)}</TableCell>
                      <TableCell label="Actions">
                        <div
                          style={{ display: 'flex', gap: 'var(--space-2)' }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Button variant="secondary" onClick={() => setEditTarget(row)}>
                            Edit
                          </Button>
                          <Button variant="danger" onClick={() => setDeleteTarget(row)}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className={styles.tableFooter}>
            <span className={styles.captionText} role="status" aria-live="polite">
              {total} voucher{total === 1 ? '' : 's'} page {page} of {pageCount}
            </span>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        </>
      )}

      <VoucherCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <VoucherEditDialog
        key={editTarget?.id ?? 'none'}
        open={editTarget !== null}
        template={editTarget}
        onClose={() => setEditTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTemplate}
        title="Delete voucher?"
        message={
          deleteTarget
            ? `This will permanently delete "${deleteTarget.title}"` +
              ((assignmentCounts.get(deleteTarget.id) ?? 0) > 0
                ? ` and revoke the ${assignmentCounts.get(deleteTarget.id)} assigned member voucher${assignmentCounts.get(deleteTarget.id) === 1 ? '' : 's'}`
                : '') +
              '. This action cannot be undone.'
            : 'This will permanently delete this voucher. This action cannot be undone.'
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmDisabled={deleteTemplateMutation.isPending}
        confirmLoading={deleteTemplateMutation.isPending}
      />
    </section>
  );
}
