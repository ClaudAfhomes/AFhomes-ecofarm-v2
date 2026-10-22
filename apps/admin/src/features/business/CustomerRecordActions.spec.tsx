import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, Customer, Sale } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { CustomerRecordActions } from './CustomerRecordActions';
import {
  getSaleSummary,
  issueCustomerAccountActivation,
} from './services';

vi.mock('./services', () => ({
  deleteCustomer: vi.fn(),
  issueCustomerAccountActivation: vi.fn(),
  getCustomerApplications: vi.fn(),
  getSaleSummary: vi.fn(),
  cancelSale: vi.fn(),
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


const FULLSTAFF: SessionUser = {
  ...STAFF,
  afHomesPermissions: [
    grant('sales.customers', { canCreate: true, canUpdate: true }),
    grant('sales.card_sales', { canCreate: true, canUpdate: true }),
    grant('finance.payment_verification', { canUpdate: true }),
  ],
};

const RECORD = {
  id: 'c-1',
  customerNumber: 'CUS-000001',
  customerCode: 'AF-CC-1A2B3C4D',
  fullName: 'MARIA SANTOS',
  email: 'maria@example.com',
  phone: '+639171234567',
  status: 'active',
  hasActiveMembership: true,
  portalAccountActivated: false,
} as unknown as Customer;

const SALE = {
  id: 's-1',
  saleNumber: 'SALE-000001',
  customerId: 'c-1',
  customerName: 'MARIA SANTOS',
  productId: 'p-1',
  productName: 'Gold',
  productCode: 'GOLD',
  status: 'draft',
  sellerStaffId: null,
  sellerName: 'Sam Seller',
  cashPrice: '60000.00',
  minimumDownPayment: '20000.00',
  paymentScheme: 'spot_cash',
  reservationFee: '0.00',
  requiredInitial: '20000.00',
  installmentMonths: null,
  monthlyAmount: null,
  validityMonths: null,
  yearlyPoints: 60000,
  commissionRate: '0.04',
  expectedCommission: '2400.00',
  paidAmount: '0.00',
  balance: '60000.00',
  spotCashDeadline: null,
  submittedAt: '2026-09-28T00:00:00.000Z',
  paymentVerifiedAt: null,
  activatedAt: null,
  createdAt: '2026-09-28T00:00:00.000Z',
} as unknown as Sale;

function renderActions(user: SessionUser = STAFF, sales: Sale[] = []) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/admin/customers/:id"
        element={<CustomerRecordActions customer={RECORD} sales={sales} onChanged={() => {}} />}
      />
      <Route path="/admin/customers/applications/new" element={<p>new application</p>} />
      <Route path="/admin/customers" element={<p>directory</p>} />
    </Routes>,
    { user, route: '/admin/customers/c-1' },
  );
}

describe('CustomerRecordActions', () => {
  it('carries the directory row workflows onto the detail page', async () => {
    renderActions();
    expect(
      await screen.findByRole('button', { name: 'Issue / Reissue activation link' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New application' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anonymize' })).not.toBeInTheDocument();
  });

  it('gives every visible button its own color', async () => {
    renderActions({ ...FULLSTAFF, roleSlug: 'super_admin' }, [SALE]);
    const names = [
      'Issue / Reissue activation link',
      'Record payment',
      'Verify payment',
    ];
    for (const name of names) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
    const treatments = names.map((name) => screen.getByRole('button', { name }).className);
    expect(new Set(treatments).size).toBe(names.length);
  });

  it('issues the one-time activation link in place', async () => {
    vi.mocked(issueCustomerAccountActivation).mockResolvedValue({
      email: 'maria@example.com',
      emailStatus: 'sent',
      activationUrl: 'https://example.test/activate',
      expiresAt: '2026-10-01T00:00:00.000Z',
    } as never);
    renderActions();
    await screen.findByRole('button', { name: 'Issue / Reissue activation link' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Issue / Reissue activation link' }));
    expect(await screen.findByText('Customer activation ready')).toBeInTheDocument();
    expect(vi.mocked(issueCustomerAccountActivation)).toHaveBeenCalledWith('c-1');
  });

  it('hides sale buttons without sale grants or sales', async () => {
    renderActions(STAFF, []);
    await screen.findByText('Actions');
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('aims the sale buttons at the selected sale', async () => {
    const other = { ...SALE, id: 's-2', saleNumber: 'SALE-000002' };
    vi.mocked(getSaleSummary).mockResolvedValue({ paymentScheme: 'spot_cash' } as never);
    renderActions(FULLSTAFF, [SALE, other]);
    await screen.findByRole('button', { name: 'Record payment' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Sale for actions'), 's-2');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('dialog', { name: 'Record a payment' })).toBeInTheDocument();
    expect(vi.mocked(getSaleSummary)).toHaveBeenCalledWith('s-2');
  });

  it('keeps permanent delete away from ordinary staff', async () => {
    renderActions();
    await screen.findByText('Actions');
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
  });
});
