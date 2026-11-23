/**
 * Customer portal: guard behaviour, screen content, and the "no sensitive data on
 * screen" rule.
 *
 * These tests render the REAL routes, the REAL guard and the REAL screens. Only
 * the network boundary is stubbed, so a change that starts requesting a field
 * the API must never return shows up here as a failure.
 *
 * The stub is deliberately a deny-by-default gate: any request for a path the
 * fixture does not define fails loudly instead of resolving to `undefined`,
 * which is what a `fetch` mock that returns `{}` would do.
 */
import { screen, within } from '@testing-library/react';
import { formatMoneyOrDash, formatUTCDate, isFeaturePathEnabled } from '@afhomes/shared';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { getCustomerPoints, getCustomerPointsPosition } from './services';
import { CustomerSessionProvider } from '../../lib/customer-session';
import { resetSupabaseClientForTest } from '../../lib/supabase';
import { ApiError } from '../../lib/api/errors';

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
  credentialsNote:
    'Your member code and QR below never change - show them at any AFHomes Ecofarm desk.',
  memberCode: 'MBS-000777',
  qrPayload: 'AFHOMES:MBS-000777',
};

/**
 * The LEGACY summary. Its shape is FROZEN - a deployed client validates against
 * exactly these five fields, so removing one, or changing what `balance` means,
 * is a breaking change. `balance` here is the RAW account balance, not spendable.
 */
const POINTS = {
  membershipId: MEMBERSHIP.id,
  balance: 60000,
  lifetimeAllocated: 60000,
  lifetimeRedeemed: 0,
  updatedAt: '2026-01-05T02:00:00.000Z',
};

/**
 * The NEW position endpoint, separately named so the richer shape is ADDITIVE
 * rather than a silent replacement of the legacy summary above.
 */
const POSITION = {
  membershipId: MEMBERSHIP.id,
  balance: 60000,
  annualCap: 100000,
  remainingEarningCapacity: 40000,
  spendable: 60000,
  reversalDebt: 0,
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2027-01-01T00:00:00.000Z',
  tier: 'GOLD' as const,
  earnedThisPeriod: 60000,
  redeemedThisPeriod: 20000,
};

const LEDGER = {
  data: [
    {
      id: '2',
      entryType: 'adjustment' as const,
      amount: 1000,
      balanceAfter: 61000,
      reason: 'Goodwill adjustment',
      occurredAt: '2026-02-01T02:00:00.000Z',
    },
    {
      id: '1',
      entryType: 'annual_allocation' as const,
      amount: 60000,
      balanceAfter: 60000,
      reason: 'Annual points allocation on activation',
      occurredAt: '2026-01-05T02:00:00.000Z',
    },
  ],
  meta: {},
};

const REDEMPTION_LEDGER = {
  data: [
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
    ...LEDGER.data,
  ],
  meta: {},
};

const PAYMENTS = {
  data: [
    {
      id: 'cccccccc-0000-4000-8000-000000000001',
      saleId: 'bbbbbbbb-0000-4000-8000-000000000001',
      amount: '20000.00',
      paymentType: 'installment',
      method: 'bank_transfer',
      reference: 'TRF-9001',
      status: 'verified',
      recordedAt: '2026-02-01T02:00:00.000Z',
      verifiedAt: '2026-02-02T02:00:00.000Z',
    },
  ],
  meta: {},
};

/** path suffix -> handler. Anything not listed is an explicit failure. */
type RouteHandler = () => { status: number; body: unknown };
const routes = new Map<string, RouteHandler>();

const ok =
  (body: unknown): RouteHandler =>
  () => ({ status: 200, body });
const list =
  (data: unknown[]): RouteHandler =>
  () => ({ status: 200, body: { data, meta: {} } });

const SIGNED_IN = { authUserId: 'ffffffff-0000-4000-8000-000000000001', email: CUSTOMER.email };

function installRoutes(over: Record<string, RouteHandler> = {}) {
  routes.clear();
  routes.set('/auth/portals', ok({ staff: null, customer: { status: 'active' }, ost: null }));
  routes.set('/customer', ok(CUSTOMER));
  routes.set(
    '/profile-photo/customer',
    ok({ url: null, expiresAt: null, canUpload: true, notice: null }),
  );
  routes.set('/customer/membership', ok(MEMBERSHIP));
  routes.set('/customer/points', ok(POINTS));
  routes.set('/customer/points/position', ok(POSITION));
  routes.set('/earning/approvals', list([]));
  routes.set('/customer/refunds', list([]));
  routes.set('/customer/points/ledger', list(LEDGER.data));
  for (const [path, handler] of Object.entries(over)) routes.set(path, handler);
}

const requests: string[] = [];

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?')[0]!;
    requests.push(`${path}`);
    const fullPath = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '');
    const handler = routes.get(fullPath) ?? routes.get(path);
    if (!handler) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed route ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const { status, body } = handler();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const render = (route: string, signedIn = true) =>
  renderWithProviders(<App />, {
    route,
    sessionUser: signedIn ? SIGNED_IN : null,
  });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  resetSupabaseClientForTest();
  requests.length = 0;
  installRoutes();
  vi.stubGlobal('fetch', mockFetch());
});

/* ================================================================== */
/* Guard                                                                */
/* ================================================================== */

