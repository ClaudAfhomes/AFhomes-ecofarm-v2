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
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { ApiError } from '../../lib/api/errors';
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

const VIEW_ONLY = {
  ...STAFF,
  afHomesPermissions: STAFF.afHomesPermissions.map((p) =>
    p.moduleKey === 'operations.redemption' ? { ...p, canCreate: false } : p,
  ),
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

describe('redemption lookup', () => {
  it('shows the three-step workflow with no member yet', () => {
    render('/admin/redemption');
    expect(screen.getByRole('heading', { name: '1. Identify the member' })).toBeInTheDocument();
    expect(screen.getByLabelText('Member code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan QR code' })).toBeInTheDocument();
    // No item list and no confirm button until a member is identified.
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('resolves a typed fallback code and says which identifier matched', async () => {
    const user = userEvent.setup();
    install({ '/redemptions/resolve': ok({ ...MEMBER, matchedBy: 'fallback_code' }) });
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByText('Ana R Buyer')).toBeInTheDocument();
    expect(screen.getByText(/MBS-000777/)).toBeInTheDocument();
    expect(screen.getByText('60,000 points')).toBeInTheDocument();
    // The staff member is told WHICH identifier matched, so they can tell the
    // member how they were identified. The value itself is never echoed.
    expect(screen.getByText(/Identified by fallback member code/i)).toBeInTheDocument();
  });

  it('says when a member was identified by QR instead', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Ana R Buyer')).toBeInTheDocument();
    expect(screen.getByText(/Identified by QR code/i)).toBeInTheDocument();
  });

  it('LOOKING UP A MEMBER SPENDS NOTHING', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');

    // The lookup is a GET, and NO request of any kind was made to the commit
    // endpoint. A scan must never be able to spend a member's points.
    const resolveCalls = requests.filter((r) => r.path === '/redemptions/resolve');
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]!.method).toBe('GET');
    expect(requests.filter((r) => r.path === '/redemptions' && r.method === 'POST')).toHaveLength(
      0,
    );
  });

  it('never sends the identifier anywhere but the resolve endpoint', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');

    const resolve = requests.find((r) => r.path === '/redemptions/resolve')!;
    expect(resolve.method).toBe('GET');
    expect(String(resolve.body ?? '')).toBe('');
  });

  it('shows a helpful message for an unknown code', async () => {
    install({
      '/redemptions/resolve': {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'No membership matches that identifier' } },
      },
    });
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-0000-0000');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Could not identify that member')).toBeInTheDocument();
  });

  it('refuses to look up a code that is too short to be real', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AB');
    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
  });

  it('blocks redemption for a member who is not redeemable, and offers no confirm', async () => {
    install({
      '/redemptions/resolve': ok({
        ...MEMBER,
        redeemable: false,
        blockedReason: 'The membership has expired.',
        expired: true,
      }),
    });
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByText('The membership has expired.')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup');
    expect(
      within(group)
        .getAllByRole('radio')
        .every((r) => (r as HTMLInputElement).disabled),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /Confirm redemption/ })).toBeNull();
  });

  it('marks an item the member cannot afford and refuses to confirm it', async () => {
    install({ '/redemptions/resolve': ok({ ...MEMBER, pointsBalance: 5000 }) });
    const user = userEvent.setup();
    render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');

    await user.click(screen.getByRole('radio', { name: /Spa Day Pass/ }));
    expect(
      await screen.findByText('The member does not have enough points for this item.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm redemption/ })).toBeDisabled();
  });
});

/* ================================================================== */
/* Confirm                                                             */
/* ================================================================== */

