import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import { afHomesModuleKeySchema, type AfHomesPermission } from '@jad/contracts';
import {
  createAfHomesRole,
  getAfHomesRoleAudit,
  getAfHomesRoles,
  updateAfHomesRole,
} from './services';

const MODULES = afHomesModuleKeySchema.options;
const blankPermissions = (): AfHomesPermission[] =>
  MODULES.map((moduleKey) => ({
    moduleKey,
    canView: false,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  }));

export function AfHomesRolesPage() {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['afhomes', 'roles'], queryFn: getAfHomesRoles });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [permissions, setPermissions] = useState(blankPermissions);
  const editing = useMemo(
    () => roles.data?.find((role) => role.id === editingId),
    [roles.data, editingId],
  );
  const roleAudit = useQuery({
    queryKey: ['afhomes', 'roles', editingId, 'audit'],
    queryFn: () => getAfHomesRoleAudit(editingId!),
    enabled: Boolean(editingId && open),
  });
  const mutation = useMutation({
    mutationFn: async () =>
      editingId
        ? updateAfHomesRole(editingId, { name, description, isActive: active, permissions })
        : createAfHomesRole({ name, description, isActive: active, permissions }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['afhomes', 'roles'] });
      setOpen(false);
    },
  });
  const launch = (id?: string) => {
    const role = id ? roles.data?.find((item) => item.id === id) : undefined;
    setEditingId(id ?? null);
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setActive(role?.isActive ?? true);
    setPermissions(
      role
        ? MODULES.map(
            (key) =>
              role.permissions.find((p) => p.moduleKey === key) ??
              blankPermissions().find((p) => p.moduleKey === key)!,
          )
        : blankPermissions(),
    );
    setOpen(true);
  };
  const toggle = (key: string, action: keyof Omit<AfHomesPermission, 'moduleKey'>) =>
    setPermissions((current) =>
      current.map((permission) => {
        if (permission.moduleKey !== key) return permission;
        const next = { ...permission, [action]: !permission[action] };
        if (action !== 'canView' && next[action]) next.canView = true;
        if (action === 'canView' && !next.canView)
          Object.assign(next, { canCreate: false, canUpdate: false, canDelete: false });
        return next;
      }),
    );
  return (
    <section>
      <PageHeader
        title="Roles & Permissions"
        description="Server-enforced AF Homes module permissions and protected system roles"
        actions={<Button onClick={() => launch()}>New custom role</Button>}
      />
      {roles.isPending ? (
        <p role="status">Loading roles…</p>
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={roles.refetch} />
      ) : roles.data?.length === 0 ? (
        <EmptyState title="No roles" description="Create the first custom role." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>Assigned staff</th>
                <th>Permissions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roles.data?.map((role) => (
                <tr key={role.id}>
                  <td>
                    <strong>{role.name}</strong>
                    <br />
                    <small>{role.description || role.slug}</small>
                  </td>
                  <td>
                    <StatusChip
                      label={role.isActive ? 'Active' : 'Inactive'}
                      tone={role.isActive ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>{role.assignedCount}</td>
                  <td>
                    {role.isSystem && role.slug === 'super_admin'
                      ? 'All modules'
                      : `${role.permissions.filter((p) => p.canView).length} modules`}
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={role.isSystem}
                      onClick={() => launch(role.id)}
                    >
                      {role.isSystem ? 'Protected' : 'Edit'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Create custom role'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? 'Saving…' : 'Save role'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
            Active
          </label>
          {mutation.error ? <p role="alert">{mutation.error.message}</p> : null}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Module</th>
                  <th>View</th>
                  <th>Create</th>
                  <th>Update</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => (
                  <tr key={p.moduleKey}>
                    <td>{p.moduleKey}</td>
                    {(['canView', 'canCreate', 'canUpdate', 'canDelete'] as const).map((action) => (
                      <td key={action}>
                        <input
                          aria-label={`${p.moduleKey} ${action}`}
                          type="checkbox"
                          checked={p[action]}
                          onChange={() => toggle(p.moduleKey, action)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing ? (
            <section>
              <h3>Audit history</h3>
              {roleAudit.isPending ? (
                <p role="status">Loading audit history…</p>
              ) : roleAudit.data?.length ? (
                <ul>
                  {roleAudit.data.map((event) => (
                    <li key={String(event.id)}>
                      {event.action} · {new Date(event.created_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No role changes recorded yet.</p>
              )}
            </section>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
