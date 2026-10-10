/**
 * Loading, pending and empty-state regressions for the operational pages.
 *
 * Three failure modes are worth a permanent test, because each one is invisible
 * in a happy-path run:
 *
 *   1. An INFINITE skeleton. TanStack Query v5 keeps `isPending` true forever for
 *      a DISABLED query, so a page gated on `isPending` shows a skeleton to a
 *      legitimate user and never resolves. Sales Records disables its claims
 *      query for anyone without `operations.redemption`, which makes it the real
 *      instance of that trap.
 *   2. An EMPTY state shown before the first response, so an operator briefly
 *      reads "no purchases recorded" for a database that has plenty.
 *   3. A success message before the server confirmed anything.
 */
import { screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';

/**
 * Hoisted so the `vi.mock` factories below can close over them: `vi.mock` is
 * hoisted above every top-level statement, so a plain `const` would not exist
 * yet when the factory runs.
 */
const { notifyConfirm, notifySuccess, grantedModules, api } = vi.hoisted(() => ({
  notifyConfirm: vi.fn(async () => true),
  notifySuccess: vi.fn(),
  /** Mutable so one mock can serve callers holding different grants. */
  grantedModules: ['sales.customers'] as string[],
  api: {
    listPurchases: vi.fn(),
    listClaims: vi.fn(),
    reissueEarningClaim: vi.fn(),
  },
}));

vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: grantedModules.map((moduleKey) => ({
        moduleKey,
        canView: true,
        canCreate: true,
        canUpdate: true,
        canDelete: false,
      })),
    },
  }),
}));

vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifyConfirm,
  notifySuccess,
}));

vi.mock('./points-services', () => api);

import { SalesRecordsPage } from './SalesRecordsPage';
import { RedemptionWorkflowPage } from '../redemption/RedemptionWorkflowPage';

const PURCHASE = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  purchaseNumber: 'AF-TXN-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  membershipId: 'bbbbbbbb-0000-4000-8000-000000000001',
  status: 'completed' as const,
  grossAmount: '100000.00',
  tierDiscountAmount: '25000.00',
  pointsDiscountAmount: '0.00',
  netAmount: '75000.00',
  recordedTotal: '75000.00',
  verifiedTotal: '75000.00',
  rejectedTotal: '0.00',
  remainingAmount: '0.00',
  tierSnapshot: 'GOLD',
  createdAt: '2026-03-01T02:00:00.000Z',
  completedAt: '2026-03-01T03:00:00.000Z',
  customerName: 'Ana R Buyer',
  customerNumber: 'CUS-000777',
  createdByName: 'GSD Staffer',
  lines: [
    {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      serviceId: 'ffffffff-0000-4000-8000-000000000001',
      serviceName: 'Japanese Teppanyaki',
      quantity: 50,
      unitAmount: '2000.00',
      lineTotal: '100000.00',
    },
  ],
};

const CLAIM = {
  id: 'cccccccc-0000-4000-8000-000000000001',
  claimNumber: 'CLM-000001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  purchaseId: PURCHASE.id,
  customerNumber: 'CUS-000777',
  customerName: 'Ana R Buyer',
  membershipNumber: 'MBS-000777',
  purchaseNumber: PURCHASE.purchaseNumber,
  serviceName: 'Japanese Teppanyaki',
  status: 'available' as const,
  pointsRequested: 5000,
  pointsReserved: 5000,
  pointsAwarded: 0,
  pointsCapped: 0,
  expiresAt: '2099-01-01T00:00:00.000Z',
  claimedAt: null,
  createdAt: '2026-03-01T03:00:00.000Z',
};

