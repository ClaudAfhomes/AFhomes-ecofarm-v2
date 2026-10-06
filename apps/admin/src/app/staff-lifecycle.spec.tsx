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

vi.mock('../features/afhomes/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/afhomes/services')>();
  return {
    ...actual,
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
    purgeTestAfHomesStaff: vi.fn(),
    updateAfHomesStaffProfile: vi.fn(),
    changeAfHomesStaffPassword: vi.fn(),
    createAfHomesRole: vi.fn(),
    updateAfHomesRole: vi.fn(),
  };
});

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
  purgeTestAfHomesStaff,
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
  testPurgeEnabled: true,
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

// A CUSTOM, non-system role, because that is what this test is about: the detail
// page renders a role a Super Admin is allowed to edit.
//
// It previously used `slug: 'admin'` with `isSystem: false`. That combination is
// unreachable - Phase 1 seeds `admin` as a system role, so `is_system` is always
// true for that slug. The impossible fixture made the OLD label check
// (`!record.isSystem`) say "Edit role" for a role that
// `public.update_operational_role` refuses outright, by slug, even for a Super
// Admin. The shared predicate therefore correctly answered "View access" and the
// test failed.
//
// This was the defect the release fixes, not the predicate: a screen that offers
// "Edit role" for a role the server will refuse is the label/gate disagreement
// that motivated `isRoleAccessProtected` in the first place.
const ROLE_ROW = {
  id: 'r-admin',
  slug: 'qa_custom_role',
  name: 'QA Custom Role',
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

describe('test-account purge', () => {
  const PURGE_RESULT = {
    purged: true as const,
    counts: {
      staff: 1,
      restrictions: 0,
      assignments: 1,
      invitations: 0,
      sales: 0,
      customers: 0,
      payments: 0,
      memberships: 0,
      history: 0,
    },
    authUserDeleted: true,
  };

  async function confirmTestPurge() {
    await screen.findByText('Ana Reyes');
    const purgeButtons = screen.getAllByRole('button', { name: 'Purge Test Account' });
    fireEvent.click(purgeButtons[purgeButtons.length - 1]!);
    fireEvent.change(screen.getByLabelText('Type PURGE to confirm test account purge'), {
      target: { value: 'PURGE' },
    });
    const confirmButtons = screen.getAllByRole('button', { name: 'Purge Test Account' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
  }

  it('shows Purge Test Account for a test-domain row when the flag is on', async () => {
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await screen.findByText('Ana Reyes');
    // ana@afhomes.test is RFC-reserved: eligible. The normal delete stays too.
    expect(screen.getAllByRole('button', { name: 'Purge Test Account' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete Permanently' }).length).toBeGreaterThan(0);
  });

  it('hides Purge Test Account for a real-domain row', async () => {
    vi.mocked(getAfHomesStaff).mockResolvedValue([
      { ...STAFF_ROW, email: 'ana.reyes@afhomes.ph' },
    ] as never);
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await screen.findByText('Ana Reyes');
    expect(screen.queryByRole('button', { name: 'Purge Test Account' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Delete Permanently' }).length).toBeGreaterThan(0);
  });

  it('hides Purge Test Account when the server flag is off', async () => {
    renderWithProviders(<App />, {
      route: '/admin/staff',
      user: { ...SUPER, testPurgeEnabled: false },
    });
    await screen.findByText('Ana Reyes');
    expect(screen.queryByRole('button', { name: 'Purge Test Account' })).toBeNull();
  });

  it('requires the exact PURGE confirmation and removes the row on success', async () => {
    vi.mocked(purgeTestAfHomesStaff).mockResolvedValueOnce(PURGE_RESULT);
    vi.mocked(getAfHomesStaff)
      .mockResolvedValueOnce([STAFF_ROW] as never)
      .mockResolvedValueOnce([] as never);
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await screen.findByText('Ana Reyes');
    fireEvent.click(screen.getAllByRole('button', { name: 'Purge Test Account' })[0]!);
    // Any other confirmation text keeps the destructive action disabled.
    fireEvent.change(screen.getByLabelText('Type PURGE to confirm test account purge'), {
      target: { value: 'DELETE' },
    });
    const confirm = screen.getAllByRole('button', { name: 'Purge Test Account' }).pop()!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type PURGE to confirm test account purge'), {
      target: { value: 'PURGE' },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(purgeTestAfHomesStaff).toHaveBeenCalledWith(STAFF_ROW.id));
    await waitFor(() => expect(screen.queryByText('Ana Reyes')).toBeNull());
  });

  it('surfaces a non-test refusal without a generic error', async () => {
    vi.mocked(purgeTestAfHomesStaff).mockRejectedValueOnce(
      new Error('Only test accounts can be purged.'),
    );
    renderWithProviders(<App />, { route: '/admin/staff', user: SUPER });
    await confirmTestPurge();
    expect(await screen.findByRole('alert')).toHaveTextContent('Only test accounts can be purged.');
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
    expect(
      await screen.findByText('You cannot edit your own assignment. Ask another administrator.'),
    ).toBeTruthy();
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
