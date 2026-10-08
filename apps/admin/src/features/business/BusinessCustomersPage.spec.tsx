import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, Customer } from '@afhomes/contracts';

import { BusinessCustomersPage } from './BusinessCustomersPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { getCardProducts, getCustomersPage, issueCustomerAccountActivation } from './services';

vi.mock('./services', () => ({
  anonymizeCustomer: vi.fn(),
  createCustomer: vi.fn(),
  deactivateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  getCardProducts: vi.fn(),
  getCustomers: vi.fn(),
  getCustomersPage: vi.fn(),
  getCustomerById: vi.fn(),
  issueCustomerAccountActivation: vi.fn(),
  getOfficialFormTemplate: vi.fn(),
  previewOfficialFormImport: vi.fn(),
}));

vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn().mockResolvedValue([]),
  setApiAccessTokenForTests: vi.fn(),
}));

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

const STAFF: SessionUser = {
  id: 'u-staff',
  name: 'Staff User',
  email: 'staff@afhomes.test',
  roleId: 'r-staff',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [grant('sales.customers', { canCreate: true, canUpdate: true })],
};

const SUPER: SessionUser = { ...STAFF, id: 'u-super', roleSlug: 'super_admin' };

const row = (extra: Record<string, unknown> = {}) =>
  ({
    id: 'c-1',
    customerNumber: 'CUS-000001',
    fullName: 'MARIA SANTOS',
    email: 'maria@example.com',
    phone: '+639171234567',
    governmentIdMasked: '••••1234',
    status: 'active',
    derivedCategory: 'ACTIVE_VIP',
    hasActiveMembership: true,
    portalAccountActivated: false,
    ...extra,
  }) as unknown as Customer;

const pageOf = (rows: Customer[], total: number) => ({ data: rows, total });

beforeEach(() => {
  vi.mocked(getCustomersPage).mockReset();
  vi.mocked(getCardProducts).mockResolvedValue([]);
  vi.mocked(issueCustomerAccountActivation).mockResolvedValue({
    activationUrl: 'https://example.test/activate',
  } as never);
});

describe('BusinessCustomersPage row actions', () => {
  it('keeps row actions behind the overflow so the table stays narrow', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    expect(await screen.findByText('MARIA SANTOS')).toBeInTheDocument();
    // No loose per-row buttons anymore - everything lives in the menu, and
    // the application entry point is gone entirely.
    expect(screen.queryByRole('button', { name: 'New application' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activation link/i })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-000001' }));
    expect(screen.queryByRole('menuitem', { name: 'New application' })).not.toBeInTheDocument();
  });

  it('opens the overflow with authorized actions and keeps danger distinct', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-000001' }));
    const issue = screen.getByRole('menuitem', { name: 'Issue / Reissue activation link' });
    const deactivate = screen.getByRole('menuitem', { name: 'Deactivate account' });
    expect(issue).toBeInTheDocument();
    expect(deactivate).toBeInTheDocument();
    expect(deactivate.className).not.toBe(issue.className);
    // Escape dismisses and focus returns to the trigger.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'More actions for CUS-000001' })).toHaveFocus();
  });

  it('hides super-admin actions from ordinary staff', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-000001' }));
    expect(screen.queryByRole('menuitem', { name: 'Anonymize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete permanently' })).not.toBeInTheDocument();
  });

  it('offers separated destructive actions to the super admin', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: SUPER });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-000001' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete permanently' }));
    // The guarded confirm dialog owns the destructive decision.
    expect(await screen.findByText('Permanently Delete Customer Account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument();
  });

  it('disables deactivation for suspended customers inside the menu', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row({ status: 'suspended' })], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-000001' }));
    expect(screen.getByRole('menuitem', { name: 'Deactivate account' })).toBeDisabled();
  });

  it('reports an empty directory with the canonical copy', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([], 0));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    expect(await screen.findByText('No customers found.')).toBeInTheDocument();
  });
});

