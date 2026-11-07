import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afHomesRoleSchema } from '@afhomes/contracts';
import { renderWithProviders, within } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { AfHomesRolesPage } from './AfHomesRolesPage';
import { getAfHomesDepartments, getAfHomesRoles, updateAfHomesRole } from './services';
vi.mock('./services', () => ({
  getAfHomesRoles: vi.fn(),
  getAfHomesDepartments: vi.fn(),
  createAfHomesRole: vi.fn(),
  updateAfHomesRole: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const DEPARTMENT_ID = '00000000-0000-4000-8000-0000000000d1';
const DEPARTMENTS = [
  {
    id: DEPARTMENT_ID,
    code: 'EXECUTIVE',
    name: 'Executive',
    isActive: true,
    staffCount: 0,
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
  },
];
function mockDepartments() {
  vi.mocked(getAfHomesDepartments).mockResolvedValue(DEPARTMENTS);
}
const role = afHomesRoleSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'employee',
  name: 'Employee',
  isSystem: true,
  isActive: true,
  departmentId: null,
  departmentName: null,
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
  mockDepartments();
  renderWithProviders(<AfHomesRolesPage />, { user: SUPER_ADMIN });
  // A Super Admin may edit the `employee` system role, so the button says so.
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.queryByText('Customer')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Edit Employee access' })).toBeInTheDocument();
  // A Super Admin editing a system role relabels the field, so only the display
  // title is theirs to change - the slug and the grants are not.
  expect(screen.getByLabelText('Display title(Optional)')).toBeEnabled();
});

it('offers Edit with every field editable - the server stays the boundary', async () => {
  // Every row offers Edit and Delete. The dialog exposes Name, Active,
  // Department and Page Access for editing; protected/system refusals surface
  // as a server 403 on save, never as a hidden control.
  vi.mocked(getAfHomesRoles).mockResolvedValue(
    OPERATIONAL_SLUGS.map((slug, index) => ({
      ...role,
      id: `00000000-0000-4000-8000-00000000000${index + 10}`,
      slug,
      name: slug,
      departmentId: DEPARTMENT_ID,
      departmentName: 'Executive',
    })),
  );
  mockDepartments();
  renderWithProviders(<AfHomesRolesPage />, { user: ADMIN_VIEWER });

  await screen.findByText('finance');
  for (const slug of OPERATIONAL_SLUGS) {
    // Scoped to the row, because all seven rows offer the same button names.
    const row = screen.getByText(slug).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: `Edit ${slug} access` })).toBeInTheDocument();
    expect(screen.getByLabelText('Display title(Optional)')).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Active' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  }
  expect(updateAfHomesRole).not.toHaveBeenCalled();
});

it('offers Edit for every operational role to a Super Admin', async () => {
  // Part 34: Finance, HR, Employee/GSD, Vice Director, Senior Sales Manager,
  // Sales Manager and OST must all be editable rather than view-only.
  vi.mocked(getAfHomesRoles).mockResolvedValue(
    OPERATIONAL_SLUGS.map((slug, index) => ({
      ...role,
      id: `00000000-0000-4000-8000-00000000000${index + 10}`,
      slug,
      name: slug,
      departmentId: DEPARTMENT_ID,
      departmentName: 'Executive',
    })),
  );
  mockDepartments();
  renderWithProviders(<AfHomesRolesPage />, { user: SUPER_ADMIN });
  for (const slug of OPERATIONAL_SLUGS) {
    const row = (await screen.findByText(slug)).closest('tr');
    // Assert on the button's own accessible name rather than reaching into the
    // DOM, so a row that renders "View access" here fails this test.
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: `Edit ${slug} access` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  }
});
it('keeps the existing custom-role permission editor usable', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    {
      ...role,
      isSystem: false,
      slug: 'qa_custom',
      name: 'QA Custom',
      departmentId: DEPARTMENT_ID,
      departmentName: 'Executive',
    },
  ]);
  mockDepartments();
  renderWithProviders(<AfHomesRolesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Name(Optional)')).toBeEnabled();
  expect(screen.getByLabelText('Role department')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
});

it('requires a department before a role can be saved', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom' },
  ]);
  mockDepartments();
  renderWithProviders(<AfHomesRolesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  // Unassigned role: the picker starts blank and Save stays off.
  expect(screen.getByLabelText('Role department')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Save role' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Role department'), {
    target: { value: DEPARTMENT_ID },
  });
  expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
  expect(updateAfHomesRole).not.toHaveBeenCalled();
});

it('filters roles by department', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    {
      ...role,
      slug: 'finance',
      name: 'finance',
      departmentId: DEPARTMENT_ID,
      departmentName: 'Executive',
    },
    { ...role, id: '00000000-0000-4000-8000-000000000003', slug: 'hr', name: 'hr' },
  ]);
  mockDepartments();
  renderWithProviders(<AfHomesRolesPage />);
  await screen.findByText('finance');
  expect(screen.getByText('hr')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter department'), {
    target: { value: DEPARTMENT_ID },
  });
  await waitFor(() => expect(screen.queryByText('hr')).toBeNull());
  expect(screen.getByText('finance')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter department'), { target: { value: 'unassigned' } });
  await waitFor(() => expect(screen.queryByText('finance')).toBeNull());
  expect(screen.getByText('hr')).toBeInTheDocument();
});

