import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, Customer, Sale } from '@afhomes/contracts';

import { CustomerDetailPage } from './CustomerDetailPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { ApiError } from '../../lib/api/errors';
import { getCustomerById, getSalePayments, getSales } from './services';

vi.mock('./services', () => ({
  getCustomerById: vi.fn(),
  getSales: vi.fn(),
  getSalePayments: vi.fn(async () => []),
  getSaleSummary: vi.fn(),
  getCustomerApplications: vi.fn(),
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
  dateOfBirth: '1990-05-05',
  gender: 'female',
  governmentIdType: 'passport',
  governmentIdMasked: '••••1234',
  status: 'active',
  derivedCategory: 'ACTIVE_VIP',
  hasActiveMembership: true,
  tier: 'GOLD',
  membershipStatus: 'active',
  membershipExpiresAt: '2027-05-05T00:00:00.000Z',
  portalAccountActivated: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
} as unknown as Customer;

const SALE = {
  id: 's-1',
  saleNumber: 'SALE-000001',
  customerId: 'c-1',
  customerName: 'MARIA SANTOS',
  productId: 'p-1',
  productName: 'Gold',
  productCode: 'GOLD',
  status: 'payment_in_progress',
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
  paidAmount: '15000.00',
  balance: '45000.00',
  spotCashDeadline: null,
  submittedAt: '2026-09-28T00:00:00.000Z',
  paymentVerifiedAt: null,
  activatedAt: null,
  createdAt: '2026-09-28T00:00:00.000Z',
} as unknown as Sale;

function renderDetail(user: SessionUser = STAFF) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers" element={<p>directory</p>} />
      <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
      <Route path="/admin/customers/applications/:id" element={<p>application editor</p>} />
    </Routes>,
    { user, route: '/admin/customers/c-1' },
  );
}

beforeEach(() => {
  vi.mocked(getSales).mockResolvedValue([]);
});