describe('BusinessCustomersPage directory table', () => {
  it('shows only the requested columns: name, payment, tier, status, actions', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(
      pageOf(
        [
          row({
            customerCode: 'AF-CC-1A2B3C4D',
            tier: 'GOLD',
            frozenTotal: '60000.00',
            verifiedPaid: '60000.00',
          }),
          row({
            id: 'c-2',
            customerNumber: 'CUS-000002',
            fullName: 'JOSE RIZAL',
            frozenTotal: '60000.00',
            verifiedPaid: '15000.00',
          }),
        ],
        2,
      ),
    );
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    for (const header of ['Name', 'Payment Status', 'VIP Tier', 'Status', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    for (const gone of ['Customer ID', 'Email', 'Government ID', 'Category', 'Phone']) {
      expect(screen.queryByRole('columnheader', { name: gone })).not.toBeInTheDocument();
    }
    // Email, masked ID, code, number and phone leave the table.
    expect(screen.queryByText('maria@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('••••1234')).not.toBeInTheDocument();
    expect(screen.queryByText('AF-CC-1A2B3C4D')).not.toBeInTheDocument();
    expect(screen.queryByText('CUS-000001')).not.toBeInTheDocument();
    expect(screen.queryByText('+639171234567')).not.toBeInTheDocument();
    // Total == Paid with zero Balance reads as Fully Paid; a remaining
    // balance with Paid below Total reads as Unsettled.
    expect(screen.getByText('Fully Paid')).toBeInTheDocument();
    expect(screen.getByText('Unsettled')).toBeInTheDocument();
    // Scoped to the table: the tier filter also renders a GOLD option.
    expect(within(screen.getByRole('table')).getByText('GOLD')).toBeInTheDocument();
  });

  it('fetches 10-row pages and walks them with Previous/Next', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 25));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    expect(vi.mocked(getCustomersPage).mock.calls[0]![0]).toMatchObject({
      limit: 10,
      offset: 0,
    });
    // The range renders across several text nodes, so assert on textContent.
    const range = () => screen.getByRole('status', { name: 'Customer record range' });
    expect(range()).toHaveTextContent('Showing 1–10 of 25');
    expect(screen.getByRole('button', { name: 'Previous customers page' })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next customers page' }));
    await waitFor(() =>
      expect(vi.mocked(getCustomersPage).mock.calls[1]![0]).toMatchObject({
        limit: 10,
        offset: 10,
      }),
    );
    await waitFor(() => expect(range()).toHaveTextContent('Showing 11–20 of 25'));
  });

  it('filters by status and payment without category or sort controls', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    expect(screen.queryByLabelText('Customer category')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sort customers')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Customer status'), 'active');
    await user.selectOptions(screen.getByLabelText('Payment status'), 'fully_paid');
    await waitFor(() =>
      expect(vi.mocked(getCustomersPage).mock.calls.at(-1)![0]).toMatchObject({
        status: 'active',
        payment: 'fully_paid',
        offset: 0,
      }),
    );
  });

  it('searches live without a Search button', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search customers'), 'maria');
    await waitFor(() =>
      expect(vi.mocked(getCustomersPage).mock.calls.at(-1)![0]).toMatchObject({
        search: 'maria',
      }),
    );
  });

  it('navigates to the detail view when a row is activated', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(
      <Routes>
        <Route path="/admin/customers" element={<BusinessCustomersPage />} />
        <Route path="/admin/customers/:id" element={<p>detail view</p>} />
      </Routes>,
      { user: STAFF, route: '/admin/customers' },
    );
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'View customer CUS-000001' }));
    expect(await screen.findByText('detail view')).toBeInTheDocument();
  });

  it('keeps row-menu actions off the detail route', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue(pageOf([row()], 1));
    renderWithProviders(
      <Routes>
        <Route path="/admin/customers" element={<BusinessCustomersPage />} />
        <Route path="/admin/customers/:id" element={<p>detail view</p>} />
      </Routes>,
      { user: STAFF, route: '/admin/customers' },
    );
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-000001' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate account' }));
    expect(await screen.findByText('Deactivate Customer Account')).toBeInTheDocument();
    expect(screen.queryByText('detail view')).not.toBeInTheDocument();
  });
});
