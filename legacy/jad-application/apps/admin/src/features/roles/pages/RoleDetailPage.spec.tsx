import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { STAFF_PERMISSIONS } from '@jad/contracts';
import { MOCK_STAFF_ADMIN, MOCK_SUPER_ADMIN } from '@jad/mock';

import { SessionProvider, type SessionUser } from '../../../lib/session';
import { resetStaffStore } from '../../../mock/staffMockStore';
import { installMockApi } from '../../../test/utils';
import { RoleDetailPage } from './RoleDetailPage';

function renderDetail(user: SessionUser = MOCK_SUPER_ADMIN, routeId = 'role-finance-reviewer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SessionProvider initialUser={user} restoreDelayMs={0}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/roles/${routeId}`]}>
          <Routes>
            <Route path="/admin/roles/:id" element={<RoleDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </SessionProvider>,
  );
}

const updateMutate = vi.hoisted(() => vi.fn());
const deleteMutate = vi.hoisted(() => vi.fn());

const reviewer = {
  id: 'role-finance-reviewer',
  name: 'Finance Reviewer',
  permissions: ['dashboard', 'sales'],
  isSystem: false,
};

const holder = {
  id: 'stf-010',
  name: 'Rita Reviewer',
  email: 'rita.reviewer@jad.example',
  roleId: 'role-finance-reviewer',
  status: 'ACTIVE',
  createdAt: '2026-08-12T10:00:00.000Z',
  createdBy: 'Saul Super',
};

const roleState = { current: reviewer };

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({ data: roleState.current, isPending: false, isError: false, error: null }),
}));

vi.mock('../../staff/hooks/useStaff', () => ({
  useStaff: () => ({ data: [holder] }),
}));

vi.mock('../hooks/useUpdateRole', () => ({
  useUpdateRole: () => ({ mutateAsync: updateMutate, isPending: false }),
}));

vi.mock('../hooks/useDeleteRole', () => ({
  useDeleteRole: () => ({ mutateAsync: deleteMutate, isPending: false }),
}));

const superAdminRecord = {
  id: 'super_admin',
  name: 'Super Admin',
  permissions: [...STAFF_PERMISSIONS.super_admin],
  isSystem: true,
};

describe('RoleDetailPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
    roleState.current = reviewer;
    updateMutate.mockReset().mockResolvedValue({ ...reviewer });
    deleteMutate.mockReset().mockResolvedValue(undefined);
  });

  it('renders role, permissions, and members', async () => {
    renderDetail();
    expect(await screen.findByText('Role Detail')).toBeInTheDocument();
    // Role name renders in the editable name field (breadcrumb removed - the
    // layout owns the trail now).
    expect((screen.getByLabelText('Role name') as HTMLInputElement).value).toBe('Finance Reviewer');
    expect(screen.getByText('role-finance-reviewer')).toBeInTheDocument();
    expect(screen.getByText('Rita Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Back to roles')).toBeInTheDocument();
  });

  it('renames the role with actor attribution', async () => {
    const user = userEvent.setup();
    renderDetail();

    const input = await screen.findByLabelText('Role name');
    await user.clear(input);
    await user.type(input, 'Finance Observer');
    await user.click(screen.getByText('Save name'));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'role-finance-reviewer',
      name: 'Finance Observer',
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
  });

  it('saves permission changes', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByLabelText('Withdrawals'));
    await user.click(screen.getByText('Save permissions'));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'role-finance-reviewer',
      permissions: expect.arrayContaining(['dashboard', 'sales', 'withdrawals']),
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
  });

  it('blocks deletion while members hold the role', async () => {
    renderDetail();
    expect(await screen.findByText(/Reassign them first/)).toBeInTheDocument();
    expect(screen.queryByText('Delete role')).not.toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('blocks non-super-admin staff from deleting roles', async () => {
    renderDetail(MOCK_STAFF_ADMIN);
    expect(await screen.findByText('Only super admins can delete roles.')).toBeInTheDocument();
    expect(screen.queryByText('Delete role')).not.toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('blocks revoking the last governance grant', async () => {
    roleState.current = { ...superAdminRecord };
    const user = userEvent.setup();
    renderDetail(MOCK_STAFF_ADMIN, 'super_admin');

    await user.click(await screen.findByRole('checkbox', { name: 'Staff' }));
    expect(await screen.findByText(/Cannot revoke Staff/)).toBeInTheDocument();
    expect(screen.getByText('Save permissions')).toBeDisabled();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('blocks stripping your own governance access', async () => {
    roleState.current = { ...superAdminRecord };
    const user = userEvent.setup();
    renderDetail(MOCK_SUPER_ADMIN, 'super_admin');

    await user.click(await screen.findByRole('checkbox', { name: 'Staff' }));
    expect(await screen.findByText(/remove your own governance access/)).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('shows live per-group counts and indeterminate partial groups', async () => {
    renderDetail();
    const operations = await screen.findByRole('group', { name: /Operations/ });
    expect(operations.textContent).toContain('1 of 4');
    const dashboard = screen.getByRole('group', { name: /Dashboard/ });
    expect(dashboard.textContent).toContain('1 of 1');

    const groupToggle = screen.getByRole('checkbox', { name: 'Select all Operations modules' });
    expect((groupToggle as HTMLInputElement).indeterminate).toBe(true);
  });

  it('discards permission drafts', async () => {
    const user = userEvent.setup();
    renderDetail();

    const withdrawals = await screen.findByRole('checkbox', { name: 'Withdrawals' });
    await user.click(withdrawals);
    expect((withdrawals as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByText('Discard'));
    expect(
      (screen.getByRole('checkbox', { name: 'Withdrawals' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByText('Save permissions')).toBeDisabled();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('selects all modules via the global action', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Select all modules' }));
    expect(screen.getByRole('group', { name: /Operations/ }).textContent).toContain('4 of 4');
    expect(screen.getByText('Save permissions')).toBeEnabled();
  });

  it('echoes the permission diff in the success toast', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('checkbox', { name: 'Withdrawals' }));
    await user.click(screen.getByText('Save permissions'));
    expect(await screen.findByText(/granted Withdrawals/)).toBeInTheDocument();
  });

  afterEach(() => {
    server.restore();
  });
});
