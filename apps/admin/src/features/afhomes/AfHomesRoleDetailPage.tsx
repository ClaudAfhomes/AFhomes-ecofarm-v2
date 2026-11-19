import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import { groupedModuleCatalog } from '@afhomes/contracts';
import {
  getAfHomesDepartments,
  getAfHomesRoleById,
  getAfHomesStaff,
  updateAfHomesRole,
} from './services';
import { AfHomesRoleFormDialog, type RoleFormInput } from './AfHomesRoleFormDialog';
import styles from './AfHomesRoleDetailPage.module.css';

export function AfHomesRoleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const role = useQuery({
    queryKey: ['afhomes', 'roles', id],
    queryFn: () => getAfHomesRoleById(id!),
    enabled: Boolean(id),
  });
  const staff = useQuery({ queryKey: ['afhomes', 'staff'], queryFn: getAfHomesStaff });
  const departments = useQuery({
    queryKey: ['afhomes', 'departments'],
    queryFn: getAfHomesDepartments,
  });
  const mutation = useBusinessMutation({
    mutationFn: (input: RoleFormInput) =>
      role.data?.isSystem
        ? updateAfHomesRole(id!, { name: input.name, departmentId: input.departmentId })
        : updateAfHomesRole(id!, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'roles'] });
      setEditing(false);
      await role.refetch();
    },
  });

  // First load skeletonizes the whole page - header and detail cards - so no
  // static content flashes before the data it describes.
  if (role.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading role"
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
  if (role.isError) return <ErrorState error={role.error} onRetry={role.refetch} />;
  const record = role.data;
  const assigned = staff.data?.filter((s) => s.roleId === record.id) ?? [];
  const viewableCount = record.permissions.filter((p) => p.canView).length;

  return (
    <section className={styles.page}>
      <PageHeader
        title={record.name}
        description="Role definition and assignments"
        actions={
          <div className={styles.headerActions}>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit role
            </Button>
            <Button variant="secondary" onClick={() => navigate('/admin/roles')}>
              Back to roles
            </Button>
          </div>
        }
      />
      <section className={styles.hero} aria-label="Role summary">
        <span className={styles.heroBadge} aria-hidden="true">
          {record.name.trim().charAt(0).toUpperCase() || '•'}
        </span>
        <div className={styles.heroText}>
          <h2 className={styles.heroName}>{record.name}</h2>
          <p className={styles.heroMeta}>{record.departmentName ?? 'Unassigned'}</p>
        </div>
        <div className={styles.heroChips}>
          <StatusChip
            label={record.isSystem ? 'System' : 'Custom'}
            tone={record.isSystem ? 'neutral' : 'info'}
          />
          <StatusChip
            label={record.isActive ? 'Active' : 'Inactive'}
            tone={record.isActive ? 'success' : 'neutral'}
          />
          <StatusChip label={`${viewableCount} modules`} tone="info" />
          <StatusChip label={`${record.assignedCount} staff`} tone="neutral" />
        </div>
      </section>
      <div className={styles.cardStack}>
        <DetailCard>
          <DetailCardTitle>Role</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Name">{record.name}</DetailField>
            <DetailField label="Department">{record.departmentName ?? 'Unassigned'}</DetailField>
            <DetailField label="Type">
              <StatusChip
                label={record.isSystem ? 'System' : 'Custom'}
                tone={record.isSystem ? 'neutral' : 'success'}
              />
            </DetailField>
            <DetailField label="Status">
              <StatusChip
                label={record.isActive ? 'Active' : 'Inactive'}
                tone={record.isActive ? 'success' : 'neutral'}
              />
            </DetailField>
          </DetailFieldGrid>
          {record.isSystem ? (
            <p className={styles.cardHint}>
              System roles are protected: they cannot be renamed, defanged, or deleted.
            </p>
          ) : null}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Permissions</DetailCardTitle>
          {record.isSystem && record.slug === 'super_admin' ? (
            <p className={styles.cardHint}>All pages - granted by slug, not by row.</p>
          ) : (
            <>
              <p className={styles.cardHint}>
                {viewableCount} of {groupedModuleCatalog().flatMap((b) => b.modules).length} pages
                accessible to this role.
              </p>
              {/* Access is per PAGE. The finer action rights still exist in the
                  data and are enforced by the server; they are not what this
                  list is about. */}
              <ul className={styles.pageList}>
                {groupedModuleCatalog().map((bucket) => {
                  const accessible = bucket.modules.filter((module) =>
                    record.permissions.some(
                      (permission) => permission.moduleKey === module.key && permission.canView,
                    ),
                  );
                  if (accessible.length === 0) return null;
                  return (
                    <li key={bucket.group} className={styles.pageGroup}>
                      <p className={styles.pageGroupName}>{bucket.group}</p>
                      <ul className={styles.pageRows}>
                        {accessible.map((module) => (
                          <li key={module.key} className={styles.pageRow}>
                            {module.label}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Assigned staff ({record.assignedCount})</DetailCardTitle>
          {staff.isPending ? (
            <div role="status" aria-label="Loading assigned staff">
              <Skeleton style={{ height: 44 }} />
              <Skeleton style={{ height: 44 }} />
            </div>
          ) : assigned.length === 0 ? (
            <EmptyState title="No staff assigned" description="No staff hold this role." />
          ) : (
            <ul className={styles.staffList}>
              {assigned.map((s) => (
                <li key={s.id} className={styles.staffItem}>
                  <span className={styles.staffAvatar} aria-hidden="true">
                    {s.fullName.trim().charAt(0).toUpperCase() || '•'}
                  </span>
                  <span className={styles.staffText}>
                    <Link to={`/admin/staff/${s.id}`} className={styles.staffName}>
                      {s.fullName}
                    </Link>
                    <span className={styles.staffMeta}>
                      {[s.email, s.departmentName ?? 'Unassigned'].filter(Boolean).join('  |  ')}
                    </span>
                  </span>
                  <StatusChip
                    label={s.status}
                    tone={
                      s.status === 'active'
                        ? 'success'
                        : s.status === 'suspended'
                          ? 'danger'
                          : 'neutral'
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </DetailCard>
      </div>

      <AfHomesRoleFormDialog
        key={editing ? `edit-${record.id}-${record.updatedAt}` : 'closed'}
        open={editing}
        role={record}
        departments={departments.data ?? []}
        saving={mutation.isPending}
        error={mutation.error}
        onClose={() => {
          setEditing(false);
          mutation.reset();
        }}
        onSave={(input) => mutation.mutate(input)}
      />
    </section>
  );
}
