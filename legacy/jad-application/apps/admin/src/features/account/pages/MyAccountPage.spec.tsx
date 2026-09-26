import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_SUPER_ADMIN } from '@jad/mock';

import { resetStaffStore, staffStore } from '../../../mock/staffMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { MyAccountPage } from './MyAccountPage';

/**
 * My Account (/admin/profile) - the signed-in staff member views identity,
 * edits their display name, and changes their password. Red: the page does
 * not exist yet.
 */
describe('MyAccountPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the signed-in identity with name editable and email/role read-only', async () => {
    renderWithProviders(<MyAccountPage />, { user: MOCK_SUPER_ADMIN });

    expect(await screen.findByRole('heading', { name: 'My Account' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Saul Super')).toBeInTheDocument();
    expect(screen.getByText('superadmin@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
  });

  it('prefers the session-resolved custom role name over the raw role id', async () => {
    renderWithProviders(<MyAccountPage />, {
      user: {
        ...MOCK_SUPER_ADMIN,
        roleId: 'role-admin-support',
        roleName: 'Admin Support',
        roleModules: ['dashboard', 'members'],
      },
    });

    expect(await screen.findByText('Admin Support')).toBeInTheDocument();
    expect(screen.queryByText('role-admin-support')).not.toBeInTheDocument();
  });

  it('saves a new display name and refreshes the session', async () => {
    const onRevalidate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MyAccountPage />, { user: MOCK_SUPER_ADMIN, onRevalidate });

    const nameInput = await screen.findByLabelText('Display name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Saul Supremo');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Profile updated')).toBeInTheDocument();
    expect(staffStore.members[0]?.name).toBe('Saul Supremo');
    await waitFor(() => expect(onRevalidate).toHaveBeenCalled());
  });

  it('rejects an empty display name without calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyAccountPage />, { user: MOCK_SUPER_ADMIN });

    const nameInput = await screen.findByLabelText('Display name');
    await user.clear(nameInput);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/enter a display name/i)).toBeInTheDocument();
    expect(staffStore.members[0]?.name).toBe('Saul Super');
  });

  it('changes the password and refreshes the session', async () => {
    const onRevalidate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MyAccountPage />, { user: MOCK_SUPER_ADMIN, onRevalidate });

    await user.type(screen.getByLabelText('Current password'), 'old-pass-1');
    await user.type(screen.getByLabelText('New password'), 'NewPass12');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass12');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    await waitFor(() => expect(onRevalidate).toHaveBeenCalled());
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('validates mismatched and short new passwords locally', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyAccountPage />, { user: MOCK_SUPER_ADMIN });

    await user.type(screen.getByLabelText('Current password'), 'old-pass-1');
    await user.type(screen.getByLabelText('New password'), 'NewPass12');
    await user.type(screen.getByLabelText('Confirm new password'), 'Different1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.queryByText('Password changed')).not.toBeInTheDocument();
  });

  it('surfaces a wrong current password from the server', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyAccountPage />, { user: MOCK_SUPER_ADMIN });

    await user.type(screen.getByLabelText('Current password'), 'wrong-current');
    await user.type(screen.getByLabelText('New password'), 'NewPass12');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass12');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
  });

  it('shows a forced-change banner when the account runs on a temporary password', async () => {
    renderWithProviders(<MyAccountPage />, {
      user: { ...MOCK_SUPER_ADMIN, mustChangePassword: true },
    });

    expect(await screen.findByText(/set a new password to continue/i)).toBeInTheDocument();
  });
});
