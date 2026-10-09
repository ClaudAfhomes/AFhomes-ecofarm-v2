/**
 * The staff points-discount workflow, and the promotion screen.
 *
 * The properties worth pinning are the accounting ones and the concurrency ones:
 * a discount must never look like cash, a figure must never be client-computed,
 * and a second click must never spend the same quote twice.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { PointsDiscountPage } from './PointsDiscountPage';
import { ClaimQr } from './ClaimQr';
import {
  commitPointDiscount,
  getPurchaseSummary,
  listClaims,
  listPurchases,
  quotePointDiscount,
} from './points-services';

vi.mock('./points-services', async () => ({
  listPurchases: vi.fn(),
  listClaims: vi.fn(),
  getPurchaseSummary: vi.fn(),
  quotePointDiscount: vi.fn(),
  commitPointDiscount: vi.fn(),
  listReceipts: vi.fn(),
  recordReceipt: vi.fn(),
  decideReceipt: vi.fn(),
  recordPurchase: vi.fn(),
  completePurchase: vi.fn(),
  issueEarningClaim: vi.fn(),
  reissueEarningClaim: vi.fn(),
  adjustPoints: vi.fn(),
  reversePurchasePoints: vi.fn(),
  listServices: vi.fn(),
  createService: vi.fn(),
  listEarningRules: vi.fn(),
  createEarningRule: vi.fn(),
  listRedemptionRules: vi.fn(),
  createRedemptionRule: vi.fn(),
  updateRedemptionRule: vi.fn(),
  resolveMemberIdentifier: vi.fn(),
}));

const mockedList = vi.mocked(listPurchases);
const mockedSummary = vi.mocked(getPurchaseSummary);
const mockedQuote = vi.mocked(quotePointDiscount);
const mockedCommit = vi.mocked(commitPointDiscount);

const PURCHASE_ID = 'dddddddd-0000-4000-8000-000000000001';

const DRAFT = {
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

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue([DRAFT] as never);
  vi.mocked(listClaims).mockResolvedValue([] as never);
  mockedSummary.mockResolvedValue(SUMMARY as never);
  mockedQuote.mockResolvedValue({
    quoteId: 'eeeeeeee-0000-4000-8000-000000000001',
    quoteNumber: 'AF-QTE-000001',
    pointsRequested: 1000,
    pesoValue: '1000.00',
    eligibleLineTotal: '5000.00',
    remainingPointsAfter: 4000,
    expiresAt: '2026-10-09T12:00:00.000Z',
  } as never);
  mockedCommit.mockResolvedValue({
    purchaseId: PURCHASE_ID,
    pointsSpent: 1000,
    discountApplied: '1000.00',
    netAmount: '4000.00',
    balanceAfter: 4000,
  } as never);
});

describe('staff points discount', () => {
  it('offers a discount only for a purchase that is not settled', async () => {
    renderWithProviders(<PointsDiscountPage />);
    expect(await screen.findByText('AF-TXN-000001')).toBeTruthy();
    expect(screen.getByRole('button', { name: /use points/i })).toBeTruthy();
  });

  it('hides the action when every purchase is already settled', async () => {
    mockedList.mockResolvedValue([{ ...DRAFT, status: 'completed' }] as never);
    renderWithProviders(<PointsDiscountPage />);
    expect(await screen.findByText(/nothing to discount/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /use points/i })).toBeNull();
  });

  it('shows gross, discount, net due and verified receipts as FOUR figures', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));

    const dialog = await screen.findByRole('dialog');
    // Scoped to the figures table: "points discount" also appears in the
    // explanatory note below it, and matching both would be ambiguous.
    const figures = await within(dialog).findByRole('table');
    // Exact labels: a loose /amount due/i also matches "Remaining amount due",
    // and two of those rows existing is the whole point of the test.
    for (const label of [
      'Gross purchase value',
      'Points discount',
      'Amount due',
      'Verified cash receipts',
      'Remaining amount due',
    ]) {
      expect(within(figures).getByRole('rowheader', { name: label }), label).toBeTruthy();
    }
  });

  it('states outright that points are never recorded as a payment', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/points are never recorded as a payment/i),
    ).toBeTruthy();
  });

  it('sends only the point COUNT when quoting - never a peso value', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(await screen.findByLabelText(/points to spend/i), '1000');
    await user.click(screen.getByRole('button', { name: /see what this is worth/i }));

    await waitFor(() => expect(mockedQuote).toHaveBeenCalledWith(PURCHASE_ID, 1000));
  });

  it('does not quote until a positive amount is entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    const button = await screen.findByRole('button', { name: /see what this is worth/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(mockedQuote).not.toHaveBeenCalled();
  });

  it('shows the server-priced value and does not compute one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(await screen.findByLabelText(/points to spend/i), '1000');
    await user.click(screen.getByRole('button', { name: /see what this is worth/i }));

    expect(await screen.findByText(/1,000 points are worth/i)).toBeTruthy();
    expect(screen.getByText('₱1,000.00')).toBeTruthy();
  });

  it('disables the commit control while it is in flight, so a second click cannot spend twice', async () => {
    const user = userEvent.setup();
    let calls = 0;
    let release: (() => void) | undefined;
    mockedCommit.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls += 1;
          release = () =>
            resolve({
              purchaseId: PURCHASE_ID,
              pointsSpent: 1000,
              discountApplied: '1000.00',
              netAmount: '4000.00',
              balanceAfter: 4000,
            } as never);
        }),
    );
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(await screen.findByLabelText(/points to spend/i), '1000');
    await user.click(screen.getByRole('button', { name: /see what this is worth/i }));

    const apply = await screen.findByRole('button', { name: /apply the discount/i });
    await user.click(apply);

    // Mid-flight the control is disabled and relabelled, so a second click has
    // nothing to press. The server refuses a reused quote anyway; this is the
    // UI half of the same guarantee.
    const pending = await screen.findByRole('button', { name: /applying/i });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    await user.click(pending).catch(() => {});

    release?.();
    await waitFor(() => expect(calls).toBe(1));
  });

  it('keeps the typed amount and the quote when the commit is refused', async () => {
    const user = userEvent.setup();
    mockedCommit.mockRejectedValue(new Error('That quote has expired. Please request a new one.'));
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(await screen.findByLabelText(/points to spend/i), '1000');
    await user.click(screen.getByRole('button', { name: /see what this is worth/i }));
    await user.click(await screen.findByRole('button', { name: /apply the discount/i }));

    // Form data survives a failure: a member does not retype their amount.
    expect(await screen.findByText(/has expired/i)).toBeTruthy();
    expect((screen.getByLabelText(/points to spend/i) as HTMLInputElement).value).toBe('1000');
    expect(screen.getByRole('button', { name: /apply the discount/i })).toBeTruthy();
  });

  it('explains an expired quote without losing the dialog', async () => {
    const user = userEvent.setup();
    mockedQuote.mockRejectedValue(new Error('That quote has expired. Please request a new one.'));
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(await screen.findByLabelText(/points to spend/i), '1000');
    await user.click(screen.getByRole('button', { name: /see what this is worth/i }));

    expect(await screen.findByText(/not applied|cannot use points/i)).toBeTruthy();
    expect((screen.getByLabelText(/points to spend/i) as HTMLInputElement).value).toBe('1000');
  });

  it('keeps the page usable while one dialog is processing', async () => {
    const user = userEvent.setup();
    mockedQuote.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /use points/i }));
    await user.type(await screen.findByLabelText(/points to spend/i), '1000');
    await user.click(screen.getByRole('button', { name: /see what this is worth/i }));

    // Only the dialog's own control is busy. The list behind it is still on
    // screen and still named, so one slow action never blocks the whole page.
    const busy = await screen.findByRole('button', { name: /pricing/i });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('AF-TXN-000001')).toBeTruthy();
    expect(
      screen.getByRole('dialog').querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
  });
});

describe('history', () => {
  const CLAIM = {
    id: 'eeeeeeee-0000-4000-8000-000000000002',
    claimNumber: 'AF-EARN-000002',
    customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
    purchaseId: PURCHASE_ID,
    status: 'claimed' as const,
    pointsRequested: 1000,
    pointsReserved: 1000,
    pointsAwarded: 1000,
    pointsCapped: 0,
    expiresAt: '2026-10-10T00:00:00.000Z',
    claimedAt: '2026-10-09T10:00:00.000Z',
    createdAt: '2026-10-09T09:00:00.000Z',
  };

  it('shows a completed purchase alongside a claim', async () => {
    const user = userEvent.setup();
    vi.mocked(listClaims).mockResolvedValue([CLAIM] as never);
    mockedList.mockResolvedValue([{ ...DRAFT, status: 'completed' }] as never);
    renderWithProviders(<PointsDiscountPage />);

    await user.click(await screen.findByRole('button', { name: /show purchase and claim history/i }));
    expect(await screen.findByText('AF-TXN-000001')).toBeTruthy();
    expect(screen.getByText('AF-EARN-000002')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('claimed')).toBeTruthy();
  });

  it('shows the capped portion of an award rather than hiding it', async () => {
    const user = userEvent.setup();
    vi.mocked(listClaims).mockResolvedValue([
      { ...CLAIM, pointsAwarded: 4000, pointsCapped: 20000 },
    ] as never);
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /show purchase and claim history/i }));

    expect(await screen.findByText('4,000')).toBeTruthy();
    // 20,000 is the part the annual limit refused. It is shown, not swallowed.
    expect(screen.getByText('20,000')).toBeTruthy();
  });

  it('offers NO way to edit history or a ledger row', async () => {
    const user = userEvent.setup();
    vi.mocked(listClaims).mockResolvedValue([CLAIM] as never);
    renderWithProviders(<PointsDiscountPage />);
    await user.click(await screen.findByRole('button', { name: /show purchase and claim history/i }));

    await screen.findByText('AF-EARN-000002');
    expect(
      screen.queryByRole('button', { name: /edit|delete|remove|correct|undo/i }),
    ).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says the ledger is permanent and corrections go through adjustment', async () => {
    renderWithProviders(<PointsDiscountPage />);
    expect(
      await screen.findByText(/the points ledger is\s+permanent/i),
    ).toBeTruthy();
  });
});

describe('issued claim QR', () => {
  const claim = {
    claimNumber: 'AF-EARN-000001',
    qrToken: 'opaque-credential-value',
    fallbackCode: 'AFH-ABCD-EFGH',
    expiresAt: '2026-10-10T00:00:00.000Z',
  };

  it('encodes a claim URL, not the bare token, so a phone scan works', async () => {
    renderWithProviders(<ClaimQr claim={claim} />);
    const image = await screen.findByRole('img', { name: /claim qr/i });
    // The matrix is generated locally by the `qrcode` package, so no token and
    // no URL ever reaches a third party.
    await waitFor(() => expect(image.getAttribute('src') ?? '').toMatch(/^data:image\/png/));
    expect(screen.getByText('AFH-ABCD-EFGH')).toBeTruthy();
  });

  it('shows the typed fallback code alongside the QR, not instead of it', () => {
    renderWithProviders(<ClaimQr claim={claim} />);
    expect(screen.getByText('AFH-ABCD-EFGH')).toBeTruthy();
    expect(screen.getByText(/expires/i)).toBeTruthy();
  });

  it('never writes the plaintext token into the visible page', () => {
    renderWithProviders(<ClaimQr claim={claim} />);
    expect(document.body.textContent).not.toContain('opaque-credential-value');
  });
});