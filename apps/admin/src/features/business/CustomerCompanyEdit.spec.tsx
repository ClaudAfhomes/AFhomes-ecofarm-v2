import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Customer } from '@afhomes/contracts';

import { CustomerCompanyEditDialog } from './CustomerCompanyEditDialog';
import { CustomerDetailPage } from './CustomerDetailPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { getCustomerById, getSales } from './services';

vi.mock('./services', () => ({
  getCustomerById: vi.fn(),
  getSales: vi.fn(),
  getSalePayments: vi.fn(async () => []),
  getSaleSummary: vi.fn(),
  getCustomerApplications: vi.fn(),
  cancelSale: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock('./services-customers', () => ({
  updateCustomer: vi.fn(async (_id: string, input: unknown) => ({ id: _id, ...(input as object) })),
}));

const STAFF: SessionUser = {
  id: 'u-staff',
  name: 'Staff User',
  email: 'staff@afhomes.test',
  roleId: 'r-staff',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'sales.customers',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
    },
  ],
};

const VIEWER: SessionUser = {
  ...STAFF,
  afHomesPermissions: [
    {
      moduleKey: 'sales.customers',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

const RECORD = {
  id: 'c-1',
  customerNumber: 'CUS-000001',
  fullName: 'MARIA SANTOS',
  email: 'maria@example.com',
  phone: '+639171234567',
  dateOfBirth: '1990-05-05',
  gender: 'female',
  status: 'active',
  raNumber: 'RA-1',
  tinNumberMasked: '********9012',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
} as unknown as Customer;

function renderDetail(user: SessionUser = STAFF) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
    </Routes>,
    { user, route: '/admin/customers/c-1' },
  );
}

beforeEach(() => {
  vi.mocked(getSales).mockResolvedValue([]);
  vi.mocked(getCustomerById).mockResolvedValue(RECORD);
});

describe('Customer company edit', () => {
  it('offers Edit company record only with update grant', async () => {
    renderDetail(VIEWER);
    await screen.findByRole('heading', { name: 'MARIA SANTOS' });
    expect(screen.queryByRole('button', { name: 'Edit company record' })).not.toBeInTheDocument();
  });

  it('renders the verbatim form with write-only TIN blank', async () => {
    renderWithProviders(
      <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );
    // Two write-only TIN inputs start empty (masked value shown as hint, never prefilled).
    const tins = await screen.findAllByLabelText(/TIN NO\. \(write-only, blank keeps\)/);
    expect(tins).toHaveLength(2);
    for (const tin of tins) expect((tin as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/current: \*\*\*\*\*\*\*\*9012/)).toBeInTheDocument();
    // Stated section present, verbatim, no money math.
    expect(screen.getByLabelText('VIP PACKAGE')).toBeInTheDocument();
    expect(screen.getByLabelText('REF NO')).toBeInTheDocument();
    // SSOT address parts and landlines are editable here (one LANDLINE
    // per member block).
    for (const label of [
      'PERMANENT ADDRESS LINE 1',
      'PERMANENT ADDRESS LINE 2',
      'PROVINCE',
      'CITY',
      'BARANGGAY',
      'POSTAL CODE',
      'SVD (NAME)',
      'SSM (NAME)',
      'SM (NAME)',
      'REFERRER (NAME)',
      'VIP RECOMMENDER (NAME)',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByLabelText('LANDLINE')).toHaveLength(2);
    // One EMAIL on each member block (never EMAIL ADDRESS), one MOBILE NO.
    // per member block (never MOBILE).
    expect(screen.getAllByLabelText('EMAIL')).toHaveLength(1);
    expect(screen.getAllByLabelText('MOBILE NO.')).toHaveLength(1);
  });
});
