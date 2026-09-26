import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  Button,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  notifyError,
  notifySuccess,
} from '@jad/ui';
import { CUSTOM_ROLE_FORBIDDEN_MODULES, STAFF_MODULE_LABEL } from '@jad/contracts';
import type { StaffModule } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { useRole } from '../hooks/useRole';
import { useRoles } from '../hooks/useRoles';
import { useUpdateRole } from '../hooks/useUpdateRole';
import { useDeleteRole } from '../hooks/useDeleteRole';
import { useStaff } from '../../staff/hooks/useStaff';
import { guardRoleDelete, guardRolePermissions } from '../guards';
import { STAFF_STATUS_LABEL, STAFF_STATUS_TONE } from '../../staff/status';
import { RoleModulePicker } from '../components/RoleModulePicker';
import styles from './RoleDetail.module.css';

function sameModules(a: StaffModule[], b: StaffModule[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((m) => set.has(m));
}

/** Role detail - rename, edit permissions, inspect members, delete custom roles. */
export function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useSession();
  const { data, isPending, isError, error } = useRole(id!);
  const { data: staff } = useStaff();
  const { data: allRoles } = useRoles();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [permDraft, setPermDraft] = useState<StaffModule[] | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const actorName = user?.name ?? 'Unknown';
  const actorRole = user?.roleId ? user.roleId.toUpperCase() : 'ADMIN';

  const members = (staff ?? []).filter((m) => m.roleId === id);

  const nameValue = nameDraft ?? data?.name ?? '';
  const nameChanged = data !== undefined && nameDraft !== null && nameDraft.trim() !== data.name;
  const effectivePermissions = permDraft ?? data?.permissions ?? [];
  const permsChanged =
    data !== undefined && permDraft !== null && !sameModules(permDraft, data.permissions);

  const permGuard =
    data !== undefined
      ? guardRolePermissions(allRoles ?? [], data.id, effectivePermissions, user?.roleId)
      : ({ ok: true } as const);
  const deleteGuard =
    data !== undefined
      ? guardRoleDelete(allRoles ?? [], staff ?? [], data, user?.roleId)
      : ({ ok: true } as const);

  const handleSaveName = async () => {
    if (!data || !nameChanged) return;
    if (!nameValue.trim()) {
      setNameError('Name is required.');
      return;
    }
    setNameError(null);
    try {
      await updateRole.mutateAsync({
        id: data.id,
        name: nameValue.trim(),
        actor: actorName,
        actorRole,
      });
      setNameDraft(null);
      notifySuccess({ title: 'Role renamed', message: `Role is now ${nameValue.trim()}` });
    } catch (e) {
      setNameError((e as Error).message);
    }
  };

  const handleDiscardName = () => {
    setNameDraft(null);
    setNameError(null);
  };

  const handleDiscardPermissions = () => {
    setPermDraft(null);
  };

  const handleSavePermissions = async () => {
    if (!data || !permsChanged || !permGuard.ok || effectivePermissions.length === 0) return;
    const granted = effectivePermissions
      .filter((m) => !data.permissions.includes(m))
      .map((m) => STAFF_MODULE_LABEL[m]);
    const revoked = data.permissions
      .filter((m) => !effectivePermissions.includes(m))
      .map((m) => STAFF_MODULE_LABEL[m]);
    const diff = [...granted.map((g) => `granted ${g}`), ...revoked.map((r) => `revoked ${r}`)];
    try {
      await updateRole.mutateAsync({
        id: data.id,
        permissions: effectivePermissions,
        actor: actorName,
        actorRole,
      });
      setPermDraft(null);
      notifySuccess({
        title: 'Permissions updated',
        message:
          diff.length > 0
            ? diff.join('; ')
            : `${data.name} now grants ${effectivePermissions.length} modules`,
      });
    } catch (e) {
      notifyError({ title: 'Update failed', message: (e as Error).message });
    }
  };

  const handleConfirmDelete = async () => {
    if (!data) return;
    try {
      await deleteRole.mutateAsync({ id: data.id, actor: actorName, actorRole });
      setShowDeleteConfirm(false);
      notifySuccess({ title: 'Role deleted', message: `${data.name} was removed` });
      navigate('/admin/roles');
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
    }
  };

  return (
    <section>
      <PageHeader
        title="Role Detail"
        description="Rename, edit permissions, and manage role lifecycle"
        actions={
          <Link className={styles.backLink} to="/admin/roles">
            Back to roles
          </Link>
        }
      />

      {isPending ? (
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <Skeleton className={styles.skeletonBlock} />
          </div>
        </div>
      ) : isError ? (
        <ErrorState error={error} />
      ) : !data ? (
        <ErrorState title="Role not found" message="The requested role does not exist." />
      ) : (
        <>
          <div className={styles.detailGrid}>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Role</h2>
              <dl className={styles.fieldGrid}>
                <div className={styles.field}>
                  <dt>Role ID</dt>
                  <dd>
                    <code className={styles.mono}>{data.id}</code>
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Type</dt>
                  <dd>
                    {data.isSystem ? (
                      <StatusChip label="System" tone="neutral" />
                    ) : (
                      <StatusChip label="Custom" tone="info" />
                    )}
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Members</dt>
                  <dd>
                    {members.length} staff member{members.length === 1 ? '' : 's'}
                  </dd>
                </div>
              </dl>
              <div className={styles.formRow}>
                <label className={styles.nameField}>
                  <span className={styles.nameLabel}>Name</span>
                  <input
                    value={nameValue}
                    onChange={(e) => setNameDraft(e.target.value)}
                    aria-label="Role name"
                    className={styles.nameInput}
                  />
                </label>
                <Button onClick={handleSaveName} disabled={!nameChanged || updateRole.isPending}>
                  {updateRole.isPending ? 'Saving…' : 'Save name'}
                </Button>
                {nameDraft !== null && !updateRole.isPending ? (
                  <Button variant="secondary" onClick={handleDiscardName}>
                    Discard
                  </Button>
                ) : null}
              </div>
              {nameError ? (
                <p className={styles.guardNote} role="status">
                  {nameError}
                </p>
              ) : (
                <p className={styles.hint}>Names must be unique. The id never changes.</p>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Permissions</h2>
              <RoleModulePicker
                selected={effectivePermissions}
                onChange={setPermDraft}
                disabled={updateRole.isPending}
                showGlobalActions
                lockedModules={data && !data.isSystem ? CUSTOM_ROLE_FORBIDDEN_MODULES : undefined}
              />
              {effectivePermissions.length === 0 ? (
                <p className={styles.guardNote} role="status">
                  A role must grant at least one module.
                </p>
              ) : null}
              {!permGuard.ok && effectivePermissions.length > 0 ? (
                <p className={styles.guardNote} role="status">
                  {permGuard.reason}
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Button
                  onClick={handleSavePermissions}
                  disabled={
                    !permsChanged ||
                    !permGuard.ok ||
                    effectivePermissions.length === 0 ||
                    updateRole.isPending
                  }
                >
                  {updateRole.isPending ? 'Saving…' : 'Save permissions'}
                </Button>
                {permDraft !== null && !updateRole.isPending ? (
                  <Button variant="secondary" onClick={handleDiscardPermissions}>
                    Discard
                  </Button>
                ) : null}
              </div>
              <p className={styles.hint}>
                {effectivePermissions.length} of {Object.keys(STAFF_MODULE_LABEL).length} modules
                granted. Changes are recorded in the audit log.
              </p>
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Members</h2>
              {members.length === 0 ? (
                <p className={styles.hint}>No staff members hold this role.</p>
              ) : (
                <ul className={styles.memberList}>
                  {members.map((m) => (
                    <li key={m.id}>
                      <Link className={styles.memberLink} to={`/admin/staff/${m.id}`}>
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                        <span className={styles.memberMeta}>
                          {m.email} ·{' '}
                          <StatusChip
                            label={STAFF_STATUS_LABEL[m.status]}
                            tone={STAFF_STATUS_TONE[m.status]}
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Delete</h2>
              {!deleteGuard.ok ? (
                <p className={styles.guardNote} role="status">
                  {deleteGuard.reason}
                </p>
              ) : (
                <>
                  <p className={styles.statusMessage}>
                    Permanently remove this {data.isSystem ? 'system' : 'custom'} role. This action
                    cannot be undone.
                  </p>
                  <div>
                    <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                      Delete role
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          <ConfirmDialog
            open={showDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={handleConfirmDelete}
            title={`Delete ${data.name}?`}
            message={`This ${data.isSystem ? 'system' : 'custom'} role will be permanently removed. This action cannot be undone.`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
          />
        </>
      )}
    </section>
  );
}
