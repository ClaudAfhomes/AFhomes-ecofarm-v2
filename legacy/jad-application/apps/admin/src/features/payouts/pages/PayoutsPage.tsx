import { useMemo, useState } from 'react';

import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
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
} from '@jad/ui';

import type { PayoutAccount } from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { usePayouts } from '../hooks/usePayouts';
import { reviewPayoutAccount } from '../services/payouts';
import { PAYOUT_METHOD_LABEL, PAYOUT_STATUS_LABEL, PAYOUT_STATUS_TONE } from '../status';
import styles from './PayoutsPage.module.css';

const PAGE_SIZE = 10;

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Account Name</TableHeaderCell>
          <TableHeaderCell>Method</TableHeaderCell>
          <TableHeaderCell>Account</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Review</TableHeaderCell>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PayoutsPage() {
  const { data, isPending, isError, error, refetch } = usePayouts();
  const [page, setPage] = useState(1);
  const [localData, setLocalData] = useState<PayoutAccount[] | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PayoutAccount | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | undefined>();
  const [detailTarget, setDetailTarget] = useState<PayoutAccount | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');

  const displayData = useMemo(() => localData ?? data ?? [], [localData, data]);

  const filtered = useMemo(() => {
    return displayData.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (methodFilter !== 'ALL' && p.method !== methodFilter) return false;
      return true;
    });
  }, [displayData, statusFilter, methodFilter]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const confirmApprove = () => {
    if (!approveId) return;
    const id = approveId;
    // Persist server-side when the backend is available; local fallback keeps
    // the workflow usable on mock data.
    reviewPayoutAccount(id, { status: 'CONFIRMED' }).catch(() => null);
    setLocalData((prev) => {
      const base = prev ?? data ?? [];
      return base.map((p) =>
        p.id === id ? { ...p, status: 'CONFIRMED' as const, rejectionReason: undefined } : p,
      );
    });
    setApproveId(null);
  };

  const handleReject = () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required.');
      return;
    }
    const id = rejectTarget.id;
    const reason = rejectReason.trim();
    reviewPayoutAccount(id, { status: 'REJECTED', rejectionReason: reason }).catch(() => null);
    setLocalData((prev) => {
      const base = prev ?? data ?? [];
      return base.map((p) =>
        p.id === id ? { ...p, status: 'REJECTED' as const, rejectionReason: reason } : p,
      );
    });
    setRejectTarget(null);
    setRejectReason('');
    setRejectError(undefined);
  };

  const hasFilters = statusFilter !== 'ALL' || methodFilter !== 'ALL';

  return (
    <section>
      <PageHeader
        title="Payouts"
        description="Member payout accounts pending verification and confirmation"
      />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : total === 0 && !hasFilters ? (
        <EmptyState
          title="No payout accounts"
          description="No payout accounts have been registered yet."
        />
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              flexWrap: 'wrap',
            }}
          >
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'All statuses' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'ADMIN_REVIEW', label: 'Admin Review' },
                { value: 'CONFIRMED', label: 'Confirmed' },
                { value: 'REJECTED', label: 'Rejected' },
              ]}
            />
            <Select
              aria-label="Filter by method"
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'All methods' },
                { value: 'TRADITIONAL_BANK', label: 'Traditional bank' },
                { value: 'DIGITAL_BANK', label: 'Digital bank' },
                { value: 'GCASH', label: 'GCash' },
                { value: 'OTHER', label: 'Other' },
              ]}
            />
            {hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ALL');
                  setMethodFilter('ALL');
                  setPage(1);
                }}
                style={{
                  padding: '8px 16px',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 'var(--text-body-s)',
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState
              title="No matching payout accounts"
              description="Try adjusting your filters."
            />
          ) : (
            <>
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Account Name</TableHeaderCell>
                      <TableHeaderCell>Method</TableHeaderCell>
                      <TableHeaderCell>Account</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Review</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => setDetailTarget(row)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetailTarget(row);
                          }
                        }}
                        aria-label={`View payout account ${row.accountName}`}
                      >
                        <TableCell label="Account Name">
                          <span style={{ fontWeight: 600 }}>{row.accountName}</span>
                        </TableCell>
                        <TableCell label="Method">
                          {PAYOUT_METHOD_LABEL[row.method] ?? row.method}
                        </TableCell>
                        <TableCell label="Account">
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-body-s)',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {row.accountIdentifier ?? row.accountIdentifierMasked}
                          </span>
                        </TableCell>
                        <TableCell label="Status">
                          <StatusChip
                            label={PAYOUT_STATUS_LABEL[row.status]}
                            tone={PAYOUT_STATUS_TONE[row.status]}
                          />
                        </TableCell>
                        <TableCell label="Review">
                          {row.status === 'PENDING' || row.status === 'ADMIN_REVIEW' ? (
                            <div
                              style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Button variant="primary" onClick={() => setApproveId(row.id)}>
                                Approve
                              </Button>
                              <Button variant="danger" onClick={() => setRejectTarget(row)}>
                                Reject
                              </Button>
                            </div>
                          ) : row.status === 'CONFIRMED' ? (
                            <div
                              style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Button variant="primary" disabled>
                                Approve
                              </Button>
                              <Button variant="danger" disabled>
                                Reject
                              </Button>
                            </div>
                          ) : row.status === 'REJECTED' ? (
                            <span
                              style={{
                                fontSize: 'var(--text-caption)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              Rejected
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.tableFooter}>
                <span className={styles.captionText} role="status" aria-live="polite">
                  {total} account{total === 1 ? '' : 's'} page {page} of {pageCount}
                </span>
                <Pagination page={page} pageCount={pageCount} onChange={setPage} />
              </div>

              <ConfirmDialog
                open={approveId !== null}
                onCancel={() => setApproveId(null)}
                onConfirm={confirmApprove}
                title="Approve payout account?"
                message="This account will be marked Confirmed and become usable for withdrawals."
                confirmLabel="Approve"
                cancelLabel="Cancel"
              />

              <Dialog
                open={rejectTarget !== null}
                onClose={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                  setRejectError(undefined);
                }}
                title="Reject payout account"
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setRejectTarget(null);
                        setRejectReason('');
                        setRejectError(undefined);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={handleReject} disabled={!rejectReason.trim()}>
                      Confirm Reject
                    </Button>
                  </>
                }
              >
                <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 'var(--text-body-s)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    Rejection requires a reason - it will be shown inline on the member Payouts page
                    and as an in-app notification.
                  </p>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
                      Rejection reason *
                    </span>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
                      placeholder="e.g., Account name does not match bank record"
                      rows={3}
                      style={{
                        padding: '10px 12px',
                        border: `1px solid ${rejectError ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-body-s)',
                        resize: 'vertical',
                      }}
                      aria-label="Rejection reason"
                    />
                    <span
                      style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}
                    >
                      {rejectReason.length}/500
                    </span>
                    {rejectError ? (
                      <span
                        style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
                      >
                        {rejectError}
                      </span>
                    ) : null}
                  </label>
                </div>
              </Dialog>

              <Dialog
                open={detailTarget !== null}
                onClose={() => setDetailTarget(null)}
                title="Payout Account Details"
                footer={
                  <Button variant="secondary" onClick={() => setDetailTarget(null)}>
                    Close
                  </Button>
                }
              >
                {detailTarget ? (
                  <div style={{ display: 'grid', gap: 'var(--space-3)', minWidth: 320 }}>
                    <DetailRow label="Account Name" value={detailTarget.accountName} />
                    <DetailRow
                      label="Method"
                      value={PAYOUT_METHOD_LABEL[detailTarget.method] ?? detailTarget.method}
                    />
                    <DetailRow
                      label="Account Number"
                      value={detailTarget.accountIdentifier ?? detailTarget.accountIdentifierMasked}
                      mono
                    />
                    <DetailRow
                      label="Status"
                      value={
                        <StatusChip
                          label={PAYOUT_STATUS_LABEL[detailTarget.status]}
                          tone={PAYOUT_STATUS_TONE[detailTarget.status]}
                        />
                      }
                    />
                    <DetailRow label="Created" value={formatDate(detailTarget.createdAt)} />
                  </div>
                ) : null}
              </Dialog>
            </>
          )}
        </>
      )}
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span
        style={{
          fontSize: 'var(--text-body-s)',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--text-body-s)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          letterSpacing: mono ? '0.02em' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
