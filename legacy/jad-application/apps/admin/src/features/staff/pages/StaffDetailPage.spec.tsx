import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_FINANCE, MOCK_STAFF_ADMIN, MOCK_SUPER_ADMIN } from '@jad/mock';

import type { MockStaffMember } from '../../../mock/data';
import { resetStaffStore } from '../../../mock/staffMockStore';
import { renderWithProviders } from '../../../test/utils';
import { StaffDetailPage } from './StaffDetailPage';

const state = vi.hoisted(() => {
  const Saul: MockStaffMember = {
    id: 'stf-001',
    name: 'Saul Super',
    email: 'superadmin@gmail.com',
    roleId: 'super_admin',
    status: 'ACTIVE',
    createdAt: '2026-07-01T09:00:00.000Z',
    createdBy: 'System',
  };
  const Ada: MockStaffMember = {
    id: 'stf-002',
    name: 'Ada Admin',
    email: 'ada.admin@jad.example',
    roleId: 'admin',
    status: 'ACTIVE',
    createdAt: '2026-07-15T10:30:00.000Z',
    createdBy: 'Saul Super',
  };
  const systemRoles = [
    { id: 'super_admin', name: 'Super Admin', permissions: ['staff'], isSystem: true },
    { id: 'admin', name: 'Admin', permissions: ['sales'], isSystem: true },
    { id: 'finance', name: 'Finance', permissions: ['sales'], isSystem: true },
  ];
  return {
    Saul,
    Ada,
    systemRoles,
    member: { ...Ada },
    roster: [{ ...Saul }, { ...Ada }],
    assignMutate: vi.fn(),
    statusMutate: vi.fn(),
    deleteMutate: vi.fn(),
  };
});

vi.mock('../hooks/useStaffMember', () => ({
  useStaffMember: () => ({ data: state.member, isPending: false, isError: false, error: null }),
}));

vi.mock('../hooks/useStaff', () => ({
  useStaff: () => ({ data: state.roster }),
}));

vi.mock('../../roles/hooks/useRoles', () => ({
  useRoles: () => ({ data: state.systemRoles }),
}));

vi.mock('../hooks/useAssignStaffRole', () => ({
  useAssignStaffRole: () => ({ mutateAsync: state.assignMutate, isPending: false }),
}));

vi.mock('../hooks/useSetStaffStatus', () => ({
  useSetStaffStatus: () => ({ mutateAsync: state.statusMutate, isPending: false }),
}));

vi.mock('../hooks/useDeleteStaff', () => ({
  useDeleteStaff: () => ({ mutateAsync: state.deleteMutate, isPending: false }),
}));

describe('StaffDetailPage', () => {
  beforeEach(() => {
    resetStaffStore();
    state.member = { ...state.Ada };
    state.roster = [{ ...state.Saul }, { ...state.Ada }];
    state.assignMutate.mockReset().mockResolvedValue({ ...state.member });
    state.statusMutate.mockReset().mockResolvedValue({ ...state.member });
    state.deleteMutate.mockReset().mockResolvedValue(undefined);
  });

  it('renders identity, role, and management cards', async () => {
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });
    expect(await screen.findByText('Staff Detail')).toBeInTheDocument();
    // Name appears in the info card (breadcrumb removed - the layout owns
    // the trail now).
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ada.admin@jad.example')).toBeInTheDocument();
    expect(screen.getByText('Back to staff')).toBeInTheDocument();
    expect(screen.getByText('Role Assignment')).toBeInTheDocument();
    expect(screen.getByText('Access')).toBeInTheDocument();
  });

  it('saves a role change with actor attribution', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });

    await user.selectOptions(screen.getByLabelText('Assign role'), 'finance');
    await user.click(screen.getByText('Save role'));

    expect(state.assignMutate).toHaveBeenCalledWith({
      id: 'stf-002',
      roleId: 'finance',
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
  });

  it('blocks changing your own role', async () => {
    state.member = { ...state.Saul };
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });

    expect(await screen.findByText('You cannot change your own role.')).toBeInTheDocument();
    expect(screen.getByText('Save role')).toBeDisabled();
  });

  it('blocks demoting the last active administrator', async () => {
    state.member = { ...state.Saul };
    renderWithProviders(<StaffDetailPage />, { user: MOCK_STAFF_ADMIN });

    // Both role and status guards fire for the last active governor.
    const notes = await screen.findAllByText(/last active administrator\./);
    expect(notes.length).toBe(2);
    expect(screen.getByText('Save role')).toBeDisabled();
  });

  it('disables access through a confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });

    await user.click(screen.getByText('Disable access'));
    expect(await screen.findByText('Disable Ada Admin?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    expect(state.statusMutate).toHaveBeenCalledWith({
      id: 'stf-002',
      status: 'DISABLED',
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
  });

  it('blocks disabling your own access', async () => {
    state.member = { ...state.Saul };
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });

    expect(await screen.findByText('You cannot change your own status.')).toBeInTheDocument();
    expect(screen.queryByText('Disable access')).not.toBeInTheDocument();
  });

  it('lets a super admin delete other staff through a confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });

    await user.click(await screen.findByText('Delete staff'));
    expect(await screen.findByText('Delete Ada Admin?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(state.deleteMutate).toHaveBeenCalledWith({
      id: 'stf-002',
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
  });

  it('blocks non-super-admin staff from deleting', async () => {
    renderWithProviders(<StaffDetailPage />, { user: MOCK_FINANCE });

    expect(
      await screen.findByText('Only super admins can delete staff accounts.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Delete staff')).not.toBeInTheDocument();
    expect(state.deleteMutate).not.toHaveBeenCalled();
  });

  it('blocks deleting your own account', async () => {
    state.member = { ...state.Saul };
    renderWithProviders(<StaffDetailPage />, { user: MOCK_SUPER_ADMIN });

    expect(
      await screen.findByText('You cannot delete your own staff account.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Delete staff')).not.toBeInTheDocument();
  });
});
