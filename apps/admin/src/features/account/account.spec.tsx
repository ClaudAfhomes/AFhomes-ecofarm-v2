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
 * 2. a successful forced change signs out and returns to the correct login.
 */
import { screen, waitFor } from '@testing-library/react';
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
const sessionMock = vi.hoisted(()=>({user:null as SessionUser|null,logout:vi.fn(),revalidate:vi.fn()}));
vi.mock('../../lib/session',async()=>({...await vi.importActual<typeof import('../../lib/session')>('../../lib/session'),useSession:()=>sessionMock}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  passwordMock.change.mockResolvedValue({ changed: true });
  sessionMock.user=gatedUser;
  sessionMock.logout.mockResolvedValue(undefined);
  sessionMock.revalidate.mockResolvedValue(undefined);
});

async function changePassword() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^current password$/i), 'TempPass123!');
  await user.type(screen.getByLabelText(/^new password$/i), 'Permanent123!');
  await user.type(screen.getByLabelText(/confirm new password/i), 'Permanent123!');
  await user.click(screen.getByRole('button', { name: /change password/i }));
}

describe('forced password change exit', () => {
  it('returns to staff login after a forced change', async () => {
    renderWithProviders(
      <>
        <MyAccountPage />
        <LocationProbe />
      </>,
      { route: '/admin/profile', user: gatedUser },
    );
    expect(await screen.findByText(/set a new password to continue/i)).toBeInTheDocument();
    await changePassword();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/staff/login'));
    expect(sessionMock.logout).toHaveBeenCalledOnce();
  });

  it('stays on the account screen after a voluntary change', async () => {
    sessionMock.user=ungatedUser;
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
    expect(sessionMock.logout).not.toHaveBeenCalled();
  });
  it('returns administrators to admin login after a forced change',async()=>{
    sessionMock.user={...gatedUser,roleSlug:'super_admin'};
    renderWithProviders(<><MyAccountPage/><LocationProbe/></>,{route:'/admin/profile',user:sessionMock.user});
    await changePassword();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/login'));
    expect(sessionMock.logout).toHaveBeenCalledOnce();
  });
});
