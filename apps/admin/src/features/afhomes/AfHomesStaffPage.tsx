import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  notifySuccess,
  PageHeader,
  Pagination,
  PasswordField,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import { PERSON_NAME_RE, type AfHomesStaff } from '@afhomes/contracts';
import { normalizeLiveHumanField } from '../../lib/normalize';
import { formatDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './AfHomesStaffPage.module.css';
import {
  createAfHomesStaff,
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaff,
  updateAfHomesStaff,
} from './services';

const PAGE_SIZE = 10;

/**
 * Sales-hierarchy roles live in genealogy / the sale-team desk, never in the
 * Staff directory. They are filtered out of the list, the role filter and the
 * create/edit role pickers. The server stays the authority; this is UX only.
 */
const HIERARCHY_SLUGS = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];

function statusTone(status: AfHomesStaff['status']): 'success' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral';
}

export function AfHomesStaffPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const staff = useQuery({
    queryKey: ['afhomes', 'staff'],
    queryFn: getAfHomesStaff,
    // Refetches keep the previous directory visible instead of blanking it.
    placeholderData: keepPreviousData,
  });
  const roles = useQuery({
    queryKey: ['afhomes', 'roles'],
    queryFn: getAfHomesRoles,
    placeholderData: keepPreviousData,
  });
  const departments = useQuery({
    queryKey: ['afhomes', 'departments'],
    queryFn: getAfHomesDepartments,
    placeholderData: keepPreviousData,
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountAction, setAccountAction] = useState<{
    staff: AfHomesStaff;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [editor, setEditor] = useState<AfHomesStaff | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [editDepartmentId, setEditDepartmentId] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active');

  const resetCreate = () => {
    setFullName('');
    setEmail('');
    setRoleId('');
    setDepartmentId('');
    setTemporaryPassword('');
    setConfirmPassword('');
  };

  const createErrors = useMemo(() => {
    const errors: {
      fullName?: string;
      email?: string;
      temporaryPassword?: string;
      confirmPassword?: string;
    } = {};
    if (fullName && !PERSON_NAME_RE.test(fullName.trim()))
      errors.fullName = 'Use letters, spaces, apostrophes and hyphens only - no numbers.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = 'Enter a valid email address.';
    if (temporaryPassword && temporaryPassword.length < 8)
      errors.temporaryPassword = 'Use at least 8 characters.';
    if (confirmPassword && temporaryPassword !== confirmPassword)
      errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }, [fullName, email, temporaryPassword, confirmPassword]);
  const createValid =
    fullName.trim().length > 0 &&
    PERSON_NAME_RE.test(fullName.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    roleId.length > 0 &&
    temporaryPassword.length >= 8 &&
    temporaryPassword === confirmPassword;

  const create = useBusinessMutation({
    mutationFn: () =>
      createAfHomesStaff({
        fullName: fullName.trim(),
        email: email.trim(),
        roleId,
        departmentId: departmentId || null,
        temporaryPassword,
      }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setCreateOpen(false);
      resetCreate();
      notifySuccess({
        title: 'Staff member created',
        message: `${created.fullName} was added with an ACTIVE status.`,
      });
    },
  });
  const changeAccount = useBusinessMutation({
    mutationFn: async () => {
      await deleteAfHomesStaff(accountAction!.staff.id);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setAccountAction(null);
      setConfirmation('');
    },
  });
  const saveEditor = useBusinessMutation({
    mutationFn: () =>
      updateAfHomesStaff(editor!.id, {
        roleId: editRoleId,
        departmentId: editDepartmentId || null,
        status: editStatus,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setEditor(null);
      notifySuccess({ title: 'Staff updated', message: 'Staff record saved.' });
    },
  });
  const openEditor = (member: AfHomesStaff) => {
    setEditor(member);
    setEditRoleId(member.roleId);
    setEditDepartmentId(member.departmentId ?? '');
    setEditStatus(member.status === 'suspended' ? 'suspended' : 'active');
    saveEditor.reset();
  };
  const roleSlugById = useMemo(
    () => new Map((roles.data ?? []).map((role) => [role.id, role.slug] as const)),
    [roles.data],
  );
  const isHierarchy = (item: AfHomesStaff) =>
    HIERARCHY_SLUGS.includes(roleSlugById.get(item.roleId) ?? '');
  const isSuperAdmin = (item: AfHomesStaff) => roleSlugById.get(item.roleId) === 'super_admin';
  const filtered = useMemo(
    () =>
      staff.data?.filter(
        (item) =>
          !isHierarchy(item) &&
          (status === 'all' || item.status === status) &&
          (roleFilter === 'all' || item.roleId === roleFilter) &&
          `${item.fullName} ${item.email} ${item.employeeNumber ?? ''}`
            .toLowerCase()
            .includes(debouncedSearch.toLowerCase()),
      ) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staff.data, status, roleFilter, debouncedSearch, roles.data],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeRoles = roles.data?.filter((role) => role.isActive && role.slug !== 'customer') ?? [];
  // Staff pickers never offer hierarchy roles or Customer: those accounts are
  // managed in genealogy / the sale-team desk, not here.
  const assignableRoles = activeRoles.filter((role) => !HIERARCHY_SLUGS.includes(role.slug));
  const selectedRole = assignableRoles.find((role) => role.id === roleId);
  const selectedRoleDescription = selectedRole
    ? `${selectedRole.assignedCount} staff hold this role.`
    : null;
  const filtersActive = search !== '' || status !== 'all' || roleFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setRoleFilter('all');
    setPage(1);
  };
  return (
    <section className={styles.page}>
      <PageHeader
        title="Staff"
        description="Staff accounts and assigned roles."
        actions={
          <Button
            onClick={() => {
              resetCreate();
              setRoleId(assignableRoles[0]?.id ?? '');
              setCreateOpen(true);
            }}
          >
            New Staff
          </Button>
        }
      />
      <FilterBar
        search={
          <SearchField
            label="Search staff"
            placeholder="Search name, email or code"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            busy={staff.isFetching && !staff.isPending}
          />
        }
        filters={
          <>
            <Select
              aria-label="Filter role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'All roles' },
                ...assignableRoles.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            <Select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={['all', 'active', 'suspended'].map((value) => ({
                value,
                label: value[0]!.toUpperCase() + value.slice(1),
              }))}
            />
            {filtersActive ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
          </>
        }
      />
      {staff.isPending ? (
        <div role="status" aria-label="Loading staff" className={styles.tableWrap}>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }} aria-hidden="true">
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      ) : staff.isError ? (
        <ErrorState error={staff.error} onRetry={staff.refetch} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No staff found"
          description={
            filtersActive ? 'No staff match these filters.' : 'Add the first staff member.'
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
                  <th>Code</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`View staff member ${item.fullName}`}
                    onClick={() => navigate(`/admin/staff/${item.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/admin/staff/${item.id}`);
                    }}
                    className={styles.clickable}
                  >
                    <td data-label="Code">
                      <span className={styles.codeCell}>{item.employeeNumber ?? '—'}</span>
                    </td>
                    <td data-label="Name">
                      <span className={styles.identityCell}>
                        <span className={styles.identityAvatar} aria-hidden="true">
                          {(item.fullName.trim().charAt(0) || '-').toUpperCase()}
                        </span>
                        <span className={styles.identityName}>{item.fullName}</span>
                      </span>
                    </td>
                    <td data-label="Email">
                      <span className={styles.emailCell}>{item.email}</span>
                    </td>
                    <td data-label="Role">
                      <StatusChip label={item.roleName} tone="neutral" />
                    </td>
                    <td data-label="Status">
                      <StatusChip label={item.status} tone={statusTone(item.status)} />
                    </td>
                    <td data-label="Added">
                      <small>{item.createdAt ? formatDate(item.createdAt) : '-'}</small>
                    </td>
                    <td
                      data-label="Actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {!(isSuperAdmin(item) && user?.roleSlug !== 'super_admin') ? (
                        <Button size="sm" variant="secondary" onClick={() => openEditor(item)}>
                          Edit
                        </Button>
                      ) : null}
                      {user?.roleSlug === 'super_admin' &&
                      item.id !== user.id &&
                      !isSuperAdmin(item) ? (
                        <>
                          {' '}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setAccountAction({ staff: item })}
                          >
                            Delete
                          </Button>
                        </>
                      ) : null}
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
              label="Staff pagination"
            />
          </div>
        </>
      )}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New staff member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!createValid || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create staff'}
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Identity</legend>
            <p className={styles.sectionHint}>Who this account belongs to.</p>
            <div className={styles.formFields}>
              <TextField
                id="staff-name"
                name="staff-name"
                label="Full name"
                value={fullName}
                suggestName
                normalize={(value) => normalizeLiveHumanField('fullName', value)}
                onChange={setFullName}
                error={createErrors.fullName}
                autoComplete="name"
              />
              <TextField
                id="staff-email"
                name="staff-email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                error={createErrors.email}
              />
            </div>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Assignment</legend>
            <p className={styles.sectionHint}>Exactly one role and one department.</p>
            <div className={styles.formFields}>
              <label className={styles.fieldLabel}>
                Department
                <Select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...(departments.data ?? [])
                      .filter((d) => d.isActive)
                      .map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </label>
              <label className={styles.fieldLabel}>
                Role
                <Select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  options={assignableRoles.map((r) => ({ value: r.id, label: r.name }))}
                />
              </label>
              {selectedRoleDescription ? (
                <p className={styles.roleHint}>{selectedRoleDescription}</p>
              ) : null}
            </div>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>First sign-in</legend>
            <p className={styles.sectionHint}>Member sets own password later.</p>
            <div className={styles.formFields}>
              <PasswordField
                id="staff-temp-password"
                label="Temporary password"
                value={temporaryPassword}
                onChange={setTemporaryPassword}
                autoComplete="new-password"
                hint="At least 8 characters. Share it privately only."
                error={createErrors.temporaryPassword}
              />
              <PasswordField
                id="staff-temp-password-confirm"
                label="Confirm temporary password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                error={createErrors.confirmPassword}
              />
            </div>
          </fieldset>
          <Alert variant="info" title="First login">
            First sign-in needs password change.
          </Alert>
          {create.error ? <p role="alert">{create.error.message}</p> : null}
        </div>
      </Dialog>
      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={`Edit ${editor?.fullName ?? 'staff'}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button
              disabled={saveEditor.isPending || !editRoleId}
              onClick={() => saveEditor.mutate()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <div className={styles.formFields}>
            <label className={styles.fieldLabel}>
              Role
              <Select
                aria-label="Edit role"
                value={editRoleId}
                onChange={(e) => setEditRoleId(e.target.value)}
                options={assignableRoles.map((r) => ({ value: r.id, label: r.name }))}
              />
            </label>
            <label className={styles.fieldLabel}>
              Department
              <Select
                aria-label="Edit department"
                value={editDepartmentId}
                onChange={(e) => setEditDepartmentId(e.target.value)}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...(departments.data ?? [])
                    .filter((d) => d.isActive)
                    .map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            </label>
            <label className={styles.fieldLabel}>
              Status
              <Select
                aria-label="Edit status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as 'active' | 'suspended')}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'suspended', label: 'Suspended' },
                ]}
              />
            </label>
          </div>
          {saveEditor.error ? <p role="alert">{saveEditor.error.message}</p> : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={accountAction !== null}
        onCancel={() => {
          setAccountAction(null);
          setConfirmation('');
        }}
        onConfirm={() => changeAccount.mutate()}
        title="Delete Staff Account"
        message={
          <div>
            <p>Remove login if records allow. This cannot be undone.</p>
            <TextField
              id="staff-delete-confirm"
              name="deleteConfirm"
              label="Type DELETE to confirm staff deletion"
              value={confirmation}
              onChange={setConfirmation}
            />
            {changeAccount.error ? <p role="alert">{changeAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel="Delete"
        confirmDisabled={confirmation !== 'DELETE'}
        confirmLoading={changeAccount.isPending}
      />
    </section>
  );
}