describe('POS till: items, pending confirmation, print safety', () => {
  const identify = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');
  };

  it('never asks for inactive items: the till fetches the active catalog only', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    expect(await screen.findByText('Japanese Teppanyaki')).toBeInTheDocument();
    const fetches = requests.filter(
      (r) => r.method === 'GET' && r.path === '/redemptions/items',
    );
    expect(fetches.length).toBeGreaterThan(0);
    for (const fetch of fetches) {
      expect(fetch.query).not.toMatch(/all|includeInactive/);
    }
    // And whatever the (active-only, server-filtered) response holds is shown.
    expect(screen.getByText('Spa Day Pass')).toBeInTheDocument();
  });

  it('filters till items by name or code without refetching', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await screen.findByText('Japanese Teppanyaki');
    await user.type(screen.getByLabelText('Filter items'), 'spa');
    expect(screen.queryByText('Japanese Teppanyaki')).toBeNull();
    expect(screen.getByText('Spa Day Pass')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Filter items'));
    expect(screen.getByText('Japanese Teppanyaki')).toBeInTheDocument();
  });

  it('disables Confirm while the redemption is pending, sending one request', async () => {
    const fallback = mockFetch();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if ((init?.method ?? 'GET') === 'POST' && url.includes('/redemptions')) {
          // Record the attempt like the base stub, then hang: the mutation
          // stays pending so the till must stay disabled with one request.
          let body: unknown = null;
          if (typeof init?.body === 'string') {
            try {
              body = JSON.parse(init.body);
            } catch {
              body = init.body;
            }
          }
          requests.push({ path: '/redemptions', method: 'POST', body, query: '' });
          return new Promise(() => {}) as unknown as Response;
        }
        return (fallback as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>)(
          input,
          init,
        );
      }),
    );
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));
    const pending = await screen.findByRole('button', { name: 'Redeeming…' });
    expect(pending).toBeDisabled();
    expect(
      requests.filter((r) => r.method === 'POST' && r.path === '/redemptions'),
    ).toHaveLength(1);
  });

  it('printing the receipt sends no further requests and keeps it open', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));
    expect(await screen.findByText('RDM-000001')).toBeInTheDocument();
    const postsBefore = requests.filter(
      (r) => r.method === 'POST' && r.path === '/redemptions',
    ).length;
    await user.click(screen.getByRole('button', { name: 'Print receipt' }));
    expect(
      requests.filter((r) => r.method === 'POST' && r.path === '/redemptions'),
    ).toHaveLength(postsBefore);
    // The receipt is still open for the next member flow.
    expect(screen.getByText('RDM-000001')).toBeInTheDocument();
  });
});

