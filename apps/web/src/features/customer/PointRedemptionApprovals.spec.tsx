import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { PointRedemptionApprovals } from './PointRedemptionApprovals';
import { getPointApprovals, decidePointApproval } from './services';
import { notifyConfirm } from '@afhomes/ui';
vi.mock('./services', () => ({ getPointApprovals: vi.fn(), decidePointApproval: vi.fn() }));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifyConfirm: vi.fn(async () => true),
}));
const quote = {
  quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  quoteNumber: 'AF-QTE-TEST',
  purchaseNumber: 'AF-TXN-TEST',
  serviceName: 'Hotel night',
  lines: [{ serviceName: 'Hotel night', quantity: 2, tierDiscountRate: 0 }],
  pesoValuePerPoint: '0.50',
  pointsRequested: 1000,
  pesoValue: '500.00',
  grossAmount: '1000.00',
  tierDiscountAmount: '0.00',
  finalAmountPayable: '500.00',
  expiresAt: '2099-01-01T00:00:00.000Z',
  status: 'pending' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPointApprovals).mockResolvedValue([quote]);
  vi.mocked(decidePointApproval).mockResolvedValue({ status: 'approved' });
  vi.mocked(notifyConfirm).mockResolvedValue(true);
});
describe('customer spending approval', () => {
  it('shows the exact quote and sends no approval automatically', async () => {
    renderWithProviders(<PointRedemptionApprovals />);
    expect(await screen.findByText('Hotel night')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getAllByText('₱500.00')).toHaveLength(2);
    expect(screen.getByText('Gross amount')).toBeInTheDocument();
    expect(screen.getByText('VIP tier discount')).toBeInTheDocument();
    expect(screen.getByText('2 x Hotel night - VIP discount 0%')).toBeInTheDocument();
    expect(screen.getByText('\u20b10.50 per point')).toBeInTheDocument();
    expect(decidePointApproval).not.toHaveBeenCalled();
  });
  it('preserves a configured four-decimal conversion rate', async () => {
    vi.mocked(getPointApprovals).mockResolvedValue([{ ...quote, pesoValuePerPoint: '0.0001' }]);
    renderWithProviders(<PointRedemptionApprovals />);
    expect(await screen.findByText('\u20b10.0001 per point')).toBeInTheDocument();
  });
  it('a declined confirmation sends no approval', async () => {
    vi.mocked(notifyConfirm).mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithProviders(<PointRedemptionApprovals />);
    await user.click(await screen.findByRole('button', { name: 'Authorize points' }));
    expect(notifyConfirm).toHaveBeenCalled();
    expect(decidePointApproval).not.toHaveBeenCalled();
  });
  it('customer confirmation approves only the server quote identifier', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointRedemptionApprovals />);
    await user.click(await screen.findByRole('button', { name: 'Authorize points' }));
    await waitFor(() => expect(decidePointApproval).toHaveBeenCalledWith(quote.quoteId, true));
    expect(notifyConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('AF-TXN-TEST') }),
    );
  });
  it('rejection does not invoke a spending or credit action', async () => {
    vi.mocked(decidePointApproval).mockResolvedValue({ status: 'rejected' });
    const user = userEvent.setup();
    renderWithProviders(<PointRedemptionApprovals />);
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(decidePointApproval).toHaveBeenCalledWith(quote.quoteId, false));
    expect(notifyConfirm).not.toHaveBeenCalled();
  });
});
