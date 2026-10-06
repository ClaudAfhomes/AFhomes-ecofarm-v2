import { useState } from 'react';
import { Button, Dialog } from '@jad/ui';
import { afHomesModuleKeySchema, type AfHomesPermission, type AfHomesRole } from '@jad/contracts';
import { useSession } from '../../lib/session';

const MODULES = afHomesModuleKeySchema.options;
const blankPermissions = (): AfHomesPermission[] =>
  MODULES.map((moduleKey) => ({
    moduleKey,
    canView: false,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  }));

/**
 * Whether a role's access is locked for the viewer.
 *
 * ONE definition, on purpose. This predicate used to be written out three times:
 * the list-page button, the detail-page button and this dialog. The copies
 * disagreed - the list page knew only `admin`/`super_admin` and forgot both
 * `customer` and the system-role rule - so a non-Super-Admin was shown an
 * "Edit access" button on the `employee` role and then received a disabled
 * "View Employee access" dialog. That is the reported symptom, and it was a
 * label disagreeing with its own gate, not a missing permission.
 *
 * `admin`, `super_admin` and `customer` are never editable by anyone, and no
 * non-Super-Admin may edit a system role. This mirrors the server gate in
 * `api/_handlers/admin/afhomes.ts`, which is the real boundary - this only
 * decides what the screen claims.
 */
export function isRoleAccessProtected(
  role: { slug: string; isSystem: boolean } | null | undefined,
  viewerRoleSlug: string | undefined,
): boolean {
  if (!role) return false;
  return (
    ['admin', 'super_admin', 'customer'].includes(role.slug) ||
    (role.isSystem && viewerRoleSlug !== 'super_admin')
  );
}

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
  const { user } = useSession();
  const titleEditable =
    role?.isSystem &&
    user?.roleSlug === 'super_admin' &&
    !['admin', 'super_admin', 'customer'].includes(role.slug);
  const protectedAccess = isRoleAccessProtected(role, user?.roleSlug);
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
      title={
        role
          ? protectedAccess
            ? `View ${role.name} access`
            : `Edit ${role.name} access`
          : 'Create custom role'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {role?.isSystem ? 'Close' : 'Cancel'}
          </Button>
          {!protectedAccess ? (
            <Button
              disabled={!name.trim() || saving}
              onClick={() => onSave({ name, description, isActive: active, permissions })}
            >
              {saving ? 'Saving…' : 'Save role'}
            </Button>
          ) : null}
        </>
      }
    >
      <fieldset disabled={protectedAccess || saving}>
        <legend>{protectedAccess ? 'Protected access — read only' : 'Role access'}</legend>
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            {titleEditable ? 'Display title' : 'Name'}
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
      </fieldset>
    </Dialog>
  );
}

// Re-exported for callers that seed the permission matrix shape.
export { blankPermissions };
