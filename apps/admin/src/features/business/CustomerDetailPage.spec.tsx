import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, Customer } from '@afhomes/contracts';

import { CustomerDetailPage } from './CustomerDetailPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { getCustomerById } from './services';

vi.mock('./services', () => ({
  getCustomerById: vi.fn(),
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
  portalAccountActivated: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
} as unknown as Customer;

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers" element={<p>directory</p>} />
      <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
    </Routes>,
    { user: STAFF, route: '/admin/customers/c-1' },
  );
}

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
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Back to customers' })).toHaveAttribute(
      'href',
      '/admin/customers',
    );
  });

  it('links back to the directory', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    renderDetail();
    await screen.findByRole('heading', { name: 'MARIA SANTOS' });
    expect(screen.getByRole('link', { name: 'Back to customers' })).toBeInTheDocument();
  });

  it('reports fetch errors with a retry', async () => {
    vi.mocked(getCustomerById).mockRejectedValue(new Error('boom'));
    renderDetail();
    // ErrorState never renders raw internals; it shows canonical copy + retry.
    expect(await screen.findByText(/couldn’t load this information/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
