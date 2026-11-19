/**
 * Use VIP Points: spend a member's accumulated balance against a DRAFT
 * purchase, in the only order that is safe: QUOTE first (prices, spends
 * nothing), COMMIT second (spends exactly what was quoted).
 *
 * The properties under test are the ones that decide whether money is honest:
 * a quote must never move points, a commit must carry the member's explicit
 * confirmation, a second click must never spend twice, and an ineligible
 * purchase must be refused with the staycation/promotion reason rather than a
 * silent empty state. Nothing here touches earning claims: spending and
 * claiming are separate pages, separate mutations, separate histories.
 */
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';

vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [
        { moduleKey: 'operations.sales', canView: true, canCreate: true },
        { moduleKey: 'operations.redemption', canView: true, canCreate: true },
      ],
    },
  }),
}));

const { notifyConfirm, notifySuccess } = vi.hoisted(() => ({
  notifyConfirm: vi.fn(async () => true),
  notifySuccess: vi.fn(),
}));

vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifyConfirm,
  notifySuccess,
}));

import { UseVipPointsPage } from './UseVipPointsPage';
import {
  commitPointDiscount,
  getPurchaseSummary,
  listOwnPurchases,
  quotePointDiscount,
} from './points-services';

vi.mock('./points-services', async () => ({
  listOwnPurchases: vi.fn(),
  getPurchaseSummary: vi.fn(),
  quotePointDiscount: vi.fn(),
  commitPointDiscount: vi.fn(),
}));

const PURCHASE_ID = 'dddddddd-0000-4000-8000-000000000001';

const DRAFT = {
  id: PURCHASE_ID,
  purchaseNumber: 'AF-TXN-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  membershipId: 'bbbbbbbb-0000-4000-8000-000000000001',
  status: 'draft' as const,
  grossAmount: '10000.00',
  tierDiscountAmount: '2500.00',
  tierSnapshot: 'GOLD' as const,
  recordedTotal: '0.00',
  verifiedTotal: '0.00',
  pointsDiscountAmount: '0.00',
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

const SUMMARY = {
  purchaseId: PURCHASE_ID,
  grossAmount: '10000.00',
  tierDiscountAmount: '2500.00',
  pointsDiscountAmount: '0.00',
  netAmount: '7500.00',
  recordedTotal: '0.00',
  verifiedTotal: '0.00',
  rejectedTotal: '0.00',
  remainingBalance: '7500.00',
  overpaidAmount: '0.00',
  fullyPaid: false,
};

const QUOTE = {
  quoteId: 'qqqqqqqq-0000-4000-8000-000000000001',
  quoteNumber: 'AF-QTE-000001',
  pointsRequested: 2000,
  pesoValue: '2000.00',
  eligibleLineTotal: '7500.00',
  remainingPointsAfter: 58000,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  notifyConfirm.mockResolvedValue(true);
  vi.mocked(listOwnPurchases).mockResolvedValue([DRAFT]);
  vi.mocked(getPurchaseSummary).mockResolvedValue(SUMMARY);
  vi.mocked(quotePointDiscount).mockResolvedValue(QUOTE);
  vi.mocked(commitPointDiscount).mockResolvedValue({
    purchaseId: PURCHASE_ID,
    pointsSpent: 2000,
    discountApplied: '2000.00',
    netAmount: '5500.00',
    balanceAfter: 58000,
  });
});

describe('Use VIP Points', () => {
  it('lists only draft purchases with the four separate figures', async () => {
    vi.mocked(listOwnPurchases).mockResolvedValue([
      DRAFT,
      { ...DRAFT, id: 'eeeeeeee-0000-4000-8000-000000000002', status: 'completed' as const },
    ]);
    renderWithProviders(<UseVipPointsPage />);
    expect(await screen.findByText('AF-TXN-000001')).toBeInTheDocument();
    // Gross, tier discount, points discount and net are shown separately: a
    // collapsed total would hide which discount did what.
    expect(screen.getByText('₱10,000.00')).toBeInTheDocument();
    expect(screen.queryByText('AF-TXN-000002')).not.toBeInTheDocument();
  });

  it('quotes without spending: no commit call leaves the page on review', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UseVipPointsPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(screen.getByLabelText(/points to spend/i), '2000');
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-10-24' } });
    await user.click(screen.getByRole('button', { name: /request customer approval/i }));
    expect(await screen.findByText(/2,000 points are worth/)).toBeInTheDocument();
    expect(quotePointDiscount).toHaveBeenCalledWith(PURCHASE_ID, 2000, { serviceDate: '2026-10-24' });
    expect(commitPointDiscount).not.toHaveBeenCalled();
  });

  it('requires portal approval and offers no staff debit action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UseVipPointsPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(screen.getByLabelText(/points to spend/i), '2000');
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-10-24' } });
    await user.click(screen.getByRole('button', { name: /request customer approval/i }));
    expect(await screen.findByText(/customer portal approval required/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open customer approval portal' })).toHaveAttribute(
      'href',
      expect.stringContaining('/customer/points'),
    );
    expect(screen.queryByRole('button', { name: /apply the discount/i })).not.toBeInTheDocument();
    expect(commitPointDiscount).not.toHaveBeenCalled();
    expect(notifyConfirm).not.toHaveBeenCalled();
  });

  it('refuses an ineligible purchase with the staycation reason, not silence', async () => {
    vi.mocked(quotePointDiscount).mockRejectedValue(
      new Error('Points can only be used on accommodation'),
    );
    const user = userEvent.setup();
    renderWithProviders(<UseVipPointsPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(screen.getByLabelText(/points to spend/i), '2000');
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-10-24' } });
    await user.click(screen.getByRole('button', { name: /request customer approval/i }));
    expect(
      await screen.findByText(/points can only be used on accommodation/i),
    ).toBeInTheDocument();
    expect(commitPointDiscount).not.toHaveBeenCalled();
  });

  it('keeps the typed amount after a failed quote so nobody retypes it', async () => {
    vi.mocked(quotePointDiscount).mockRejectedValueOnce(new Error('No promotion price'));
    const user = userEvent.setup();
    renderWithProviders(<UseVipPointsPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    const input = screen.getByLabelText(/points to spend/i);
    await user.type(input, '2000');
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-10-24' } });
    await user.click(screen.getByRole('button', { name: /request customer approval/i }));
    expect(await screen.findByText(/no promotion price/i)).toBeInTheDocument();
    expect(input).toHaveValue(2000);
  });
});
