import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ServiceRefundPanel } from './ServiceRefundPanel';
import {
  listServiceRefunds,
  requestServiceRefund,
  recordServiceRefundRepayment,
  decideServiceRefund,
  reconcileServiceRefundReceipt,
} from './points-services';
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
  listServiceRefunds: vi.fn(),
  requestServiceRefund: vi.fn(),
  recordServiceRefundRepayment: vi.fn(),
  decideServiceRefund: vi.fn(),
  reconcileServiceRefundReceipt: vi.fn(),
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

const REFUND = {
  id: PURCHASE_ID,
  purchaseId: PURCHASE_ID,
  purchaseNumber: PURCHASE.purchaseNumber,
  reference: 'REFUND-SYNTHETIC',
  status: 'approved_pending_repayment' as const,
  serviceValue: '1000.00',
  cashAmount: '500.00',
  cashRepaid: '0.00',
  cashOutstanding: '500.00',
  pointsRestored: 500,
  earnedPointsAdjusted: 100,
  reason: 'Finance reviewed eligibility',
  requestedAt: '2026-10-01T00:00:00.000Z',
  repayments: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  controls.mayReview = true;
  controls.confirm.mockResolvedValue(true);
  vi.mocked(listServiceRefunds).mockResolvedValue([]);
  vi.mocked(requestServiceRefund).mockResolvedValue({ id: PURCHASE_ID });
  vi.mocked(recordServiceRefundRepayment).mockResolvedValue({ id: PURCHASE_ID });
});
describe('Finance external repayment UI', () => {
  it('hides refund mutations without Finance authorization', () => {
    controls.mayReview = false;
    renderWithProviders(<ServiceRefundPanel purchase={PURCHASE} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('supports cash-only purchases and submits a pending request without recording repayment', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceRefundPanel purchase={{ ...PURCHASE, pointsDiscountAmount: '0.00' }} />,
    );
    await user.click(screen.getByRole('button', { name: /Manage refunds/ }));
    await screen.findByText('No refund requests yet.');
    await user.type(screen.getByLabelText('Eligible service value'), '1000.00');
    await user.type(screen.getByLabelText('Cash repayment requested'), '1000.00');
    await user.type(screen.getByLabelText('Refund reason'), 'Reviewed cash-only cancellation');
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() =>
      expect(requestServiceRefund).toHaveBeenCalledWith(
        PURCHASE_ID,
        expect.objectContaining({
          serviceValue: '1000.00',
          cashAmount: '1000.00',
          serviceReviewConfirmed: true,
        }),
      ),
    );
    expect(recordServiceRefundRepayment).not.toHaveBeenCalled();
  });
  it('shows outstanding cash separately and records only explicitly completed external repayment', async () => {
    vi.mocked(listServiceRefunds).mockResolvedValue([REFUND]);
    const user = userEvent.setup();
    renderWithProviders(<ServiceRefundPanel purchase={PURCHASE} />);
    await user.click(screen.getByRole('button', { name: /Manage refunds/ }));
    await screen.findByText('REFUND-SYNTHETIC: approved pending repayment');
    expect(screen.getByText('Cash outstanding')).toBeInTheDocument();
    expect(screen.getByText('Cash repaid')).toBeInTheDocument();
    expect(screen.getByText('Points restored')).toBeInTheDocument();
    expect(screen.getByText('Earned points adjusted')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount actually repaid'), '200.00');
    await user.type(screen.getByLabelText('External transaction reference'), 'EXTERNAL-PAID');
    await user.type(screen.getByLabelText('Actual repayment date'), '2026-10-01T10:00');
    await user.click(screen.getByRole('button', { name: 'Record external repayment' }));
    await waitFor(() =>
      expect(recordServiceRefundRepayment).toHaveBeenCalledWith(
        PURCHASE_ID,
        PURCHASE_ID,
        expect.objectContaining({ amount: '200.00', method: 'cash', reference: 'EXTERNAL-PAID' }),
      ),
    );
    expect(decideServiceRefund).not.toHaveBeenCalled();
  });
});

it('requires a Finance review note and confirmation for targeted receipt reconciliation', async () => {
  vi.mocked(listServiceRefunds).mockResolvedValue([
    {
      ...REFUND,
      receiptAttempts: [
        {
          auditId: '123',
          reference: 'UNCERTAIN',
          preparedAt: REFUND.requestedAt,
          status: 'unresolved',
        },
      ],
    },
  ]);
  vi.mocked(reconcileServiceRefundReceipt).mockResolvedValue({ status: 'cleanup_pending' });
  const user = userEvent.setup();
  renderWithProviders(<ServiceRefundPanel purchase={PURCHASE} />);
  await user.click(screen.getByRole('button', { name: /Manage refunds/ }));
  const button = await screen.findByRole('button', { name: 'Reconcile receipt attempt' });
  expect(button).toBeDisabled();
  await user.type(
    screen.getByLabelText('Receipt reconciliation review note'),
    'Finance checked uncertain repayment',
  );
  await user.click(button);
  await waitFor(() =>
    expect(reconcileServiceRefundReceipt).toHaveBeenCalledWith(
      PURCHASE_ID,
      PURCHASE_ID,
      '123',
      'Finance checked uncertain repayment',
    ),
  );
  expect(controls.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Reconcile this receipt attempt?' }),
  );
  expect(await screen.findByText(/private receipt cleanup is pending/)).toBeInTheDocument();
  expect(recordServiceRefundRepayment).not.toHaveBeenCalled();
});
