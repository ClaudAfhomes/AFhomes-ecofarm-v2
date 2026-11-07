import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { PointRefundReview } from './PointRefundReview';
import { listPointRefunds, refundPurchasePoints, cancelPointPurchase } from './points-services';
const controls = vi.hoisted(() => ({ mayReview: true, confirm: vi.fn(async () => true) }));
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [{ moduleKey: 'operations.payments', canUpdate: controls.mayReview }],
    },
  }),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifyConfirm: controls.confirm,
  notifySuccess: vi.fn(),
}));
vi.mock('./points-services', () => ({
  listPointRefunds: vi.fn(),
  refundPurchasePoints: vi.fn(),
  cancelPointPurchase: vi.fn(),
}));
const PURCHASE_ID = 'dddddddd-0000-4000-8000-000000000001';
const PURCHASE = {
  id: PURCHASE_ID,
  purchaseNumber: 'AF-TXN-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  membershipId: 'bbbbbbbb-0000-4000-8000-000000000001',
  status: 'completed' as const,
  grossAmount: '10000.00',
  tierDiscountAmount: '2500.00',
  tierSnapshot: 'GOLD' as const,
  recordedTotal: '0.00',
  verifiedTotal: '0.00',
  pointsDiscountAmount: '2000.00',
  netAmount: '7500.00',
  completedAt: null,
  reversedAt: null,
  reversalReason: null,
  createdAt: '2026-03-01T02:00:00.000Z',
  customerName: 'Ana R Buyer',
  createdByName: 'GSD Staffer',
  claimStatus: null,
  claimable: false,
  lines: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  controls.mayReview = true;
  controls.confirm.mockResolvedValue(true);
  vi.mocked(listPointRefunds).mockResolvedValue([]);
  vi.mocked(refundPurchasePoints).mockResolvedValue({
    refundId: PURCHASE_ID,
    pointsRestored: 200,
    balanceAfter: 1000,
  });
});
describe('Finance point refund review', () => {
  it('hides financial mutations without Finance update permission', () => {
    controls.mayReview = false;
    renderWithProviders(<PointRefundReview purchase={PURCHASE} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('requires explicit service review and sends value, never a point count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointRefundReview purchase={PURCHASE} />);
    await user.click(screen.getByRole('button', { name: 'Review point refund' }));
    await screen.findByText(/Remaining attributable value/);
    await user.type(
      screen.getByLabelText('Service value being refunded, before the points discount(Optional)'),
      '750.00',
    );
    await user.type(
      screen.getByLabelText('Finance review and reason(Optional)'),
      'Reviewed partial cancellation',
    );
    expect(screen.getByRole('button', { name: 'Record Finance review' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Record Finance review' }));
    await waitFor(() =>
      expect(refundPurchasePoints).toHaveBeenCalledWith(PURCHASE_ID, {
        serviceValue: '750.00',
        reference: expect.any(String),
        reason: 'Reviewed partial cancellation',
        serviceReviewConfirmed: true,
      }),
    );
  });
  it('cancelled confirmation sends no restoration', async () => {
    controls.confirm.mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithProviders(<PointRefundReview purchase={{ ...PURCHASE, status: 'draft' }} />);
    await user.click(screen.getByRole('button', { name: 'Cancel purchase reservation' }));
    await user.type(screen.getByLabelText('Finance review and reason(Optional)'), 'Reviewed cancellation');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Record Finance review' }));
    expect(cancelPointPurchase).not.toHaveBeenCalled();
    expect(refundPurchasePoints).not.toHaveBeenCalled();
  });
});
