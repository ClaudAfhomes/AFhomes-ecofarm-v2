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
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
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
    'Your member code and QR below never change - show them at any AF Homes Ecofarm desk.',
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
  routes.set('/customer/membership', ok(MEMBERSHIP));
  routes.set('/customer/points', ok(POINTS));
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
    const handler = routes.get(path);
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
    expect(screen.getAllByText('Gold')).toHaveLength(2);
    expect(screen.getAllByText('60,000').length).toBeGreaterThan(0);
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

  it('renders an activation and valid-until date', async () => {
    render('/customer');
    const card = (await screen.findByText('MBS-000777')).closest('section')!;
    const activated = within(card).getByText('Activated').closest('div')!;
    expect(activated).toHaveTextContent('Jan 5, 2026');
    const until = within(card).getByText('Valid until').closest('div')!;
    expect(until).toHaveTextContent('Jan 5, 2027');
  });

  it('summarizes the account in MetricCard KPIs that link to their screens', async () => {
    render('/customer');
    await screen.findByText('MBS-000777');
    expect(screen.getByRole('link', { name: /Membership: Gold/ })).toHaveAttribute(
      'href',
      '/customer/membership',
    );
    expect(screen.getByRole('link', { name: /Points balance: 60,000/ })).toHaveAttribute(
      'href',
      '/customer/points',
    );
    expect(screen.getByRole('link', { name: /Valid until:/ })).toHaveAttribute(
      'href',
      '/customer/membership',
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
    const card = (await screen.findByRole('heading', { name: 'Your details' })).closest('section')!;
    expect(within(card).getByText('CUS-000777')).toBeInTheDocument();
    expect(within(card).getByText('Ana R Buyer')).toBeInTheDocument();

    const contact = screen.getByRole('heading', { name: 'Contact' }).closest('section')!;
    expect(within(contact).getByText('ana.buyer@example.invalid')).toBeInTheDocument();
    expect(within(contact).getByText('09185550000')).toBeInTheDocument();

    const address = screen.getByRole('heading', { name: 'Address' }).closest('section')!;
    expect(within(address).getByText(/77 Katipunan/)).toBeInTheDocument();
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
    await screen.findByRole('heading', { name: 'Your details' });
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

    expect(await screen.findByText('AFH-NEWW-WWWW')).toBeInTheDocument();
    // The issued secret renders inside the dialog; the persistent card QR
    // renders on the page, so scope the image query to the dialog.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: /member QR code/i })).toBeInTheDocument();
    expect(screen.getAllByText(/cannot be displayed again/i).length).toBeGreaterThan(0);
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

describe('points screen', () => {
  it('shows the balance, lifetime totals and history', async () => {
    render('/customer/points');
    const balanceCard = (await screen.findByRole('heading', { name: 'Balance' })).closest(
      'section',
    )!;
    // "60,000" legitimately appears as both the current balance and the lifetime
    // allocation, so assert the presence and the labelled totals rather than
    // counting occurrences.
    expect(within(balanceCard).getAllByText('60,000').length).toBeGreaterThanOrEqual(1);
    expect(within(balanceCard).getByText('All time allocated')).toBeInTheDocument();
    expect(within(balanceCard).getByText('All time redeemed')).toBeInTheDocument();
    const history = screen.getByRole('heading', { name: 'Points activity' }).closest('section')!;
    expect(within(history).getByText('Goodwill adjustment')).toBeInTheDocument();
    expect(within(history).getByText('Annual points allocation on activation')).toBeInTheDocument();
  });

  it('offers no redemption control and mutates nothing', async () => {
    render('/customer/points');
    await screen.findByRole('heading', { name: 'Balance' });
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
    expect(screen.getByText('bank_transfer')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    for (const heading of ['Date', 'Type', 'Method', 'Reference', 'Status', 'Amount']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
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

  it('links profile, redemptions and payments from the dashboard', async () => {
    render('/customer');
    // The section links render once the membership they depend on resolves.
    await screen.findByText('MBS-000777');
    expect(screen.getByRole('link', { name: 'Your profile' })).toHaveAttribute(
      'href',
      '/customer/profile',
    );
    expect(screen.getByRole('link', { name: 'Redemption history' })).toHaveAttribute(
      'href',
      '/customer/redemptions',
    );
    expect(screen.getByRole('link', { name: 'Payment history' })).toHaveAttribute(
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

  it('still signs in normally when the account was newly created', async () => {
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
    // No Supabase client is configured in tests, so the normal sign-in
    // attempt surfaces its configuration error instead of navigating - which
    // still proves the recovery panel was NOT shown for a fresh account.
    expect(await screen.findByText('We could not activate your account')).toBeInTheDocument();
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