describe('CustomerDetailPage', () => {
  it('renders the full record, including fields the table no longer shows', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'MARIA SANTOS' })).toBeInTheDocument();
    for (const value of [
      'CUS-000001',
      'AF-CC-1A2B3C4D',
      'maria@example.com',
      '+639171234567',
      '••••1234',
      'GOLD',
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    // Lookup-mirrored membership facts: status chip, tier, formatted expiry.
    expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/May.*2027/)).toBeInTheDocument();
    // No back link: the directory row is the way back.
    expect(screen.queryByRole('link', { name: 'Back to customers' })).not.toBeInTheDocument();
    // Customer card reads as two columns: identity fields, then identifiers.
    const grid = screen.getByText('Full name').closest('dl');
    expect(grid?.className).toMatch(/twoCol/);
    const order = Array.from(grid?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent);
    expect(order).toEqual([
      'Full name',
      'Status',
      'Category',
      'Portal account',
      'Customer ID',
      'Customer code',
      'Registered',
    ]);
  });

  it('reports fetch errors with a retry', async () => {
    vi.mocked(getCustomerById).mockRejectedValue(new Error('boom'));
    renderDetail();
    // ErrorState never renders raw internals; it shows canonical copy + retry.
    expect(await screen.findByText(/couldn’t load this information/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('CustomerDetailPage card sales', () => {
  it('renders each sale as a facts card with inline payment history', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    vi.mocked(getSalePayments).mockResolvedValue([
      {
        id: 'pay-1',
        paymentNumber: 'AF-PAY-ABC123',
        amount: '15000.00',
        paymentType: 'installment',
        method: 'bank_transfer',
        reference: 'TRF-0001',
        status: 'verified',
        rejectionReason: null,
        recordedBy: 'c9165fee-635b-4486-9d96-bd79f8858dd2',
        verifiedBy: 'd9165fee-635b-4486-9d96-bd79f8858dd3',
        recordedByName: 'Sam Seller',
        verifiedByName: 'Fin User',
        recordedAt: '2026-09-28T00:00:00.000Z',
        verifiedAt: '2026-09-29T00:00:00.000Z',
      },
    ] as never);
    renderDetail();
    await screen.findByRole('heading', { name: 'Card Sales' });
    expect(vi.mocked(getSales)).toHaveBeenCalledWith({ customerId: 'c-1' });
    expect(screen.getByRole('heading', { name: 'Sale Details' })).toBeInTheDocument();
    expect(screen.getByText('SALE-000001')).toBeInTheDocument();
    // Record fields down column one, money fields down column two.
    const saleGrid = screen.getByText('SALE-000001').closest('dl');
    expect(saleGrid?.className).toMatch(/twoColRows5/);
    expect(Array.from(saleGrid?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent)).toEqual([
      'Sale number',
      'Card',
      'Scheme',
      'Seller',
      'Activation status',
      'Total',
      'Paid',
      'Balance',
      'Payment Status',
      'Created',
    ]);
    expect(screen.getByText('₱15,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱45,000.00')).toBeInTheDocument();
    // Paid trails Total with a remaining balance: Unsettled, not Fully Paid.
    expect(screen.getByText('Unsettled')).toBeInTheDocument();
    expect(screen.queryByText('Fully Paid')).not.toBeInTheDocument();
    // Once in the Customer card (portal account), once in the sale card.
    expect(screen.getAllByText('Not activated')).toHaveLength(2);
    // History hides behind a disclosure until opened.
    expect(screen.queryByText('AF-PAY-ABC123')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText('View Payment History'));
    // Reference shows the system payment number with the stored value on hover.
    const reference = await screen.findByText('AF-PAY-ABC123');
    expect(reference).toBeInTheDocument();
    expect(reference).toHaveAttribute('title', 'TRF-0001');
    // Codes render humanized; actor names render, never UUIDs.
    expect(screen.getByText('Installment')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
    // Once as the sale's seller, once as the recording staff member.
    expect(screen.getAllByText('Sam Seller')).toHaveLength(2);
    expect(screen.getByText('Fin User')).toBeInTheDocument();
    expect(screen.queryByText('c9165fee-635b-4486-9d96-bd79f8858dd2')).not.toBeInTheDocument();
  });

  it('shows an empty state when the customer holds no sales', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([]);
    renderDetail();
    await screen.findByRole('heading', { name: 'Card Sales' });
    expect(screen.getByText('No card sales yet.')).toBeInTheDocument();
  });

  it('hides the card when the viewer lacks the card-sales scope', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockRejectedValue(
      new ApiError({ code: 'FORBIDDEN', message: 'Denied', status: 403 }),
    );
    renderDetail();
    await screen.findByRole('heading', { name: 'MARIA SANTOS' });
    expect(screen.queryByRole('heading', { name: 'Card Sales' })).not.toBeInTheDocument();
  });

  it('reports sales fetch errors with a retry', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockRejectedValue(new Error('sales down'));
    renderDetail();
    await screen.findByRole('heading', { name: 'Card Sales' });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('CustomerDetailPage merged actions', () => {
  it('renders record and sale workflows in one Actions card', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    renderDetail(FULLSTAFF);
    await screen.findByRole('heading', { name: 'Actions' });
    // Record-level workflows …
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument();
    // … beside the per-sale payment actions and the status dropdown.
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify payment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Membership status')).toBeInTheDocument();
    // … and the removed sale buttons stay gone.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // … and neither of the old split cards remains.
    expect(screen.queryByRole('heading', { name: 'Customer Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Action' })).not.toBeInTheDocument();
  });

  it('hides sale actions without any action grant, keeping record actions', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    renderWithProviders(
      <Routes>
        <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
      </Routes>,
      {
        user: { ...STAFF, afHomesPermissions: [grant('sales.customers', {})] },
        route: '/admin/customers/c-1',
      },
    );
    await screen.findByRole('heading', { name: 'Card Sales' });
    // No sale-level actions without grants …
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // … but the record-level workflows stay.
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument();
  });

  it('renders one Sale Details card per sale', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([
      SALE,
      { ...SALE, id: 's-2', saleNumber: 'SALE-000002' },
    ]);
    renderDetail(FULLSTAFF);
    await screen.findByRole('heading', { name: 'Card Sales' });
    expect(screen.getAllByRole('heading', { name: 'Sale Details' })).toHaveLength(2);
    // Once in the sale facts, once as a selector option in Customer Actions.
    expect(screen.getAllByText('SALE-000001')).toHaveLength(2);
    expect(screen.getAllByText('SALE-000002')).toHaveLength(2);
  });
});