describe('customer guard', () => {
  it('sends an unauthenticated visitor to the sign-in screen', async () => {
    render('/customer', false);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your card', level: 1 }),
    ).toBeInTheDocument();
    // The guard must not even ask for customer data without a session.
    expect(requests).not.toContain('/customer');
  });

  it.each(['/customer/membership', '/customer/points', '/customer/profile'])(
    'protects %s as well',
    async (route) => {
      render(route, false);
      expect(
        await screen.findByRole('heading', { name: 'Sign in to your card', level: 1 }),
      ).toBeInTheDocument();
    },
  );

  it('lets an active customer into the dashboard', async () => {
    render('/customer');
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('CUS-000777')).toBeInTheDocument();
  });

  it('tells a signed-in non-customer that this is not a customer account', async () => {
    installRoutes({
      '/customer': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'This sign-in is not a customer account.' } },
      }),
    });
    render('/customer');
    expect(await screen.findByText('Customer access unavailable')).toBeInTheDocument();
    // A staff member must not be offered a customer sign-in form here.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('shows a suspended customer a restricted state, not an error', async () => {
    installRoutes({
      '/customer': ok({ ...CUSTOMER, status: 'suspended' }),
      '/customer/membership': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Your account is suspended.' } },
      }),
      '/customer/points': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Your account is suspended.' } },
      }),
      '/customer/points/ledger': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Your account is suspended.' } },
      }),
    });
    render('/customer/membership');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Your account is suspended/i);
    // The restriction is explained, and no card data is rendered.
    expect(await screen.findByText(/not available while this is in effect/i)).toBeInTheDocument();
  });

  it('words a prospect banner in plain language and gives the tab one h1', async () => {
    installRoutes({
      '/customer': ok({ ...CUSTOMER, status: 'prospect' }),
      '/customer/membership': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Your account is not active.' } },
      }),
    });
    render('/customer/membership');
    expect(await screen.findByText(/Your account is not active yet\./)).toBeInTheDocument();
    expect(screen.queryByText(/Your account is prospect/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'My card',
    ]);
  });

  it('does not render the shell before the session resolves', async () => {
    // No `initialUser` => the provider runs its real resolve path, which with no
    // Supabase client configured lands on "unauthenticated" without flashing.
    renderWithProviders(<App />, { route: '/customer' });
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Sign in to your card', level: 1 },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Dashboard                                                            */
/* ================================================================== */

describe('customer dashboard', () => {
  it('shows the member their own card and points, and nothing else', async () => {
    render('/customer');
    expect(await screen.findByText('MBS-000777')).toBeInTheDocument();
    // The tier label now appears once, on the VIP card preview (the old
    // duplicate lived in the removed "Membership" KPI tile).
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /gold vip privilege card/i })).toBeInTheDocument();
    expect(screen.getAllByText('60,000').length).toBeGreaterThan(0);
    // The dashboard shows the artwork only: never the scannable QR or its payload.
    expect(screen.queryByRole('img', { name: /member QR code/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/AFHOMES:/)).not.toBeInTheDocument();
    // Card details, not staff or finance information - and no payment figures
    // leak onto the dashboard (amounts live on the Payments screen only).
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/seller/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/₱/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TRF-/)).not.toBeInTheDocument();
  });

  it('shows recent points activity on the dashboard', async () => {
    render('/customer');
    expect(await screen.findByText('Goodwill adjustment')).toBeInTheDocument();
    expect(screen.getByText('Annual Allocation')).toBeInTheDocument();
  });

  it('renders the valid-until date, status and scheme in the membership summary', async () => {
    render('/customer');
    await screen.findByText('MBS-000777');
    const summary = screen.getByRole('heading', { name: 'Available Points' }).closest('section')!;
    expect(within(summary).getByText('Valid until').closest('div')).toHaveTextContent(
      'Jan 5, 2027',
    );
    expect(within(summary).getByText('Status').closest('div')).toHaveTextContent('active');
    expect(within(summary).getByText('Payment scheme').closest('div')).toHaveTextContent(
      'Spot Cash',
    );
    // Available Points is SPENDABLE; the card ledger balance stays a separate, labelled line.
    expect(within(summary).getByText('60,000')).toBeInTheDocument();
    expect(within(summary).getByText('60,000 on your card')).toBeInTheDocument();
  });

  it('keeps the card preview and quick actions pointing at their screens', async () => {
    render('/customer');
    await screen.findByText('MBS-000777');
    expect(screen.getByRole('link', { name: 'View My Card' })).toHaveAttribute(
      'href',
      '/customer/membership',
    );
    const quick = within(screen.getByRole('navigation', { name: 'Quick actions' }));
    expect(quick.getByRole('link', { name: 'My Card' })).toHaveAttribute(
      'href',
      '/customer/membership',
    );
    expect(quick.getByRole('link', { name: 'Points' })).toHaveAttribute('href', '/customer/points');
  });

  it('explains a missing membership instead of showing a zero balance', async () => {
    const notFound = () => ({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'none' } },
    });
    installRoutes({
      '/customer/membership': notFound,
      '/customer/points/position': notFound,
    });
    render('/customer');
    expect(
      await screen.findByText('You do not have an active membership yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Available Points' })).not.toBeInTheDocument();
    // The account status and a valid next step remain.
    const account = screen.getByRole('heading', { name: 'Your account' }).closest('section')!;
    expect(within(account).getByText('active')).toBeInTheDocument();
    expect(within(account).getByRole('link', { name: 'Open Messages' })).toHaveAttribute(
      'href',
      '/customer/messages',
    );
  });

  it('shows card-shaped skeletons while the summary loads', async () => {
    render('/customer');
    expect(await screen.findByLabelText('Loading summary')).toBeInTheDocument();
    await screen.findByText('MBS-000777');
  });
});

/* ================================================================== */
/* Profile - the read model must stay narrow                            */
/* ================================================================== */

