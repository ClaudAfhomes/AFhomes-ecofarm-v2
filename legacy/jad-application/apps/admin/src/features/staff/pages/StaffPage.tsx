import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Button,
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
import { systemRoleRecords } from '@jad/contracts';

import { useStaff } from '../hooks/useStaff';
import { useRoles } from '../../roles/hooks/useRoles';
import { StaffFormDialog } from '../components/StaffFormDialog';
import { STAFF_STATUS_LABEL, STAFF_STATUS_TONE, roleLabelFor, roleToneFor } from '../status';
import { formatDate } from '../../../lib/format';
import styles from './StaffPage.module.css';

const PAGE_SIZE = 10;

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DISABLED', label: 'Disabled' },
];

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Name</TableHeaderCell>
          <TableHeaderCell>Role</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Added</TableHeaderCell>
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

/** Staff directory - read-only roster with role/status management on detail. */
export function StaffPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useStaff();
  const { data: roles } = useRoles();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const roleOptions = useMemo(() => {
    const records = roles?.length ? roles : systemRoleRecords();
    return [
      { value: 'ALL', label: 'All roles' },
      ...records.map((r) => ({ value: r.id, label: r.name })),
    ];
  }, [roles]);

  const filtered = useMemo(() => {
    return (data ?? []).filter((r) => {
      if (roleFilter !== 'ALL' && r.roleId !== roleFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${r.name} ${r.email}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, roleFilter, statusFilter, search]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtersActive = search !== '' || roleFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <section>
      <PageHeader
        title="Staff"
        description="Admin users and their roles (role changes are audited)"
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            New Staff
          </Button>
        }
      />
      <StaffFormDialog open={showCreate} onClose={() => setShowCreate(false)} />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState title="No staff members" description="No staff users have been added yet." />
      ) : (
        <>
          <div className={styles.filterBar}>
            <div className={styles.searchWrap}>
              <input
                type="search"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label="Search staff"
                className={styles.searchInput}
              />
              <span aria-hidden="true" className={styles.searchIcon}>
                ⌕
              </span>
            </div>
            <Select
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              options={roleOptions}
            />
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={STATUS_FILTER_OPTIONS}
            />
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setRoleFilter('ALL');
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
            <EmptyState title="No staff found" description="Try adjusting filters or search." />
          ) : (
            <>
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Name</TableHeaderCell>
                      <TableHeaderCell>Role</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Added</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => navigate(`/admin/staff/${row.id}`)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/admin/staff/${row.id}`);
                          }
                        }}
                        aria-label={`View staff member ${row.name}`}
                      >
                        <TableCell label="Name">
                          <span style={{ fontWeight: 600 }}>{row.name}</span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-caption)',
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            {row.email}
                          </span>
                        </TableCell>
                        <TableCell label="Role">
                          <StatusChip
                            label={roleLabelFor(roles, row.roleId)}
                            tone={roleToneFor(row.roleId)}
                          />
                        </TableCell>
                        <TableCell label="Status">
                          <StatusChip
                            label={STAFF_STATUS_LABEL[row.status]}
                            tone={STAFF_STATUS_TONE[row.status]}
                          />
                        </TableCell>
                        <TableCell label="Added" style={{ whiteSpace: 'nowrap' }}>
                          {formatDate(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.tableFooter}>
                <span className={styles.captionText} role="status" aria-live="polite">
                  {total} staff member{total === 1 ? '' : 's'} page {page} of {pageCount}
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
