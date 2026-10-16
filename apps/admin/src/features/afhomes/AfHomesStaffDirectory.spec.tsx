import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesRole, AfHomesStaff } from '@afhomes/contracts';
import { AfHomesStaffPage } from './AfHomesStaffPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import {
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaff,
  updateAfHomesStaff,
} from './services';

vi.mock('./services', () => ({
  getAfHomesStaff: vi.fn(),
  getAfHomesRoles: vi.fn(),
  getAfHomesDepartments: vi.fn(),
  isTestStaffEmail: () => false,
  createAfHomesStaff: vi.fn(),
  updateAfHomesStaff: vi.fn(),
  deleteAfHomesStaff: vi.fn(),
  purgeTestAfHomesStaff: vi.fn(),
}));

const ADMIN: SessionUser = {
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Admin User',
  email: 'admin@afhomes.test',
  roleId: '00000000-0000-4000-8000-000000000010',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [],
};

const role = (extra: Partial<AfHomesRole>): AfHomesRole =>
  ({
    id: '00000000-0000-4000-8000-000000000010',
    slug: 'admin',
    name: 'Admin',
    isSystem: true,
    isActive: true,
    departmentId: null,
    departmentName: null,
    assignedCount: 1,
    permissions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  }) as AfHomesRole;

const ADMIN_ROLE = role({});
const EMPLOYEE_ROLE = role({
  id: '00000000-0000-4000-8000-000000000011',
  slug: 'employee',
  name: 'Employee',
});
const OST_ROLE = role({
  id: '00000000-0000-4000-8000-000000000012',
  slug: 'ost',
  name: 'OST',
});
const SUPER_ROLE = role({
  id: '00000000-0000-4000-8000-000000000013',
  slug: 'super_admin',
  name: 'Super Admin',
});

const member = (extra: Partial<AfHomesStaff>): AfHomesStaff =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ana@afhomes.test',
    fullName: 'ANA REYES',
    status: 'active',
    departmentId: null,
    departmentName: null,
    roleId: ADMIN_ROLE.id,
    roleName: 'Admin',
    employeeNumber: 'AF-EMP-00001',
    salesNumber: null,
    restrictions: [],
    mustChangePassword: false,
    invitedAt: null,
    activatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  }) as AfHomesStaff;

const ANA = member({});
const OST_MEMBER = member({
  id: '22222222-2222-4222-8222-222222222222',
  email: 'ost@afhomes.test',
  fullName: 'OST AGENT',
  roleId: OST_ROLE.id,
  roleName: 'OST',
  employeeNumber: null,
  salesNumber: 'AF-SALES-00001',
});
const BOSS = member({
  id: '33333333-3333-4333-8333-333333333333',
  email: 'boss@afhomes.test',
  fullName: 'SUPER BOSS',
  roleId: SUPER_ROLE.id,
  roleName: 'Super Admin',
  employeeNumber: 'AF-EMP-00002',
});

function show(rows: AfHomesStaff[], user: SessionUser = ADMIN) {
  vi.mocked(getAfHomesStaff).mockResolvedValue(rows);
  vi.mocked(getAfHomesRoles).mockResolvedValue([ADMIN_ROLE, EMPLOYEE_ROLE, OST_ROLE, SUPER_ROLE]);
  vi.mocked(getAfHomesDepartments).mockResolvedValue([]);
  vi.mocked(updateAfHomesStaff).mockReset();
  vi.mocked(deleteAfHomesStaff).mockReset();
  renderWithProviders(<AfHomesStaffPage />, { user });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staff directory columns', () => {
  it('shows Code, Name, Email, Role, Status, Added and Actions only', async () => {
    show([ANA]);
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Code', 'Name', 'Email', 'Role', 'Status', 'Added', 'Actions']);
    expect(screen.queryByText('AA Number')).toBeNull();
    expect(screen.queryByText(ANA.id)).toBeNull();
    expect(await screen.findByText('AF-EMP-00001')).toBeInTheDocument();
    expect(screen.getByText('ana@afhomes.test')).toBeInTheDocument();
  });

  it('keeps sales hierarchy rows out of the staff directory', async () => {
    show([ANA, OST_MEMBER]);
    await screen.findByText('ANA REYES');
    expect(screen.queryByText('OST AGENT')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New Staff' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByRole('option', { name: 'Employee' })).toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: 'OST' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: 'Customer' })).not.toBeInTheDocument();
  });

  it('shows only Edit and Delete actions (Delete for super-admins only)', async () => {
    show([ANA, BOSS]);
    await screen.findByText('ANA REYES');
    const anaRow = screen.getAllByRole('link').find((r) => within(r).queryByText('ANA REYES'))!;
    // Status changes go through Edit now; no inline Suspend/Activate,
    // Restrictions, or Purge controls on the row.
    expect(within(anaRow).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(anaRow).queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(within(anaRow).queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(within(anaRow).queryByRole('button', { name: 'Restrictions' })).toBeNull();
    expect(within(anaRow).queryByRole('button', { name: 'Delete' })).toBeNull();
    const bossRow = screen.getAllByRole('link').find((r) => within(r).queryByText('SUPER BOSS'))!;
    expect(within(bossRow).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(bossRow).queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(within(bossRow).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows Delete to super-admins', async () => {
    const SUPER_ADMIN_USER: SessionUser = {
      ...ADMIN,
      id: '00000000-0000-4000-8000-000000000098',
      roleSlug: 'super_admin',
      roleName: 'Super Admin',
    };
    show([ANA], SUPER_ADMIN_USER);
    await screen.findByText('ANA REYES');
    const anaRow = screen.getAllByRole('link').find((r) => within(r).queryByText('ANA REYES'))!;
    expect(within(anaRow).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(anaRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(anaRow).queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(within(anaRow).queryByRole('button', { name: 'Restrictions' })).toBeNull();
  });

  it('edits role, department and status', async () => {
    show([ANA]);
    await screen.findByText('ANA REYES');
    const anaRow = screen.getAllByRole('link').find((r) => within(r).queryByText('ANA REYES'))!;
    fireEvent.click(within(anaRow).getByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Edit status'), {
      target: { value: 'suspended' },
    });
    vi.mocked(updateAfHomesStaff).mockResolvedValue({ ...ANA, status: 'suspended' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateAfHomesStaff).toHaveBeenCalledWith(
        ANA.id,
        expect.objectContaining({ status: 'suspended' }),
      ),
    );
  });
});
