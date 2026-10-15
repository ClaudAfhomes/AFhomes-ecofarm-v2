import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  ConfirmDialog,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  DetailMono,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import type { AfHomesDepartment, AfHomesRole, AfHomesStaff } from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import {
  deactivateAfHomesStaff,
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaffAudit,
  getAfHomesStaffById,
  updateAfHomesStaff,
  type AfHomesAuditEvent,
} from './services';
import { formatDateTime, humanizeToken } from '../../lib/format';
import { SaleTeamAccreditationCard } from './SaleTeamAccreditationCard';
import styles from './AfHomesStaffDetailPage.module.css';

const statusTone = (status: string): 'success' | 'danger' | 'neutral' =>
  status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral';

const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '-';

export function AfHomesStaffDetailPage() {
  const { id } = useParams();
  const staff = useQuery({
    queryKey: ['afhomes', 'staff', id],
    queryFn: () => getAfHomesStaffById(id!),
    enabled: Boolean(id),
  });
  const roles = useQuery({ queryKey: ['afhomes', 'roles'], queryFn: getAfHomesRoles });
  const departments = useQuery({
    queryKey: ['afhomes', 'departments'],
    queryFn: getAfHomesDepartments,
  });
  const history = useQuery({
    queryKey: ['afhomes', 'staff', id, 'audit'],
    queryFn: () => getAfHomesStaffAudit(id!),
    enabled: Boolean(id),
  });

  // First load skeletonizes the whole page - header and detail cards - so no
  // static content flashes before the data it describes.
  if (staff.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading staff member"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <Skeleton style={{ height: 160 }} />
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </div>
      </section>
    );
  if (staff.isError) return <ErrorState error={staff.error} onRetry={staff.refetch} />;
  return (
    <StaffDetailForm
      key={staff.data.id}
      member={staff.data}
      roles={roles.data?.filter((role) => role.slug !== 'customer')}
      departments={departments.data}
      history={history.data}
      historyPending={history.isPending}
      historyError={history.error}
      onRetryHistory={history.refetch}
      onChanged={async () => {
        await staff.refetch();
      }}
    />
  );
}

