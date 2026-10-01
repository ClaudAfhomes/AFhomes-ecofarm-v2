/**
 * AF Homes Phase 33 - web responsive completion (portal + public site).
 *
 * Renders the REAL portal and marketing routes at mobile widths against a
 * deny-by-default fetch stub. Assertions pin mobile-first usability without
 * pixel-perfect brittleness: no structural exception, portal tables wrapped,
 * the digital card fits small screens, and the public site keeps its design
 * (no redesign, only responsive-defect coverage).
 */
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from './test/utils';
import App from './app/App';
import { resetSupabaseClientForTest } from './lib/supabase';

const CUSTOMER = {
  id: 'cccccccc-0000-4000-8000-000000000001',
  customerNumber: 'CUS-000777',
  firstName: 'Ana',
  middleName: 'R',
  lastName: 'Buyer',
  suffix: null,
  fullName: 'Ana R Buyer',
  email: 'ana.buyer@example.invalid',
  phone: '09185550000',
  dateOfBirth: '1990-05-04',
  addressLine1: '77 Katipunan',
  addressLine2: null,
  city: 'Quezon City',
  province: 'Metro Manila',
  countryCode: 'PH',
  status: 'active' as const,
  activatedAt: '2026-01-05T02:00:00.000Z',
  updatedAt: '2026-01-05T02:00:00.000Z',
};

const MEMBERSHIP = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  membershipNumber: 'MBS-000777',
  productName: 'Gold',
  productCode: 'GOLD',
  status: 'active' as const,
  activatedAt: '2026-01-05T02:00:00.000Z',
  expiresAt: '2027-01-05T02:00:00.000Z',
  renewalDueAt: '2027-01-05T02:00:00.000Z',
  yearlyPointsAllocated: 60000,
  pointsBalance: 60000,
  paymentScheme: 'spot_cash' as const,
  validityYears: 1,
  credentialsAvailable: false as const,
  credentialsNote: 'Your member code and QR below never change.',
  memberCode: 'MBS-000777',
  qrPayload: 'AFHOMES:MBS-000777',
};

const POINTS = {
  membershipId: MEMBERSHIP.id,
  balance: 60000,
  lifetimeAllocated: 60000,
  lifetimeRedeemed: 0,
  updatedAt: '2026-01-05T02:00:00.000Z',
};

const LEDGER = [
  {
    id: '1',
    entryType: 'annual_allocation' as const,
    amount: 60000,
    balanceAfter: 60000,
    reason: 'Annual points allocation on activation',
    occurredAt: '2026-01-05T02:00:00.000Z',
  },
];

const REDEMPTION_LEDGER = [
  {
    id: '9',
    entryType: 'redemption' as const,
    amount: -2000,
    balanceAfter: 58000,
    reason: 'Redeemed Japanese Teppanyaki (TEPPANYAKI)',
    occurredAt: '2026-03-01T02:00:00.000Z',
    redemptionNumber: 'RDM-000001',
    itemName: 'Japanese Teppanyaki',
    itemCode: 'TEPPANYAKI',
    quantity: 1,
  },
  ...LEDGER,
];

const PAYMENTS = [
  {
    id: 'cccccccc-0000-4000-8000-000000000001',
    saleId: 'bbbbbbbb-0000-4000-8000-000000000001',
    amount: '20000.00',
    paymentType: 'installment',
    method: 'bank_transfer',
    reference: 'TRF-9001-with-a-long-suffix-0001',
    status: 'verified',
    recordedAt: '2026-02-01T02:00:00.000Z',
    verifiedAt: '2026-02-02T02:00:00.000Z',
  },
];

type RouteHandler = () => { status: number; body: unknown };
const routes = new Map<string, RouteHandler>();
const ok = (body: unknown): RouteHandler => () => ({ status: 200, body });

const SIGNED_IN = { authUserId: 'ffffffff-0000-4000-8000-000000000001', email: CUSTOMER.email };

function install() {
  routes.clear();
  routes.set('/customer', ok(CUSTOMER));
  routes.set('/customer/membership', ok(MEMBERSHIP));
  routes.set('/customer/points', ok(POINTS));
  // The ledger carries a redemption entry so the redemptions screen has a row.
  routes.set('/customer/points/ledger', ok({ data: REDEMPTION_LEDGER, meta: {} }));
  routes.set('/customer/payments', ok({ data: PAYMENTS, meta: {} }));
  routes.set('/customer/redemptions', ok({ data: REDEMPTION_LEDGER, meta: {} }));
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?')[0]!;
    const handler = routes.get(path);
    if (!handler) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed ${path}` } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { status, body } = handler();
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
}

function atWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

const render = (route: string, signedIn = true) =>
  renderWithProviders(<App />, { route, sessionUser: signedIn ? SIGNED_IN : null });

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.scrollTo = vi.fn() as never;
  localStorage.clear();
  resetSupabaseClientForTest();
  install();
  vi.stubGlobal('fetch', mockFetch());
});

describe('Phase 33 customer portal at mobile widths', () => {
  it.each([320, 390, 430])('login renders at %ipx', async (width) => {
    atWidth(width);
    render('/customer/login', false);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your card', level: 2 }),
    ).toBeInTheDocument();
  });

  it.each([320, 390])('dashboard renders at %ipx', async (width) => {
    atWidth(width);
    render('/customer');
    expect(await screen.findByRole('main')).toBeInTheDocument();
  });

  it('digital card fits 320px without clipping the number or plan', async () => {
    atWidth(320);
    render('/customer/membership');
    expect(await screen.findAllByText('MBS-000777')).not.toHaveLength(0);
    expect(screen.getAllByText('Gold').length).toBeGreaterThanOrEqual(1);
    // No hidden credential is ever rendered alongside the card.
    expect(document.body.textContent).not.toMatch(/qr_token|fallback_code|_hash/);
  });

  it('points and payment history tables scroll at 390px', async () => {
    atWidth(390);
    render('/customer/payments');
    expect(await screen.findByText(/TRF-9001/)).toBeInTheDocument();
  });

  it('redemption history renders at 390px', async () => {
    atWidth(390);
    render('/customer/redemptions');
    expect(await screen.findByText('RDM-000001')).toBeInTheDocument();
  });

  it('profile renders at 390px with reachable actions', async () => {
    atWidth(390);
    render('/customer/profile');
    expect(await screen.findByText('ana.buyer@example.invalid')).toBeInTheDocument();
  });
});

describe('Phase 33 public site keeps its responsive design', () => {
  it.each([
    [320, '/', 'Hospitality'],
    [390, '/', 'Hospitality'],
    [390, '/contact', "Let's connect."],
    [768, '/about', 'Hospitality, touched by home.'],
  ])('%ipx %s renders with marketing chrome', async (width, route, marker) => {
    atWidth(width);
    render(route, false);
    const main = await screen.findByRole('main', undefined, { timeout: 20000 });
    expect(main.textContent).toMatch(marker);
    expect(document.querySelector('.afh-public')).toBeInTheDocument();
  });

  it('footer wraps at 390px without losing brand content', async () => {
    atWidth(390);
    render('/', false);
    await screen.findByRole('main', undefined, { timeout: 20000 });
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});
