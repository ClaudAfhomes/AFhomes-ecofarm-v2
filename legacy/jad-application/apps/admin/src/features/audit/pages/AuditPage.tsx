import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
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
import type { StatusTone } from '@jad/ui';

import { useAudit } from '../hooks/useAudit';
import { useAdjustments } from '../../adjustments/hooks/useAdjustments';
import { formatDateTime } from '../../../lib/format';
import styles from './AuditPage.module.css';
import type { Adjustment, AuditLogEntry } from '@jad/contracts';

const PAGE_SIZE = 10;

/** Unified record shape for the merged table. */
type MergedRecord = {
  recordKind: 'AUDIT' | 'ADJUSTMENT';
  id: string;
  action: string;
  summary: string;
  detail: string;
  by: string;
  actorRole: string;
  targetType: string;
  createdAt: string;
};

const RECORD_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All records' },
  { value: 'AUDIT', label: 'Audit entries' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
];

const ACTOR_ROLE_OPTIONS = [
  { value: 'ALL', label: 'All actors' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'SYSTEM', label: 'System' },
];

const TARGET_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All targets' },
  { value: 'Registration', label: 'Registration' },
  { value: 'Sale', label: 'Sale' },
  { value: 'PayoutAccount', label: 'Payout Account' },
  { value: 'Withdrawal', label: 'Withdrawal' },
  { value: 'Adjustment', label: 'Adjustment' },
  { value: 'SystemConfig', label: 'Config' },
  { value: 'Content', label: 'Content' },
];

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

const ADJ_CREATEDBY_ROLE: Record<string, string> = {
  'Ada Admin': 'ADMIN',
  'Fina Finance': 'FINANCE',
  'Saul Super': 'SUPER_ADMIN',
};

