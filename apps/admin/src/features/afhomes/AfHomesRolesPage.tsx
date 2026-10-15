import { memo, useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useNavigate } from 'react-router';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  notifySuccess,
} from '@afhomes/ui';
import { MODULE_CATALOG, type AfHomesRole } from '@afhomes/contracts';
import {
  createAfHomesRole,
  deleteAfHomesRole,
  getAfHomesRoles,
  updateAfHomesRole,
} from './services';
import { AfHomesRoleFormDialog, type RoleFormInput } from './AfHomesRoleFormDialog';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './AfHomesRolesPage.module.css';

const PAGE_SIZE = 10;

const RoleRow = memo(function RoleRow({
  role,
  onEdit,
  onDelete,
}: {
  role: AfHomesRole;
  onEdit: (role: AfHomesRole) => void;
  onDelete: (role: AfHomesRole) => void;
}) {
  const navigate = useNavigate();
  const openDetail = useCallback(() => navigate(`/admin/roles/${role.id}`), [navigate, role.id]);
  const canView = role.permissions.filter((p) => p.canView).length;
  const share = Math.round((canView / MODULE_CATALOG.length) * 100);
  return (
    <tr
      key={role.id}
      tabIndex={0}
      role="link"
      aria-label={`View role ${role.name}`}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openDetail();
      }}
      className={styles.clickableRow}
    >
      <td data-label="Role">
        <span className={styles.roleLink}>{role.name}</span>
        {role.description ? <span className={styles.description}>{role.description}</span> : null}
      </td>
      <td data-label="Type">
        <StatusChip
          label={role.isSystem ? 'System' : 'Custom'}
          tone={role.isSystem ? 'neutral' : 'info'}
        />
      </td>
      <td data-label="Status">
        <StatusChip
          label={role.isActive ? 'Active' : 'Inactive'}
          tone={role.isActive ? 'success' : 'neutral'}
        />
      </td>
      <td data-label="Assigned staff">{role.assignedCount}</td>
      <td data-label="Permissions">
        {role.isSystem && role.slug === 'super_admin' ? (
          'All modules'
        ) : (
          <span className={styles.permissionCell}>
            <span className={styles.permissionText}>
              {canView} of {MODULE_CATALOG.length} modules
            </span>
            <span
              className={styles.permissionMeter}
              role="img"
              aria-label={`${share}% of modules viewable`}
            >
              <span className={styles.permissionMeterFill} style={{ width: `${share}%` }} />
            </span>
          </span>
        )}
      </td>
      <td
        data-label="Actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={() => onEdit(role)}>
            Edit
          </Button>{' '}
          <Button size="sm" variant="danger" onClick={() => onDelete(role)}>
            Delete
          </Button>
        </span>
      </td>
    </tr>
  );
});