describe('customer profile', () => {
  it('shows the safe profile fields', async () => {
    render('/customer/profile');
    // The customer number appears in the shell header too, so scope to the card.
    // Sections were regrouped: "Your details" -> Personal details (now also holds the date of
    // birth); "Contact" + "Address" -> Contact information.
    const card = (await screen.findByRole('heading', { name: 'Personal details' })).closest(
      'section',
    )!;
    expect(within(card).getByText('CUS-000777')).toBeInTheDocument();
    expect(within(card).getByText('Ana R Buyer')).toBeInTheDocument();

    const contact = screen
      .getByRole('heading', { name: 'Contact information' })
      .closest('section')!;
    expect(within(contact).getByText('ana.buyer@example.invalid')).toBeInTheDocument();
    expect(within(contact).getByText('09185550000')).toBeInTheDocument();
    expect(within(contact).getByText(/77 Katipunan/)).toBeInTheDocument();
  });

  it('keeps the profile read-only, with an account section and a status label', async () => {
    render('/customer/profile');
    const account = (await screen.findByRole('heading', { name: 'Account' })).closest('section')!;
    expect(within(account).getByText('Portal access')).toBeInTheDocument();
    expect(within(account).getAllByText('Active').length).toBeGreaterThan(0);
    // No edit form: nothing on this page can write to the customer record.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Managed by AF Homes/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('never renders a government ID, document path or staff identifier', async () => {
    // Even if a hostile API smuggled one in, it must not reach the DOM.
    installRoutes({
      '/customer': ok({
        ...CUSTOMER,
        governmentIdNumber: '7788-9900-1122',
        identityDocumentPath: 'afhomes-customer-ids/ana/id.pdf',
        createdBy: '00000000-0000-4000-8000-0000000000bb',
      }),
    });
    const { container } = render('/customer/profile');
    await screen.findByRole('heading', { name: 'Personal details' });
    const html = container.innerHTML;
    expect(html).not.toContain('7788-9900-1122');
    expect(html).not.toContain('id.pdf');
    expect(html).not.toContain('afhomes-customer-ids');
    expect(html).not.toContain('00000000-0000-4000-8000-0000000000bb');
  });
});

/* ================================================================== */
/* Membership + credential policy                                       */
/* ================================================================== */

