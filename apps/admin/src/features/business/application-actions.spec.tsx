import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { customerApplicationSchema, type CustomerApplicationStatus } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationEditorPage } from './OfficialFormsPages';
import {
  decideCustomerApplication,
  exportCustomerApplication,
  getCustomerApplication,
  reopenCustomerApplication,
} from './services';

vi.mock('./services', async (original) => ({
  ...(await original()),
  getCustomers: async () => [],
  getCardProducts: async () => [],
  getCustomerApplication: vi.fn(),
  decideCustomerApplication: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  exportCustomerApplication: vi.fn(),
}));
vi.mock('../documents/services', async (original) => ({
  ...(await original()),
  getDocuments: async () => [],
  getCurrentDocument: async () => null,
}));
vi.mock('../../lib/download', () => ({ downloadFile: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000001';
const detail = (status: CustomerApplicationStatus) =>
  customerApplicationSchema.parse({
    id,
    applicationNumber: 'QA APPLICATION',
    customerId: id,
    planId: id,
    tier: 'BRONZE',
    paymentScheme: 'spot_cash',
    primary: {
      holderType: 'PRIMARY',
      lastName: 'SANTOS',
      firstName: 'ANA',
      birthDate: '1990-01-01',
      permanentAddressLine1: 'QA ADDRESS',
      cityMunicipality: 'CALAMBA',
      province: 'LAGUNA',
      mobile: '+639171234567',
      email: 'qa@example.test',
      printedName: 'ANA SANTOS',
    },
    acquisitionChannels: [],
    consentAcknowledged: true,
    acknowledgedAt: '2026-10-01',
    primarySignatureStatus: 'received',
    validIdReceived: false,
    reservationPaymentProofReceived: false,
    vipAmount: '60000.00',
    discountPercent: 10,
    validityYears: 1,
    yearlyPoints: 60000,
    annualPointsTranches: 1,
    holderLimit: 1,
    status,
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    submittedAt: null,
    approvedAt: null,
    rejectedAt: null,
  });
beforeEach(() => vi.clearAllMocks());
async function show(status: CustomerApplicationStatus) {
  vi.mocked(getCustomerApplication).mockResolvedValue(detail(status));
  renderWithProviders(
    <Routes>
      <Route path="/admin/customers/applications/:id" element={<CustomerApplicationEditorPage />} />
    </Routes>,
    {
      route: `/admin/customers/applications/${id}`,
      user: {
        id,
        name: 'QA ADMIN',
        email: 'qa@example.test',
        roleId: id,
        roleSlug: 'super_admin',
        roleName: 'Super Admin',
        status: 'active',
        afHomesPermissions: [],
      },
    },
  );
  await screen.findByText('QA APPLICATION');
  await waitFor(() => expect(screen.getByLabelText('First name')).toHaveValue('ANA'));
}
it.each(['draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const)(
  'keeps %s actions outside the read-only fields',
  async (status) => {
    await show(status);
    if (status === 'draft')
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    else expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByLabelText('First name')).toHaveProperty('disabled', false);
    if (status !== 'draft') expect(screen.getByLabelText('First name')).toBeDisabled();
    for (const name of ['Export XLSX', 'Export PDF'])
      expect(screen.getByRole('button', { name })).toBeEnabled();
    for (const name of ['Approve', 'Reject']) {
      if (status === 'submitted') expect(screen.getByRole('button', { name })).toBeEnabled();
      else expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    if (status === 'submitted' || status === 'rejected')
      expect(screen.getByRole('button', { name: 'Reopen to draft' })).toBeEnabled();
    else expect(screen.queryByRole('button', { name: 'Reopen to draft' })).not.toBeInTheDocument();
    if (status !== 'cancelled')
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    else expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  },
);
it('dispatches submitted decisions and reopen', async () => {
  await show('submitted');
  vi.mocked(decideCustomerApplication).mockResolvedValue(detail('submitted'));
  vi.mocked(reopenCustomerApplication).mockResolvedValue(detail('submitted'));
  for (const [name, decision] of [
    ['Approve', 'approved'],
    ['Reject', 'rejected'],
    ['Cancel', 'cancelled'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() =>
      expect(decideCustomerApplication).toHaveBeenCalledWith(
        id,
        decision,
        'Reviewed by authorized staff.',
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  }
  fireEvent.click(screen.getByRole('button', { name: 'Reopen to draft' }));
  await waitFor(() => expect(reopenCustomerApplication).toHaveBeenCalledWith(id));
});
it.each(['xlsx', 'pdf'] as const)(
  'shows %s export errors instead of rejecting silently',
  async (format) => {
    await show('approved');
    vi.mocked(exportCustomerApplication).mockRejectedValue(new Error('Export unavailable'));
    fireEvent.click(screen.getByRole('button', { name: `Export ${format.toUpperCase()}` }));
    expect(await screen.findByText('Export unavailable')).toBeInTheDocument();
  },
);
