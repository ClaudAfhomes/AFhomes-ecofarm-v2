import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
} from '@jad/ui';
import type { AfHomesStaff } from '@jad/contracts';
import { useSession } from '../../lib/session';
import {
  deactivateAfHomesStaff,
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaff,
  inviteAfHomesStaff,
  updateAfHomesStaff,
} from './services';

type Restriction = AfHomesStaff['restrictions'][number];
export function AfHomesStaffPage() {
  const client = useQueryClient();
  const { user } = useSession();
  const staff = useQuery({ queryKey: ['afhomes', 'staff'], queryFn: getAfHomesStaff });
  const roles = useQuery({ queryKey: ['afhomes', 'roles'], queryFn: getAfHomesRoles });
  const departments = useQuery({
    queryKey: ['afhomes', 'departments'],
    queryFn: getAfHomesDepartments,
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [editing, setEditing] = useState<AfHomesStaff | null>(null);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [accountAction, setAccountAction] = useState<{
    kind: 'deactivate' | 'delete';
    staff: AfHomesStaff;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const invite = useMutation({
    mutationFn: () =>
      inviteAfHomesStaff({ fullName, email, roleId, departmentId: departmentId || null }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setInviteOpen(false);
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
  const rows = useMemo(
    () =>
      staff.data?.filter(
        (item) =>
          (status === 'all' || item.status === status) &&
          `${item.fullName} ${item.email}`.toLowerCase().includes(search.toLowerCase()),
      ) ?? [],
    [staff.data, status, search],
  );
  const activeRoles = roles.data?.filter((role) => role.isActive) ?? [];
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
  return (
    <section>
      <PageHeader
        title="Staff"
        description="Secure Auth invitations, department and role assignments, status, and deny-only overrides"
        actions={
          <Button
            onClick={() => {
              setRoleId(activeRoles[0]?.id ?? '');
              setInviteOpen(true);
            }}
          >
            Invite staff
          </Button>
        }
      />
      <FilterBar
        search={
          <SearchField
            label="Search staff"
            placeholder="Search name or email"
            value={search}
            onChange={setSearch}
          />
        }
        filters={
          <Select
            aria-label="Filter status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={['all', 'invited', 'active', 'inactive', 'suspended'].map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
            }))}
          />
        }
      />
      {staff.isPending ? (
        <p role="status">Loading staff…</p>
      ) : staff.isError ? (
        <ErrorState error={staff.error} onRetry={staff.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No staff found" description="Invite staff or adjust your filters." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.fullName}</strong>
                    <br />
                    <small>{item.email}</small>
                  </td>
                  <td>{item.departmentName ?? 'Unassigned'}</td>
                  <td>{item.roleName}</td>
                  <td>
                    <StatusChip
                      label={item.status}
                      tone={
                        item.status === 'active'
                          ? 'success'
                          : item.status === 'suspended'
                            ? 'danger'
                            : 'neutral'
                      }
                    />
                  </td>
                  <td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite staff member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!fullName || !email || !roleId || invite.isPending}
              onClick={() => invite.mutate()}
            >
              {invite.isPending ? 'Sending…' : 'Send secure invite'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
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
          <p>
            No password is generated or stored. Supabase Auth sends the password-setup invitation.
          </p>
          {invite.error ? <p role="alert">{invite.error.message}</p> : null}
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
    </section>
  );
}
