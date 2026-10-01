import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardProduct } from '@jad/contracts';

import { renderWithProviders } from '../../test/utils';
import { SaleApplicationDialog, previewSchedule } from './SaleApplicationDialog';
import { createSale } from './services';

vi.mock('./services', () => ({
  createSale: vi.fn(),
}));

const mockedCreateSale = vi.mocked(createSale);

const GOLD: CardProduct = {
  id: '33333333-3333-4333-8333-333333333333',
  categoryId: '99999999-9999-4999-8999-999999999999',
  categoryName: 'Membership Cards',
  categoryIsActive: true,
  code: 'GOLD',
  name: 'Gold',
  description: null,
  cashPrice: '312000.00',
  installmentPrice: '390000.00',
  reservationFee: '10000.00',
  spotCashDays: 7,
  standardInstallmentMonths: 4,
  validityYears: 22,
  moveAEnabled: true,
  moveB1Enabled: true,
  moveB2Enabled: true,
  minimumDownPayment: '20000.00',
  yearlyPoints: 25000,
  discountPercent: 25,
  baseValidityYears: 20,
  validityExtensionYears: 2,
  cardholderLimit: 2,
  annualPointsTranches: 20,
  totalLoyaltyValue: '500000.00',
  priorityReservation: true,
  noMonthlyAnnualDues: true,
  commissionRate: '0',
  isActive: true,
  sortOrder: 10,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

const BRONZE: CardProduct = {
  ...GOLD,
  id: '11111111-1111-4111-8111-111111111111',
  code: 'BRONZE',
  name: 'Bronze',
  cashPrice: '54000.00',
  installmentPrice: '72000.00',
  validityYears: 7,
  moveB1Enabled: false,
  moveB2Enabled: false,
  minimumDownPayment: '10000.00',
  yearlyPoints: 10000,
  discountPercent: 15,
  baseValidityYears: 5,
  cardholderLimit: 1,
  annualPointsTranches: 5,
  totalLoyaltyValue: '50000.00',
  sortOrder: 30,
};

const CUSTOMER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function renderDialog(products: CardProduct[] = [GOLD, BRONZE]) {
  return renderWithProviders(
    <SaleApplicationDialog
      customerId={CUSTOMER_ID}
      products={products}
      productsPending={false}
      productsError={null}
      onClose={() => undefined}
      onCreated={() => undefined}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe('sale application dialog', () => {
  it('presents the standard offer first with both tracks priced', async () => {
    renderDialog();
    expect(await screen.findByText('Standard offer')).toBeInTheDocument();
    expect(screen.getAllByText('₱312,000.00')).toHaveLength(2);
    expect(screen.getByText('₱390,000.00')).toBeInTheDocument();
  });

  it('shows Move A on the spot track with the same total', async () => {
    renderDialog();
    await screen.findByText('Standard offer');
    const moveA = screen.getByRole('radio', { name: /Move A/ });
    fireEvent.click(moveA);
    expect(moveA).toBeChecked();
  });

  it('hides B1/B2 for Bronze and says so', async () => {
    renderDialog([BRONZE]);
    await screen.findByText('Standard offer');
    fireEvent.click(screen.getByText('4-Month Installment'));
    expect(screen.queryByRole('radio', { name: /Move B1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Move B2/ })).not.toBeInTheDocument();
    expect(screen.getByText(/not available for Bronze/i)).toBeInTheDocument();
  });

  it('summarizes the Gold B1 selection before submit', async () => {
    renderDialog();
    await screen.findByText('Standard offer');
    fireEvent.click(screen.getByText('4-Month Installment'));
    fireEvent.click(screen.getByRole('radio', { name: /Move B1/ }));
    expect(screen.getAllByText('Move B1 — 40% DP + 12 Months')).toHaveLength(2);
    expect(screen.getAllByText('₱390,000.00')).toHaveLength(2);
    expect(screen.getByText('₱156,000.00')).toBeInTheDocument();
    expect(screen.getByText(/19,500.00.*12/)).toBeInTheDocument();
    expect(screen.getByText('22 years')).toBeInTheDocument();
  });

  it('sends only the scheme code - never figures - on confirm', async () => {
    mockedCreateSale.mockResolvedValue({} as never);
    renderDialog();
    await screen.findByText('Standard offer');
    fireEvent.click(screen.getByText('4-Month Installment'));
    fireEvent.click(screen.getByRole('radio', { name: /Move B2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm application' }));
    await waitFor(() => expect(mockedCreateSale).toHaveBeenCalledTimes(1));
    expect(mockedCreateSale).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      productId: GOLD.id,
      paymentScheme: 'move_b2_25_12',
    });
    // No money figure travels with the request.
    expect(JSON.stringify(mockedCreateSale.mock.calls[0]![0])).not.toMatch(
      /390000|97500|24375|156000/,
    );
  });
});

describe('previewSchedule (display only)', () => {
  it('matches the guideline schedules exactly', () => {
    expect(previewSchedule(GOLD, 'move_b1_40_12')).toEqual({
      total: '390000.00',
      reservation: '10000.00',
      initial: '156000.00',
      months: 12,
      monthly: '19500.00',
    });
    expect(previewSchedule(BRONZE, 'move_a')).toEqual({
      total: '54000.00',
      reservation: '10000.00',
      initial: '10000.00',
      months: 4,
      monthly: '11000.00',
    });
  });
});
