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

import { useRoles } from '../hooks/useRoles';
import { useStaff } from '../../staff/hooks/useStaff';
import { RoleFormDialog } from '../components/RoleFormDialog';
import styles from './RolesPage.module.css';

const PAGE_SIZE = 10;

const TYPE_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All roles' },
  { value: 'SYSTEM', label: 'System' },
  { value: 'CUSTOM', label: 'Custom' },
];

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Role</TableHeaderCell>
          <TableHeaderCell>Members</TableHeaderCell>
          <TableHeaderCell>Modules</TableHeaderCell>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Roles directory - inspect and manage role permission sets. */
export function RolesPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useRoles();
  const { data: staff } = useStaff();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of staff ?? []) counts.set(m.roleId, (counts.get(m.roleId) ?? 0) + 1);
    return counts;
  }, [staff]);

  const filtered = useMemo(() => {
    return (data ?? []).filter((r) => {
      if (typeFilter === 'SYSTEM' && !r.isSystem) return false;
      if (typeFilter === 'CUSTOM' && r.isSystem) return false;
      if (search.trim() && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, typeFilter, search]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtersActive = search !== '' || typeFilter !== 'ALL';

  return (
    <section>
      <PageHeader
        title="Roles"
        description="Permission sets assigned to staff (changes are audited)"
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            New Role
          </Button>
        }
      />
      <RoleFormDialog open={showCreate} onClose={() => setShowCreate(false)} />
      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState title="No roles" description="No roles have been defined yet." />
      ) : (
        <>
          <div className={styles.filterBar}>
            <div className={styles.searchWrap}>
              <input
                type="search"
                placeholder="Search roles…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label="Search roles"
                className={styles.searchInput}
              />
              <span aria-hidden="true" className={styles.searchIcon}>
                ⌕
              </span>
            </div>
            <Select
              aria-label="Filter by type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              options={TYPE_FILTER_OPTIONS}
            />
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('ALL');
                  setPage(1);
                }}
                className={styles.clearButton}
              >
                Clear
              </button>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState title="No roles found" description="Try adjusting filters or search." />
          ) : (
            <>
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Role</TableHeaderCell>
                      <TableHeaderCell>Members</TableHeaderCell>
                      <TableHeaderCell>Modules</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => navigate(`/admin/roles/${row.id}`)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/admin/roles/${row.id}`);
                          }
                        }}
                        aria-label={`View role ${row.name}`}
                      >
                        <TableCell label="Role">
                          <span style={{ fontWeight: 600 }}>{row.name}</span>{' '}
                          {row.isSystem ? (
                            <StatusChip label="System" tone="neutral" />
                          ) : (
                            <StatusChip label="Custom" tone="info" />
                          )}
                          <span
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-caption)',
                              color: 'var(--color-text-muted)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {row.id}
                          </span>
                        </TableCell>
                        <TableCell label="Members">{memberCounts.get(row.id) ?? 0}</TableCell>
                        <TableCell label="Modules">
                          {row.permissions.length} module{row.permissions.length === 1 ? '' : 's'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.tableFooter}>
                <span className={styles.captionText} role="status" aria-live="polite">
                  {total} role{total === 1 ? '' : 's'} page {page} of {pageCount}
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
