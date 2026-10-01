/**
 * Forced password-change exit (temporary-password loop regression).
 *
 * Root cause, fixed: the gate parks every session on `/admin/profile`, logout
 * does not navigate, and login restores any `/admin*` target - so a fixed
 * session bounced straight back onto the same screen and looked like the
 * force-change page had reappeared. Two guards now close it:
 *
 * 1. The login restore target excludes `/admin/profile` (unit-pinned in
 *    `lib/portal.spec.ts`), and
 * 2. this page navigates forward to the dashboard once a FORCED change
 *    succeeds (navigating is safe either way: a still-gated session is
 *    parked back here by the guard instead of stranding).
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { MyAccountPage } from './MyAccountPage';

const passwordMock = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock('../afhomes/services', () => ({
  changeAfHomesStaffPassword: (...args: unknown[]) =>
    (passwordMock.change as (...a: unknown[]) => unknown)(...args),
  updateAfHomesStaffProfile: vi.fn(),
}));

const gatedUser: SessionUser = {
  id: 'staff-1',
  name: 'Temp User',
  email: 'temp@afhomes.test',
  roleId: 'role-1',
  roleSlug: 'employee',
  roleName: 'Employee',
  afHomesPermissions: [],
  status: 'active',
  mustChangePassword: true,
};

const ungatedUser: SessionUser = { ...gatedUser, mustChangePassword: false };

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  passwordMock.change.mockResolvedValue({ changed: true });
});

async function changePassword() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^current password$/i), 'TempPass123!');
  await user.type(screen.getByLabelText(/^new password$/i), 'Permanent123!');
  await user.type(screen.getByLabelText(/confirm new password/i), 'Permanent123!');
  await user.click(screen.getByRole('button', { name: /change password/i }));
}

describe('forced password change exit', () => {
  it('leaves the change screen for the dashboard after a forced change', async () => {
    renderWithProviders(
      <>
        <MyAccountPage />
        <LocationProbe />
      </>,
      { route: '/admin/profile', user: gatedUser },
    );
    expect(await screen.findByText(/set a new password to continue/i)).toBeInTheDocument();
    await changePassword();
    expect(await screen.findByTestId('location')).toHaveTextContent('/admin');
  });

  it('stays on the account screen after a voluntary change', async () => {
    renderWithProviders(
      <>
        <MyAccountPage />
        <LocationProbe />
      </>,
      { route: '/admin/profile', user: ungatedUser },
    );
    await changePassword();
    await screen.findByTestId('location');
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/profile');
  });
});
