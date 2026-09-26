import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  Button,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  notifyError,
  notifySuccess,
} from '@jad/ui';
import { systemRoleRecords } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { formatDateTime } from '../../../lib/format';
import { useStaff } from '../hooks/useStaff';
import { useStaffMember } from '../hooks/useStaffMember';
import { useAssignStaffRole } from '../hooks/useAssignStaffRole';
import { useSetStaffStatus } from '../hooks/useSetStaffStatus';
import { useDeleteStaff } from '../hooks/useDeleteStaff';
import { useRoles } from '../../roles/hooks/useRoles';
import { STAFF_STATUS_LABEL, STAFF_STATUS_TONE, roleLabelFor, roleToneFor } from '../status';
import { guardRoleChange, guardStaffDelete, guardStatusChange } from '../guards';
import styles from './StaffDetail.module.css';

/** Staff detail - view identity, assign role, enable/disable (all audited). */
export function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useSession();
  const { data, isPending, isError, error } = useStaffMember(id!);
  const { data: roster } = useStaff();
  const { data: roles } = useRoles();
  const assignRole = useAssignStaffRole();
  const setStatus = useSetStaffStatus();
  const deleteStaff = useDeleteStaff();

  const [roleDraft, setRoleDraft] = useState<string | null>(null);
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const records = roles?.length ? roles : systemRoleRecords();
  const roleOptions = records.map((r) => ({ value: r.id, label: r.name }));

  const actorName = user?.name ?? 'Unknown';
  const actorRole = user?.roleId ? user.roleId.toUpperCase() : 'ADMIN';
  const selectedRole = roleDraft ?? data?.roleId ?? 'admin';
  const roleChanged = data !== undefined && selectedRole !== data.roleId;

  const roleGuard =
    data !== undefined
      ? guardRoleChange(roster ?? [], records, user?.email, data)
      : ({ ok: true } as const);
  const statusGuard =
    data !== undefined
      ? guardStatusChange(roster ?? [], records, user?.email, data)
      : ({ ok: true } as const);
  const deleteGuard =
    data !== undefined
      ? guardStaffDelete(roster ?? [], records, user?.email, user?.roleId, data)
      : ({ ok: true } as const);

  const handleSaveRole = async () => {
    if (!data || !roleChanged || !roleGuard.ok) return;
    try {
      await assignRole.mutateAsync({
        id: data.id,
        roleId: selectedRole,
        actor: actorName,
        actorRole,
      });
      setRoleDraft(null);
      notifySuccess({
        title: 'Role updated',
        message: `${data.name} is now ${roleLabelFor(records, selectedRole)}`,
      });
    } catch (e) {
      notifyError({ title: 'Update failed', message: (e as Error).message });
    }
  };

  const handleConfirmDelete = async () => {
    if (!data || !deleteGuard.ok) return;
    try {
      await deleteStaff.mutateAsync({ id: data.id, actor: actorName, actorRole });
      setShowDeleteConfirm(false);
      notifySuccess({
        title: 'Staff deleted',
        message: `${data.name} was permanently removed`,
      });
      navigate('/admin/staff');
    } catch (e) {
      notifyError({ title: 'Delete failed', message: (e as Error).message });
    }
  };

  const handleConfirmStatus = async () => {
    if (!data || !statusGuard.ok) return;
    const next = data.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      await setStatus.mutateAsync({ id: data.id, status: next, actor: actorName, actorRole });
      setShowStatusConfirm(false);
      notifySuccess({
        title: next === 'ACTIVE' ? 'Staff enabled' : 'Staff disabled',
        message: `${data.name} is now ${next === 'ACTIVE' ? 'active' : 'disabled'}`,
      });
    } catch (e) {
      notifyError({ title: 'Update failed', message: (e as Error).message });
    }
  };

  return (
    <section>
      <PageHeader
        title="Staff Detail"
        description="View identity, assign role, and manage access"
        actions={
          <Link className={styles.backLink} to="/admin/staff">
            Back to staff
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
        <ErrorState
          title="Staff member not found"
          message="The requested staff member does not exist."
        />
      ) : (
        <>
          <div className={styles.detailGrid}>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Staff Information</h2>
              <dl className={styles.fieldGrid}>
                <div className={styles.field}>
                  <dt>Staff ID</dt>
                  <dd>
                    <code className={styles.mono}>{data.id}</code>
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Name</dt>
                  <dd style={{ fontWeight: 600 }}>{data.name}</dd>
                </div>
                <div className={styles.field}>
                  <dt>Email</dt>
                  <dd>{data.email}</dd>
                </div>
                <div className={styles.field}>
                  <dt>Role</dt>
                  <dd>
                    <StatusChip
                      label={roleLabelFor(records, data.roleId)}
                      tone={roleToneFor(data.roleId)}
                    />
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Status</dt>
                  <dd>
                    <StatusChip
                      label={STAFF_STATUS_LABEL[data.status]}
                      tone={STAFF_STATUS_TONE[data.status]}
                    />
                  </dd>
                </div>
                <div className={styles.field}>
                  <dt>Added</dt>
                  <dd>{formatDateTime(data.createdAt)}</dd>
                </div>
                <div className={styles.field}>
                  <dt>Added by</dt>
                  <dd>{data.createdBy}</dd>
                </div>
              </dl>
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Role Assignment</h2>
              <div className={styles.formRow}>
                <Select
                  aria-label="Assign role"
                  value={selectedRole}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  options={roleOptions}
                />
                <Button
                  onClick={handleSaveRole}
                  disabled={!roleChanged || !roleGuard.ok || assignRole.isPending}
                >
                  {assignRole.isPending ? 'Saving…' : 'Save role'}
                </Button>
              </div>
              {!roleGuard.ok ? (
                <p className={styles.guardNote} role="status">
                  {roleGuard.reason}
                </p>
              ) : (
                <p className={styles.hint}>
                  Each staff user holds exactly one role. Role changes are recorded in the audit
                  log.
                </p>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Access</h2>
              <p className={styles.statusMessage}>
                This staff account is currently{' '}
                <strong>{data.status === 'ACTIVE' ? 'active' : 'disabled'}</strong>.
                {data.status === 'ACTIVE'
                  ? ' Disabling revokes admin-shell access immediately.'
                  : ' Enabling restores admin-shell access.'}
              </p>
              {!statusGuard.ok ? (
                <p className={styles.guardNote} role="status">
                  {statusGuard.reason}
                </p>
              ) : (
                <div>
                  <Button
                    variant={data.status === 'ACTIVE' ? 'danger' : 'secondary'}
                    onClick={() => setShowStatusConfirm(true)}
                  >
                    {data.status === 'ACTIVE' ? 'Disable access' : 'Enable access'}
                  </Button>
                </div>
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
                    Permanently remove this staff account. This action cannot be undone.
                  </p>
                  <div>
                    <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                      Delete staff
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
            message="This staff account will be permanently removed. This action cannot be undone."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
          />
          <ConfirmDialog
            open={showStatusConfirm}
            onCancel={() => setShowStatusConfirm(false)}
            onConfirm={handleConfirmStatus}
            title={data.status === 'ACTIVE' ? `Disable ${data.name}?` : `Enable ${data.name}?`}
            message={
              data.status === 'ACTIVE'
                ? 'This staff account will lose access to the admin shell immediately. This change is recorded in the audit log.'
                : 'This staff account will regain access to the admin shell. This change is recorded in the audit log.'
            }
            confirmLabel={data.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            cancelLabel="Cancel"
            danger={data.status === 'ACTIVE'}
          />
        </>
      )}
    </section>
  );
}
