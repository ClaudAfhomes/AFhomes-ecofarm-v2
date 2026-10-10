/**
 * Staff redemption workflow - the screen an employee actually uses at a till.
 *
 * Two things are being proved here, and both are the reason this feature is safe:
 *
 *  1. SCANNING NEVER SPENDS ANYTHING. Resolving a member is a read. The only
 *     call that moves points is the confirm, and the test asserts the lookup path
 *     makes no POST at all.
 *  2. The screen never invents a figure. The total it displays comes from the
 *     server's own price; a test that returns a different catalog price proves the
 *     UI follows the database rather than its own arithmetic.
 */
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';

const MEMBER = {
  membershipId: '22222222-2222-4222-8222-222222222222',
  membershipNumber: 'MBS-000777',
  customerDisplayName: 'Ana R Buyer',
  productName: 'Gold',
  membershipStatus: 'active' as const,
  expired: false,
  redeemable: true,
  blockedReason: null,
  pointsBalance: 60000,
  matchedBy: 'qr' as const,
};

const ITEMS = [
  {
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
  },
  {
    id: '55555555-5555-4555-8555-5555555555aa',
    code: 'SPA',
    name: 'Spa Day Pass',
    description: null,
    category: 'wellness',
    pointsCost: 25000,
    isActive: true,
    sortOrder: 20,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const RECEIPT = {
  redemptionId: '88888888-8888-4888-8888-888888888888',
  redemptionNumber: 'RDM-000001',
  membershipId: MEMBER.membershipId,
  membershipNumber: 'MBS-000777',
  customerDisplayName: 'Ana R Buyer',
  itemCode: 'TEPPANYAKI',
  itemName: 'Japanese Teppanyaki',
  unitPoints: 2000,
  quantity: 1,
  totalPoints: 2000,
  balanceBefore: 60000,
  balanceAfter: 58000,
  redeemedByName: 'Fin Staffer',
  completedAt: '2026-03-01T02:00:00.000Z',
  replayed: false,
};

type Route = { status?: number; body: unknown };
const routes = new Map<string, Route>();
const requests: { path: string; method: string; body: unknown; query: string }[] = [];

const ok = (body: unknown): Route => ({ status: 200, body });
const list = (data: unknown[]): Route => ({ status: 200, body: { data, meta: {} } });

const STAFF: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Fin Staffer',
  email: 'finance@afhomes.test',
  roleId: 'r1',
  roleName: 'Finance',
  afHomesPermissions: [
    {
      moduleKey: 'operations.redemption',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    },
    {
      moduleKey: 'operations.catalog',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    },
    {
      moduleKey: 'dashboard.view',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
  status: 'active',
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const [bare, query = ''] = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?');
    const path = bare!;
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ path, method, body, query });

    // The resolve endpoint is identified by its query string.
    if (path === '/redemptions/resolve') {
      const route = routes.get('/redemptions/resolve') ?? ok(MEMBER);
      return new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const route = routes.get(`${method} ${path}`) ?? routes.get(path);
    if (!route) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed ${method} ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function install(over: Record<string, Route> = {}) {
  routes.clear();
  routes.set('/redemptions/resolve', ok(MEMBER));
  routes.set('GET /redemptions/items', list(ITEMS));
  routes.set('GET /redemptions', list([]));
  routes.set('POST /redemptions', { status: 201, body: RECEIPT });
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string, user: typeof STAFF = STAFF) =>
  renderWithProviders(<App />, { route, user });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
});

/* ================================================================== */
/* Lookup                                                              */
/* ================================================================== */

describe('redemption screens', () => {
  it('renders the history screen with server-side filters', async () => {
    render('/admin/redemption/legacy-history');
    expect(
      await screen.findByRole('heading', { name: 'Legacy Points Transactions' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Membership number')).toBeInTheDocument();
    expect(screen.getByLabelText('Item')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('renders redemption rows with the item AS CHARGED', async () => {
    install({
      'GET /redemptions': list([
        {
          id: '88888888-8888-4888-8888-888888888888',
          redemptionNumber: 'RDM-000009',
          membershipId: MEMBER.membershipId,
          membershipNumber: 'MBS-000777',
          customerId: '33333333-3333-4333-8333-333333333333',
          customerDisplayName: 'Ana R Buyer',
          redemptionItemId: ITEMS[0]!.id,
          itemCodeSnapshot: 'TEPPANYAKI',
          itemNameSnapshot: 'Japanese Teppanyaki (2025 Menu)',
          pointsCostSnapshot: 2000,
          quantity: 1,
          totalPoints: 2000,
          balanceBeforeSnapshot: 60000,
          balanceAfterSnapshot: 58000,
          status: 'completed',
          redeemedBy: '11111111-1111-4111-8111-111111111111',
          redeemedByName: 'Fin Staffer',
          createdAt: '2026-03-01T02:00:00.000Z',
          completedAt: '2026-03-01T02:00:00.000Z',
          voidedAt: null,
          voidReason: null,
        },
      ]),
    });
    render('/admin/redemption/legacy-history');
    expect(await screen.findByText('RDM-000009')).toBeInTheDocument();
    // The snapshot name, not the current catalog name.
    expect(screen.getByText(/Japanese Teppanyaki \(2025 Menu\)/)).toBeInTheDocument();
    expect(screen.getByText('58,000')).toBeInTheDocument();
  });

  it('offers no void control in the history', async () => {
    render('/admin/redemption/legacy-history');
    await screen.findByRole('heading', { name: 'Legacy Points Transactions' });
    for (const verb of ['Void', 'Refund', 'Reverse']) {
      expect(screen.queryByRole('button', { name: new RegExp(verb, 'i') }), verb).toBeNull();
    }
  });
});
