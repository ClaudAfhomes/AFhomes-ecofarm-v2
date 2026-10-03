import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationsPage, ReservationAgreementsPage } from './OfficialFormsPages';
import { getCustomerApplications, getReservationAgreements } from './services';

vi.mock('./services', () => ({
  createCustomerApplication: vi.fn(),
  createReservationAgreement: vi.fn(),
  decideCustomerApplication: vi.fn(),
  decideReservationAgreement: vi.fn(),
  exportCustomerApplication: vi.fn(),
  exportReservationAgreement: vi.fn(),
  getCardProducts: vi.fn(),
  getCustomerApplication: vi.fn(),
  getCustomerApplications: vi.fn(),
  getCustomers: vi.fn(),
  getOfficialFormTemplate: vi.fn(),
  getReservationAgreement: vi.fn(),
  getReservationAgreements: vi.fn(),
  getSaleSummary: vi.fn(),
  getSales: vi.fn(),
  previewOfficialFormImport: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  reopenReservationAgreement: vi.fn(),
  submitCustomerApplication: vi.fn(),
  submitReservationAgreement: vi.fn(),
  updateCustomerApplication: vi.fn(),
  updateReservationAgreement: vi.fn(),
}));

vi.mock('../documents/services', () => ({
  putUploadBytes: vi.fn(),
  requestUploadGrant: vi.fn(),
  runDocumentOcr: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

const application = {
  id: 'app-1',
  applicationNumber: 'APP-000001',
  primary: { firstName: 'MARIA', lastName: 'SANTOS' },
  tier: 'GOLD',
  createdBy: 'Sam Seller',
  status: 'submitted',
  submittedAt: '2026-09-28T00:00:00.000Z',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const agreement = {
  id: 'res-1',
  reservationNumber: 'RES-000001',
  tier: 'SILVER',
  saleId: 'sale-1',
  status: 'submitted',
  submittedAt: '2026-09-28T00:00:00.000Z',
  createdAt: '2026-09-28T00:00:00.000Z',
};

describe('CustomerApplicationsPage list states', () => {
  it('shows loading - never a phantom empty state - on first load', () => {
    vi.mocked(getCustomerApplications).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CustomerApplicationsPage />);
    expect(screen.getByText('Loading applications…')).toBeInTheDocument();
    expect(screen.queryByText('No customer applications')).not.toBeInTheDocument();
  });

  it('shows the real empty state only after an empty response', async () => {
    vi.mocked(getCustomerApplications).mockResolvedValue([]);
    renderWithProviders(<CustomerApplicationsPage />);
    expect(await screen.findByText('No customer applications')).toBeInTheDocument();
  });

  it('renders rows in the shared filter toolbar with a clearable search', async () => {
    vi.mocked(getCustomerApplications).mockResolvedValue([application] as never);
    renderWithProviders(<CustomerApplicationsPage />);
    expect(await screen.findByText('APP-000001')).toBeInTheDocument();
    // Shared FilterBar grammar: landmark search + clearable field.
    expect(screen.getByRole('search')).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Search applications' });
    fireEvent.change(search, { target: { value: 'APP-000001' } });
    expect(
      screen.getByRole('button', { name: 'Clear search applications' }),
    ).toBeInTheDocument();
  });
});

describe('ReservationAgreementsPage list states', () => {
  it('shows loading - never a phantom empty state - on first load', () => {
    vi.mocked(getReservationAgreements).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ReservationAgreementsPage />);
    expect(screen.getByText('Loading reservation agreements…')).toBeInTheDocument();
    expect(screen.queryByText('No reservation agreements')).not.toBeInTheDocument();
  });

  it('renders rows with a clearable search after load', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([agreement] as never);
    renderWithProviders(<ReservationAgreementsPage />);
    expect(await screen.findByText('RES-000001')).toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Search reservation agreements' }),
    ).toBeInTheDocument();
  });
});