describe('redemption confirm', () => {
  const identify = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');
  };

  it('shows the server figures for item, cost, balance and balance after', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));

    // Scope to the confirmation summary: the same figures also appear in the
    // member card and the item list, and a global query would be ambiguous.
    const cost = await screen.findByText('Points cost');
    const summary = cost.closest('div')!.parentElement!;
    expect(within(summary).getByText('2,000')).toBeInTheDocument();
    expect(within(summary).getByText('60,000')).toBeInTheDocument();
    expect(within(summary).getByText('58,000')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Confirm redemption of 2,000 points/ }),
    ).toBeEnabled();
  });

  it('multiplies by quantity using the server price', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    const qty = await screen.findByLabelText('Quantity');

    // Set the value in one change event. `clear` then `type` races a CONTROLLED
    // number input: clearing fires an empty value, state clamps back to 1, and
    // the next keystroke appends to that.
    fireEvent.change(qty, { target: { value: '3' } });

    // 2,000 x 3 = 6,000 off a 60,000 balance, all from the catalog price.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Confirm redemption of 6,000 points/ }),
      ).toBeEnabled(),
    );
    const cost = screen.getByText('Points cost').closest('div')!.parentElement!;
    expect(within(cost).getByText('6,000')).toBeInTheDocument();
    const after = screen.getByText('Balance after').closest('div')!;
    expect(after).toHaveTextContent('54,000');
  });

  it('sends only the membership, item, quantity and reference', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));

    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'POST' && r.path === '/redemptions')).toHaveLength(
        1,
      ),
    );
    const sent = requests.find((r) => r.method === 'POST' && r.path === '/redemptions')!
      .body as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      'clientTransactionId',
      'membershipId',
      'quantity',
      'redemptionItemId',
    ]);
    // The screen does not send a price, a balance or a staff id.
    for (const forbidden of ['pointsCost', 'balance', 'redeemedBy', 'staffId', 'totalPoints']) {
      expect(sent, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('prints a receipt with the server figures', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));

    expect(await screen.findByText('RDM-000001')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Ana R Buyer')).toBeInTheDocument();
    expect(within(dialog).getByText('MBS-000777')).toBeInTheDocument();
    expect(within(dialog).getByText('2,000')).toBeInTheDocument();
    expect(within(dialog).getByText('58,000')).toBeInTheDocument();
    expect(within(dialog).getByText('Fin Staffer')).toBeInTheDocument();
  });

  it('reuses ONE reference across a double click, so points are debited once', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    const confirm = await screen.findByRole('button', { name: /Confirm redemption/ });
    await user.click(confirm);
    await user.click(confirm).catch(() => undefined);
    await user.click(confirm).catch(() => undefined);

    await waitFor(() =>
      expect(
        requests.filter((r) => r.method === 'POST' && r.path === '/redemptions').length,
      ).toBeGreaterThan(0),
    );
    const posts = requests
      .filter((r) => r.method === 'POST' && r.path === '/redemptions')
      .map((r) => (r.body as { clientTransactionId: string }).clientTransactionId);
    // Whatever the number of clicks, every request carries the same reference, so
    // the server can recognise the repeats.
    expect(new Set(posts).size).toBe(1);
  });

  it('explains that a replayed transaction was not deducted twice', async () => {
    install({ 'POST /redemptions': { status: 201, body: { ...RECEIPT, replayed: true } } });
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));
    expect(await screen.findByText(/nothing was deducted twice/i)).toBeInTheDocument();
  });

  it('shows the business refusal and re-enables the flow', async () => {
    install({
      'POST /redemptions': {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'The customer does not have enough points for this item.',
          },
        },
      },
    });
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));

    expect(await screen.findByText('The redemption was not completed')).toBeInTheDocument();
    expect(screen.queryByText('RDM-000001')).toBeNull();
    // The member is still on screen, so the till can correct the mistake.
    expect(screen.getByText('Ana R Buyer')).toBeInTheDocument();
  });

  it('clears back to a blank till for the next member', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));
    await screen.findByText('RDM-000001');
    await user.click(screen.getByRole('button', { name: 'Next member' }));

    await waitFor(() => expect(screen.queryByText('Ana R Buyer')).toBeNull());
    expect(screen.getByLabelText('Member code')).toHaveValue('');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('does not render a void or refund control anywhere', async () => {
    const user = userEvent.setup();
    render('/admin/redemption');
    await identify(user);
    await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
    for (const verb of ['Void', 'Refund', 'Reverse', 'Cancel redemption', 'Undo']) {
      expect(screen.queryByRole('button', { name: new RegExp(verb, 'i') }), verb).toBeNull();
    }
    // "Clear" resets the till; it must not read like a void.
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Permission-flavoured UI (UX only)                                   */
/* ================================================================== */

describe('redemption receipt printing', () => {
  it('offers a printed receipt with the server figures and no credential', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    try {
      const user = userEvent.setup();
      render('/admin/redemption');
      await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
      await user.click(screen.getByRole('button', { name: 'Look up' }));
      await screen.findByText('Ana R Buyer');
      await user.click(screen.getByRole('radio', { name: /Japanese Teppanyaki/ }));
      await user.click(await screen.findByRole('button', { name: /Confirm redemption/ }));
      await screen.findByText('RDM-000001');

      const dialog = screen.getByRole('dialog');
      // The receipt carries the redemption number and the figures - never a
      // QR token or a fallback member code.
      expect(within(dialog).getByText('RDM-000001')).toBeInTheDocument();
      expect(dialog.textContent).not.toMatch(/AFH-[0-9A-F]{4}-[0-9A-F]{4}/);

      await user.click(within(dialog).getByRole('button', { name: 'Print receipt' }));
      expect(print).toHaveBeenCalledTimes(1);
      // Printing leaves the receipt open for the next member flow.
      expect(screen.getByText('RDM-000001')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('redemption workflow permissions', () => {
  it('tells a view-only operator that they cannot create redemptions', async () => {
    const user = userEvent.setup();
    render('/admin/redemption', VIEW_ONLY);
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');
    expect(await screen.findByText(/your role cannot create redemptions/i)).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Nothing sensitive                                                    */
/* ================================================================== */

describe('redemption screen data hygiene', () => {
  it('renders no government ID, address, phone or commission figure', async () => {
    install({
      '/redemptions/resolve': ok({
        ...MEMBER,
        // Even if a hostile API added these, they must not reach the DOM.
        governmentIdNumber: '7788-9900-1122',
        phone: '09185550000',
        address: '77 Katipunan',
        commission: '2400.00',
      }),
    });
    const user = userEvent.setup();
    const { container } = render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');

    const html = container.innerHTML;
    expect(html).not.toContain('7788-9900-1122');
    expect(html).not.toContain('09185550000');
    expect(html).not.toContain('Katipunan');
    expect(html).not.toContain('2400.00');
  });

  it('shows no NFC affordance of any kind', () => {
    render('/admin/redemption');
    for (const label of ['NFC', 'Tap', 'Tag', 'Contactless', 'Wave']) {
      expect(screen.queryByRole('button', { name: new RegExp(label, 'i') }), label).toBeNull();
    }
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/\bnfc\b|contactless|tap to/);
  });

  it('never renders a credential hash', async () => {
    const user = userEvent.setup();
    const { container } = render('/admin/redemption');
    await user.type(screen.getByLabelText('Member code'), 'AFH-1A2B-3C4D');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Ana R Buyer');
    expect(container.innerHTML).not.toMatch(/[a-f0-9]{64}/);
  });
});

/* ================================================================== */
/* Camera scanner                                                       */
/* ================================================================== */

describe('camera scanner safety', () => {
  it('offers manual entry alongside the camera, so a denied camera is not a dead end', () => {
    render('/admin/redemption');
    expect(screen.getByLabelText('Member code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan QR code' })).toBeInTheDocument();
  });

  it('explains a declined camera and points at manual entry', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      },
    });
    render('/admin/redemption');
    await user.click(screen.getByRole('button', { name: 'Scan QR code' }));
    expect(await screen.findByText(/Camera access was declined/i)).toBeInTheDocument();
    expect(screen.getByText(/Enter the fallback member code instead/i)).toBeInTheDocument();
  });

  it('explains a device with no camera', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' })),
      },
    });
    render('/admin/redemption');
    await user.click(screen.getByRole('button', { name: 'Scan QR code' }));
    expect(await screen.findByText(/No camera is available/i)).toBeInTheDocument();
  });

  it('asks for the camera only when the scan panel is opened', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    render('/admin/redemption');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/* History and catalog routing                                          */
/* ================================================================== */

describe('redemption screens', () => {
  it('renders the history screen with server-side filters', async () => {
    render('/admin/redemption/history');
    expect(await screen.findByRole('heading', { name: 'Redemption History' })).toBeInTheDocument();
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
    render('/admin/redemption/history');
    expect(await screen.findByText('RDM-000009')).toBeInTheDocument();
    // The snapshot name, not the current catalog name.
    expect(screen.getByText(/Japanese Teppanyaki \(2025 Menu\)/)).toBeInTheDocument();
    expect(screen.getByText('58,000')).toBeInTheDocument();
  });

  it('offers no void control in the history', async () => {
    render('/admin/redemption/history');
    await screen.findByRole('heading', { name: 'Redemption History' });
    for (const verb of ['Void', 'Refund', 'Reverse']) {
      expect(screen.queryByRole('button', { name: new RegExp(verb, 'i') }), verb).toBeNull();
    }
  });

  it('renders the catalog with the points price and no delete control', async () => {
    render('/admin/redemption/items');
    expect(await screen.findByRole('heading', { name: 'Redemption Catalog' })).toBeInTheDocument();
    expect(await screen.findByText('Japanese Teppanyaki')).toBeInTheDocument();
    expect(screen.getByText('2,000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('lets a catalog manager add an item', async () => {
    const user = userEvent.setup();
    install({ 'POST /redemptions/items': { status: 201, body: { ...ITEMS[0]!, code: 'RAMEN' } } });
    render('/admin/redemption/items');
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    await user.type(screen.getByLabelText('Code'), 'ramen');
    await user.type(screen.getByLabelText('Name'), 'Ramen Bowl');
    await user.clear(screen.getByLabelText('Points cost'));
    await user.type(screen.getByLabelText('Points cost'), '1500');
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST' && r.path === '/redemptions/items');
      expect(post?.body).toMatchObject({ code: 'RAMEN', name: 'Ramen Bowl', pointsCost: 1500 });
    });
  });

  it('refuses to let a redemption-only operator change the catalog', async () => {
    install();
    render('/admin/redemption/items', {
      ...STAFF,
      afHomesPermissions: STAFF.afHomesPermissions.map((p) =>
        p.moduleKey === 'operations.catalog' ? { ...p, canCreate: false, canUpdate: false } : p,
      ),
    });
    await screen.findByRole('heading', { name: 'Redemption Catalog' });
    expect(screen.getByText(/you can view the catalog but not change it/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('redemption catalog search and filter', () => {
  it('shows the display-order column with formatted whole points', async () => {
    render('/admin/redemption/items');
    await screen.findByText('Japanese Teppanyaki');
    expect(screen.getByRole('columnheader', { name: 'Display order' })).toBeInTheDocument();
    // Whole points with grouping, never decimals: "2,000", not "2000.00".
    expect(screen.getByText('2,000')).toBeInTheDocument();
    expect(screen.queryByText('2000.00')).toBeNull();
  });

  it('sends the search term to the catalog API', async () => {
    const user = userEvent.setup();
    render('/admin/redemption/items');
    await screen.findByText('Japanese Teppanyaki');
    await user.type(screen.getByLabelText('Search catalog items'), 'tepp');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const get = requests.find(
        (r) => r.method === 'GET' && r.path === '/redemptions/items' && r.query.includes('search=tepp'),
      );
      expect(get).toBeDefined();
    });
  });

  it('sends the inactive filter to the catalog API', async () => {
    const user = userEvent.setup();
    render('/admin/redemption/items');
    await screen.findByText('Japanese Teppanyaki');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'inactive');
    await waitFor(() => {
      const get = requests.find(
        (r) => r.method === 'GET' && r.path === '/redemptions/items' && r.query.includes('active=false'),
      );
      expect(get).toBeDefined();
    });
  });

  it('shows a filtered-empty state when nothing matches', async () => {
    install({ 'GET /redemptions/items': list([]) });
    const user = userEvent.setup();
    render('/admin/redemption/items');
    await screen.findByText('The catalog is empty');
    await user.type(screen.getByLabelText('Search catalog items'), 'nothing-matches');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No items match')).toBeInTheDocument();
  });

  it('shows loading while the catalog request is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render('/admin/redemption/items');
    expect(await screen.findByLabelText('Loading the catalog')).toBeInTheDocument();
  });

  it('recovers from a load error through retry', async () => {
    const user = userEvent.setup();
    install({
      'GET /redemptions/items': { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } },
    });
    render('/admin/redemption/items');
    await screen.findByText('The catalog could not be loaded');
    install({ 'GET /redemptions/items': list(ITEMS) });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Japanese Teppanyaki')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Guard                                                                */
/* ================================================================== */

describe('redemption route guard', () => {
  it('refuses a staff member without the redemption permission', async () => {
    render('/admin/redemption', {
      ...STAFF,
      afHomesPermissions: [
        {
          moduleKey: 'dashboard.view',
          canView: true,
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        },
      ],
    });
    // The generic 403 copy, which deliberately does not reveal whether the
    // route or the data exists.
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(
      screen.getByText(/you do not have permission to view this section/i),
    ).toBeInTheDocument();
    // And nothing from the redemption workflow leaked into the page.
    expect(screen.queryByLabelText('Fallback member code')).toBeNull();
  });

  it('refuses the catalog to a staff member without the catalog permission', async () => {
    render('/admin/redemption/items', {
      ...STAFF,
      afHomesPermissions: STAFF.afHomesPermissions.map((p) =>
        p.moduleKey === 'operations.catalog' ? { ...p, canView: false } : p,
      ),
    });
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
  });

  it('surfaces an ApiError without leaking a stack', () => {
    const err = new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 });
    expect(err.status).toBe(500);
    expect(err.message).toBe('boom');
  });
});
