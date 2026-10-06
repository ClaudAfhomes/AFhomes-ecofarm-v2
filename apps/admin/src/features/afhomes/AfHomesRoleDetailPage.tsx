import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  DetailMono,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
} from '@jad/ui';
import {
  getAfHomesRoleAudit,
  getAfHomesRoleById,
  getAfHomesStaff,
  updateAfHomesRole,
} from './services';
import {
  AfHomesRoleFormDialog,
  isRoleAccessProtected,
  type RoleFormInput,
} from './AfHomesRoleFormDialog';
import { useSession } from '../../lib/session';

export function AfHomesRoleDetailPage() {
  const { user } = useSession();
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const role = useQuery({
    queryKey: ['afhomes', 'roles', id],
    queryFn: () => getAfHomesRoleById(id!),
    enabled: Boolean(id),
  });
  const history = useQuery({
    queryKey: ['afhomes', 'roles', id, 'audit'],
    queryFn: () => getAfHomesRoleAudit(id!),
    enabled: Boolean(id),
  });
  const staff = useQuery({ queryKey: ['afhomes', 'staff'], queryFn: getAfHomesStaff });
  const mutation = useMutation({
    mutationFn: (input: RoleFormInput) => updateAfHomesRole(id!, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'roles'] });
      setEditing(false);
      await role.refetch();
    },
  });

  if (role.isPending) return <p role="status">Loading role…</p>;
  if (role.isError) return <ErrorState error={role.error} onRetry={role.refetch} />;
  const record = role.data;
  const assigned = staff.data?.filter((s) => s.roleId === record.id) ?? [];

  return (
    <section>
      <PageHeader
        title={record.name}
        description="Role definition, assignments, and change history"
        actions={
          <>
            {(
              <Button variant="ghost" onClick={() => setEditing(true)}>
                {isRoleAccessProtected(record, user?.roleSlug) ? 'View access' : 'Edit role'}
              </Button>
            )}{' '}
            <Button variant="secondary" onClick={() => navigate('/admin/roles')}>
              Back to roles
            </Button>
          </>
        }
      />
      <div style={{ display: 'grid', gap: 16 }}>
        <DetailCard>
          <DetailCardTitle>Role</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="ID">
              <DetailMono>{record.id}</DetailMono>
            </DetailField>
            <DetailField label="Name">{record.name}</DetailField>
            <DetailField label="Description">{record.description ?? '—'}</DetailField>
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
            <p>System roles are protected: they cannot be renamed, defanged, or deleted.</p>
          ) : null}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Permissions</DetailCardTitle>
          {record.isSystem && record.slug === 'super_admin' ? (
            <p>All modules — granted by slug, not by row.</p>
          ) : (
            <div
              role="region"
              aria-label="Scrollable records"
              tabIndex={0}
              className="table-scroll"
            >
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
                  {record.permissions.map((p) => (
                    <tr key={p.moduleKey}>
                      <td>{p.moduleKey}</td>
                      <td>{p.canView ? 'Yes' : '—'}</td>
                      <td>{p.canCreate ? 'Yes' : '—'}</td>
                      <td>{p.canUpdate ? 'Yes' : '—'}</td>
                      <td>{p.canDelete ? 'Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Assigned staff ({record.assignedCount})</DetailCardTitle>
          {staff.isPending ? (
            <p role="status">Loading assigned staff…</p>
          ) : assigned.length === 0 ? (
            <EmptyState title="No staff assigned" description="No staff hold this role." />
          ) : (
            <ul>
              {assigned.map((s) => (
                <li key={s.id}>
                  <Link to={`/admin/staff/${s.id}`}>{s.fullName}</Link> · {s.email} · {s.status}
                </li>
              ))}
            </ul>
          )}
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>Audit history</DetailCardTitle>
          {history.isPending ? (
            <p role="status">Loading audit history…</p>
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={history.refetch} />
          ) : history.data?.length ? (
            <ul>
              {history.data.map((event) => (
                <li key={String(event.id)}>
                  {event.action} · {new Date(event.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : (
            <p>No role changes recorded yet.</p>
          )}
        </DetailCard>
      </div>

      <p>
        <Link to="/admin/roles">Back to roles</Link>
      </p>

      <AfHomesRoleFormDialog
        key={editing ? `edit-${record.id}-${record.updatedAt}` : 'closed'}
        open={editing}
        role={record}
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
