import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afHomesRoleSchema } from '@afhomes/contracts';
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
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.queryByText('Customer')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Edit Employee access' })).toBeInTheDocument();
  // A Super Admin editing a system role relabels the field, so only the display
  // title is theirs to change - the slug and the grants are not.
  expect(screen.getByLabelText('Display title(Optional)')).toBeEnabled();
});

it('offers Edit - never a dead button - to a non-Super-Admin', async () => {
  // Every row offers Edit (read-only dialog for protected roles) and Delete.
  // The dialog gate, not the button label, decides writability.
  vi.mocked(getAfHomesRoles).mockResolvedValue(
    OPERATIONAL_SLUGS.map((slug, index) => ({
      ...role,
      id: `00000000-0000-4000-8000-00000000000${index + 10}`,
      slug,
      name: slug,
    })),
  );
  renderWithProviders(<AfHomesRolesPage />, { user: ADMIN_VIEWER });

  await screen.findByText('finance');
  for (const slug of OPERATIONAL_SLUGS) {
    // Scoped to the row, because all seven rows offer the same button names.
    const row = screen.getByText(slug).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: `View ${slug} access` })).toBeInTheDocument();
    expect(screen.getByLabelText('Name(Optional)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
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
    })),
  );
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
    { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom' },
  ]);
  renderWithProviders(<AfHomesRolesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Name(Optional)')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
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

  it('renders Dashboard as a single row, not a one-item dropdown', async () => {
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom', permissions: [] },
    ]);
    renderWithProviders(<AfHomesRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // No group toggle for Dashboard; the module checkbox is right there.
    expect(screen.queryByRole('button', { name: /Dashboard/ })).toBeNull();
    expect(screen.getByLabelText('Dashboard access')).toBeInTheDocument();
    // And the other groups are collapsed dropdowns, so their modules are absent.
    expect(screen.queryByLabelText('Customers access')).toBeNull();
  });

  it('collapses unheld groups and expands one on demand', async () => {
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom', permissions: [] },
    ]);
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
      {
        ...role,
        isSystem: false,
        slug: 'qa_custom',
        name: 'QA Custom',
        permissions: [permission('sales.customers', true)],
      },
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
    vi.mocked(getAfHomesRoles).mockResolvedValue([
      { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom', permissions: [] },
    ]);
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
      {
        ...role,
        isSystem: false,
        slug: 'qa_custom',
        name: 'QA Custom',
        permissions: [
          {
            moduleKey: 'finance.points',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
        ],
      },
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
      {
        ...role,
        isSystem: false,
        slug: 'qa_custom',
        name: 'QA Custom',
        permissions: [
          {
            moduleKey: 'finance.points',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
        ],
      },
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
});
