import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  StatusChip,
  TextField,
} from '@jad/ui';
import type { AfHomesStaff } from '@jad/contracts';
import { useSession } from '../../lib/session';
import {
  createAfHomesStaff,
  deactivateAfHomesStaff,
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaff,
  isTestStaffEmail,
  purgeTestAfHomesStaff,
  updateAfHomesStaff,
} from './services';

const PAGE_SIZE = 10;

type Restriction = AfHomesStaff['restrictions'][number];

function statusTone(status: AfHomesStaff['status']): 'success' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral';
}

export function AfHomesStaffPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();  const staff = useQuery({ queryKey: ['afhomes', 'staff'], queryFn: getAfHomesStaff });
  const roles = useQuery({ queryKey: ['afhomes', 'roles'], queryFn: getAfHomesRoles });
  const departments = useQuery({
    queryKey: ['afhomes', 'departments'],
    queryFn: getAfHomesDepartments,
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editing, setEditing] = useState<AfHomesStaff | null>(null);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [accountAction, setAccountAction] = useState<{
    kind: 'deactivate' | 'delete';
    staff: AfHomesStaff;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [purgeTarget, setPurgeTarget] = useState<AfHomesStaff | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const canPurgeTest =
    user?.roleSlug === 'super_admin' && user.testPurgeEnabled === true;

  const resetCreate = () => {
    setFullName('');
    setEmail('');
    setRoleId('');
    setDepartmentId('');
    setTemporaryPassword('');
    setConfirmPassword('');
  };

  const createErrors = useMemo(() => {
    const errors: { email?: string; temporaryPassword?: string; confirmPassword?: string } = {};
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = 'Enter a valid email address.';
    if (temporaryPassword && temporaryPassword.length < 8)
      errors.temporaryPassword = 'Use at least 8 characters.';
    if (confirmPassword && temporaryPassword !== confirmPassword)
      errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }, [email, temporaryPassword, confirmPassword]);
  const createValid =
    fullName.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    roleId.length > 0 &&
    temporaryPassword.length >= 8 &&
    temporaryPassword === confirmPassword;

  const create = useMutation({
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
  const update = useMutation({
    mutationFn: () => updateAfHomesStaff(editing!.id, { restrictions }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setEditing(null);
    },
  });
  const changeAccount = useMutation({
    mutationFn: async () => {
      if (accountAction?.kind === 'delete') await deleteAfHomesStaff(accountAction.staff.id);
      else await deactivateAfHomesStaff(accountAction!.staff.id);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setAccountAction(null);
      setConfirmation('');
    },
  });
  const purgeTestAccount = useMutation({
    mutationFn: () => purgeTestAfHomesStaff(purgeTarget!.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setPurgeTarget(null);
      setPurgeConfirmation('');
    },
  });
  const filtered = useMemo(
    () =>
      staff.data?.filter(
        (item) =>
          (status === 'all' || item.status === status) &&
          (roleFilter === 'all' || item.roleId === roleFilter) &&
          `${item.fullName} ${item.email}`.toLowerCase().includes(search.toLowerCase()),
      ) ?? [],
    [staff.data, status, roleFilter, search],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeRoles = roles.data?.filter((role) => role.isActive) ?? [];
  const filtersActive = search !== '' || status !== 'all' || roleFilter !== 'all';
  const openRestrictions = (member: AfHomesStaff) => {
    const role = roles.data?.find((item) => item.id === member.roleId);
    setRestrictions(
      (role?.permissions ?? [])
        .filter((p) => p.canView)
        .map(
          (p) =>
            member.restrictions.find((r) => r.moduleKey === p.moduleKey) ?? {
              moduleKey: p.moduleKey,
              denyView: false,
              denyCreate: false,
              denyUpdate: false,
              denyDelete: false,
            },
        ),
    );
    setEditing(member);
  };
  const toggle = (key: string, field: keyof Omit<Restriction, 'moduleKey'>) =>
    setRestrictions((current) =>
      current.map((item) => (item.moduleKey === key ? { ...item, [field]: !item[field] } : item)),
    );
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setRoleFilter('all');
    setPage(1);
  };
  return (
    <section>
      <PageHeader
        title="Staff"
        description="Admin users and their roles (role changes are audited)"
        actions={
          <Button
            onClick={() => {
              resetCreate();
              setRoleId(activeRoles[0]?.id ?? '');
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
            placeholder="Search name or email"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
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
                ...activeRoles.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            <Select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={['all', 'invited', 'active', 'inactive', 'suspended'].map((value) => ({
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
        <p role="status">Loading staff…</p>
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th />
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
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <strong>{item.fullName}</strong>
                      <br />
                      <small>{item.email}</small>
                    </td>
                    <td>
                      <StatusChip label={item.roleName} tone="neutral" />
                    </td>
                    <td>
                      <StatusChip label={item.status} tone={statusTone(item.status)} />
                    </td>
                    <td>
                      <small>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</small>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Button variant="secondary" onClick={() => openRestrictions(item)}>
                        Restrictions
                      </Button>
                      {item.id !== user?.id && item.status !== 'inactive' ? (
                        <>
                          {' '}
                          <Button
                            variant="secondary"
                            onClick={() => setAccountAction({ kind: 'deactivate', staff: item })}
                          >
                            Deactivate
                          </Button>
                        </>
                      ) : null}
                      {user?.roleSlug === 'super_admin' && item.id !== user.id ? (
                        <>
                          {' '}
                          <Button
                            variant="danger"
                            onClick={() => setAccountAction({ kind: 'delete', staff: item })}
                          >
                            Delete Permanently
                          </Button>
                        </>
                      ) : null}
                      {canPurgeTest && item.id !== user?.id && isTestStaffEmail(item.email) ? (
                        <>
                          {' '}
                          <Button variant="danger" onClick={() => setPurgeTarget(item)}>
                            Purge Test Account
                          </Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p role="status">
            {filtered.length} staff member(s) · page {safePage} of {pageCount}
          </p>
          {pageCount > 1 ? (
            <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
          ) : null}
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
        <div style={{ display: 'grid', gap: 12 }}>
          <TextField
            id="staff-name"
            name="staff-name"
            label="Full name"
            value={fullName}
            onChange={setFullName}
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
          <label>
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
          <label>
            Role
            <Select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              options={activeRoles.map((r) => ({ value: r.id, label: r.name }))}
            />
          </label>
          <PasswordField
            id="staff-temp-password"
            label="Temporary password"
            value={temporaryPassword}
            onChange={setTemporaryPassword}
            autoComplete="new-password"
            hint="At least 8 characters. Share it with the new member directly — it is never emailed or stored."
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
          <Alert variant="info" title="First login">
            The new member signs in with this password and must set their own before the admin
            panel unlocks.
          </Alert>
          {create.error ? <p role="alert">{create.error.message}</p> : null}
        </div>
      </Dialog>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Restrict ${editing?.fullName ?? 'staff access'}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={update.isPending} onClick={() => update.mutate()}>
              Save restrictions
            </Button>
          </>
        }
      >
        <p>Overrides can only remove access granted by the role.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Deny view</th>
                <th>Deny create</th>
                <th>Deny update</th>
                <th>Deny delete</th>
              </tr>
            </thead>
            <tbody>
              {restrictions.map((r) => (
                <tr key={r.moduleKey}>
                  <td>{r.moduleKey}</td>
                  {(['denyView', 'denyCreate', 'denyUpdate', 'denyDelete'] as const).map(
                    (field) => (
                      <td key={field}>
                        <input
                          type="checkbox"
                          aria-label={`${r.moduleKey} ${field}`}
                          checked={r[field]}
                          onChange={() => toggle(r.moduleKey, field)}
                        />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {update.error ? <p role="alert">{update.error.message}</p> : null}
      </Dialog>
      <ConfirmDialog
        open={accountAction !== null}
        onCancel={() => {
          setAccountAction(null);
          setConfirmation('');
        }}
        onConfirm={() => changeAccount.mutate()}
        title={
          accountAction?.kind === 'delete'
            ? 'Permanently Delete Staff Account'
            : 'Deactivate Staff Account'
        }
        message={
          <div>
            <p>
              {accountAction?.kind === 'delete'
                ? 'This action permanently removes the login/account if no protected business records exist. This cannot be undone.'
                : 'This user will no longer be able to access the AF Homes staff system. Historical records will remain.'}
            </p>
            {accountAction?.kind === 'delete' ? (
              <label>
                Type DELETE to confirm
                <input
                  aria-label="Type DELETE to confirm staff deletion"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            ) : null}
            {changeAccount.error ? <p role="alert">{changeAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel={accountAction?.kind === 'delete' ? 'Delete Permanently' : 'Confirm'}
        confirmDisabled={accountAction?.kind === 'delete' && confirmation !== 'DELETE'}
        confirmLoading={changeAccount.isPending}
      />
      <ConfirmDialog
        open={purgeTarget !== null}
        onCancel={() => {
          setPurgeTarget(null);
          setPurgeConfirmation('');
        }}
        onConfirm={() => purgeTestAccount.mutate()}
        title="Purge Test Account"
        message={
          <div>
            <p>
              TEST DATA PURGE. This permanently deletes the test account
              {purgeTarget ? ` ${purgeTarget.email}` : ''} and related test records. This
              action cannot be undone. Real business data is never purged: anything
              shared or non-test blocks the purge instead.
            </p>
            <label>
              Type PURGE to confirm
              <input
                aria-label="Type PURGE to confirm test account purge"
                value={purgeConfirmation}
                onChange={(event) => setPurgeConfirmation(event.target.value)}
              />
            </label>
            {purgeTestAccount.error ? <p role="alert">{purgeTestAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel="Purge Test Account"
        confirmDisabled={purgeConfirmation !== 'PURGE'}
        confirmLoading={purgeTestAccount.isPending}
      />
    </section>
  );
}
