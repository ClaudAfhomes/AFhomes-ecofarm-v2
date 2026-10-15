import { useMemo, useState } from 'react';
import { Button, Dialog, Icon, StatusChip, TextAreaField, TextField } from '@afhomes/ui';
import {
  MODULE_CATALOG,
  afHomesModuleKeySchema,
  groupedModuleCatalog,
  type AfHomesPermission,
  type AfHomesRole,
} from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import styles from './AfHomesRoleFormDialog.module.css';

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

  /**
   * The ONE per-page control: "Can access".
   *
   * Checking grants access (canView) and deliberately leaves create / update /
   * delete exactly as they were, so editing a role can never silently upgrade
   * the actions it may perform. Unchecking clears all four, because the
   * database enforces "an action right implies access" - there is no such
   * state as a page that is inaccessible but writable.
   */
  const toggleAccess = (key: string) =>
    setPermissions((current) =>
      current.map((permission) => {
        if (permission.moduleKey !== key) return permission;
        if (permission.canView)
          return {
            moduleKey: permission.moduleKey,
            canView: false,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          };
        return { ...permission, canView: true };
      }),
    );

  /**
   * Group-level "view" behavior is deliberately PER MODULE: there is no bulk
   * "view all" control, so a click can never grant a module the operator did
   * not see. The group header is a plain disclosure instead.
   */
  const groups = useMemo(() => {
    const byKey = new Map(permissions.map((permission) => [permission.moduleKey, permission]));
    return groupedModuleCatalog().map((bucket) => ({
      group: bucket.group,
      entries: bucket.modules.map((module) => ({
        ...module,
        permission: byKey.get(module.key) ?? {
          moduleKey: module.key,
          canView: false,
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        },
      })),
    }));
  }, [permissions]);
  const viewCount = permissions.filter((permission) => permission.canView).length;
  /**
   * Which group dropdowns are open. A group with several modules is a
   * disclosure: it opens pre-expanded when the role already holds something in
   * it, so opening this dialog shows current access at a glance, and starts
   * collapsed otherwise so the list stays short. A group with ONE module
   * (Dashboard) is not a dropdown at all - it renders as its own row.
   */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () =>
      new Set(
        groups
          .filter((bucket) => bucket.entries.some((entry) => entry.permission.canView))
          .map((bucket) => bucket.group),
      ),
  );
  const toggleGroup = (group: string) =>
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

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
      <div className={styles.body}>
        {role ? (
          <div className={styles.identity}>
            <div>
              <p className={styles.roleName}>{role.name}</p>
            </div>
            <div className={styles.identityChips}>
              <StatusChip
                label={role.isSystem ? 'System' : 'Custom'}
                tone={role.isSystem ? 'neutral' : 'info'}
              />
              <StatusChip
                label={role.isActive ? 'Active' : 'Inactive'}
                tone={role.isActive ? 'success' : 'neutral'}
              />
            </div>
          </div>
        ) : null}
        <fieldset disabled={protectedAccess || saving} className={styles.accessFieldset}>
          <legend>{protectedAccess ? 'Protected access — read only' : 'Role access'}</legend>
          <div className={styles.formGrid}>
            <TextField
              id="role-name"
              name="roleName"
              label={titleEditable ? 'Display title' : 'Name'}
              optional
              value={name}
              onChange={setName}
            />
            <TextAreaField
              id="role-description"
              name="description"
              label="Description"
              optional
              value={description}
              onChange={setDescription}
            />
            <label className={styles.activeRow}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{' '}
              Active
            </label>
          </div>
          {error ? <p role="alert">{error.message}</p> : null}
          <div className={styles.permissionHead}>
            <p className={styles.permissionTitle}>Page access</p>
            <p className={styles.permissionCount}>
              {viewCount} of {MODULE_CATALOG.length} pages accessible
            </p>
          </div>
          {/*
            ONE control per page. The four underlying action rights still exist
            in the data and are enforced by the server, but they are not an
            operator decision here:
            - Checking grants ACCESS (the page opens for this role) and leaves
              any action rights the role already holds untouched, so editing a
              role can never silently escalate it.
            - Unchecking removes access AND every action right on that page,
              which is the only way the stored flags can stay legal.
            A page where the role holds more than access is tagged so the
            difference stays visible instead of hidden.
          */}
          <ul className={styles.moduleList}>
            {groups.map((bucket) => {
              const grantedCount = bucket.entries.filter(
                (entry) => entry.permission.canView,
              ).length;
              const singleModule = bucket.entries.length === 1;
              const expanded = singleModule || expandedGroups.has(bucket.group);
              return (
                <li key={bucket.group} className={styles.groupBlock}>
                  {singleModule ? null : (
                    <button
                      type="button"
                      className={styles.groupToggleButton}
                      aria-expanded={expanded}
                      onClick={() => toggleGroup(bucket.group)}
                    >
                      <span className={styles.chevron} data-open={expanded}>
                        <Icon name="chevron-right" size={14} />
                      </span>
                      <span className={styles.groupName}>{bucket.group}</span>
                      <span
                        className={grantedCount > 0 ? styles.groupCountOn : styles.groupCount}
                        title={`${grantedCount} of ${bucket.entries.length} pages accessible`}
                      >
                        {grantedCount}/{bucket.entries.length}
                      </span>
                    </button>
                  )}
                  {expanded ? (
                    <ul className={styles.moduleRows}>
                      {bucket.entries.map((entry) => {
                        const elevated =
                          entry.permission.canCreate ||
                          entry.permission.canUpdate ||
                          entry.permission.canDelete;
                        return (
                          <li key={entry.key} className={styles.moduleRow}>
                            <label className={styles.moduleCheck}>
                              <input
                                aria-label={`${entry.label} access`}
                                type="checkbox"
                                checked={entry.permission.canView}
                                onChange={() => toggleAccess(entry.key)}
                              />
                              <span className={styles.moduleName}>{entry.label}</span>
                              {elevated ? (
                                <span
                                  className={styles.moduleTag}
                                  title="This role also keeps its action rights here."
                                >
                                  Full
                                </span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      </div>
    </Dialog>
  );
}

// Re-exported for callers that seed the permission matrix shape.
export { blankPermissions };
