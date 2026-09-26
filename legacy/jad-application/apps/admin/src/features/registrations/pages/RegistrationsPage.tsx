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

import { formatDate } from '../../../lib/format';
import { useRegistrationsPage } from '../hooks/useRegistrations';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE } from '../status';
import styles from './RegistrationsPage.module.css';

const PAGE_SIZE = 10;

/** Registrations queue - pending registrations requiring review (mock repository, DB-ready). */
export function RegistrationsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'REJECTED'>('PENDING');
  const [programFilter, setProgramFilter] = useState<'ALL' | 'DOMESTIC' | 'ABROAD'>('ALL');
  const { data: queuePage, isPending, isError, error, refetch } = useRegistrationsPage();
  const data = queuePage?.registrations;
  const hiddenInvalid = queuePage?.invalid ?? 0;

  const filtered = useMemo(() => {
    const all = data ?? [];
    return all.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (programFilter !== 'ALL' && r.programCode !== programFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const name = `${r.firstName} ${r.lastName}`.toLowerCase();
        if (
          !name.includes(q) &&
          !r.countryName.toLowerCase().includes(q) &&
          !(r.referralCode ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [data, statusFilter, programFilter, search]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (isPending) {
    return (
      <section>
        <PageHeader title="Registrations" description="Member registrations requiring review" />
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section>
        <PageHeader title="Registrations" description="Member registrations requiring review" />
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      </section>
    );
  }

  if (!data || data.length === 0) {
    return (
      <section>
        <PageHeader title="Registrations" description="Member registrations requiring review" />
        {hiddenInvalid > 0 ? (
          <p role="status" className={styles.noticeBanner}>
            {hiddenInvalid} application{hiddenInvalid === 1 ? '' : 's'} could not be displayed
            because some stored details are incomplete. The dashboard count includes{' '}
            {hiddenInvalid === 1 ? 'it' : 'them'} - check the server logs for
            {` "[registrations] dropping invalid row"`} and re-save the application.
          </p>
        ) : null}
        <EmptyState
          title="Queue is clear"
          description="There are no registrations to review right now."
        />
      </section>
    );
  }

  return (
    <section>
      <PageHeader title="Registrations" description="Member registrations requiring review" />
      {hiddenInvalid > 0 ? (
        <p role="status" className={styles.noticeBanner}>
          {hiddenInvalid} more application{hiddenInvalid === 1 ? '' : 's'}{' '}
          {hiddenInvalid === 1 ? 'is' : 'are'} hidden because some stored details are incomplete.
          Check the server logs for
          {` "[registrations] dropping invalid row"`}.
        </p>
      ) : null}
      <div className={styles.filterBar}>
        <div className={styles.searchWrap}>
          <input
            type="search"
            placeholder="Search applicant, country or referral…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search registrations"
            className={styles.searchInput}
          />
          <span aria-hidden="true" className={styles.searchIcon}>
            ⌕
          </span>
        </div>
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as never);
            setPage(1);
          }}
          options={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'ALL', label: 'All statuses' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
        <Select
          aria-label="Filter by program"
          value={programFilter}
          onChange={(e) => {
            setProgramFilter(e.target.value as never);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All programs' },
            { value: 'DOMESTIC', label: 'Domestic' },
            { value: 'ABROAD', label: 'Abroad' },
          ]}
        />
        {search || statusFilter !== 'PENDING' || programFilter !== 'ALL' ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatusFilter('PENDING');
              setProgramFilter('ALL');
              setPage(1);
            }}
            className={styles.clearButton}
          >
            Clear
          </button>
        ) : null}
      </div>
      {total === 0 ? (
        <EmptyState title="No registrations found" description="Try adjusting filters or search." />
      ) : (
        <>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Applicant</TableHeaderCell>
                  <TableHeaderCell>Country</TableHeaderCell>
                  <TableHeaderCell>Program</TableHeaderCell>
                  <TableHeaderCell>Referral</TableHeaderCell>
                  <TableHeaderCell>Submitted</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => navigate(`/admin/registrations/${row.id}`)}
                    style={{ cursor: 'pointer' }}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/admin/registrations/${row.id}`);
                      }
                    }}
                    aria-label={`View registration for ${row.firstName} ${row.lastName}`}
                  >
                    <TableCell label="Applicant">
                      <span style={{ fontWeight: 600 }}>
                        {row.firstName} {row.middleInitial ? `${row.middleInitial}. ` : ''}
                        {row.lastName}
                        {row.nameSuffix ? ` ${row.nameSuffix}` : ''}
                      </span>
                    </TableCell>
                    <TableCell label="Country">
                      <span title={row.countryCode}>
                        {row.countryName} ({row.countryCode})
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
                        {row.programCode}
                      </span>
                    </TableCell>
                    <TableCell label="Referral">
                      <span
                        style={{
                          fontSize: 'var(--text-body-s)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {row.referralCode ?? '-'}
                      </span>
                    </TableCell>
                    <TableCell label="Submitted">{formatDate(row.submittedAt)}</TableCell>
                    <TableCell label="Status">
                      <StatusChip
                        label={MEMBER_STATUS_LABEL[row.status]}
                        tone={MEMBER_STATUS_TONE[row.status]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className={styles.tableFooter}>
            <span className={styles.captionText} role="status" aria-live="polite">
              {total} registration{total === 1 ? '' : 's'} page {page} of {pageCount}
            </span>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        </>
      )}
    </section>
  );
}