/** A promise plus its resolver, so a query can be held genuinely in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  grantedModules.splice(0, grantedModules.length, 'sales.customers');
  notifyConfirm.mockClear();
  notifyConfirm.mockResolvedValue(true);
  notifySuccess.mockClear();
  api.listPurchases.mockReset();
  api.listClaims.mockReset();
  api.reissueEarningClaim.mockReset();
});

describe('Sales Records loading states', () => {
  it('resolves for a caller who may NOT view claims, instead of skeleton forever', async () => {
    // The regression: the claims query is DISABLED for this caller. On TanStack
    // Query v5 that keeps `claims.isPending` true for the life of the page, so a
    // skeleton gated on it would leave an operator on a permanent loading state.
    api.listPurchases.mockResolvedValue([PURCHASE]);

    renderWithProviders(<SalesRecordsPage />);

    expect(screen.getByRole('status', { name: 'Loading sales records' })).toBeInTheDocument();
    await waitForElementToBeRemoved(() =>
      screen.queryByRole('status', { name: 'Loading sales records' }),
    );
    expect(screen.getByText('AF-TXN-000001')).toBeInTheDocument();
    // The claims section is not rendered at all, and the query was never issued.
    expect(screen.queryByText('CLM-000001')).not.toBeInTheDocument();
    expect(api.listClaims).not.toHaveBeenCalled();
  });

  it('shows the claim rows for a caller who may view claims', async () => {
    grantedModules.splice(0, grantedModules.length, 'sales.customers', 'operations.redemption');
    api.listPurchases.mockResolvedValue([PURCHASE]);
    api.listClaims.mockResolvedValue([CLAIM]);

    renderWithProviders(<SalesRecordsPage />);

    expect(await screen.findByText('AF-TXN-000001')).toBeInTheDocument();
    expect(screen.getByText('CLM-000001')).toBeInTheDocument();
    expect(api.listClaims).toHaveBeenCalled();
  });

  it('never shows an empty state before the first response arrives', async () => {
    const held = deferred<(typeof PURCHASE)[]>();
    api.listPurchases.mockReturnValue(held.promise);

    renderWithProviders(<SalesRecordsPage />);

    // The list is still in flight: a skeleton, and NOT "no purchases recorded".
    expect(screen.getByRole('status', { name: 'Loading sales records' })).toBeInTheDocument();
    expect(screen.queryByText(/no purchases recorded yet/i)).not.toBeInTheDocument();

    held.resolve([PURCHASE]);
    expect(await screen.findByText('AF-TXN-000001')).toBeInTheDocument();
    expect(screen.queryByText(/no purchases recorded yet/i)).not.toBeInTheDocument();
  });

  it('shows an empty state only once a genuinely empty response arrives', async () => {
    api.listPurchases.mockResolvedValue([]);

    renderWithProviders(<SalesRecordsPage />);

    expect(await screen.findByText(/no purchases recorded yet/i)).toBeInTheDocument();
  });
});

describe('a pending request is never announced as success', () => {
  it('keeps the rotation busy and reveals no credential until the server answers', async () => {
    grantedModules.splice(0, grantedModules.length, 'operations.redemption');
    api.listClaims.mockResolvedValue([CLAIM]);
    const held = deferred<{ claimNumber: string; qrToken: string; fallbackCode: string }>();
    api.reissueEarningClaim.mockReturnValue(held.promise);

    renderWithProviders(<RedemptionWorkflowPage />);

    await userEvent.setup().click(await screen.findByRole('button', { name: /rotate code/i }));

    await waitFor(() => expect(notifyConfirm).toHaveBeenCalled());
    // Mid-flight the button is busy, and says WHICH claim it is rotating rather
    // than the generic "Loading…".
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /rotating CLM-000001/i })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
    // No success dialog, and no plaintext credential, while the request is open.
    expect(screen.queryByText(/give the customer their new claim code/i)).not.toBeInTheDocument();
    expect(screen.queryByText('AFH-1')).not.toBeInTheDocument();

    held.resolve({ claimNumber: 'CLM-000001', qrToken: 'rotated-token', fallbackCode: 'AFH-1' });
    expect(
      await screen.findByText(/give the customer their new claim code/i, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    // The new credential is revealed only after the server confirmed the rotation.
    expect(screen.getByText('AFH-1')).toBeInTheDocument();
  });
});
