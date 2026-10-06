import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { afHomesRoleSchema } from '@jad/contracts';
import { renderWithProviders, within } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { AfHomesRolesPage } from './AfHomesRolesPage';
import { getAfHomesRoles, updateAfHomesRole } from './services';
vi.mock('./services', () => ({
  getAfHomesRoles: vi.fn(),
  createAfHomesRole: vi.fn(),
  updateAfHomesRole: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const role = afHomesRoleSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'employee',
  name: 'Employee',
  description: null,
  isSystem: true,
  isActive: true,
  assignedCount: 0,
  permissions: [],
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
});
/**
 * A non-Super-Admin viewer. Every operational role is a seeded system role, and
 * the server refuses `role_permissions` edits to any system role for anyone
 * other than a Super Admin (`api/_handlers/admin/afhomes.ts`), so the screen
 * must OFFER "View access" for all of them.
 */
const ADMIN_VIEWER: SessionUser = {
  id: 'u-admin',
  name: 'Admin',
  email: 'admin@afhomes.test',
  roleId: 'r-admin',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  testPurgeEnabled: false,
  afHomesPermissions: [],
};

const SUPER_ADMIN: SessionUser = {
  ...ADMIN_VIEWER,
  id: 'u-super',
  name: 'Super Admin',
  email: 'super@afhomes.test',
  roleId: 'r-super',
  roleSlug: 'super_admin',
  roleName: 'Super Admin',
};

// Operational roles the request names explicitly. All are seeded isSystem, and
// none is admin/super_admin/customer, so all are editable by a Super Admin.
const OPERATIONAL_SLUGS = [
  'finance',
  'hr',
  'employee',
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
] as const;

it('hides Customer and opens protected access read-only without a mutation path', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    role,
    { ...role, id: '00000000-0000-4000-8000-000000000002', slug: 'customer', name: 'Customer' },
  ]);
  renderWithProviders(<AfHomesRolesPage />, { user: SUPER_ADMIN });
  // A Super Admin may edit the `employee` system role, so the button says so.
  fireEvent.click(await screen.findByRole('button', { name: 'Edit access' }));
  expect(screen.queryByRole('link', { name: 'Customer' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Edit Employee access' })).toBeInTheDocument();
  // A Super Admin editing a system role relabels the field, so only the display
  // title is theirs to change - the slug and the grants are not.
  expect(screen.getByLabelText('Display title')).toBeEnabled();
});

it('offers View access - never a dead Edit access button - to a non-Super-Admin', async () => {
  // This is the reported defect: the list button used to say "Edit access" for
  // every role except admin/super_admin, then handed back a disabled "View ...
  // access" dialog, because the label and the gate were two different predicates.
  // The label must now agree with the gate for every operational role.
  vi.mocked(getAfHomesRoles).mockResolvedValue(
    OPERATIONAL_SLUGS.map((slug, index) => ({
      ...role,
      id: `00000000-0000-4000-8000-00000000000${index + 10}`,
      slug,
      name: slug,
    })),
  );
  renderWithProviders(<AfHomesRolesPage />, { user: ADMIN_VIEWER });

  await screen.findByRole('link', { name: 'finance' });
  expect(screen.queryByRole('button', { name: 'Edit access' })).toBeNull();
  for (const slug of OPERATIONAL_SLUGS) {
    // Scoped to the row, because all seven rows offer the same button name.
    const row = screen.getByRole('link', { name: slug }).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'View access' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Edit access' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'View access' }));
    expect(screen.getByRole('dialog', { name: `View ${slug} access` })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  }
  expect(updateAfHomesRole).not.toHaveBeenCalled();
});

it('offers Edit access for every operational role to a Super Admin', async () => {
  // Part 34: Finance, HR, Employee/GSD, Vice Director, Senior Sales Manager,
  // Sales Manager and OST must all be editable rather than view-only.
  vi.mocked(getAfHomesRoles).mockResolvedValue(
    OPERATIONAL_SLUGS.map((slug, index) => ({
      ...role,
      id: `00000000-0000-4000-8000-00000000000${index + 10}`,
      slug,
      name: slug,
    })),
  );
  renderWithProviders(<AfHomesRolesPage />, { user: SUPER_ADMIN });
  for (const slug of OPERATIONAL_SLUGS) {
    const row = (await screen.findByRole('link', { name: slug })).closest('tr');
    // Assert on the button's own accessible name rather than reaching into the
    // DOM, so a row that renders "View access" here fails this test.
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Edit access' }));
    expect(screen.getByRole('dialog', { name: `Edit ${slug} access` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  }
});
it('keeps the existing custom-role permission editor usable', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom' },
  ]);
  renderWithProviders(<AfHomesRolesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit access' }));
  expect(screen.getByLabelText('Name')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
});
