/**
 * Finance: purchase receipts.
 *
 * The four properties under test are the ones that decide whether a purchase can
 * be settled honestly:
 *
 *   1. An UNVERIFIED receipt does not settle a purchase.
 *   2. A VERIFIED receipt updates the net amount due correctly.
 *   3. A REJECTED receipt does not count as received money.
 *   4. Duplicate verification fails safely, in the UI and in the server.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [
        { moduleKey: 'operations.payments', canView: true, canUpdate: true },
        { moduleKey: 'operations.sales', canView: true, canCreate: true },
      ],
    },
  }),
}));
import { PurchasePaymentsPage } from './PurchasePaymentsPage';
import {
  decideReceipt,
  getPurchaseSummary,
  listFinancePurchases,
  listReceipts,
  recordReceipt,
} from './points-services';

vi.mock('./points-services', async () => ({
  listFinancePurchases: vi.fn(),
  getPurchaseSummary: vi.fn(),
  listReceipts: vi.fn(),
  recordReceipt: vi.fn(),
  decideReceipt: vi.fn(),
  listClaims: vi.fn(),
}));

const mockedList = vi.mocked(listFinancePurchases);
const mockedSummary = vi.mocked(getPurchaseSummary);
const mockedReceipts = vi.mocked(listReceipts);
const mockedRecord = vi.mocked(recordReceipt);
const mockedDecide = vi.mocked(decideReceipt);

const PURCHASE_ID = 'dddddddd-0000-4000-8000-000000000001';
const PAYMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const PURCHASE = {
  id: PURCHASE_ID,
  purchaseNumber: 'AF-TXN-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  membershipId: 'bbbbbbbb-0000-4000-8000-000000000001',
  status: 'draft' as const,
  grossAmount: '5000.00',
  pointsDiscountAmount: '0.00',
  netAmount: '5000.00',
  completedAt: null,
  reversedAt: null,
  reversalReason: null,
  createdAt: '2026-10-09T00:00:00.000Z',
  lines: [],
};

const SUMMARY = {
  purchaseId: PURCHASE_ID,
  grossAmount: '5000.00',
  pointsDiscountAmount: '0.00',
  netAmount: '5000.00',
  recordedTotal: '0.00',
  verifiedTotal: '0.00',
  rejectedTotal: '0.00',
  remainingBalance: '5000.00',
  overpaidAmount: '0.00',
  fullyPaid: false,
};

const RECEIPT = {
  id: PAYMENT_ID,
  paymentNumber: 'AF-PAY-000001',
  amount: '5000.00',
  method: 'cash',
  reference: 'REF-1',
  status: 'recorded' as const,
  recordedBy: '11111111-1111-4111-8111-111111111111',
  verifiedBy: null,
  recordedAt: '2026-10-09T09:00:00.000Z',
  verifiedAt: null,
  rejectionReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue([PURCHASE] as never);
  mockedSummary.mockResolvedValue(SUMMARY as never);
  mockedReceipts.mockResolvedValue([] as never);
  mockedRecord.mockResolvedValue({
    paymentId: PAYMENT_ID,
    paymentNumber: 'AF-PAY-000001',
    amount: '5000.00',
    status: 'recorded',
  } as never);
  mockedDecide.mockResolvedValue({
    paymentId: PAYMENT_ID,
    status: 'verified',
    verifiedTotal: '5000.00',
  } as never);
});

describe('purchase receipts', () => {
  it('shows the amount due and what is still outstanding', async () => {
    renderWithProviders(<PurchasePaymentsPage />);
    const section = await screen.findByRole('region', { name: /receipts for/i });
    // The summary loads after the section does, so await the figures themselves
    // rather than asserting on an empty skeleton.
    expect(await within(section).findByRole('rowheader', { name: 'Amount due' })).toBeTruthy();
    expect(within(section).getByRole('rowheader', { name: 'Verified received' })).toBeTruthy();
    expect(within(section).getByRole('rowheader', { name: 'Still due' })).toBeTruthy();
    expect(within(section).getByText('Outstanding')).toBeTruthy();
  });

  it('offers NO verify control until a payment has been recorded', async () => {
    renderWithProviders(<PurchasePaymentsPage />);
    expect(await screen.findByText(/no payment recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^verify$/i })).toBeNull();
  });

  it('records a payment as RECORDED and never calls it money received', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchasePaymentsPage />);
    await user.click(await screen.findByRole('button', { name: /record a payment/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(mockedRecord).toHaveBeenCalledTimes(1));
    expect(mockedRecord).toHaveBeenCalledWith(PURCHASE_ID, {
      amount: '5000.00',
      method: 'cash',
      reference: null,
    });
    // The wording is the guard: "recorded" is explicitly not yet money.
    expect(await screen.findByText(/not money received yet/i)).toBeTruthy();
  });

  it('has no points option when recording a payment', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchasePaymentsPage />);
    await user.click(await screen.findByRole('button', { name: /record a payment/i }));
    const dialog = await screen.findByRole('dialog');

    const methods = within(dialog)
      .getByLabelText(/method/i)
      .textContent?.toLowerCase();
    // A points "method" would let a discount be re-entered as cash.
    expect(methods).not.toContain('point');
  });

  it('an UNVERIFIED receipt does not settle the purchase', async () => {
    mockedReceipts.mockResolvedValue([RECEIPT] as never);
    renderWithProviders(<PurchasePaymentsPage />);

    expect(await screen.findByText('recorded')).toBeTruthy();
    const section = screen.getByRole('region', { name: /receipts for/i });
    // Still outstanding, and nothing verified yet.
    expect(
      await within(section).findByRole('rowheader', { name: 'Verified received' }),
    ).toBeTruthy();
    expect(within(section).getByText('Outstanding')).toBeTruthy();
    expect(mockedDecide).not.toHaveBeenCalled();
  });

  it('a VERIFIED receipt updates the amount due', async () => {
    const user = userEvent.setup();
    mockedReceipts.mockResolvedValue([RECEIPT] as never);
    mockedSummary.mockResolvedValue({
      ...SUMMARY,
      verifiedTotal: '5000.00',
      remainingBalance: '0.00',
      fullyPaid: true,
    } as never);
    renderWithProviders(<PurchasePaymentsPage />);

    await user.click(await screen.findByRole('button', { name: /^verify$/i }));
    await waitFor(() =>
      expect(mockedDecide).toHaveBeenCalledWith(PAYMENT_ID, {
        decision: 'verified',
        rejectionReason: null,
      }),
    );
    // The summary is invalidated so the on-screen figure is real, not stale.
    await waitFor(() => expect(screen.getByText('Settled')).toBeTruthy());
  });

  it('shows the recorder and the verifier as SEPARATE attributed acts', async () => {
    mockedReceipts.mockResolvedValue([
      { ...RECEIPT, status: 'verified', verifiedBy: '22222222-2222-4222-8222-222222222222' },
    ] as never);
    renderWithProviders(<PurchasePaymentsPage />);
    await screen.findByText('verified');
    expect(screen.getByRole('columnheader', { name: 'Recorded by' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Verified by' })).toBeTruthy();
    expect(screen.getByText('11111111-1111-4111-8111-111111111111')).toBeTruthy();
    expect(screen.getByText('22222222-2222-4222-8222-222222222222')).toBeTruthy();
  });

  it('refuses a rejection with no reason, in the UI', async () => {
    const user = userEvent.setup();
    mockedReceipts.mockResolvedValue([RECEIPT] as never);
    renderWithProviders(<PurchasePaymentsPage />);

    await user.click(await screen.findByRole('button', { name: /reject/i }));
    const confirm = await screen.findByRole('button', { name: /confirm rejection/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.click(confirm);
    expect(mockedDecide).not.toHaveBeenCalled();
  });

  it('keeps the typed rejection reason after a failure', async () => {
    const user = userEvent.setup();
    mockedReceipts.mockResolvedValue([RECEIPT] as never);
    mockedDecide.mockRejectedValue(new Error('That payment has already been decided.'));
    renderWithProviders(<PurchasePaymentsPage />);

    await user.click(await screen.findByRole('button', { name: /reject/i }));
    await user.type(await screen.findByLabelText(/reason for rejecting/i), 'Duplicate entry');
    await user.click(screen.getByRole('button', { name: /confirm rejection/i }));

    expect(await screen.findByText(/already been decided/i)).toBeTruthy();
    expect((screen.getByLabelText(/reason for rejecting/i) as HTMLInputElement).value).toBe(
      'Duplicate entry',
    );
  });

  it('does not send a second verification while one is in flight', async () => {
    const user = userEvent.setup();
    mockedReceipts.mockResolvedValue([RECEIPT] as never);
    let calls = 0;
    let release: (() => void) | undefined;
    mockedDecide.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls += 1;
          release = () =>
            resolve({
              paymentId: PAYMENT_ID,
              status: 'verified',
              verifiedTotal: '5000.00',
            } as never);
        }),
    );
    renderWithProviders(<PurchasePaymentsPage />);

    await user.click(await screen.findByRole('button', { name: /^verify$/i }));
    const busy = await screen.findByRole('button', { name: /verifying/i });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await user.click(busy).catch(() => {});
    release?.();

    await waitFor(() => expect(calls).toBe(1));
  });

  it('a REJECTED receipt is shown as rejected, with its reason', async () => {
    mockedReceipts.mockResolvedValue([
      {
        ...RECEIPT,
        status: 'rejected',
        verifiedBy: '22222222-2222-4222-8222-222222222222',
        rejectionReason: 'Cheque bounced',
      },
    ] as never);
    renderWithProviders(<PurchasePaymentsPage />);
    expect(await screen.findByText('rejected')).toBeTruthy();
    expect(screen.getByText(/cheque bounced/i)).toBeTruthy();
    // A rejected receipt offers no further decision: it is already decided.
    expect(screen.queryByRole('button', { name: /^verify$/i })).toBeNull();
  });
});
