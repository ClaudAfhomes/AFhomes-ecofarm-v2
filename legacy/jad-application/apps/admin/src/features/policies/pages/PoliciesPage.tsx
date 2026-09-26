import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
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
import type { Policy } from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { usePolicies } from '../hooks/usePolicies';
import { useDeletePolicy } from '../hooks/useDeletePolicy';
import { PolicyFormDialog } from '../components/PolicyFormDialog';
import { PolicyEditDialog } from '../components/PolicyEditDialog';
import { policyTypeLabel, policyTypeTone } from '../status';
import styles from './PoliciesPage.module.css';

const PAGE_SIZE = 10;

function TableSkeleton() {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Title</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Summary</TableHeaderCell>
          <TableHeaderCell>Updated</TableHeaderCell>
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

/** Admin Policies - CRUD list for policies, guidelines, T&C (FR-ADM-004). */
export function PoliciesPage() {
  const { data, isPending, isError, error, refetch } = usePolicies();
  const deletePolicy = useDeletePolicy();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null);
  const [editTarget, setEditTarget] = useState<Policy | null>(null);

  const allItems = useMemo(() => [...(data ?? [])], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        (p.content ?? '').toLowerCase().includes(q),
    );
  }, [allItems, search]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const result = await deletePolicy.mutateAsync(target.id);
      notifySuccess({
        title: 'Policy deleted',
        message:
          `"${target.title}" was permanently removed` +
          (target.documentUrl && result.fileRemoved === false
            ? ', but its uploaded PDF could not be removed.'
            : '.'),
      });
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <section>
      <PageHeader
        title="Policies"
        description="Policies, program guidelines, and terms and conditions - each with its required PDF"
        actions={<Button onClick={() => setShowCreate(true)}>New Policy</Button>}
      />

      <div className={styles.filters} role="search" aria-label="Search policies">
        <label className={styles.searchWrap} aria-label="Search policies">
          <input
            type="search"
            placeholder="Search policies"
            aria-label="Search policies"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className={styles.searchInput}
          />
        </label>
      </div>

      <p className={styles.count} aria-live="polite">
        {isPending
          ? 'Loading policies…'
          : `Showing ${rows.length} of ${total} ${total === 1 ? 'policy' : 'policies'}`}
      </p>

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : allItems.length === 0 ? (
        <EmptyState
          title="No policies"
          description="No policies have been published yet. Add the first one."
        />
      ) : total === 0 ? (
        <EmptyState
          title="No matches"
          description="No policies match your search."
          action={
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => handleSearchChange('')}
            >
              Clear search
            </button>
          }
        />
      ) : (
        <>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Summary</TableHeaderCell>
                  <TableHeaderCell>Updated</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={styles.row}
                    tabIndex={0}
                    onClick={() => navigate(`/admin/policies/${row.id}`)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      if ((e.target as HTMLElement).closest('a')) return;
                      e.preventDefault();
                      navigate(`/admin/policies/${row.id}`);
                    }}
                  >
                    <TableCell label="Title">
                      <Link
                        to={`/admin/policies/${row.id}`}
                        className={styles.titleLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell label="Type">
                      <StatusChip
                        label={policyTypeLabel(row.type)}
                        tone={policyTypeTone(row.type)}
                        icon="file-text"
                      />
                    </TableCell>
                    <TableCell label="Summary">
                      <span className={styles.description}>{row.content?.trim() || '-'}</span>
                    </TableCell>
                    <TableCell label="Updated">
                      <span className={styles.meta}>{formatDate(row.updatedAt)}</span>
                    </TableCell>
                    <TableCell label="Actions">
                      <div
                        style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Button variant="secondary" onClick={() => setEditTarget(row)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setDeleteTarget(row)}
                          aria-label={`Delete ${row.title}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className={styles.tableFooter}>
            <span className={styles.captionText} role="status" aria-live="polite">
              {total} {total === 1 ? 'policy' : 'policies'} · page {page} of {pageCount}
            </span>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        </>
      )}

      <PolicyFormDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <PolicyEditDialog
        open={editTarget !== null}
        item={editTarget}
        onClose={() => setEditTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete "${deleteTarget?.title ?? ''}"?`}
        message="This will permanently remove this policy and its uploaded PDF. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
      />
    </section>
  );
}
