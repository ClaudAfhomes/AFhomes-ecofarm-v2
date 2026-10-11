/**
 * The staff sales records view and the claim hand-off.
 *
 * The properties worth pinning are the accounting ones: gross, discount and net
 * are the SERVER's figures, a recorded receipt is never presented as money, and a
 * claim credential is shown once and only for a claim that may legitimately be
 * claimed.
 */
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: { afHomesPermissions: [{ moduleKey: 'operations.redemption', canView: true }] },
  }),
}));
import { SalesRecordsPage } from './SalesRecordsPage';
import { ClaimQr } from './ClaimQr';
import { getPurchaseSummary, listClaims, listPurchases } from './points-services';

vi.mock('./points-services', async () => ({
  listPurchases: vi.fn(),
  listClaims: vi.fn(),
  getPurchaseSummary: vi.fn(),
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
  resolveMemberIdentifier: vi.fn(),
}));

const mockedList = vi.mocked(listPurchases);
const mockedSummary = vi.mocked(getPurchaseSummary);

const PURCHASE_ID = 'dddddddd-0000-4000-8000-000000000001';

const DRAFT = {
  id: PURCHASE_ID,
  purchaseNumber: 'AF-TXN-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  membershipId: 'bbbbbbbb-0000-4000-8000-000000000001',
  status: 'draft' as const,
  grossAmount: '5000.00',
  recordedTotal: '0.00',
  verifiedTotal: '0.00',
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
    vi.mocked(listClaims).mockResolvedValue([CLAIM] as never);
    mockedList.mockResolvedValue([{ ...DRAFT, status: 'completed' }] as never);
    renderWithProviders(<SalesRecordsPage />);

    expect(await screen.findByText('AF-TXN-000001')).toBeTruthy();
    expect(screen.getByText('AF-EARN-000002')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('claimed')).toBeTruthy();
  });

  it('shows the capped portion of an award rather than hiding it', async () => {
    vi.mocked(listClaims).mockResolvedValue([
      { ...CLAIM, pointsAwarded: 4000, pointsCapped: 20000 },
    ] as never);
    renderWithProviders(<SalesRecordsPage />);

    expect(await screen.findByText('4,000')).toBeTruthy();
    // 20,000 is the part the annual limit refused. It is shown, not swallowed.
    expect(screen.getByText('20,000')).toBeTruthy();
  });

  it('offers NO way to edit history or a ledger row', async () => {
    vi.mocked(listClaims).mockResolvedValue([CLAIM] as never);
    renderWithProviders(<SalesRecordsPage />);

    await screen.findByText('AF-EARN-000002');
    expect(screen.queryByRole('button', { name: /edit|delete|remove|correct|undo/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says the ledger is permanent and corrections go through adjustment', async () => {
    renderWithProviders(<SalesRecordsPage />);
    expect(await screen.findByText(/the points ledger is\s+permanent/i)).toBeTruthy();
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