function StaffDetailForm({
  member,
  roles,
  departments,
  history,
  historyPending,
  historyError,
  onRetryHistory,
  onChanged,
}: {
  member: AfHomesStaff;
  roles: AfHomesRole[] | undefined;
  departments: AfHomesDepartment[] | undefined;
  history: AfHomesAuditEvent[] | undefined;
  historyPending: boolean;
  historyError: Error | null;
  onRetryHistory: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { user } = useSession();
  // Form state mounts fresh per staff member (the parent keys on member
  // id), so initializers run exactly when the viewed member changes.
  const [roleId, setRoleId] = useState(member.roleId);
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? '');
  const [status, setStatus] = useState<string>(member.status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
  };

  const assignment = useBusinessMutation({
    mutationFn: () =>
      updateAfHomesStaff(member.id, {
        roleId: roleId !== member.roleId ? roleId : undefined,
        departmentId:
          departmentId !== (member.departmentId ?? '') ? departmentId || null : undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      await onChanged();
    },
  });
  const standing = useBusinessMutation({
    mutationFn: () =>
      updateAfHomesStaff(member.id, {
        status: status as 'active' | 'inactive' | 'suspended',
      }),
    onSuccess: async () => {
      await invalidate();
      await onChanged();
    },
  });
  const deactivate = useBusinessMutation({
    mutationFn: () => deactivateAfHomesStaff(member.id),
    onSuccess: async () => {
      setConfirmDeactivate(false);
      await invalidate();
      await onChanged();
    },
  });
  const remove = useBusinessMutation({
    mutationFn: () => deleteAfHomesStaff(member.id),
    onSuccess: async () => {
      await invalidate();
      navigate('/admin/staff');
    },
  });

  const isSelf = user?.id === member.id;
  const activeRoles = useMemo(() => roles?.filter((r) => r.isActive) ?? [], [roles]);
  const assignmentChanged =
    roleId !== member.roleId || departmentId !== (member.departmentId ?? '');
  const statusChanged = status !== member.status;
  const targetIsSuperAdmin = useMemo(() => {
    const role = roles?.find((r) => r.id === member.roleId);
    return role?.slug === 'super_admin';
  }, [roles, member.roleId]);
  const canGovernSuperAdmin = user?.roleSlug === 'super_admin';
  const superAdminBlocked = targetIsSuperAdmin && !canGovernSuperAdmin;

  return (
    <section className={styles.page}>
      <PageHeader
        title={member.fullName}
        description="Staff identity, assignment, access, and history"
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/staff')}>
            Back to staff
          </Button>
        }
      />
      <section className={styles.hero} aria-label="Staff summary">
        <span className={styles.heroAvatar} aria-hidden="true">
          {initialsOf(member.fullName)}
        </span>
        <div className={styles.heroText}>
          <h2 className={styles.heroName}>{member.fullName}</h2>
          <p className={styles.heroMeta}>{member.email}</p>
          {member.employeeNumber ? (
            <p className={styles.heroMeta}>Employee No. {member.employeeNumber}</p>
          ) : null}
        </div>
        <div className={styles.heroChips}>
          <StatusChip label={member.roleName} tone="neutral" />
          <StatusChip label={member.departmentName ?? 'Unassigned'} tone="neutral" />
          <StatusChip label={member.status} tone={statusTone(member.status)} />
        </div>
      </section>
      {['admin', 'super_admin'].includes(user?.roleSlug ?? '') &&
      ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(
        roles?.find((r) => r.id === member.roleId)?.slug ?? '',
      ) ? (
        <SaleTeamAccreditationCard
          staffId={member.id}
          kind={roles?.find((r) => r.id === member.roleId)?.slug === 'ost' ? 'OST' : 'IST'}
        />
      ) : null}
      <div className={styles.cardStack}>
        <DetailCard>
          <DetailCardTitle>Staff information</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Employee No.">
              <DetailMono>{member.employeeNumber ?? '—'}</DetailMono>
            </DetailField>
            <DetailField label="Name">{member.fullName}</DetailField>
            <DetailField label="Email">{member.email}</DetailField>
            <DetailField label="Department">{member.departmentName ?? 'Unassigned'}</DetailField>
            <DetailField label="Role">
              <StatusChip label={member.roleName} tone="neutral" />
            </DetailField>
            <DetailField label="Status">
              <StatusChip label={member.status} tone={statusTone(member.status)} />
            </DetailField>
            <DetailField label="Added">{formatDateTime(member.createdAt)}</DetailField>
          </DetailFieldGrid>
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Account state</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Temporary password">
              {member.mustChangePassword ? 'Change required - panel locked' : 'Changed'}
            </DetailField>
            <DetailField label="Invited">{formatDateTime(member.invitedAt)}</DetailField>
            <DetailField label="Activated">{formatDateTime(member.activatedAt)}</DetailField>
          </DetailFieldGrid>
          {member.mustChangePassword ? (
            <Alert variant="warning" title="First login pending">
              This account still runs on its administrator-set temporary password. Normal admin
              access stays locked until the member sets their own password.
            </Alert>
          ) : null}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Role assignment</DetailCardTitle>
          {isSelf ? (
            <Alert variant="warning" title="Own account">
              You cannot edit your own assignment. Ask another administrator.
            </Alert>
          ) : superAdminBlocked ? (
            <Alert variant="warning" title="Protected account">
              Only a Super Admin can modify a Super Admin.
            </Alert>
          ) : (
            <>
              <div className={styles.formGrid}>
                <label className={styles.fieldLabel}>
                  Role
                  <Select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    options={activeRoles.map((r) => ({ value: r.id, label: r.name }))}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Department
                  <Select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...(departments ?? [])
                        .filter((d) => d.isActive)
                        .map((d) => ({ value: d.id, label: d.name })),
                    ]}
                  />
                </label>
              </div>
              <div className={styles.actionRow}>
                <Button
                  disabled={!assignmentChanged || assignment.isPending}
                  onClick={() => assignment.mutate()}
                >
                  {assignment.isPending ? 'Saving…' : 'Save assignment'}
                </Button>
              </div>
              <p className={styles.cardHint}>
                Exactly one role per member. Assignment changes are audited.
              </p>
              {assignment.error ? <p role="alert">{assignment.error.message}</p> : null}
            </>
          )}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Access</DetailCardTitle>
          {isSelf ? (
            <Alert variant="warning" title="Own account">
              You cannot change your own access state.
            </Alert>
          ) : superAdminBlocked ? (
            <Alert variant="warning" title="Protected account">
              Only a Super Admin can change a Super Admin&apos;s access.
            </Alert>
          ) : (
            <>
              <div className={styles.formGrid}>
                <label className={styles.fieldLabel}>
                  Status
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    options={['active', 'inactive', 'suspended'].map((value) => ({
                      value,
                      label: value[0]!.toUpperCase() + value.slice(1),
                    }))}
                  />
                </label>
              </div>
              <div className={styles.actionRow}>
                <Button
                  disabled={!statusChanged || standing.isPending}
                  onClick={() => standing.mutate()}
                >
                  {standing.isPending ? 'Saving…' : 'Save status'}
                </Button>
                {member.status === 'active' ? (
                  <Button variant="danger" onClick={() => setConfirmDeactivate(true)}>
                    Deactivate access
                  </Button>
                ) : null}
              </div>
              <p className={styles.cardHint}>
                Deactivation revokes access immediately and is audited.
              </p>
              {standing.error ? <p role="alert">{standing.error.message}</p> : null}
            </>
          )}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Audit history</DetailCardTitle>
          {historyPending ? (
            <div role="status" aria-label="Loading audit history">
              <Skeleton style={{ height: 44 }} />
              <Skeleton style={{ height: 44 }} />
            </div>
          ) : historyError ? (
            <ErrorState error={historyError} onRetry={onRetryHistory} />
          ) : history?.length ? (
            <ul className={styles.historyList}>
              {history.map((event) => (
                <li key={String(event.id)} className={styles.historyItem}>
                  <span className={styles.historyAction} title={event.action}>
                    {humanizeToken(event.action)}
                  </span>
                  <span className={styles.historyTime}>{formatDateTime(event.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No history"
              description="No recorded changes for this account yet."
            />
          )}
        </DetailCard>

        {canGovernSuperAdmin && !isSelf && !targetIsSuperAdmin ? (
          <DetailCard>
            <DetailCardTitle>Delete</DetailCardTitle>
            <p className={styles.cardHint}>
              Permanent removal is only possible when the account has no protected business records.
              Deactivation is the safe default.
            </p>
            <div className={styles.actionRow}>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete permanently
              </Button>
            </div>
            {remove.error ? <p role="alert">{remove.error.message}</p> : null}
          </DetailCard>
        ) : null}
      </div>

      <p>
        <Link to="/admin/staff">Back to staff</Link>
      </p>

      <ConfirmDialog
        open={confirmDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => deactivate.mutate()}
        title="Deactivate Staff Account"
        message="This user will no longer be able to access the AFHomes staff system. Historical records will remain."
        danger
        confirmLabel="Confirm"
        confirmLoading={deactivate.isPending}
      />
      {deactivate.error ? <p role="alert">{deactivate.error.message}</p> : null}
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteConfirmation('');
        }}
        onConfirm={() => remove.mutate()}
        title="Permanently Delete Staff Account"
        message={
          <div>
            <p>
              This action permanently removes the login/account if no protected business records
              exist. This cannot be undone.
            </p>
            <TextField
              id="staff-delete-confirm"
              name="deleteConfirm"
              label="Type DELETE to confirm staff deletion"
              value={deleteConfirmation}
              onChange={setDeleteConfirmation}
            />
          </div>
        }
        danger
        confirmLabel="Delete Permanently"
        confirmDisabled={deleteConfirmation !== 'DELETE'}
        confirmLoading={remove.isPending}
      />
    </section>
  );
}
