import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sale } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import { BusinessSalesPage } from './BusinessSalesPage';
import { getSales } from './services';

vi.mock('./services', () => ({
  getSales: vi.fn(),
  getSalePayments: vi.fn(),
  getSaleSummary: vi.fn(),
}));

const mockedGetSales = vi.mocked(getSales);

const sale: Sale = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  saleNumber: 'SALE-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  customerName: 'Ada Customer',
  productId: '33333333-3333-4333-8333-333333333333',
  productName: 'Gold',
  productCode: 'GOLD',
  status: 'payment_in_progress',
  sellerStaffId: '00000000-0000-4000-8000-0000000000bb',
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
};

afterEach(() => vi.clearAllMocks());

describe('Card Sales states', () => {
  it('opens payment history in a dedicated dialog rather than appending it below sales', async () => {
    mockedGetSales.mockResolvedValue([sale]);
    renderWithProviders(<BusinessSalesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Payments' }));
    expect(screen.getByRole('dialog', { name: 'Payment history' })).toHaveTextContent(
      sale.saleNumber,
    );
  });
  it('shows loading while the API request is pending', () => {
    mockedGetSales.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<BusinessSalesPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading sales');
  });

  it('shows the empty state after an empty response', async () => {
    mockedGetSales.mockResolvedValue([]);
    renderWithProviders(<BusinessSalesPage />);
    expect(await screen.findByText('No card sales')).toBeInTheDocument();
    expect(screen.queryByText('Loading sales…')).not.toBeInTheDocument();
  });

  it('renders every required field for a populated sale', async () => {
    mockedGetSales.mockResolvedValue([sale]);
    renderWithProviders(<BusinessSalesPage />);
    expect(await screen.findByText('SALE-000001')).toBeInTheDocument();
    for (const heading of [
      'Customer',
      'Card',
      'Seller',
      'Total',
      'Paid',
      'Balance',
      'Payment status',
      'Activation status',
      'Created',
      'Actions',
    ]) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('Ada Customer')).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('Sam Seller')).toBeInTheDocument();
    expect(screen.getByText('₱60,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱15,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱45,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('Payment in progress')).toHaveLength(2);
    expect(screen.getByText('Not activated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payments' })).toBeInTheDocument();
  });

  it('replaces loading with a retryable API error state', async () => {
    mockedGetSales.mockRejectedValue(new Error('Sales service unavailable'));
    renderWithProviders(<BusinessSalesPage />);
    await waitFor(() => expect(screen.queryByText('Loading sales…')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Sales service unavailable');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
