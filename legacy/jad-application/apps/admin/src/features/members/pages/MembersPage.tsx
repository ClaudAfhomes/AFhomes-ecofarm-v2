import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Button,
  ConfirmDialog,
  EmptyState,
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

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { formatDate } from '../../../lib/format';
import { archiveMember } from '../repositories/memberRepository';
import { getMembers } from '../repositories/memberRepository';
import { getArchived, restoreArchivedMember } from '../repositories/archiveRepository';
import type { AdminMember, ArchivedMember } from '@jad/contracts';
import { MemberFormDialog } from '../components/MemberFormDialog';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE } from '../status';
import styles from './MembersPage.module.css';

const PAGE_SIZE = 10;

/**
 * Program code of an archived snapshot, tolerant of both snapshot shapes:
 * registration snapshots carry `programCode`, member snapshots (what the
 * archive endpoint actually stores) carry `program.code`.
 */
function archivedProgramCode(a: ArchivedMember): string {
  const d = a.originalData as { programCode?: unknown; program?: { code?: unknown } };
  if (typeof d.programCode === 'string') return d.programCode;
  if (d.program && typeof d.program.code === 'string') return d.program.code;
  return '';
}

export function MembersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [programFilter, setProgramFilter] = useState<'ALL' | 'DOMESTIC' | 'ABROAD'>('ALL');
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [membershipFilter, setMembershipFilter] = useState<
    'ALL' | 'PENDING' | 'APPROVED_ACTIVE' | 'REJECTED'
  >('ALL');
  const [accountFilter, setAccountFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingMember, setEditingMember] = useState<AdminMember | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AdminMember | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);

  const { data: membersData, isPending: membersPending } = useQuery({
    queryKey: ['admin', 'members'],
    queryFn: getMembers,
  });
  const { data: archivedData } = useQuery({
    queryKey: ['admin', 'archived'],
    queryFn: getArchived,
  });
  const members = membersData ?? [];
  const archived = archivedData ?? [];

  // Use existing mock master data - derive unique countries from current members/archived (no manual dataset)
  const availableCountries = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (!map.has(m.countryCode)) map.set(m.countryCode, m.countryName);
    }
    for (const a of archived) {
      const cc = a.originalData.countryCode;
      const cn = a.originalData.countryName;
      if (!map.has(cc)) map.set(cc, cn);
    }
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, archived]);

  const filtered = useMemo(() => {
    const source = tab === 'archived' ? [] : members; // archived shown separately
    return source.filter((m) => {
      if (programFilter !== 'ALL' && m.program.code !== programFilter) return false;
      if (countryFilter !== 'ALL' && m.countryCode !== countryFilter) return false;
      if (membershipFilter !== 'ALL' && m.status !== membershipFilter) return false;
      if (accountFilter !== 'ALL' && m.accountStatus !== accountFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [members, search, tab, programFilter, countryFilter, membershipFilter, accountFilter]);

  const archFiltered = useMemo(() => {
    if (tab !== 'archived') return [];
    return archived.filter((a) => {
      if (countryFilter !== 'ALL' && a.originalData.countryCode !== countryFilter) return false;
      if (programFilter !== 'ALL' && archivedProgramCode(a) !== programFilter) return false;
      if (membershipFilter !== 'ALL' && (a.previousStatus as string) !== membershipFilter)
        return false;
      if (accountFilter !== 'ALL' && (a.previousAccountStatus as string) !== accountFilter)
        return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        a.memberId.toLowerCase().includes(q) || a.originalData.firstName.toLowerCase().includes(q)
      );
    });
  }, [archived, search, tab, programFilter, countryFilter, membershipFilter, accountFilter]);

  const total = tab === 'archived' ? archFiltered.length : filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const archivedRows = archFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleArchive = async () => {
    if (!archiveTarget || archivePending) return;
    setArchivePending(true);
    try {
      await archiveMember(archiveTarget.id);
      await qc.invalidateQueries({ queryKey: ['admin', 'members'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'archived'] });
      notifySuccess({
        title: 'Member archived',
        message: `${archiveTarget.firstName} ${archiveTarget.lastName} moved to archives`,
      });
      setArchiveTarget(null);
    } catch (e) {
      notifyError({ title: 'Archive failed', message: (e as Error).message });
    } finally {
      setArchivePending(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget || restorePending) return;
    setRestorePending(true);
    try {
      await restoreArchivedMember(restoreTarget);
      await qc.invalidateQueries({ queryKey: ['admin', 'members'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'archived'] });
      notifySuccess({
        title: 'Member restored',
        message: 'Member restored to active list',
      });
      setRestoreTarget(null);
    } catch (e) {
      notifyError({ title: 'Restore failed', message: (e as Error).message });
    } finally {
      setRestorePending(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Members"
        description="Member management edit, deactivate, archive (mock repositories, DB-ready)"
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)} aria-label="Create member">
            Create Member
          </Button>
        }
      />

      <div className={styles.tabList} role="tablist" aria-label="Member view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          onClick={() => {
            setTab('active');
            setPage(1);
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-pill)',
            border:
              tab === 'active'
                ? '1px solid var(--color-brand-primary)'
                : '1px solid var(--color-border-default)',
            background: tab === 'active' ? 'var(--color-brand-primary)' : 'transparent',
            color: tab === 'active' ? 'white' : 'var(--color-text-secondary)',
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: '44px',
          }}
        >
          Active ({members.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'archived'}
          onClick={() => {
            setTab('archived');
            setPage(1);
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-pill)',
            border:
              tab === 'archived'
                ? '1px solid var(--color-brand-primary)'
                : '1px solid var(--color-border-default)',
            background: tab === 'archived' ? 'var(--color-brand-primary)' : 'transparent',
            color: tab === 'archived' ? 'white' : 'var(--color-text-secondary)',
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: '44px',
          }}
        >
          Archived ({archived.length})
        </button>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.searchWrap}>
          <input
            type="search"
            placeholder="Search by name, email or ID…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search members"
            className={styles.searchInput}
          />
          <span aria-hidden="true" className={styles.searchIcon}>
            ⌕
          </span>
        </div>
        <Select
          aria-label="Filter by program"
          value={programFilter}
          onChange={(e) => {
            setProgramFilter(e.target.value as 'ALL' | 'DOMESTIC' | 'ABROAD');
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All programs' },
            { value: 'DOMESTIC', label: 'Domestic' },
            { value: 'ABROAD', label: 'Abroad' },
          ]}
        />
        <Select
          aria-label="Filter by country"
          value={countryFilter}
          onChange={(e) => {
            setCountryFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All countries' },
            ...availableCountries.map((c) => ({
              value: c.code,
              label: `${c.name} (${c.code})`,
            })),
          ]}
        />
        <Select
          aria-label="Filter by membership status"
          value={membershipFilter}
          onChange={(e) => {
            setMembershipFilter(
              e.target.value as 'ALL' | 'PENDING' | 'APPROVED_ACTIVE' | 'REJECTED',
            );
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All membership' },
            { value: 'PENDING', label: 'Pending' },
            { value: 'APPROVED_ACTIVE', label: 'Active' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
        <Select
          aria-label="Filter by account status"
          value={accountFilter}
          onChange={(e) => {
            setAccountFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE');
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All accounts' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
        />
        {search ||
        programFilter !== 'ALL' ||
        countryFilter !== 'ALL' ||
        membershipFilter !== 'ALL' ||
        accountFilter !== 'ALL' ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setProgramFilter('ALL');
              setCountryFilter('ALL');
              setMembershipFilter('ALL');
              setAccountFilter('ALL');
              setPage(1);
            }}
            className={styles.clearButton}
          >
            Clear
          </button>
        ) : null}
      </div>

      {membersPending ? (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      ) : tab === 'active' ? (
        total === 0 ? (
          <EmptyState
            title="No members found"
            description={
              search ? 'Try a different search.' : 'No members yet. Approve a registration.'
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Member ID</TableHeaderCell>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Program</TableHeaderCell>
                    <TableHeaderCell>Contact</TableHeaderCell>
                    <TableHeaderCell>Membership</TableHeaderCell>
                    <TableHeaderCell>Qualified</TableHeaderCell>
                    <TableHeaderCell align="right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeRows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => navigate(`/admin/members/${row.id}`)}
                      style={{ cursor: 'pointer' }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/admin/members/${row.id}`);
                        }
                      }}
                      aria-label={`View member ${row.firstName} ${row.lastName}`}
                    >
                      <TableCell label="Member ID">
                        <span
                          title={row.id}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body-s)' }}
                        >
                          {row.id.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell label="Name">
                        <span style={{ fontWeight: 600 }}>
                          {row.firstName} {row.lastName}
                        </span>
                      </TableCell>
                      <TableCell label="Program">
                        <span
                          style={{
                            display: 'inline-flex',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-pill)',
                            background: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-border-subtle)',
                            fontSize: 'var(--text-caption)',
                            fontWeight: 600,
                          }}
                        >
                          {row.program.code}
                        </span>
                      </TableCell>
                      <TableCell label="Contact">
                        <span style={{ fontSize: 'var(--text-body-s)' }}>{row.phone}</span>
                        <br />
                        <span
                          style={{
                            fontSize: 'var(--text-caption)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {row.email}
                        </span>
                      </TableCell>
                      <TableCell label="Membership">
                        <StatusChip
                          label={MEMBER_STATUS_LABEL[row.status]}
                          tone={MEMBER_STATUS_TONE[row.status]}
                        />
                      </TableCell>
                      <TableCell label="Qualified">
                        {row.status === 'APPROVED_ACTIVE' ? (
                          <StatusChip
                            label={row.isQualified ? 'Qualified' : 'Not Qualified'}
                            tone={row.isQualified ? 'success' : 'neutral'}
                          />
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell label="Actions" align="right">
                        <span
                          style={{ display: 'inline-flex', gap: 4 }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <IconButton
                            icon="pencil"
                            label={`Edit member ${row.firstName} ${row.lastName}`}
                            onClick={() => setEditingMember(row)}
                          />
                          <IconButton
                            icon="trash"
                            label={`Archive member ${row.firstName} ${row.lastName}`}
                            onClick={() => setArchiveTarget(row)}
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
                {total} member{total === 1 ? '' : 's'} page {page} of {pageCount}
              </span>
              <Pagination page={page} pageCount={pageCount} onChange={setPage} />
            </div>
          </>
        )
      ) : (
        <>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Archive ID</TableHeaderCell>
                  <TableHeaderCell>Member</TableHeaderCell>
                  <TableHeaderCell>Previous Status</TableHeaderCell>
                  <TableHeaderCell>Archived</TableHeaderCell>
                  <TableHeaderCell>By</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {archivedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        title="No archived members"
                        description="Archived records appear here after Delete → Archive."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  archivedRows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell label="Archive ID">
                        <span
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body-s)' }}
                        >
                          {a.id}
                        </span>
                      </TableCell>
                      <TableCell label="Member">
                        <span style={{ fontWeight: 600 }}>
                          {a.originalData.firstName} {a.originalData.lastName}
                        </span>
                        <br />
                        <span
                          style={{
                            fontSize: 'var(--text-caption)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {a.memberId}
                        </span>
                      </TableCell>
                      <TableCell label="Previous">
                        {a.previousStatus} / {a.previousAccountStatus}
                      </TableCell>
                      <TableCell label="Archived">{formatDate(a.archivedAt)}</TableCell>
                      <TableCell label="By">{a.archivedBy}</TableCell>
                      <TableCell label="Actions" align="right">
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <IconButton
                            icon="user-check"
                            label={`Restore member ${a.originalData.firstName} ${a.originalData.lastName}`}
                            onClick={() => setRestoreTarget(a.id)}
                          />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {total > 0 && (
            <div className={styles.tableFooter}>
              <span className={styles.captionText} role="status" aria-live="polite">
                {total} archived record{total === 1 ? '' : 's'} page {page} of {pageCount}
              </span>
              <Pagination page={page} pageCount={pageCount} onChange={setPage} />
            </div>
          )}
        </>
      )}
      <MemberFormDialog open={showCreate} onClose={() => setShowCreate(false)} member={null} />
      <MemberFormDialog
        open={Boolean(editingMember)}
        onClose={() => setEditingMember(null)}
        member={editingMember ?? undefined}
      />
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onCancel={() => {
          if (!archivePending) setArchiveTarget(null);
        }}
        onConfirm={handleArchive}
        title={
          archiveTarget
            ? `Archive ${archiveTarget.firstName} ${archiveTarget.lastName}?`
            : 'Archive member?'
        }
        message="Archive this member? Record will be moved to Archives and removed from active Members. Original data retained for audit."
        confirmLabel="Archive"
        cancelLabel="Cancel"
        danger
        confirmDisabled={archivePending}
        confirmLoading={archivePending}
      />
      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onCancel={() => {
          if (!restorePending) setRestoreTarget(null);
        }}
        onConfirm={handleRestore}
        title="Restore member?"
        message="Restore this archived member to the active list?"
        confirmLabel="Restore"
        cancelLabel="Cancel"
        confirmDisabled={restorePending}
        confirmLoading={restorePending}
      />
    </section>
  );
}
