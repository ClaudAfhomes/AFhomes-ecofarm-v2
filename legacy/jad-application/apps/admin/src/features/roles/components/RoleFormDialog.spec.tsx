import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_SUPER_ADMIN } from '@jad/mock';

import { resetStaffStore } from '../../../mock/staffMockStore';
import { renderWithProviders } from '../../../test/utils';
import { RoleFormDialog } from './RoleFormDialog';

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useCreateRole', () => ({
  useCreateRole: () => ({ mutateAsync, isPending: false }),
}));

function renderDialog(onClose = vi.fn()) {
  renderWithProviders(<RoleFormDialog open onClose={onClose} />, { user: MOCK_SUPER_ADMIN });
  return { onClose };
}

describe('RoleFormDialog', () => {
  beforeEach(() => {
    resetStaffStore();
    mutateAsync
      .mockReset()
      .mockResolvedValue({ id: 'role-finance-reviewer', name: 'Finance Reviewer' });
  });

  it('renders name and module picker', async () => {
    renderDialog();
    expect(await screen.findByRole('heading', { name: 'Create Role' })).toBeInTheDocument();
    expect(screen.getByLabelText('Role name')).toBeInTheDocument();
    expect(screen.getByLabelText('Sales')).toBeInTheDocument();
    expect(screen.getByLabelText('Staff')).toBeInTheDocument();
  });

  it('requires a name and at least one module', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('checkbox', { name: 'Dashboard' }));
    await user.click(await screen.findByRole('button', { name: 'Create Role' }));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Select at least one module.')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('surfaces duplicate-name errors from the store', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValueOnce(new Error('A role with this name already exists.'));
    renderDialog();
    await user.type(screen.getByLabelText('Role name'), 'Admin');
    await user.click(screen.getByRole('button', { name: 'Create Role' }));
    expect(await screen.findByText('A role with this name already exists.')).toBeInTheDocument();
  });

  it('locks governance modules for new custom roles (server rejects them)', async () => {
    renderDialog();
    await screen.findByRole('heading', { name: 'Create Role' });
    // staff/audit/config/programs stay super-admin-only on new roles.
    expect(screen.getByLabelText('Staff')).toBeDisabled();
    expect(screen.getByLabelText('Audit Log')).toBeDisabled();
    expect(screen.getByLabelText('System Configuration')).toBeDisabled();
    // Operational modules stay selectable.
    expect(screen.getByLabelText('Sales')).toBeEnabled();
    expect(screen.getByLabelText('Dashboard')).toBeEnabled();
  });

  it('creates the role with actor attribution and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(screen.getByLabelText('Role name'), 'Finance Reviewer');
    await user.click(screen.getByLabelText('Sales'));
    await user.click(screen.getByRole('button', { name: 'Create Role' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      name: 'Finance Reviewer',
      permissions: expect.arrayContaining(['dashboard', 'sales']),
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