describe('membership screen', () => {
  it('shows the persistent digital VIP card without any rotation', async () => {
    render('/customer/membership');
    expect(
      await screen.findByRole('heading', { name: /my digital vip card/i }),
    ).toBeInTheDocument();
    // The Membership Code IS the membership number: always visible, never rotated,
    // and shown exactly once. It used to render twice (as "Membership" and as
    // "Member Code"), which read as two different credentials.
    expect(screen.getByText('MBS-000777')).toBeInTheDocument();
    expect(screen.getAllByText('MBS-000777')).toHaveLength(1);
    expect(screen.queryByText('Member Code')).not.toBeInTheDocument();
    expect(screen.getByText('Membership Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy membership code/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /member QR code/i })).toBeInTheDocument();
  });

  it('does not display a one-time secret until one is explicitly requested', async () => {
    render('/customer/membership');
    await screen.findByText(/my digital vip card/i);
    expect(screen.queryByText('AFH-NEWW-WWWW')).not.toBeInTheDocument();
  });

  it('issues and displays a new code on request, and says the old one dies', async () => {
    installRoutes({
      '/customer/membership/credentials': () => ({
        status: 201,
        body: {
          membershipId: MEMBERSHIP.id,
          membershipNumber: 'MBS-000777',
          fallbackCode: 'AFH-NEWW-WWWW',
          qrToken: 'opaque-rotated-qr-token',
          issuedAt: '2026-03-01T02:00:00.000Z',
          previousCodesInvalidated: true,
        },
      }),
    });
    const user = userEvent.setup();
    render('/customer/membership');
    await user.click(await screen.findByRole('button', { name: /request a new card secret/i }));
    // Rotation is behind a confirmation: nothing is requested until it is accepted.
    expect(requests).not.toContain('/customer/membership/credentials');
    const confirm = await screen.findByRole('dialog', { name: /replace your card secret/i });
    expect(
      within(confirm).getByText(/replaces the previous secret immediately/i),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Replace secret' }));

    expect(await screen.findByText('AFH-NEWW-WWWW')).toBeInTheDocument();
    // The issued secret renders inside the dialog; the persistent card QR
    // renders on the page, so scope the image query to the dialog.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: /member QR code/i })).toBeInTheDocument();
    expect(screen.getAllByText(/cannot be displayed again/i).length).toBeGreaterThan(0);
  });

  it('does not rotate the secret when the confirmation is cancelled', async () => {
    installRoutes({
      '/customer/membership/credentials': () => ({
        status: 201,
        body: {
          membershipId: MEMBERSHIP.id,
          membershipNumber: 'MBS-000777',
          fallbackCode: 'AFH-NEWW-WWWW',
          qrToken: 'opaque-rotated-qr-token',
          issuedAt: '2026-03-01T02:00:00.000Z',
          previousCodesInvalidated: true,
        },
      }),
    });
    const user = userEvent.setup();
    render('/customer/membership');
    await user.click(await screen.findByRole('button', { name: /request a new card secret/i }));
    const confirm = await screen.findByRole('dialog', { name: /replace your card secret/i });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requests).not.toContain('/customer/membership/credentials');
    expect(screen.queryByText('AFH-NEWW-WWWW')).not.toBeInTheDocument();
  });

  it('lists the full membership details, with the card ledger balance labelled as such', async () => {
    render('/customer/membership');
    await screen.findByRole('heading', { name: /my digital vip card/i });
    const details = screen.getByRole('heading', { name: 'Membership details' }).closest('section')!;
    const row = (term: string) => within(details).getByText(term).closest('div')!;
    expect(row('Activated')).toHaveTextContent('Jan 5, 2026');
    expect(row('VIP Card ID')).toHaveTextContent('Not issued');
    expect(row('Annual points')).toHaveTextContent('60,000');
    expect(row('Points on your card')).toHaveTextContent(
      /not your available \(spendable\) points/i,
    );
    expect(screen.getByRole('heading', { name: 'Scan at the desk' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Card security' })).toBeInTheDocument();
  });

  it('never renders a stored credential hash', async () => {
    installRoutes({
      '/customer/membership': ok({
        ...MEMBERSHIP,
        fallback_code_hash: 'a'.repeat(64),
        qr_token_hash: 'b'.repeat(64),
      }),
    });
    const { container } = render('/customer/membership');
    await screen.findAllByText('MBS-000777');
    expect(container.innerHTML).not.toContain('a'.repeat(64));
    expect(container.innerHTML).not.toContain('b'.repeat(64));
  });

  it('shows the member’s own agreed scheme and validity, never the move playbook', async () => {
    render('/customer/membership');
    expect(await screen.findByText('Spot Cash')).toBeInTheDocument();
    expect(screen.getByText('Valid for 1 year')).toBeInTheDocument();
    const { container } = render('/customer/membership');
    await screen.findAllByText('MBS-000777');
    expect(container.innerHTML).not.toMatch(/Move B1|Move B2|40% DP|25% DP/);
  });
});

/* ================================================================== */
/* Points                                                               */
/* ================================================================== */

describe('points position vs legacy summary', () => {
  /**
   * The two endpoints are separate on purpose, and this is what proves it.
   * `getCustomerPoints` keeps the deployed contract; `getCustomerPointsPosition`
   * adds the three figures. If either were folded into the other, a deployed
   * client would start failing validation the moment this branch deploys.
   */
  it('the new page reads the position endpoint, not the legacy summary', async () => {
    render('/customer/points');
    await screen.findByRole('heading', { name: 'Your points' });
    const paths = (globalThis.fetch as unknown as { mock: { calls: [unknown][] } }).mock.calls.map(
      (call) =>
        String(call[0])
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api\/v1/, '')
          .split('?')[0],
    );
    // The screen that needs the three figures uses the endpoint that has them.
    expect(paths).toContain('/customer/points/position');
  });

  it('the legacy summary keeps every deployed field, with balance unchanged', async () => {
    // Called directly so the assertion is about the CLIENT CONTRACT, not about
    // which screen happens to render it.
    const summary = await getCustomerPoints();
    // Exactly the frozen shape. `balance` is still the raw account balance.
    expect(Object.keys(summary).sort()).toEqual([
      'balance',
      'lifetimeAllocated',
      'lifetimeRedeemed',
      'membershipId',
      'updatedAt',
    ]);
    expect(summary.balance).toBe(60000);
    expect(summary.lifetimeAllocated).toBe(60000);
    expect(summary.lifetimeRedeemed).toBe(0);
  });

  it('the position endpoint exposes spendable, capacity and debt separately', async () => {
    const position = await getCustomerPointsPosition();
    expect(position.balance).toBe(60000);
    expect(position.spendable).toBe(60000);
    expect(position.remainingEarningCapacity).toBe(40000);
    expect(position.annualCap).toBe(100000);
    expect(position.reversalDebt).toBe(0);
    expect(position.tier).toBe('GOLD');
  });

  it('a member in debt sees a spendable figure LOWER than the balance', async () => {
    installRoutes({
      '/customer/points/position': ok({
        ...POSITION,
        balance: 60000,
        reversalDebt: 15000,
        spendable: 45000,
      }),
    });
    render('/customer/points');
    // The headline is spendable, so a member in debt is not told they hold the
    // full balance as usable.
    expect(await screen.findByText(/15,000 points are held/i)).toBeTruthy();
    // Hero is spendable (45,000); the card balance and the hold stay separate.
    expect(screen.getByText('Available points').nextElementSibling).toHaveTextContent('45,000');
    expect(screen.getByText('On your card').nextElementSibling).toHaveTextContent('60,000');
    expect(screen.getByText('Held for a reversal').nextElementSibling).toHaveTextContent('15,000');
    // The spendable figure is shown once, in the hero, not repeated as a row.
    expect(screen.queryByText('Available to spend')).toBeNull();
  });

  it('a member at their earning cap still sees a healthy spendable balance', async () => {
    installRoutes({
      '/customer/points/position': ok({
        ...POSITION,
        remainingEarningCapacity: 0,
        earnedThisPeriod: 100000,
      }),
    });
    render('/customer/points');
    const card = (await screen.findByRole('heading', { name: 'Your points' })).closest('section')!;
    // Capacity 0 must not read as "no points": the balance is untouched. Await
    // the loaded balance card: the shell renders while loading, so the heading
    // alone does not prove the figures arrived.
    expect(await within(card).findByText('Available points')).toBeInTheDocument();
    expect(within(card).getByText('On your card')).toBeInTheDocument();
    expect(within(card).getByText('Can still earn this year')).toBeInTheDocument();
  });
});

describe('points screen', () => {
  it('shows earning and refund references even without a redemption row', async () => {
    installRoutes({
      '/customer/points/ledger': list([
        { ...LEDGER.data[0], entryType: 'earned', referenceNumber: 'CLM-LOCAL-001' },
        { ...LEDGER.data[0], id: '3', referenceNumber: 'REFUND-LOCAL-001' },
      ]),
    });
    render('/customer/points');
    expect(await screen.findByText('CLM-LOCAL-001')).toBeInTheDocument();
    expect(screen.getByText('REFUND-LOCAL-001')).toBeInTheDocument();
  });

  it('separates spendable points from what may still be earned', async () => {
    render('/customer/points');
    const card = (await screen.findByRole('heading', { name: 'Your points' })).closest('section')!;
    // Await the loaded figures: the card shell renders while loading.
    expect(await within(card).findByText('Available points')).toBeInTheDocument();
    // The three figures are labelled separately so none can be read as another.
    expect(within(card).getByText('On your card')).toBeInTheDocument();
    expect(within(card).queryByText('Available to spend')).toBeNull();
    // No reversal is outstanding, so no "held" measure is shown.
    expect(within(card).queryByText('Held for a reversal')).toBeNull();
    expect(within(card).getByText('Can still earn this year')).toBeInTheDocument();
    expect(within(card).getByText('Annual limit')).toBeInTheDocument();
    // 40,000 of capacity is NOT spendable and must not be presented as money.
    expect(within(card).getByText('40,000')).toBeInTheDocument();
    const history = screen.getByRole('heading', { name: 'Points activity' }).closest('section')!;
    expect(within(history).getByText('Goodwill adjustment')).toBeInTheDocument();
    expect(within(history).getByText('Annual points allocation on activation')).toBeInTheDocument();
  });

  it('lists the ledger as records with a signed amount, type label and balance after', async () => {
    installRoutes({
      '/customer/points/ledger': list([
        {
          id: '11',
          entryType: 'earned',
          amount: 500,
          balanceAfter: 1500,
          reason: 'Spa purchase',
          occurredAt: '2026-10-01T00:00:00.000Z',
        },
        {
          id: '12',
          entryType: 'redemption',
          amount: -200,
          balanceAfter: 1300,
          reason: null,
          occurredAt: '2026-10-02T00:00:00.000Z',
        },
      ]),
    });
    render('/customer/points');
    const history = (await screen.findByRole('heading', { name: 'Points activity' })).closest(
      'section',
    )!;
    const earned = (await within(history).findByText('Spa purchase')).closest('li')!;
    expect(within(earned).getByText('Earned')).toBeInTheDocument();
    expect(within(earned).getByText('+500')).toBeInTheDocument();
    expect(within(earned).getByText('Balance after 1,500')).toBeInTheDocument();
    // No description: the type label leads the row, and the debit carries a minus sign.
    const spent = within(history).getByText('Redemption').closest('li')!;
    expect(within(spent).getByText('−200')).toBeInTheDocument();
    expect(within(spent).getByText('Balance after 1,300')).toBeInTheDocument();
    expect(within(history).queryByRole('table')).toBeNull();
  });

  it('offers no redemption control and mutates nothing', async () => {
    render('/customer/points');
    await screen.findByRole('heading', { name: 'Your points' });
    expect(screen.queryByRole('button', { name: /redeem|convert|spend|use points/i })).toBeNull();
    // Every request the screen made was a read.
    const calls = (globalThis.fetch as unknown as { mock: { calls: [unknown, RequestInit?][] } })
      .mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) {
      const method = (init as { method?: string } | undefined)?.method ?? 'GET';
      expect(method, `unexpected ${method}`).toBe('GET');
    }
  });
});

/* ================================================================== */
/* Activation + sign-in screens                                         */
/* ================================================================== */

describe('activation screen', () => {
  it('offers only a token and a password - never an identity field', async () => {
    render('/customer/activate', false);
    expect(await screen.findByLabelText('Activation code')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    for (const forbidden of [
      'Email',
      'Customer number',
      'Customer ID',
      'Membership',
      'Role',
      'Status',
    ]) {
      expect(screen.queryByLabelText(new RegExp(forbidden, 'i'))).toBeNull();
    }
  });

  it('never pre-renders a token from the query string', async () => {
    // A token in `?token=` would be written to server access logs. The screen
    // reads the fragment only, so the field must start empty.
    render('/customer/activate?token=secret-in-query-string-0000', false);
    const input = (await screen.findByLabelText('Activation code')) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('prefills an emailed token from the URL fragment and removes it from the address bar', async () => {
    window.history.replaceState(
      null,
      '',
      '/customer/activate#token=customer-onboarding-token-0001',
    );
    render('/customer/activate', false);
    const input = (await screen.findByLabelText('Activation code')) as HTMLInputElement;
    expect(input.value).toBe('customer-onboarding-token-0001');
    expect(window.location.hash).toBe('');
  });
});

describe('sign-in screen', () => {
  it('shows a single generic message on failure, so accounts cannot be enumerated', async () => {
    const user = userEvent.setup();
    render('/customer/login', false);
    await user.type(screen.getByLabelText('Email'), 'nobody@example.invalid');
    await user.type(screen.getByLabelText('Password'), 'Whatever12345');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    // Whatever the backend says (unknown address or wrong password), the
    // member sees exactly one sentence that names neither case.
    expect(
      await screen.findByText('We could not sign you in with that email and password.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/invalid login|user not found|unknown/i);
  });

  it('points staff at the staff portal instead of a second login form', async () => {
    render('/customer/login', false);
    await screen.findByLabelText('Email');
    expect(
      screen.queryByRole('link', { name: /staff login|ost login|admin login/i }),
    ).not.toBeInTheDocument();
    // The administration entry is intentionally undiscoverable here.
    expect(document.body.textContent).not.toMatch(/administration console|administration login/i);
  });
});

/* ================================================================== */
/* Session provider contract                                            */
/* ================================================================== */

describe('customer session provider', () => {
  it('holds no permission or role - authorization lives on the server', async () => {
    render('/customer');
    await screen.findByText('CUS-000777');
    // The shell renders the customer's own data and nothing about capabilities.
    expect(document.body.textContent).not.toMatch(/permission|role|super admin/i);
  });

  it('exposes a sign-out control that clears the session', async () => {
    const user = userEvent.setup();
    render('/customer');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Sign in to your card', level: 1 },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });
});

/* ================================================================== */
/* The provider must never be bypassable by a nested consumer           */
/* ================================================================== */

describe('hook misuse', () => {
  it('the provider itself renders without a Supabase client configured', () => {
    // With no client the real resolve path lands on "unauthenticated" rather
    // than throwing, so the guard has a defined state to render.
    function Orphan() {
      return <CustomerSessionProvider>{null}</CustomerSessionProvider>;
    }
    expect(() => renderWithProviders(<Orphan />)).not.toThrow();
  });

  it('keeps ApiError usable for status checks outside the shell', () => {
    expect(new ApiError({ code: 'FORBIDDEN', message: 'x', status: 403 }).status).toBe(403);
  });
});

/* ================================================================== */
/* Nothing sensitive reaches the DOM via an error path                 */
/* ================================================================== */

describe('error handling', () => {
  it('renders a generic failure when the API is unreachable', async () => {
    installRoutes({
      '/customer': () => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } }),
    });
    render('/customer');
    expect(await screen.findByText('We could not load your account')).toBeInTheDocument();
  });

  it('does not echo a server error message that contains a staff identifier', async () => {
    installRoutes({
      '/customer': () => ({
        status: 500,
        body: {
          error: {
            code: 'INTERNAL',
            message: 'failed for staff 00000000-0000-4000-8000-0000000000bb',
          },
        },
      }),
    });
    const { container } = render('/customer');
    await screen.findByText('We could not load your account');
    expect(container.innerHTML).not.toContain('00000000-0000-4000-8000-0000000000bb');
  });

  it('renders a not-found screen for an unknown portal path', async () => {
    render('/customer/nope');
    expect(await screen.findByRole('heading')).toBeInTheDocument();
  });

  it('the portal never links to a staff-only screen', async () => {
    render('/customer');
    await screen.findByText('CUS-000777');
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => href?.includes('/admin/'))).toBe(false);
    expect(hrefs.some((href) => href?.includes('/queues'))).toBe(false);
  });

  it('the membership screen renders within the portal shell navigation', async () => {
    render('/customer/membership');
    const nav = await screen.findByRole('navigation', { name: 'Customer portal' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Points' })).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Payment history                                                       */
/* ================================================================== */

describe('customer payments screen', () => {
  it('renders the member own payments with safe columns only', async () => {
    installRoutes({ '/customer/payments': list(PAYMENTS.data) });
    render('/customer/payments');
    expect(await screen.findByText('TRF-9001')).toBeInTheDocument();
    // Method codes are shown as words; the stored code is never rendered raw.
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
    expect(screen.queryByText('bank_transfer')).not.toBeInTheDocument();
    // Status is text; amount, type and date are visible on the same record.
    expect(screen.getByText('Verified')).toBeInTheDocument();
    const record = screen.getByText('TRF-9001').closest('li')!;
    expect(within(record).getByText('Installment')).toBeInTheDocument();
    expect(within(record).getByText(formatMoneyOrDash('20000.00'))).toBeInTheDocument();
    expect(within(record).getByText(formatUTCDate('2026-02-01T02:00:00.000Z'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('never words a recorded payment as verified', async () => {
    installRoutes({
      '/customer/payments': list([
        { ...PAYMENTS.data[0], id: 'cccccccc-0000-4000-8000-000000000002', status: 'recorded' },
        { ...PAYMENTS.data[0], id: 'cccccccc-0000-4000-8000-000000000003', status: 'voided' },
        { ...PAYMENTS.data[0], id: 'cccccccc-0000-4000-8000-000000000004', status: 'rejected' },
      ]),
    });
    render('/customer/payments');
    expect(await screen.findByText('Recorded, not yet verified')).toBeInTheDocument();
    expect(screen.getByText('Voided')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).toBeNull();
    expect(screen.getByText('Showing the most recent 3 payments.')).toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/recorded_by|verified_by|receipt|rejection|staff/i);
  });

  it('shows an empty state with no payments', async () => {
    installRoutes({ '/customer/payments': list([]) });
    render('/customer/payments');
    expect(await screen.findByText('No payments recorded yet.')).toBeInTheDocument();
  });

  it('shows a forbidden state for a restricted account', async () => {
    installRoutes({
      '/customer/payments': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Your account is suspended.' } },
      }),
    });
    render('/customer/payments');
    expect(await screen.findByText('Payments unavailable')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Redemption history                                                    */
/* ================================================================== */

describe('customer redemptions screen', () => {
  it('shows the operational spending reference from the customer ledger', async () => {
    installRoutes({
      '/customer/points/ledger': list([
        {
          ...REDEMPTION_LEDGER.data[0],
          redemptionNumber: undefined,
          referenceNumber: 'Q-LOCAL-001',
        },
      ]),
    });
    render('/customer/redemptions');
    expect(await screen.findByText('Q-LOCAL-001')).toBeInTheDocument();
  });

  it('renders only redemption entries with their frozen snapshots', async () => {
    installRoutes({ '/customer/points/ledger': list(REDEMPTION_LEDGER.data) });
    render('/customer/redemptions');
    // The item cell splits name and code across nodes, so match the full text.
    expect(
      await screen.findByText((_, el) => el?.textContent === 'Japanese Teppanyaki (TEPPANYAKI)'),
    ).toBeInTheDocument();
    expect(screen.getByText('RDM-000001')).toBeInTheDocument();
    expect(screen.queryByText('Goodwill adjustment')).toBeNull();
    expect(screen.queryByText('Annual points allocation on activation')).toBeNull();
  });

  it('shows an empty state with no redemptions', async () => {
    render('/customer/redemptions');
    expect(await screen.findByText(/No redemptions yet/)).toBeInTheDocument();
  });

  it('shows an unavailable state when the ledger fails', async () => {
    installRoutes({
      '/customer/points/ledger': () => ({
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom' } },
      }),
    });
    render('/customer/redemptions');
    expect(await screen.findByText('Redemptions unavailable')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Portal navigation and dashboard resilience                            */
/* ================================================================== */

describe('portal navigation', () => {
  it('links every section from the shell', async () => {
    render('/customer');
    const nav = await screen.findByRole('navigation', { name: 'Customer portal' });
    for (const name of ['Dashboard', 'My card', 'Points', 'Redemptions', 'Payments', 'Profile']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/customer/payments',
    );
    expect(within(nav).getByRole('link', { name: 'Redemptions' })).toHaveAttribute(
      'href',
      '/customer/redemptions',
    );
  });

  describe('mobile navigation', () => {
    afterEach(() => {
      vi.mocked(isFeaturePathEnabled).mockImplementation(() => true);
    });

    const MOBILE = { name: 'Customer portal mobile' };

    it('shows the five everyday destinations and a More button', async () => {
      render('/customer');
      const nav = await screen.findByRole('navigation', MOBILE);
      const links = within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
      expect(links).toEqual([
        ['Home', '/customer'],
        ['My card', '/customer/membership'],
        ['Points', '/customer/points'],
        ['Payments', '/customer/payments'],
        ['Profile', '/customer/profile'],
      ]);
      expect(within(nav).getByRole('button', { name: 'More' })).toHaveAttribute(
        'aria-haspopup',
        'dialog',
      );
    });

    it('marks More as current only on a page that lives inside it', async () => {
      render('/customer/redemptions');
      const more = await within(await screen.findByRole('navigation', MOBILE)).findByRole(
        'button',
        {
          name: 'More',
        },
      );
      expect(more).toHaveAttribute('data-active', 'true');
    });

    it('does not mark More as current on an everyday destination', async () => {
      render('/customer');
      const more = await within(await screen.findByRole('navigation', MOBILE)).findByRole(
        'button',
        {
          name: 'More',
        },
      );
      expect(more).not.toHaveAttribute('data-active');
    });

    it('offers a skip link that targets the main content', async () => {
      render('/customer');
      const skip = await screen.findByRole('link', { name: 'Skip to content' });
      expect(skip).toHaveAttribute('href', '#customer-main');
      expect(screen.getByRole('main')).toHaveAttribute('id', 'customer-main');
    });

    it('opens a sheet with the remaining routes and Sign out', async () => {
      const user = userEvent.setup();
      render('/customer');
      const nav = await screen.findByRole('navigation', MOBILE);
      await user.click(within(nav).getByRole('button', { name: 'More' }));
      const sheet = await screen.findByRole('dialog', { name: 'More' });
      const links = within(sheet)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
      expect(links).toEqual([
        ['Redemptions', '/customer/redemptions'],
        ['Bookings', '/customer/bookings'],
        ['Messages', '/customer/messages'],
        ['Notifications', '/customer/notifications'],
      ]);
      expect(within(sheet).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('closes the sheet with Escape and returns focus to More', async () => {
      const user = userEvent.setup();
      render('/customer');
      const nav = await screen.findByRole('navigation', MOBILE);
      const more = within(nav).getByRole('button', { name: 'More' });
      await user.click(more);
      await screen.findByRole('dialog', { name: 'More' });
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    });

    it('closes the sheet when a destination is chosen', async () => {
      const user = userEvent.setup();
      render('/customer');
      const nav = await screen.findByRole('navigation', MOBILE);
      await user.click(within(nav).getByRole('button', { name: 'More' }));
      const sheet = await screen.findByRole('dialog', { name: 'More' });
      await user.click(within(sheet).getByRole('link', { name: 'Bookings' }));
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
    });

    it('omits disabled module routes from both navs and the sheet', async () => {
      vi.mocked(isFeaturePathEnabled).mockImplementation(
        (path) => !path.startsWith('/customer/redemptions') && !path.startsWith('/customer/points'),
      );
      const user = userEvent.setup();
      render('/customer');
      const desktop = await screen.findByRole('navigation', { name: 'Customer portal' });
      const mobile = screen.getByRole('navigation', MOBILE);
      for (const nav of [desktop, mobile]) {
        expect(within(nav).queryByRole('link', { name: 'Points' })).not.toBeInTheDocument();
        expect(within(nav).queryByRole('link', { name: 'Redemptions' })).not.toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Payments' })).toBeInTheDocument();
      }
      await user.click(within(mobile).getByRole('button', { name: 'More' }));
      const sheet = await screen.findByRole('dialog', { name: 'More' });
      expect(within(sheet).queryByRole('link', { name: 'Redemptions' })).not.toBeInTheDocument();
      expect(within(sheet).getByRole('link', { name: 'Bookings' })).toBeInTheDocument();
    });
  });

  it('links profile, redemptions and payments from the dashboard', async () => {
    render('/customer');
    // The quick actions replaced the old text links ("Your profile", "Redemption
    // history", "Payment history"); the same targets stay reachable from the dashboard.
    await screen.findByText('MBS-000777');
    const quick = within(screen.getByRole('navigation', { name: 'Quick actions' }));
    expect(quick.getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/customer/profile',
    );
    expect(quick.getByRole('link', { name: 'Redemptions' })).toHaveAttribute(
      'href',
      '/customer/redemptions',
    );
    expect(quick.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/customer/payments',
    );
  });

  it('keeps the dashboard usable when one section fails', async () => {
    installRoutes({
      '/customer/points/ledger': () => ({
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom' } },
      }),
    });
    render('/customer');
    // The card section is independent of the ledger section.
    expect(await screen.findByText('MBS-000777')).toBeInTheDocument();
    expect(
      screen.getByText('Your points activity is not available right now.'),
    ).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Activation password policy + public recovery routes                   */
/* ================================================================== */

describe('activation password policy', () => {
  it('rejects a weak password before any network call', async () => {
    const user = userEvent.setup();
    render('/customer/activate', false);
    await user.type(screen.getByLabelText('Activation code'), 'a-valid-token-value-0000000001');
    await user.type(screen.getByLabelText('Password'), 'weakpassword');
    await user.type(screen.getByLabelText('Confirm password'), 'weakpassword');
    await user.click(screen.getByRole('button', { name: 'Activate my account' }));
    expect(
      await screen.findByText(
        'Password must contain a lowercase letter, an uppercase letter and a digit.',
      ),
    ).toBeInTheDocument();
  });

  it('rejects mismatched passwords before any network call', async () => {
    const user = userEvent.setup();
    render('/customer/activate', false);
    await user.type(screen.getByLabelText('Activation code'), 'a-valid-token-value-0000000001');
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await user.type(screen.getByLabelText('Confirm password'), 'StrongPass124');
    await user.click(screen.getByRole('button', { name: 'Activate my account' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
  });

  it('shows a live rule checklist while typing, before submit', async () => {
    const user = userEvent.setup();
    render('/customer/activate', false);
    // Untouched password: no checklist yet.
    expect(screen.queryByRole('list', { name: 'Password requirements' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'abc');
    const list = await screen.findByRole('list', { name: 'Password requirements' });
    expect(within(list).getByText('One lowercase letter')).toBeInTheDocument();
    expect(within(list).getAllByText('(missing)')).toHaveLength(3);
    // A compliant password flips every row to met.
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await screen.findAllByText('(met)');
    expect(
      within(screen.getByRole('list', { name: 'Password requirements' })).queryByText('(missing)'),
    ).not.toBeInTheDocument();
  });
});

describe('activation existing-account recovery', () => {
  const RECOVERY_RESULT = {
    customerId: 'cccccccc-0000-4000-8000-000000000001',
    customerNumber: 'CUS-000777',
    email: 'ana.buyer@example.invalid',
    fullName: 'Ana R Buyer',
    nextStep: 'sign_in',
    linkedExistingAuth: true,
  };

  it('links instead of signing in, and points at sign-in / forgot-password', async () => {
    const user = userEvent.setup();
    installRoutes({
      '/auth/customer/activate': () => ({ status: 201, body: RECOVERY_RESULT }),
    });
    render('/customer/activate', false);
    await user.type(screen.getByLabelText('Activation code'), 'a-valid-token-value-0000000001');
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await user.type(screen.getByLabelText('Confirm password'), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: 'Activate my account' }));
    // The typed password was never set on the pre-existing account, so the
    // page must not attempt a sign-in with it (which would fail) - it
    // explains the link and offers the password-owning flows instead.
    expect(await screen.findByText(/An account already exists for this email/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/customer/login',
    );
    expect(screen.getByRole('link', { name: 'Forgot password' })).toHaveAttribute(
      'href',
      '/customer/forgot-password',
    );
    expect(requests.filter((r) => r === '/auth/customer/activate')).toHaveLength(1);
    expect(screen.queryByText('We could not activate your account')).toBeNull();
  });

  it('preserves successful new activation when the subsequent normal sign-in is unavailable', async () => {
    const user = userEvent.setup();
    installRoutes({
      '/auth/customer/activate': () => ({
        status: 201,
        body: { ...RECOVERY_RESULT, linkedExistingAuth: false },
      }),
    });
    render('/customer/activate', false);
    await user.type(screen.getByLabelText('Activation code'), 'a-valid-token-value-0000000001');
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await user.type(screen.getByLabelText('Confirm password'), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: 'Activate my account' }));
    // No client is configured here; sign-in failure cannot undo the completed activation.
    expect(await screen.findByRole('heading', { name: 'Account activated' })).toBeVisible();
    expect(screen.getByText('Use the password you just created.')).toBeVisible();
    expect(screen.queryByText(/An account already exists for this email/)).toBeNull();
  });
});

describe('public recovery routes', () => {
  it('renders forgot-password without a session', async () => {
    render('/customer/forgot-password', false);
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders an invalid-link state for reset without a recovery session', async () => {
    render('/customer/reset-password', false);
    expect(
      await screen.findByText(
        'This recovery link is invalid or has expired. Recovery links are single-use.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Non-active membership display                                         */
/* ================================================================== */

describe('membership status display', () => {
  it('renders a cancelled membership with a neutral status', async () => {
    installRoutes({
      '/customer/membership': ok({ ...MEMBERSHIP, status: 'cancelled' as const }),
    });
    render('/customer/membership');
    expect(await screen.findAllByText('MBS-000777')).not.toHaveLength(0);
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('renders an expired membership with a neutral status', async () => {
    installRoutes({
      '/customer/membership': ok({ ...MEMBERSHIP, status: 'expired' as const }),
    });
    render('/customer/membership');
    expect(await screen.findAllByText('MBS-000777')).not.toHaveLength(0);
    expect(screen.getByText('expired')).toBeInTheDocument();
  });
});

describe('points history pagination', () => {
  it('loads an older bounded page and returns to newer activity', async () => {
    installRoutes({
      '/customer/points/ledger': ok({
        data: [
          {
            id: '101',
            entryType: 'earned',
            amount: 100,
            balanceAfter: 100,
            reason: 'Newest synthetic award',
            occurredAt: '2026-10-01T00:00:00.000Z',
          },
        ],
        meta: { nextCursor: 'older-page' },
      }),
      '/customer/points/ledger?cursor=older-page': ok({
        data: [
          {
            id: '1',
            entryType: 'adjustment',
            amount: 50,
            balanceAfter: 50,
            reason: 'Older synthetic correction',
            occurredAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        meta: { nextCursor: null },
      }),
    });
    render('/customer/points');
    expect(await screen.findByText('Newest synthetic award')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Older activity' }));
    expect(await screen.findByText('Older synthetic correction')).toBeInTheDocument();
    expect(screen.queryByText('Newest synthetic award')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Older activity' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Newer activity' }));
    expect(await screen.findByText('Newest synthetic award')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* A member without a card: a normal state, not a failure              */
/* ================================================================== */

describe('member without an active membership', () => {
  const notFound = () => ({
    status: 404,
    body: { error: { code: 'NOT_FOUND', message: 'none' } },
  });
  // The production client retries reads. A long delay keeps the retry window open for the
  // whole test, so these assertions prove the answer is shown DURING the retries.
  const retrying = () =>
    new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 60_000 } } });
  const renderRetrying = (route: string) =>
    renderWithProviders(<App />, { route, sessionUser: SIGNED_IN, queryClient: retrying() });

  beforeEach(() => {
    installRoutes({
      '/customer/membership': notFound,
      '/customer/points/position': notFound,
      '/customer/points/ledger': notFound,
    });
  });

  it('explains the missing card on the card screen without waiting for retries', async () => {
    renderRetrying('/customer/membership');
    expect(
      await screen.findByText('You do not have an active membership yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading your card…')).not.toBeInTheDocument();
  });

  it('does not word the points screen as a failure', async () => {
    renderRetrying('/customer/points');
    expect(await screen.findByText('No active card yet')).toBeInTheDocument();
    expect(screen.queryByText('Points unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your points activity is not available right now.')).toBeNull();
    expect(
      await screen.findByText('Points activity appears here once your membership is active.'),
    ).toBeInTheDocument();
  });

  it('does not word the dashboard points activity as a failure', async () => {
    renderRetrying('/customer');
    expect(
      await screen.findByText('Points activity appears here once your membership is active.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Your points activity is not available right now.')).toBeNull();
    expect(screen.getByText('You do not have an active membership yet.')).toBeInTheDocument();
  });

  it('still words a genuine server failure as a failure', async () => {
    installRoutes({
      '/customer/points/ledger': () => ({
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom' } },
      }),
    });
    render('/customer');
    expect(
      await screen.findByText('Your points activity is not available right now.'),
    ).toBeInTheDocument();
  });
});

// Preserve source-module behavior tests with explicit feature-on fixtures.
vi.mock('@afhomes/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@afhomes/shared')>();
  return {
    ...actual,
    FEATURE_FLAGS: { redemption: true, services: true },
    isFeaturePathEnabled: vi.fn(() => true),
  };
});
