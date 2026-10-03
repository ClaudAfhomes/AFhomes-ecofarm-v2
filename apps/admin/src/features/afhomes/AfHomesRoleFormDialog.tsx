import { useState } from 'react';
import { Button, Dialog } from '@jad/ui';
import { afHomesModuleKeySchema, type AfHomesPermission, type AfHomesRole } from '@jad/contracts';

const MODULES = afHomesModuleKeySchema.options;
const blankPermissions = (): AfHomesPermission[] =>
  MODULES.map((moduleKey) => ({
    moduleKey,
    canView: false,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  }));

export interface RoleFormInput {
  name: string;
  description: string;
  isActive: boolean;
  permissions: AfHomesPermission[];
}

export function AfHomesRoleFormDialog({
  open,
  role,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  role: AfHomesRole | null;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (input: RoleFormInput) => void;
}) {
  // Form state mounts fresh per open session: callers pass a `key` that
  // changes with each open (new vs. which role), so initializers below run
  // exactly on open and no effect-sync is needed.
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [active, setActive] = useState(role?.isActive ?? true);
  const [permissions, setPermissions] = useState<AfHomesPermission[]>(() =>
    role
      ? MODULES.map(
          (key) =>
            role.permissions.find((p) => p.moduleKey === key) ??
            blankPermissions().find((p) => p.moduleKey === key)!,
        )
      : blankPermissions(),
  );

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
    <Dialog
      open={open}
      onClose={onClose}
      title={role ? `Edit ${role.name}` : 'Create custom role'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || saving}
            onClick={() => onSave({ name, description, isActive: active, permissions })}
          >
            {saving ? 'Saving…' : 'Save role'}
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
        {error ? <p role="alert">{error.message}</p> : null}
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
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
      </div>
    </Dialog>
  );
}

// Re-exported for callers that seed the permission matrix shape.
export { blankPermissions };
