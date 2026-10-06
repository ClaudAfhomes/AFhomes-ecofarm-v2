import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, StatusChip } from '@afhomes/ui';
import { createAfHomesDepartment, getAfHomesDepartments } from './services';

export function AfHomesDepartmentsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['afhomes', 'departments'], queryFn: getAfHomesDepartments });
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => createAfHomesDepartment({ code: code.toUpperCase(), name }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'departments'] });
      setOpen(false);
    },
  });
  return (
    <section>
      <PageHeader
        title="Departments"
        description="Active organization units used for staff assignment"
        actions={<Button onClick={() => setOpen(true)}>New department</Button>}
      />
      {query.isPending ? (
        <p role="status">Loading departments…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState title="No departments" description="Create an organization department." />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Staff</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((d) => (
                <tr key={d.id}>
                  <td>{d.code}</td>
                  <td>{d.name}</td>
                  <td>{d.staffCount}</td>
                  <td>
                    <StatusChip
                      label={d.isActive ? 'Active' : 'Inactive'}
                      tone={d.isActive ? 'success' : 'neutral'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create department"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!code || !name || create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
            />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {create.error ? <p role="alert">{create.error.message}</p> : null}
        </div>
      </Dialog>
    </section>
  );
}