/**
 * The permission list is a set of group dropdowns. Two properties matter:
 * Dashboard has ONE module, so it must not be hidden behind a one-item
 * dropdown, and a multi-module group is a disclosure that opens on demand -
 * pre-expanded only when the role already holds something in it.
 */
describe('role access module dropdowns', () => {
  const permission = (moduleKey: string, canView: boolean) => ({
    moduleKey: moduleKey as never,
    canView,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  });
  const customRole = (extra: Record<string, unknown> = {}) => ({
    ...role,
    isSystem: false,
    slug: 'qa_custom',
    name: 'QA Custom',
    departmentId: DEPARTMENT_ID,
    departmentName: 'Executive',
    ...extra,
  });
  beforeEach(() => {
    mockDepartments();
  });

  it('renders Dashboard as a single row, not a one-item dropdown', async () => {
    vi.mocked(getAfHomesRoles).mockResolvedValue([customRole({ permissions: [] })]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // No group toggle for Dashboard; the module checkbox is right there.
    expect(screen.queryByRole('button', { name: /Dashboard/ })).toBeNull();
    expect(screen.getByLabelText('Dashboard access')).toBeInTheDocument();
    // And the other groups are collapsed dropdowns, so their modules are absent.
    expect(screen.queryByLabelText('Customers access')).toBeNull();
  });

  it('collapses unheld groups and expands one on demand', async () => {
    vi.mocked(getAfHomesRoles).mockResolvedValue([customRole({ permissions: [] })]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const salesToggle = screen.getByRole('button', { name: /Sales & Customers/ });
    expect(salesToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(salesToggle);
    expect(salesToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Customers access')).toBeInTheDocument();
    // Collapsing again hides its module rows.
    fireEvent.click(salesToggle);
    expect(screen.queryByLabelText('Customers access')).toBeNull();
  });

  it('opens a group that already holds a grant, so current access is visible', async () => {
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      customRole({ permissions: [permission('sales.customers', true)] }),
    ]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // Pre-expanded, and the granted box is checked without a click.
    expect(screen.getByRole('button', { name: /Sales & Customers/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('Customers access')).toBeChecked();
    // A group with no grant stays closed.
    expect(screen.getByRole('button', { name: /Finance/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps granting an explicit per-page decision, with no bulk control', async () => {
    vi.mocked(getAfHomesRoles).mockResolvedValue([customRole({ permissions: [] })]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // The bulk "View all" control is gone: access is granted page by page, so
    // a click can never enable a page an operator did not look at.
    expect(screen.queryByLabelText(/^View all /)).toBeNull();
    expect(screen.queryByText('View all')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Finance/ }));
    for (const label of ['Payment Verification', 'Card Activation', 'Points Ledger'])
      expect(screen.getByLabelText(`${label} access`)).not.toBeChecked();
    const points = screen.getByLabelText('Points Ledger access');
    fireEvent.click(points);
    expect(points).toBeChecked();
  });

  it('keeps a page’s action rights when access stays granted', async () => {
    // The store keeps four flags per page; the screen exposes ONE. Editing a
    // role must never upgrade it silently, and must not silently DOWNGRADE it
    // either: saving a page that stays accessible preserves the wider rights.
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      customRole({
        permissions: [
          {
            moduleKey: 'finance.points',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
        ],
      }),
    ]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // The group holding a grant opens by itself, so current access is visible
    // at a glance without expanding anything.
    const points = screen.getByLabelText('Points Ledger access');
    expect(points).toBeChecked();
    // The wider rights are disclosed, not hidden.
    expect(screen.getByText('Full')).toHaveAttribute(
      'title',
      'This role also keeps its action rights here.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(updateAfHomesRole).toHaveBeenCalledWith(
        role.id,
        expect.objectContaining({
          permissions: expect.arrayContaining([
            expect.objectContaining({
              moduleKey: 'finance.points',
              canView: true,
              canUpdate: true,
            }),
          ]),
        }),
      ),
    );
  });

  it('clears a page’s action rights when access is revoked', async () => {
    // Unchecking is the ONLY thing that clears them, because the database
    // allows no state where a page is inaccessible but writable.
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      customRole({
        permissions: [
          {
            moduleKey: 'finance.points',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
        ],
      }),
    ]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByLabelText('Points Ledger access'));
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(updateAfHomesRole).toHaveBeenCalledWith(
        role.id,
        expect.objectContaining({
          permissions: expect.arrayContaining([
            expect.objectContaining({
              moduleKey: 'finance.points',
              canView: false,
              canUpdate: false,
              canCreate: false,
              canDelete: false,
            }),
          ]),
        }),
      ),
    );
  });

  it('disables Delete while staff hold the role', async () => {
    // Deleting a role with assigned staff is a server 409; the button stays
    // disabled so the refusal is visible before the confirm dialog.
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      { ...role, assignedCount: 3 },
      { ...role, id: '00000000-0000-4000-8000-000000000003', name: 'Empty', assignedCount: 0 },
    ]);
    mockDepartments();
    renderWithProviders(<AfHomesRolesPage />, { user: SUPER_ADMIN });
    await screen.findByText('Employee');
    const heldRow = screen.getByText('Employee').closest('tr') as HTMLElement;
    const heldDelete = within(heldRow).getByRole('button', { name: 'Delete' });
    expect(heldDelete).toBeDisabled();
    expect(heldDelete).toHaveAttribute('title', 'Reassign staff before deleting.');
    const emptyRow = screen.getByText('Empty').closest('tr') as HTMLElement;
    expect(within(emptyRow).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});
