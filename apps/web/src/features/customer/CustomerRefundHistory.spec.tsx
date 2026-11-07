import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { CustomerRefundHistory } from './CustomerRefundHistory';
import { getCustomerRefunds } from './services';
vi.mock('./services', () => ({ getCustomerRefunds: vi.fn() }));
const refund = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  purchaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  purchaseNumber: 'AF-SYNTHETIC-REFUND',
  reference: 'LOCAL-REFUND',
  status: 'approved_pending_repayment' as const,
  serviceValue: '100.00',
  cashAmount: '100.00',
  cashRepaid: '0.00',
  cashOutstanding: '100.00',
  pointsRestored: 50,
  earnedPointsAdjusted: 25,
  reason: 'Synthetic Finance review',
  requestedAt: '2026-10-01T00:00:00Z',
  repayments: [],
};
beforeEach(() => vi.clearAllMocks());
describe('Customer refund history', () => {
  it('shows approved cash as outstanding separately from points compensation', async () => {
    vi.mocked(getCustomerRefunds).mockResolvedValue([refund]);
    renderWithProviders(<CustomerRefundHistory />);
    expect(
      await screen.findByRole('heading', {
        name: /AF-SYNTHETIC-REFUND.*approved pending repayment/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cash repaid')).toBeInTheDocument();
    expect(screen.getByText('Cash outstanding')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText(/Approval and cash repayment are separate/)).toBeInTheDocument();
  });
  it('shows a retryable failure instead of an empty or successful history', async () => {
    vi.mocked(getCustomerRefunds).mockRejectedValue(new Error('unavailable'));
    renderWithProviders(<CustomerRefundHistory />);
    expect(await screen.findByText('Refund history unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});