export function AfHomesRolesPage() {
  const queryClient = useQueryClient();
  const roles = useQuery({
    queryKey: ['afhomes', 'roles'],
    queryFn: getAfHomesRoles,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState<AfHomesRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AfHomesRole | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const resetPage = useCallback(() => setPage(1), []);

  const applyListUpdate = useCallback(
    (updater: (current: AfHomesRole[]) => AfHomesRole[]) => {
      queryClient.setQueryData<AfHomesRole[]>(['afhomes', 'roles'], (current) =>
        updater(current ?? []),
      );
    },
    [queryClient],
  );

  const mutation = useBusinessMutation({
    mutationFn: async (input: RoleFormInput) =>
      editing
        ? updateAfHomesRole(editing.id, input)
        : createAfHomesRole({ ...input, description: input.description || undefined }),
    onSuccess: async (saved) => {
      const wasEditing = editing !== null;
      const savedName = wasEditing ? editing?.name : saved.name;
      if (wasEditing) {
        applyListUpdate((current) => current.map((r) => (r.id === saved.id ? saved : r)));
      } else {
        applyListUpdate((current) => [saved, ...current]);
        resetPage();
      }
      setCreating(false);
      setEditing(null);
      notifySuccess({
        title: wasEditing ? 'Role saved' : 'Role created',
        message: `${savedName ?? 'Role'} saved.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['afhomes', 'roles'] });
    },
  });

  const remove = useBusinessMutation({
    mutationFn: (id: string) => deleteAfHomesRole(id),
    onSuccess: async (_data, id) => {
      applyListUpdate((current) => current.filter((r) => r.id !== id));
      setDeleting(null);
      setDeleteError(null);
      notifySuccess({ title: 'Role deleted', message: 'Role removed.' });
      void queryClient.invalidateQueries({ queryKey: ['afhomes', 'roles'] });
    },
    onError: (error) => {
      setDeleteError(error instanceof Error ? error.message : 'Delete failed.');
    },
  });

  const listed = useMemo(
    () => (roles.data ?? []).filter((role) => role.slug !== 'customer'),
    [roles.data],
  );
  const filtered = useMemo(
    () =>
      listed.filter(
        (role) =>
          (typeFilter === 'all' || (typeFilter === 'system') === role.isSystem) &&
          (statusFilter === 'all' || (statusFilter === 'active') === Boolean(role.isActive)) &&
          `${role.name} ${role.slug} ${role.description ?? ''}`
            .toLowerCase()
            .includes(debouncedSearch.trim().toLowerCase()),
      ),
    [listed, typeFilter, statusFilter, debouncedSearch],
  );
  const summary = useMemo(
    () => ({
      total: listed.length,
      system: listed.filter((role) => role.isSystem).length,
      custom: listed.filter((role) => !role.isSystem).length,
      assigned: listed.reduce((sum, role) => sum + role.assignedCount, 0),
    }),
    [listed],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  const filtersActive =
    debouncedSearch.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all';
  const clearFilters = useCallback(() => {
    setSearch('');
    setTypeFilter('all');
    setStatusFilter('all');
    resetPage();
  }, [resetPage]);

  const handleEdit = useCallback((role: AfHomesRole) => setEditing(role), []);
  const handleDelete = useCallback((role: AfHomesRole) => {
    setDeleteError(null);
    setDeleting(role);
  }, []);

  return (
    <section className={styles.page}>
      <PageHeader
        title="Roles & Permissions"
        description="Server controls role access only."
        actions={<Button onClick={() => setCreating(true)}>New custom role</Button>}
      />
      {roles.isPending ? (
        <div role="status" aria-label="Loading roles">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }} aria-hidden="true">
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={roles.refetch} />
      ) : listed.length === 0 ? (
        <EmptyState title="No roles" description="Create first custom role." />
      ) : (
        <>
          <div className={styles.summary}>
            <MetricCard
              label="Roles"
              value={summary.total}
              description="Staff roles"
              icon="users"
            />
            <MetricCard
              label="System"
              value={summary.system}
              description="Protected roles"
              icon="gear"
            />
            <MetricCard
              label="Custom"
              value={summary.custom}
              description="Created here"
              icon="plus"
            />
            <MetricCard
              label="Assigned staff"
              value={summary.assigned}
              description="Across all roles"
              icon="user-check"
            />
          </div>
          <FilterBar
            search={
              <SearchField
                label="Search roles"
                placeholder="Search name, key or description"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  resetPage();
                }}
              />
            }
            filters={
              <>
                <Select
                  aria-label="Filter role type"
                  value={typeFilter}
                  onChange={(event) => {
                    setTypeFilter(event.target.value);
                    resetPage();
                  }}
                  options={[
                    { value: 'all', label: 'All types' },
                    { value: 'system', label: 'System roles' },
                    { value: 'custom', label: 'Custom roles' },
                  ]}
                />
                <Select
                  aria-label="Filter role status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    resetPage();
                  }}
                  options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                />
                {filtersActive ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear
                  </Button>
                ) : null}
              </>
            }
          />
          {filtered.length === 0 ? (
            <EmptyState title="No roles match" description="No role matches filters." />
          ) : (
            <>
              <div
                role="region"
                aria-label="Scrollable records"
                tabIndex={0}
                className={`table-scroll ${styles.tableWrap}`}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Assigned staff</th>
                      <th>Permissions</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((role) => (
                      <RoleRow
                        key={role.id}
                        role={role}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <Pagination
                  page={safePage}
                  pageCount={pageCount}
                  onChange={setPage}
                  label="Roles pagination"
                />
                <p role="status">
                  Showing {rangeStart}-{rangeEnd} of {filtered.length}
                </p>
              </div>
            </>
          )}
        </>
      )}
      <AfHomesRoleFormDialog
        key={creating ? 'new-role' : (editing?.id ?? 'closed')}
        open={creating || editing !== null}
        role={editing}
        saving={mutation.isPending}
        error={mutation.error}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          mutation.reset();
        }}
        onSave={(input) => mutation.mutate(input)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
          remove.reset();
        }}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        title="Delete role?"
        message={
          <div>
            <p>Delete {deleting?.name}? System roles stay protected.</p>
            {deleteError ? <p role="alert">{deleteError}</p> : null}
          </div>
        }
        danger
        confirmLabel="Delete role"
        confirmLoading={remove.isPending}
      />
    </section>
  );
}
