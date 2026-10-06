import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, Customer } from '@jad/contracts';

import { BusinessCustomersPage } from './BusinessCustomersPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import {
  getCardProducts,
  getCustomers,
  issueCustomerAccountActivation,
} from './services';

vi.mock('./services', () => ({
  anonymizeCustomer: vi.fn(),
  createCustomer: vi.fn(),
  deactivateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  getCardProducts: vi.fn(),
  getCustomers: vi.fn(),
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

beforeEach(() => {
  vi.mocked(getCustomers).mockReset();
  vi.mocked(getCardProducts).mockResolvedValue([]);
  vi.mocked(issueCustomerAccountActivation).mockResolvedValue({
    activationUrl: 'https://example.test/activate',
  } as never);
});

describe('BusinessCustomersPage row actions', () => {
  it('keeps the primary action visible and secondary actions behind the overflow', async () => {
    vi.mocked(getCustomers).mockResolvedValue([row()]);
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    expect(await screen.findByText('MARIA SANTOS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New application' })).toBeInTheDocument();
    // Secondary workflow actions are not loose buttons anymore.
    expect(
      screen.queryByRole('button', { name: 'Deactivate account' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /activation link/i }),
    ).not.toBeInTheDocument();
  });

  it('opens the overflow with authorized actions and keeps danger distinct', async () => {
    vi.mocked(getCustomers).mockResolvedValue([row()]);
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'More actions for CUS-000001' }),
    );
    const issue = screen.getByRole('menuitem', { name: 'Issue / Reissue activation link' });
    const deactivate = screen.getByRole('menuitem', { name: 'Deactivate account' });
    expect(issue).toBeInTheDocument();
    expect(deactivate).toBeInTheDocument();
    expect(deactivate.className).not.toBe(issue.className);
    // Escape dismisses and focus returns to the trigger.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'More actions for CUS-000001' }),
    ).toHaveFocus();
  });

  it('hides super-admin actions from ordinary staff', async () => {
    vi.mocked(getCustomers).mockResolvedValue([row()]);
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'More actions for CUS-000001' }),
    );
    expect(screen.queryByRole('menuitem', { name: 'Anonymize' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete permanently' }),
    ).not.toBeInTheDocument();
  });

  it('offers separated destructive actions to the super admin', async () => {
    vi.mocked(getCustomers).mockResolvedValue([row()]);
    renderWithProviders(<BusinessCustomersPage />, { user: SUPER });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'More actions for CUS-000001' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete permanently' }));
    // The guarded confirm dialog owns the destructive decision.
    expect(await screen.findByText('Permanently Delete Customer Account')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeInTheDocument();
  });

  it('disables deactivation for suspended customers inside the menu', async () => {
    vi.mocked(getCustomers).mockResolvedValue([row({ status: 'suspended' })]);
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    await screen.findByText('MARIA SANTOS');
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'More actions for CUS-000001' }),
    );
    expect(screen.getByRole('menuitem', { name: 'Deactivate account' })).toBeDisabled();
  });

  it('reports an empty directory with the canonical copy', async () => {
    vi.mocked(getCustomers).mockResolvedValue([]);
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    expect(await screen.findByText('No customers found.')).toBeInTheDocument();
  });
});
