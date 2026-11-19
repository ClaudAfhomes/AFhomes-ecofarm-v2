import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
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
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import type { AfHomesDepartment, AfHomesRole, AfHomesStaff } from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import {
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaffById,
  updateAfHomesStaff,
} from './services';
import { formatDateTime } from '../../lib/format';
import { SaleTeamAccreditationCard } from './SaleTeamAccreditationCard';
import { StaffSalesInvolvement } from './StaffSalesInvolvement';
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
  onChanged,
}: {
  member: AfHomesStaff;
  roles: AfHomesRole[] | undefined;
  departments: AfHomesDepartment[] | undefined;
  onChanged: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { user } = useSession();
  // Edit dialog state mounts fresh per staff member (the parent keys on
  // member id), so initializers run exactly when the viewed member changes.
  const [editOpen, setEditOpen] = useState(false);
  const [editRoleId, setEditRoleId] = useState(member.roleId);
  const [editDepartmentId, setEditDepartmentId] = useState(member.departmentId ?? '');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>(
    member.status === 'suspended' ? 'suspended' : 'active',
  );
  const [statusTouched, setStatusTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
  };

  const saveEdit = useBusinessMutation({
    mutationFn: () =>
      updateAfHomesStaff(member.id, {
        ...(editRoleId !== member.roleId ? { roleId: editRoleId } : {}),
        ...(editDepartmentId !== (member.departmentId ?? '')
          ? { departmentId: editDepartmentId || null }
          : {}),
        // A legacy standing (invited, inactive) is never rewritten silently:
        // status travels only when the operator explicitly changes it.
        ...(statusTouched && editStatus !== member.status ? { status: editStatus } : {}),
      }),
    onSuccess: async () => {
      await invalidate();
      await onChanged();
      setEditOpen(false);
      setStatusTouched(false);
      notifySuccess({ title: 'Staff updated', message: 'Staff record saved.' });
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
  // Assignment pickers never offer hierarchy roles or Customer: those accounts
  // are managed in genealogy / the sale-team desk, not here.
  const assignableRoles = useMemo(
    () =>
      (roles ?? []).filter(
        (r) =>
          r.isActive &&
          r.slug !== 'customer' &&
          !['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(r.slug),
      ),
    [roles],
  );
  const targetIsSuperAdmin = useMemo(() => {
    const role = roles?.find((r) => r.id === member.roleId);
    return role?.slug === 'super_admin';
  }, [roles, member.roleId]);
  const canGovernSuperAdmin = user?.roleSlug === 'super_admin';
  const superAdminBlocked = targetIsSuperAdmin && !canGovernSuperAdmin;
  const canEdit = !isSelf && !superAdminBlocked;
  const canDelete = canGovernSuperAdmin && !isSelf && !targetIsSuperAdmin;

  return (
    <section className={styles.page}>
      <PageHeader
        title={member.fullName}
        description="Staff identity and assignment"
        actions={
          <div className={styles.headerActions}>
            <Button variant="ghost" onClick={() => navigate('/admin/staff')}>
              Back to staff
            </Button>
            {canEdit ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditRoleId(member.roleId);
                  setEditDepartmentId(member.departmentId ?? '');
                  setEditStatus(member.status === 'suspended' ? 'suspended' : 'active');
                  setStatusTouched(false);
                  saveEdit.reset();
                  setEditOpen(true);
                }}
              >
                Edit
              </Button>
            ) : null}
            {canDelete ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />
      {isSelf ? (
        <Alert variant="warning" title="Own account">
          You cannot edit your own account. Ask another administrator.
        </Alert>
      ) : superAdminBlocked ? (
        <Alert variant="warning" title="Protected account">
          Only a Super Admin can modify a Super Admin.
        </Alert>
      ) : member.mustChangePassword ? (
        <Alert variant="warning" title="First login pending">
          This account still runs on its administrator-set temporary password. Access stays locked
          until the member sets their own password.
        </Alert>
      ) : null}
      <section
        className={styles.hero}
        data-status={member.status === 'suspended' ? 'suspended' : 'active'}
        aria-label="Staff summary"
      >
        <span className={styles.heroAvatar} aria-hidden="true">
          {initialsOf(member.fullName)}
        </span>
        <div className={styles.heroText}>
          <h2 className={styles.heroName}>{member.fullName}</h2>
          <p className={styles.heroMeta}>{member.email}</p>
        </div>
        <div className={styles.heroChips}>
          <StatusChip label={member.roleName} tone="info" />
          <StatusChip label={member.departmentName ?? 'Unassigned'} tone="neutral" />
          <StatusChip label={member.status} tone={statusTone(member.status)} />
          {member.mustChangePassword ? (
            <StatusChip label="First login pending" tone="warning" />
          ) : null}
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
        {(user?.roleSlug === 'super_admin' ||
          user?.afHomesPermissions.some((p) => p.moduleKey === 'sales.customers' && p.canView)) && (
          <StaffSalesInvolvement key={member.id} staffId={member.id} />
        )}
        <DetailCard>
          <DetailCardTitle>Identity</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Employee No.">
              <DetailMono>{member.employeeNumber ?? '—'}</DetailMono>
            </DetailField>
            <DetailField label="Name">{member.fullName}</DetailField>
            <DetailField label="Email">{member.email}</DetailField>
            <DetailField label="Added">{formatDateTime(member.createdAt)}</DetailField>
          </DetailFieldGrid>
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Assignment</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Department">{member.departmentName ?? 'Unassigned'}</DetailField>
            <DetailField label="Role">
              <StatusChip label={member.roleName} tone="info" />
            </DetailField>
            <DetailField label="Status">
              <StatusChip label={member.status} tone={statusTone(member.status)} />
            </DetailField>
          </DetailFieldGrid>
        </DetailCard>
      </div>

      <ConfirmDialog
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onConfirm={() => saveEdit.mutate()}
        title={`Edit ${member.fullName}`}
        message={
          <div className={styles.dialogFields}>
            <label className={styles.fieldLabel}>
              Role
              <Select
                aria-label="Edit role"
                value={editRoleId}
                onChange={(e) => setEditRoleId(e.target.value)}
                options={assignableRoles.map((r) => ({ value: r.id, label: r.name }))}
              />
            </label>
            <label className={styles.fieldLabel}>
              Department
              <Select
                aria-label="Edit department"
                value={editDepartmentId}
                onChange={(e) => setEditDepartmentId(e.target.value)}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...(departments ?? [])
                    .filter((d) => d.isActive)
                    .map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            </label>
            <label className={styles.fieldLabel}>
              Status
              <Select
                aria-label="Edit status"
                value={editStatus}
                onChange={(e) => {
                  setEditStatus(e.target.value as 'active' | 'suspended');
                  setStatusTouched(true);
                }}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'suspended', label: 'Suspended' },
                ]}
              />
            </label>
            <p className={styles.cardHint}>Exactly one role per member. Changes are audited.</p>
            {saveEdit.error ? <p role="alert">{saveEdit.error.message}</p> : null}
          </div>
        }
        confirmLabel={saveEdit.isPending ? 'Saving…' : 'Save'}
        confirmLoading={saveEdit.isPending}
      />
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteConfirmation('');
        }}
        onConfirm={() => remove.mutate()}
        title="Delete Staff Account"
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
        confirmLabel="Delete"
        confirmDisabled={deleteConfirmation !== 'DELETE'}
        confirmLoading={remove.isPending}
      />
    </section>
  );
}
