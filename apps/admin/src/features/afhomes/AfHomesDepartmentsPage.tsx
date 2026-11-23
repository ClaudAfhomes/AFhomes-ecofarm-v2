import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import type { AfHomesDepartment } from '@afhomes/contracts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchField,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import {
  createAfHomesDepartment,
  deleteAfHomesDepartment,
  getAfHomesDepartments,
  updateAfHomesDepartment,
} from './services';
import styles from './AfHomesDepartmentsPage.module.css';

const DEPARTMENTS_KEY = ['afhomes', 'departments'];

const PAGE_SIZE = 10;

export function AfHomesDepartmentsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: DEPARTMENTS_KEY,
    queryFn: getAfHomesDepartments,
    // Refetches keep the previous rows visible instead of blanking the table.
    placeholderData: keepPreviousData,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AfHomesDepartment | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<AfHomesDepartment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return query.data ?? [];
    return (query.data ?? []).filter((d) => d.name.toLowerCase().includes(term));
  }, [query.data, search]);
  const total = query.data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, rows.length);

  const openCreate = () => {
    setEditing(null);
    setName('');
    save.reset();
    setFormOpen(true);
  };
  const openEdit = (department: AfHomesDepartment) => {
    setEditing(department);
    setName(department.name);
    save.reset();
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    save.reset();
  };

  const save = useBusinessMutation({
    mutationFn: () =>
      editing
        ? updateAfHomesDepartment(editing.id, { name: name.trim() })
        : createAfHomesDepartment({ name: name.trim() }),
    onSuccess: (saved) => {
      if (editing) {
        client.setQueryData<AfHomesDepartment[]>(DEPARTMENTS_KEY, (current) =>
          (current ?? []).map((d) => (d.id === saved.id ? saved : d)),
        );
        notifySuccess({ title: 'Department saved', message: `${saved.name} saved.` });
      } else {
        client.setQueryData<AfHomesDepartment[]>(DEPARTMENTS_KEY, (current) => [
          saved,
          ...(current ?? []),
        ]);
        notifySuccess({ title: 'Department created', message: `${saved.name} created.` });
      }
      closeForm();
      void client.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
    },
  });

  const remove = useBusinessMutation({
    mutationFn: (id: string) => deleteAfHomesDepartment(id),
    onSuccess: async (_data, id) => {
      client.setQueryData<AfHomesDepartment[]>(DEPARTMENTS_KEY, (current) =>
        (current ?? []).filter((d) => d.id !== id),
      );
      setDeleting(null);
      setDeleteError(null);
      notifySuccess({ title: 'Department deleted', message: 'Department removed.' });
      void client.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
    },
    onError: (error) => {
      setDeleteError(error instanceof Error ? error.message : 'Delete failed.');
    },
  });

  return (
    <section className={styles.page}>
      <PageHeader
        title="Departments"
        description={`${total} units for staff assignment.`}
        actions={<Button onClick={openCreate}>New department</Button>}
      />
      <div className={styles.toolbar}>
        <SearchField
          label="Search departments"
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search name"
        />
      </div>
      {query.isPending ? (
        <div role="status" aria-label="Loading departments">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }} aria-hidden="true">
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState
          title="No departments"
          description="Create an organization department."
          action={<Button onClick={openCreate}>New department</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No matches"
          description="Try a different search."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
            >
              Clear search
            </Button>
          }
        />
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
                  <th>Department Name</th>
                  <th>Staff</th>
                  <th className={styles.actionsHead}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Department Name">
                      <span className={styles.identityCell}>
                        <span className={styles.identityAvatar} aria-hidden="true">
                          {d.name.trim().charAt(0).toUpperCase() || '•'}
                        </span>
                        <span className={styles.identityName}>{d.name}</span>
                      </span>
                    </td>
                    <td data-label="Staff">
                      <StatusChip
                        label={d.staffCount === 0 ? 'Empty' : `${d.staffCount} staff`}
                        tone={d.staffCount === 0 ? 'neutral' : 'info'}
                      />
                    </td>
                    <td data-label="Actions">
                      <span className={styles.actionsCell}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(d)}>
                          Edit
                        </Button>{' '}
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={d.staffCount > 0}
                          title={
                            d.staffCount > 0
                              ? 'Reassign staff before deleting.'
                              : 'Delete this department.'
                          }
                          onClick={() => {
                            setDeleteError(null);
                            remove.reset();
                            setDeleting(d);
                          }}
                        >
                          Delete
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <Pagination
              page={safePage}
              pageCount={pageCount}
              onChange={setPage}
              label="Departments pagination"
            />
            <p role="status">
              Showing {rangeStart}-{rangeEnd} of {rows.length}
            </p>
          </div>
        </>
      )}
      <Dialog
        open={formOpen}
        onClose={closeForm}
        title={editing ? 'Edit department' : 'Create department'}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <TextField
            id="department-name"
            name="name"
            label="Department Name"
            value={name}
            onChange={setName}
          />
          {save.error ? <p role="alert">{save.error.message}</p> : null}
        </div>
      </Dialog>
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
        title="Delete department?"
        message={
          <div>
            <p>Delete {deleting?.name}? This cannot be undone.</p>
            {deleteError ? <p role="alert">{deleteError}</p> : null}
          </div>
        }
        danger
        confirmLabel="Delete department"
        confirmLoading={remove.isPending}
      />
    </section>
  );
}
