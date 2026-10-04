import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, EmptyState, ErrorState, PageHeader, StatusChip, notifySuccess } from '@jad/ui';
import type { AfHomesRole } from '@jad/contracts';
import { createAfHomesRole, getAfHomesRoles, updateAfHomesRole } from './services';
import { AfHomesRoleFormDialog, type RoleFormInput } from './AfHomesRoleFormDialog';

export function AfHomesRolesPage() {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['afhomes', 'roles'], queryFn: getAfHomesRoles });
  const [editing, setEditing] = useState<AfHomesRole | null>(null);
  const [creating, setCreating] = useState(false);
  const mutation = useMutation({
    mutationFn: async (input: RoleFormInput) =>
      editing
        ? updateAfHomesRole(editing.id, editing.isSystem ? { name: input.name } : input)
        : createAfHomesRole({ ...input, description: input.description || undefined }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['afhomes', 'roles'] });
      setCreating(false);
      setEditing(null);
      notifySuccess({ title: 'Role updated', message: 'Role changes saved successfully.' });
    },
  });
  return (
    <section>
      <PageHeader
        title="Roles & Permissions"
        description="Server-enforced AF Homes module permissions and protected system roles"
        actions={<Button onClick={() => setCreating(true)}>New custom role</Button>}
      />
      {roles.isPending ? (
        <p role="status">Loading roles…</p>
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={roles.refetch} />
      ) : roles.data?.length === 0 ? (
        <EmptyState title="No roles" description="Create the first custom role." />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>Assigned staff</th>
                <th>Permissions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roles.data
                ?.filter((role) => role.slug !== 'customer')
                .map((role) => (
                  <tr key={role.id}>
                    <td>
                      <Link to={`/admin/roles/${role.id}`}>
                        <strong>{role.name}</strong>
                      </Link>
                      <br />
                      <small>{role.description || role.slug}</small>
                    </td>
                    <td>
                      <StatusChip
                        label={role.isActive ? 'Active' : 'Inactive'}
                        tone={role.isActive ? 'success' : 'neutral'}
                      />
                    </td>
                    <td>{role.assignedCount}</td>
                    <td>
                      {role.isSystem && role.slug === 'super_admin'
                        ? 'All modules'
                        : `${role.permissions.filter((p) => p.canView).length} modules`}
                    </td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(role)}>
                        {role.isSystem ? 'View access' : 'Edit'}
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <AfHomesRoleFormDialog
        key={creating ? 'new-role' : (editing?.id ?? 'closed')}
        open={creating || editing !== null}
        role={editing}
        saving={mutation.isPending}
        error={mutation.error}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          mutation.reset();
        }}
        onSave={(input) => mutation.mutate(input)}
      />
    </section>
  );
}