function toMergedRecords(
  auditData: AuditLogEntry[] | undefined,
  adjData: Adjustment[] | undefined,
): MergedRecord[] {
  const auditRecords: MergedRecord[] = (auditData ?? []).map((r) => ({
    recordKind: 'AUDIT' as const,
    id: r.id,
    action: r.action,
    summary: r.targetName,
    detail: r.detail,
    by: r.actor,
    actorRole: r.actorRole,
    targetType: r.targetType,
    createdAt: r.createdAt,
  }));
  const adjRecords: MergedRecord[] = (adjData ?? []).map((r) => ({
    recordKind: 'ADJUSTMENT' as const,
    id: r.id,
    action: r.entryType,
    summary: `${r.memberName} - ${r.direction === 'CREDIT' ? '+' : '−'}${r.amount}`,
    detail: r.reason,
    by: r.createdBy,
    actorRole: ADJ_CREATEDBY_ROLE[r.createdBy] ?? 'ADMIN',
    targetType: 'Adjustment',
    createdAt: r.createdAt,
  }));
  return [...auditRecords, ...adjRecords].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Summary</TableHeaderCell>
          <TableHeaderCell>By</TableHeaderCell>
          <TableHeaderCell>Date</TableHeaderCell>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Audit Logs - combined read-only view of admin action history and ledger adjustments. */
export function AuditPage() {
  const navigate = useNavigate();
  const {
    data: auditData,
    isPending: auditPending,
    isError: auditError,
    error: auditErr,
    refetch: auditRefetch,
  } = useAudit();
  const {
    data: adjData,
    isPending: adjPending,
    isError: adjError,
    error: adjErr,
    refetch: adjRefetch,
  } = useAdjustments();

  const isPending = auditPending || adjPending;
  const isError = auditError || adjError;
  const error = auditErr ?? adjErr;
  const refetch = () => {
    auditRefetch();
    adjRefetch();
  };

  const [search, setSearch] = useState('');
  const [recordTypeFilter, setRecordTypeFilter] = useState('ALL');
  const [actorRoleFilter, setActorRoleFilter] = useState('ALL');
  const [targetTypeFilter, setTargetTypeFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const allRecords = useMemo(() => toMergedRecords(auditData, adjData), [auditData, adjData]);

  const filtered = useMemo(() => {
    return allRecords.filter((r) => {
      if (recordTypeFilter !== 'ALL' && r.recordKind !== recordTypeFilter) return false;
      if (actorRoleFilter !== 'ALL' && r.actorRole !== actorRoleFilter) return false;
      if (targetTypeFilter !== 'ALL' && r.targetType !== targetTypeFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = `${r.summary} ${r.detail} ${r.by} ${r.action}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allRecords, recordTypeFilter, actorRoleFilter, targetTypeFilter, search]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section>
      <PageHeader
        title="Audit Logs"
        description="Administrative action history and ledger adjustments (read-only)"
      />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : total === 0 &&
        !search &&
        recordTypeFilter === 'ALL' &&
        actorRoleFilter === 'ALL' &&
        targetTypeFilter === 'ALL' ? (
        <EmptyState
          title="No records"
          description="No audit entries or adjustments have been recorded."
        />
      ) : (
        <>
          <div className={styles.filterBar}>
            <div className={styles.searchWrap}>
              <input
                type="search"
                placeholder="Search by name, action or detail…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label="Search audit logs"
                className={styles.searchInput}
              />
              <span aria-hidden="true" className={styles.searchIcon}>
                ⌕
              </span>
            </div>
            <Select
              aria-label="Filter by record type"
              value={recordTypeFilter}
              onChange={(e) => {
                setRecordTypeFilter(e.target.value);
                setPage(1);
              }}
              options={RECORD_TYPE_OPTIONS}
            />
            <Select
              aria-label="Filter by actor role"
              value={actorRoleFilter}
              onChange={(e) => {
                setActorRoleFilter(e.target.value);
                setPage(1);
              }}
              options={ACTOR_ROLE_OPTIONS}
            />
            <Select
              aria-label="Filter by target type"
              value={targetTypeFilter}
              onChange={(e) => {
                setTargetTypeFilter(e.target.value);
                setPage(1);
              }}
              options={TARGET_TYPE_OPTIONS}
            />
            {search ||
            recordTypeFilter !== 'ALL' ||
            actorRoleFilter !== 'ALL' ||
            targetTypeFilter !== 'ALL' ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setRecordTypeFilter('ALL');
                  setActorRoleFilter('ALL');
                  setTargetTypeFilter('ALL');
                  setPage(1);
                }}
                className={styles.clearButton}
              >
                Clear
              </button>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState title="No records found" description="Try adjusting filters or search." />
          ) : (
            <>
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell>Summary</TableHeaderCell>
                      <TableHeaderCell>By</TableHeaderCell>
                      <TableHeaderCell>Date</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={`${row.recordKind}-${row.id}`}
                        onClick={() => navigate(`/admin/audit/${row.id}`)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/admin/audit/${row.id}`);
                          }
                        }}
                        aria-label={`View ${row.recordKind === 'AUDIT' ? 'audit entry' : 'adjustment'} ${row.summary}`}
                      >
                        <TableCell label="Type">
                          {row.recordKind === 'AUDIT' ? (
                            <StatusChip label={row.action} tone="neutral" />
                          ) : (
                            <StatusChip
                              label={
                                ADJUSTMENT_TYPE_LABEL[
                                  row.action as keyof typeof ADJUSTMENT_TYPE_LABEL
                                ] ?? row.action
                              }
                              tone={
                                ADJUSTMENT_TYPE_TONE[
                                  row.action as keyof typeof ADJUSTMENT_TYPE_TONE
                                ] ?? 'neutral'
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell label="Summary">
                          <span style={{ fontWeight: 600 }}>{row.summary}</span>
                          <span
                            title={row.detail}
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-caption)',
                              color: 'var(--color-text-muted)',
                              maxWidth: '40ch',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.detail}
                          </span>
                        </TableCell>
                        <TableCell label="By">
                          <span style={{ fontWeight: 600 }}>{row.by}</span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-caption)',
                              color: 'var(--color-text-muted)',
                              fontWeight: 500,
                              letterSpacing: '0.02em',
                            }}
                          >
                            {row.actorRole}
                          </span>
                        </TableCell>
                        <TableCell label="Date" style={{ whiteSpace: 'nowrap' }}>
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.tableFooter}>
                <span className={styles.captionText} role="status" aria-live="polite">
                  {total} record{total === 1 ? '' : 's'} page {page} of {pageCount}
                </span>
                <Pagination page={page} pageCount={pageCount} onChange={setPage} />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
