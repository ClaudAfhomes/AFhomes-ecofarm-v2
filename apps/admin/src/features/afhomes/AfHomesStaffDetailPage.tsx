import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  StatusChip,
} from '@jad/ui';
import type { AfHomesDepartment, AfHomesRole, AfHomesStaff } from '@jad/contracts';
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

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

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

  if (staff.isPending) return <p role="status">Loading staff member…</p>;
  if (staff.isError) return <ErrorState error={staff.error} onRetry={staff.refetch} />;
  return (
    <StaffDetailForm
      key={staff.data.id}
      member={staff.data}
      roles={roles.data}
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

  const assignment = useMutation({
    mutationFn: () =>
      updateAfHomesStaff(member.id, {
        roleId: roleId !== member.roleId ? roleId : undefined,
        departmentId: departmentId !== (member.departmentId ?? '') ? departmentId || null : undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      await onChanged();
    },
  });
  const standing = useMutation({
    mutationFn: () =>
      updateAfHomesStaff(member.id, {
        status: status as 'active' | 'inactive' | 'suspended',
      }),
    onSuccess: async () => {
      await invalidate();
      await onChanged();
    },
  });
  const deactivate = useMutation({
    mutationFn: () => deactivateAfHomesStaff(member.id),
    onSuccess: async () => {
      setConfirmDeactivate(false);
      await invalidate();
      await onChanged();
    },
  });
  const remove = useMutation({
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
    <section>
      <PageHeader
        title={member.fullName}
        description="Staff identity, assignment, access, and history"
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/staff')}>
            Back to staff
          </Button>
        }
      />
      <div style={{ display: 'grid', gap: 16 }}>
        <DetailCard>
          <DetailCardTitle>Staff information</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="ID">
              <DetailMono>{member.id}</DetailMono>
            </DetailField>
            <DetailField label="Name">{member.fullName}</DetailField>
            <DetailField label="Email">{member.email}</DetailField>
            <DetailField label="Department">{member.departmentName ?? 'Unassigned'}</DetailField>
            <DetailField label="Role">
              <StatusChip label={member.roleName} tone="neutral" />
            </DetailField>
            <DetailField label="Status">
              <StatusChip
                label={member.status}
                tone={member.status === 'active' ? 'success' : 'neutral'}
              />
            </DetailField>
            <DetailField label="Added">{formatDateTime(member.createdAt)}</DetailField>
          </DetailFieldGrid>
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Account state</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Temporary password">
              {member.mustChangePassword ? 'Change required — panel locked' : 'Changed'}
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
            <div style={{ display: 'grid', gap: 12 }}>
              <label>
                Role
                <Select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  options={activeRoles.map((r) => ({ value: r.id, label: r.name }))}
                />
              </label>
              <label>
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
              <div>
                <Button
                  disabled={!assignmentChanged || assignment.isPending}
                  onClick={() => assignment.mutate()}
                >
                  {assignment.isPending ? 'Saving…' : 'Save assignment'}
                </Button>
              </div>
              <p>Exactly one role per member. Assignment changes are audited.</p>
              {assignment.error ? <p role="alert">{assignment.error.message}</p> : null}
            </div>
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
            <div style={{ display: 'grid', gap: 12 }}>
              <label>
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
              <div>
                <Button
                  disabled={!statusChanged || standing.isPending}
                  onClick={() => standing.mutate()}
                >
                  {standing.isPending ? 'Saving…' : 'Save status'}
                </Button>{' '}
                {member.status === 'active' ? (
                  <Button variant="secondary" onClick={() => setConfirmDeactivate(true)}>
                    Deactivate access
                  </Button>
                ) : null}
              </div>
              <p>Deactivation revokes access immediately and is audited.</p>
              {standing.error ? <p role="alert">{standing.error.message}</p> : null}
            </div>
          )}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Audit history</DetailCardTitle>
          {historyPending ? (
            <p role="status">Loading audit history…</p>
          ) : historyError ? (
            <ErrorState error={historyError} onRetry={onRetryHistory} />
          ) : history?.length ? (
            <ul>
              {history.map((event) => (
                <li key={String(event.id)}>
                  {event.action} · {formatDateTime(event.created_at)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No history" description="No recorded changes for this account yet." />
          )}
        </DetailCard>

        {canGovernSuperAdmin && !isSelf && !targetIsSuperAdmin ? (
          <DetailCard>
            <DetailCardTitle>Delete</DetailCardTitle>
            <p>
              Permanent removal is only possible when the account has no protected business
              records. Deactivation is the safe default.
            </p>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete permanently
            </Button>
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
        message="This user will no longer be able to access the AF Homes staff system. Historical records will remain."
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
            <label>
              Type DELETE to confirm
              <input
                aria-label="Type DELETE to confirm staff deletion"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
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
