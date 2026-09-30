/**
 * AF Homes Phase 1 (JAD parity) - staff lifecycle frontend behavior.
 *
 * Pins the forced-password-change gating (nav hidden, module routes parked
 * on My Account, profile reachable), the UserMenu account entry, the
 * temporary-password creation dialog, and the real staff/role detail pages.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission } from '@jad/contracts';

import { renderWithProviders } from '../test/utils';
import App from './App';
import type { SessionUser } from '../lib/session';

vi.mock('../features/afhomes/services', () => ({
  getAfHomesStaff: vi.fn(),
  getAfHomesStaffById: vi.fn(),
  getAfHomesStaffAudit: vi.fn(),
  getAfHomesRoles: vi.fn(),
  getAfHomesRoleById: vi.fn(),
  getAfHomesRoleAudit: vi.fn(),
  getAfHomesDepartments: vi.fn(),
  createAfHomesStaff: vi.fn(),
  updateAfHomesStaff: vi.fn(),
  deactivateAfHomesStaff: vi.fn(),
  deleteAfHomesStaff: vi.fn(),
  updateAfHomesStaffProfile: vi.fn(),
  changeAfHomesStaffPassword: vi.fn(),
  createAfHomesRole: vi.fn(),
  updateAfHomesRole: vi.fn(),
}));

import {
  changeAfHomesStaffPassword,
  createAfHomesStaff,
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoleAudit,
  getAfHomesRoleById,
  getAfHomesRoles,
  getAfHomesStaff,
  getAfHomesStaffAudit,
  getAfHomesStaffById,
} from '../features/afhomes/services';

const grant = (
  moduleKey: AfHomesPermission['moduleKey'],
  extra: Partial<AfHomesPermission> = {},
): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  ...extra,
});

const SUPER: SessionUser = {
  id: 'u-super',
  name: 'Super Admin',
  email: 'super@afhomes.test',
  roleId: 'r-super',
  roleSlug: 'super_admin',
  roleName: 'Super Admin',
  status: 'active',
  afHomesPermissions: [
    grant('dashboard.view'),
    grant('organization.staff', { canCreate: true, canUpdate: true, canDelete: true }),
    grant('organization.departments'),
    grant('organization.roles', { canCreate: true, canUpdate: true }),
  ],
};

const GATED: SessionUser = { ...SUPER, id: 'u-gated', mustChangePassword: true };

const STAFF_ROW = {
  id: 's-1',
  email: 'ana@afhomes.test',
  fullName: 'Ana Reyes',
  status: 'active',
  departmentId: null,
  departmentName: null,
  roleId: 'r-admin',
  roleName: 'Admin',
  restrictions: [],
  mustChangePassword: false,
  invitedAt: null,
  activatedAt: '2026-09-02T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const ROLE_ROW = {
  id: 'r-admin',
  slug: 'admin',
  name: 'Admin',
  description: 'Operations admin',
  isSystem: false,
  isActive: true,
  assignedCount: 1,
  permissions: [grant('dashboard.view'), grant('organization.staff')],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function install() {
  vi.mocked(getAfHomesStaff).mockResolvedValue([STAFF_ROW] as never);
  vi.mocked(getAfHomesStaffById).mockResolvedValue(STAFF_ROW as never);
  vi.mocked(getAfHomesStaffAudit).mockResolvedValue([] as never);
  vi.mocked(getAfHomesRoles).mockResolvedValue([ROLE_ROW] as never);
  vi.mocked(getAfHomesRoleById).mockResolvedValue(ROLE_ROW as never);
  vi.mocked(getAfHomesRoleAudit).mockResolvedValue([] as never);
  vi.mocked(getAfHomesDepartments).mockResolvedValue([] as never);
  vi.mocked(createAfHomesStaff).mockResolvedValue(STAFF_ROW as never);
  vi.mocked(changeAfHomesStaffPassword).mockResolvedValue({ changed: true } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  install();
});

describe('forced password-change gating', () => {
  it('parks a gated session on My Account with the first-login banner', async () => {
    renderWithProviders(<App />, { route: '/admin', user: GATED });
    expect(await screen.findByText('Set a new password to continue')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull();
  });

  it('keeps My Account reachable while gated and hides module navigation', async () => {
    renderWithProviders(<App />, { route: '/admin/profile', user: GATED });
    expect(await screen.findByText('Your staff identity and sign-in')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull();
  });

  it('shows module navigation once the flag is cleared', async () => {
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    expect(await screen.findByText('Ana Reyes')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Staff' }).length).toBeGreaterThan(0);
  });

  it('exposes My Account in the account menu', async () => {
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await screen.findByText('Ana Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const item = await screen.findByRole('menuitem', { name: 'My Account' });
    expect(item.getAttribute('href')).toBe('/admin/profile');
  });
});

describe('My Account password workflow', () => {
  it('rejects mismatched confirmation and calls the change endpoint when valid', async () => {
    renderWithProviders(<App />, { route: '/admin/profile', user: GATED });
    await screen.findByText('Your staff identity and sign-in');
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'TempPass123' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewPass456' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'SomethingElse' },
    });
    expect(await screen.findByText('New passwords do not match.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewPass456' },
    });
    const button = screen.getByRole('button', { name: 'Change password' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(changeAfHomesStaffPassword).toHaveBeenCalledWith({
        currentPassword: 'TempPass123',
        newPassword: 'NewPass456',
      }),
    );
  });

  it('surfaces a wrong-current-password failure without clearing the form state', async () => {
    vi.mocked(changeAfHomesStaffPassword).mockRejectedValueOnce(new Error('Unauthorized'));
    renderWithProviders(<App />, { route: '/admin/profile', user: GATED });
    await screen.findByText('Your staff identity and sign-in');
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'WrongPass1' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewPass456' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewPass456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('temporary-password staff creation', () => {
  it('validates confirmation client-side and creates with the temporary password', async () => {
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await screen.findByText('Ana Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'New Staff' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Hire' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new.hire@afhomes.test' },
    });
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'TempPass123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm temporary password'), {
      target: { value: 'TempPass12' },
    });
    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create staff' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirm temporary password'), {
      target: { value: 'TempPass123' },
    });
    const create = screen.getByRole('button', { name: 'Create staff' });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(createAfHomesStaff).toHaveBeenCalledWith({
        fullName: 'New Hire',
        email: 'new.hire@afhomes.test',
        roleId: 'r-admin',
        departmentId: null,
        temporaryPassword: 'TempPass123',
      }),
    );
  });
});

describe('permanent staff deletion', () => {
  async function confirmPermanentDelete() {
    await screen.findByText('Ana Reyes');
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete Permanently' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!);
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm staff deletion'), {
      target: { value: 'DELETE' },
    });
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete Permanently' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
  }

  it('shows the protected-history message instead of a generic server error', async () => {
    vi.mocked(deleteAfHomesStaff).mockRejectedValueOnce(
      new Error(
        'This staff account has historical business records and cannot be permanently deleted. Deactivate the account instead.',
      ),
    );
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await confirmPermanentDelete();
    expect(await screen.findByRole('alert')).toHaveTextContent(/historical business records/i);
    expect(screen.queryByText('Internal server error')).toBeNull();
  });

  it('shows an expired-session message without exposing authorization details', async () => {
    vi.mocked(deleteAfHomesStaff).mockRejectedValueOnce(
      new Error('Your session has expired. Please sign in again.'),
    );
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await confirmPermanentDelete();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session has expired. Please sign in again.');
    expect(alert).not.toHaveTextContent(/Authorization|Bearer|token/i);
  });

  it('removes the deleted row after invalidating and refetching the staff query', async () => {
    vi.mocked(deleteAfHomesStaff).mockResolvedValueOnce({ deleted: true });
    vi.mocked(getAfHomesStaff)
      .mockResolvedValueOnce([STAFF_ROW] as never)
      .mockResolvedValueOnce([] as never);
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await confirmPermanentDelete();
    await waitFor(() => expect(deleteAfHomesStaff).toHaveBeenCalledWith(STAFF_ROW.id));
    await waitFor(() => expect(screen.queryByText('Ana Reyes')).toBeNull());
    expect(await screen.findByText('No staff found')).toBeTruthy();
  });
});

describe('staff and role detail pages', () => {
  it('navigates from the staff list to a real detail page', async () => {
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await screen.findByText('Ana Reyes');
    fireEvent.click(screen.getByRole('link', { name: 'View staff member Ana Reyes' }));
    expect(await screen.findByText('Staff information')).toBeTruthy();
    expect(screen.getByText('Account state')).toBeTruthy();
    expect(screen.getByText('Audit history')).toBeTruthy();
  });

  it('blocks self-assignment edits on the own detail page', async () => {
    const self: SessionUser = { ...SUPER, id: 's-1', name: 'Ana Reyes' };
    renderWithProviders(<App />, { route: '/admin/staff/s-1', user: self });
    await screen.findByText('Staff information');
    expect(await screen.findByText('You cannot edit your own assignment. Ask another administrator.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save assignment' })).toBeNull();
  });

  it('renders the role detail with permissions and history', async () => {
    renderWithProviders(<App />, { route: '/admin/roles/r-admin', user: SUPER });
    expect(await screen.findByText('Permissions')).toBeTruthy();
    expect(screen.getByText('Assigned staff (1)')).toBeTruthy();
    expect(screen.getByText('Audit history')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit role' }));
    expect(await screen.findByText('Save role')).toBeTruthy();
  });
});
