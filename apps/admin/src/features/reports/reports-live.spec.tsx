/**
 * Live search and no-reload refresh for Employee Reports.
 *
 * Search boxes fetch automatically ~300ms after the user stops typing (no
 * Search button needed); only the latest term ever reaches the server; stale
 * terms never render. A completed redemption invalidates the reports cache,
 * so Employee Reports shows the new transaction - with fresh summary cards -
 * without a manual reload.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';

const EMPLOYEE: SessionUser = {
  id: '10101010-0000-4000-8000-000000000006',
  name: 'HR Officer',
  email: 'hr@afhomes.test',
  roleId: '00000000-0000-4000-8000-000000000aa4',
  roleName: 'Employee',
  status: 'active',
  afHomesPermissions: [
    { moduleKey: 'dashboard.view', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    {
      moduleKey: 'operations.redemption',
      canView: true,
      canCreate: true,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

const envelope = (data: unknown[] = []) => ({
  report: 'redemptions',
  generatedAt: new Date().toISOString(),
  scope: { kind: 'redemption', viewerRole: 'employee', label: 'Own redemption activity only' },
  window: { from: null, to: null },
  filters: {},
  summary: {
    redemptions: data.length,
    pointsSpent: 0,
    customersServed: 0,
    completedTransactions: 0,
    pointsRedeemed: 0,
    todayTransactions: 0,
    monthTransactions: 0,
  },
  data,
  meta: { total: data.length, limit: 50, offset: 0 },
});

const reportCalls: string[] = [];

function install() {
  reportCalls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, '');
      if (url.startsWith('/api/v1/reports/')) reportCalls.push(url);
      return new Response(JSON.stringify(envelope()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  install();
});

async function openRedemptionsReport(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<App />, { route: '/admin/reports', user: EMPLOYEE });
  await user.selectOptions(screen.getByLabelText('Report'), 'redemptions');
  await waitFor(() => {
    expect(reportCalls.some((url) => url.startsWith('/api/v1/reports/redemptions'))).toBe(true);
  });
}

describe('employee reports live search', () => {
  it('fetches automatically after the pause, with only the latest term', async () => {
    const user = userEvent.setup();
    await openRedemptionsReport(user);
    reportCalls.length = 0;

    const box = screen.getByLabelText('Search report');
    await user.type(box, 'ped');
    // Mid-typing: no request for the partial term has left yet.
    expect(reportCalls.filter((url) => url.includes('search=p')).length).toBe(0);
    await waitFor(
      () => {
        expect(reportCalls.some((url) => url.includes('search=ped'))).toBe(true);
      },
      { timeout: 2000 },
    );
    // Intermediate keystrokes never became requests of their own.
    expect(reportCalls.filter((url) => /search=p(&|$)/.test(url)).length).toBe(0);
    expect(reportCalls.filter((url) => /search=pe(&|$)/.test(url)).length).toBe(0);
  });

  it('clearing the search restores the unfiltered report', async () => {
    const user = userEvent.setup();
    await openRedemptionsReport(user);
    await user.type(screen.getByLabelText('Search report'), 'ped');
    await waitFor(() => {
      expect(reportCalls.some((url) => url.includes('search=ped'))).toBe(true);
    });
    reportCalls.length = 0;
    await user.clear(screen.getByLabelText('Search report'));
    await waitFor(
      () => {
        expect(
          reportCalls.some(
            (url) => url.startsWith('/api/v1/reports/redemptions') && !url.includes('search='),
          ),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('combines search, status and type filters in one request', async () => {
    const user = userEvent.setup();
    await openRedemptionsReport(user);
    await user.type(screen.getByLabelText('Search report'), 'ped');
    await user.type(screen.getByLabelText('Status'), 'completed');
    await user.selectOptions(screen.getByLabelText('Transaction type'), 'redemption');
    await waitFor(
      () => {
        expect(
          reportCalls.some(
            (url) =>
              url.includes('search=ped') &&
              url.includes('status=completed') &&
              url.includes('transactionType=redemption'),
          ),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
  });
});

describe('redemption refreshes reports without reload', () => {
  it('invalidates the reports cache when a redemption completes', async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    try {
      const member = {
        membershipId: '22222222-2222-4222-8222-222222222222',
        membershipNumber: 'MBS-000777',
        customerDisplayName: 'Ana R Buyer',
        productName: 'Gold',
        membershipStatus: 'active',
        expired: false,
        redeemable: true,
        blockedReason: null,
        pointsBalance: 60000,
        matchedBy: 'fallback_code',
      };
      const item = {
        id: '55555555-5555-4555-8555-555555555555',
        code: 'TEPPANYAKI',
        name: 'Japanese Teppanyaki',
        description: 'Dinner for two',
        category: 'dining',
        pointsCost: 2000,
        isActive: true,
        sortOrder: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const receipt = {
        redemptionId: '88888888-8888-4888-8888-888888888888',
        redemptionNumber: 'RDM-000001',
        membershipId: member.membershipId,
        membershipNumber: 'MBS-000777',
        customerDisplayName: 'Ana R Buyer',
        itemCode: 'TEPPANYAKI',
        itemName: 'Japanese Teppanyaki',
        unitPoints: 2000,
        quantity: 1,
        totalPoints: 2000,
        balanceBefore: 60000,
        balanceAfter: 58000,
        redeemedByName: 'HR Officer',
        completedAt: '2026-03-01T02:00:00.000Z',
        replayed: false,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input).replace(/^https?:\/\/[^/]+/, '');
          const method = init?.method ?? 'GET';
          if (url.startsWith('/api/v1/redemptions/resolve'))
            return new Response(JSON.stringify(member), { status: 200 });
          if (url.startsWith('/api/v1/redemptions/items'))
            return new Response(JSON.stringify({ data: [item], meta: {} }), { status: 200 });
          if (url.startsWith('/api/v1/redemptions') && method === 'POST')
            return new Response(JSON.stringify(receipt), { status: 201 });
          return new Response(JSON.stringify(envelope()), { status: 200 });
        }),
      );
      renderWithProviders(<App />, { route: '/admin/redemption', user: EMPLOYEE });
      await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
      await user.click(screen.getByRole('button', { name: 'Look up' }));
      await screen.findByText('Ana R Buyer');
      await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
      await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));
      await screen.findByText('RDM-000001');
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['redemption', 'history'] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
      });
    } finally {
      invalidate.mockRestore();
    }
  });

  it('polls while mounted and stops polling once the screen unmounts', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return new Response(JSON.stringify(envelope()), { status: 200 });
        }),
      );
      const { unmount } = renderWithProviders(<App />, {
        route: '/admin/reports',
        user: EMPLOYEE,
      });
      await vi.advanceTimersByTimeAsync(1000);
      const settled = calls.filter((url) => url.includes('/api/v1/reports/')).length;
      expect(settled).toBeGreaterThan(0);
      // The 30s report interval fires while mounted: cross-session changes
      // arrive without reload.
      await vi.advanceTimersByTimeAsync(35_000);
      const polling = calls.filter((url) => url.includes('/api/v1/reports/')).length;
      expect(polling).toBeGreaterThan(settled);
      unmount();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls.filter((url) => url.includes('/api/v1/reports/')).length).toBe(polling);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('activation refreshes lookups without reload', () => {
  it('invalidates member lookup, memberships and reports on activation', async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    try {
      const finance: SessionUser = {
        ...EMPLOYEE,
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Fin Officer',
        email: 'finance@afhomes.test',
        roleName: 'Finance',
        afHomesPermissions: [
          {
            moduleKey: 'dashboard.view',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
          {
            moduleKey: 'finance.card_activation',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
          {
            moduleKey: 'sales.card_sales',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
        ],
      };
      const item = {
        saleId: 'bbbbbbbb-0000-4000-8000-000000002602',
        saleNumber: 'SALE-260002',
        customerId: 'aaaaaaaa-0000-4000-8000-000000002602',
        customerName: 'Ana R Reyes',
        productName: 'Gold',
        status: 'payment_verified',
        cashPrice: '60000.00',
        paymentScheme: 'spot_cash',
        reservationFee: '0.00',
        requiredInitial: '20000.00',
        installmentMonths: null,
        monthlyAmount: null,
        validityMonths: null,
        verifiedTotal: '60000.00',
        remainingBalance: '0.00',
        downPaymentSatisfied: true,
        fullyPaid: true,
        spotCashState: 'fully_paid',
        spotCashDeadline: null,
        firstVerifiedPayment: '2026-09-27T10:00:00.000Z',
        activatable: true,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input).replace(/^https?:\/\/[^/]+/, '');
          if (url.startsWith('/api/v1/queues/activation'))
            return new Response(JSON.stringify({ data: [item], meta: { total: 1 } }), {
              status: 200,
            });
          if (url.startsWith(`/api/v1/sales/${item.saleId}/activate`))
            return new Response(
              JSON.stringify({
                membershipId: '33333333-3333-4333-8333-333333333333',
                membershipNumber: 'MBS-000026',
                fallbackCode: null,
                qrToken: null,
                pointsAllocated: 60000,
                alreadyActive: false,
                onboarding: {
                  status: 'email_sent',
                  emailStatus: 'sent',
                  token: null,
                  activationUrl: null,
                  expiresAt: null,
                },
              }),
              { status: 200 },
            );
          return new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 });
        }),
      );
      renderWithProviders(<App />, { route: '/admin/finance/activation', user: finance });
      const row = (await screen.findByText('SALE-260002')).closest('tr')!;
      await user.click(within(row).getByRole('button', { name: 'Activate' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Activate membership' });
      await user.click(within(confirmation).getByRole('button', { name: 'Activate' }));
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: ['business', 'queue', 'activation'],
        });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member-lookup'] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['memberships'] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
      });
    } finally {
      invalidate.mockRestore();
    }
  });
});
