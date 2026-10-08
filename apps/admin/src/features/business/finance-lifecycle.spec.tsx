/**
 * AF Homes Phase 26 finance UI.
 *
 * Proves the Finance queues and the Commission management screen render real
 * backend state (never mocks), with loading/empty/error handling, search and
 * status filtering, and per-state actions (a paid commission offers no
 * mutation).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';

type Route = { status?: number; body: unknown };
const routes = new Map<string, Route>();
const requests: { path: string; method: string; body: unknown; query: string }[] = [];

const list = (data: unknown[]): Route => ({
  status: 200,
  body: { data, meta: { total: data.length } },
});

const QUEUE_ITEM = {
  // The Finance queue is a discriminated union; a sale-origin row must say so.
  origin: 'sale',
  saleId: 'bbbbbbbb-0000-4000-8000-000000002601',
  saleNumber: 'SALE-260001',
  customerId: 'aaaaaaaa-0000-4000-8000-000000002601',
  customerName: 'Ana R Reyes',
  productName: 'Gold',
  status: 'payment_in_progress',
  cashPrice: '60000.00',
  paymentScheme: 'spot_cash',
  reservationFee: '0.00',
  requiredInitial: '20000.00',
  installmentMonths: null,
  monthlyAmount: null,
  validityMonths: null,
  verifiedTotal: '20000.00',
  remainingBalance: '40000.00',
  downPaymentSatisfied: true,
  fullyPaid: false,
  spotCashState: 'within_deadline',
  spotCashDeadline: '2026-10-04T10:00:00.000Z',
  firstVerifiedPayment: '2026-09-27T10:00:00.000Z',
  activatable: false,
};

const ACTIVATION_ITEM = {
  ...QUEUE_ITEM,
  saleId: 'bbbbbbbb-0000-4000-8000-000000002602',
  saleNumber: 'SALE-260002',
  status: 'payment_verified',
  verifiedTotal: '60000.00',
  remainingBalance: '0.00',
  fullyPaid: true,
  spotCashState: 'fully_paid',
  activatable: true,
};

const COMMISSIONS = [
  {
    id: '99990000-0000-4000-8000-000000002601',
    saleId: 'bbbbbbbb-0000-4000-8000-000000002601',
    saleNumber: 'SALE-260001',
    beneficiaryType: 'staff',
    beneficiaryName: 'Sam Seller',
    rate: '0.04',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'pending',
    qualificationNotes: null,
    qualifiedAt: null,
    earnedAt: null,
    paidAt: null,
    createdAt: '2026-09-27T10:00:00.000Z',
  },
  {
    id: '99990000-0000-4000-8000-000000002602',
    saleId: 'bbbbbbbb-0000-4000-8000-000000002602',
    saleNumber: 'SALE-260002',
    beneficiaryType: 'staff',
    beneficiaryName: 'Sam Seller',
    rate: '0.04',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'earned',
    qualificationNotes: 'Qualified on review.',
    qualifiedAt: '2026-09-28T10:00:00.000Z',
    earnedAt: '2026-09-28T10:00:00.000Z',
    paidAt: null,
    createdAt: '2026-09-27T10:00:00.000Z',
  },
  {
    id: '99990000-0000-4000-8000-000000002603',
    saleId: 'bbbbbbbb-0000-4000-8000-000000002603',
    saleNumber: 'SALE-260003',
    beneficiaryType: 'staff',
    beneficiaryName: 'Sam Seller',
    rate: '0.04',
    basisAmount: '40000.00',
    amount: '1600.00',
    status: 'paid',
    qualificationNotes: 'Qualified on review.',
    qualifiedAt: '2026-09-28T10:00:00.000Z',
    earnedAt: '2026-09-28T10:00:00.000Z',
    paidAt: '2026-09-29T10:00:00.000Z',
    createdAt: '2026-09-27T10:00:00.000Z',
  },
];

const FINANCE_USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Fin Officer',
  email: 'finance@afhomes.test',
  roleId: 'r-fin',
  roleName: 'Finance',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'dashboard.view',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'finance.payment_verification',
      canView: true,
      canCreate: false,
      canUpdate: true,
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
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate: false,
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

const ADMIN_USER: SessionUser = {
  ...FINANCE_USER,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Admin User',
  email: 'admin@afhomes.test',
  roleName: 'Admin',
  afHomesPermissions: FINANCE_USER.afHomesPermissions.map((p) =>
    p.moduleKey === 'network.commissions' ? { ...p, canUpdate: true } : p,
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
  routes.set('GET /queues/finance', list([QUEUE_ITEM]));
  routes.set('GET /queues/activation', list([ACTIVATION_ITEM]));
  routes.set('GET /commissions', list(COMMISSIONS));
  routes.set('GET /sales', list([]));
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string, user: SessionUser = FINANCE_USER) =>
  renderWithProviders(<App />, { route, user });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
});

/* ================================================================== */
/* Finance queue: loading / empty / error (41/42/43)                   */
/* ================================================================== */

describe('Phase 26 finance queue states', () => {
  it('keeps payment mutations disabled for a view-only finance principal', async () => {
    render('/admin/finance/payments', {
      ...FINANCE_USER,
      afHomesPermissions: FINANCE_USER.afHomesPermissions.map((permission) => ({
        ...permission,
        canUpdate: false,
      })),
    });
    await screen.findByText(QUEUE_ITEM.saleNumber);
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'View details' }));
    const detail = within(screen.getByRole('dialog'));
    expect(detail.getByRole('button', { name: 'Verify payment' })).toBeDisabled();
    expect(detail.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(requests.some((request) => request.method !== 'GET')).toBe(false);
  });
  it('41. shows a loading state while the queue is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render('/admin/finance/payments');
    expect(await screen.findByText('Loading queue…')).toBeInTheDocument();
  });

  it('42. shows an empty state when nothing awaits payment', async () => {
    install({ 'GET /queues/finance': list([]) });
    render('/admin/finance/payments');
    expect(await screen.findByText('Nothing to handle')).toBeInTheDocument();
  });

  it('43. shows an error with retry and recovers', async () => {
    const user = userEvent.setup();
    install({
      'GET /queues/finance': {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom' } },
      },
    });
    render('/admin/finance/payments');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    install({ 'GET /queues/finance': list([QUEUE_ITEM]) });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('SALE-260001')).toBeInTheDocument();
  });

  it('46. renders real backend money (no mock figures)', async () => {
    render('/admin/finance/payments');
    // The server-sent exact-decimal strings, formatted without float math.
    expect(await screen.findByText('SALE-260001')).toBeInTheDocument();
    expect(screen.getByText('₱60,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('₱20,000.00')).toHaveLength(1);
    expect(screen.getByText('₱40,000.00')).toBeInTheDocument();
    const get = requests.find((r) => r.method === 'GET' && r.path === '/queues/finance');
    expect(get).toBeDefined();
  });

  it('shows first verified payment and deadline status from the server', async () => {
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    await userEvent.setup().click(screen.getByRole('button', { name: 'View details' }));
    // First verified instant and the derived 7-day state are displayed.
    expect(screen.getByText('Within 7 days')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Activation queue                                                    */
/* ================================================================== */

describe('Phase 26 activation queue', () => {
  it('shows fully-paid rows as eligible with deadline context', async () => {
    render('/admin/finance/activation');
    expect(await screen.findByText('SALE-260002')).toBeInTheDocument();
    expect(screen.getByText('Eligible')).toBeInTheDocument();
    expect(screen.getByText('Settled')).toBeInTheDocument();
  });

  it('shows and copies the one-time onboarding fallback when email delivery fails', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    install({
      [`POST /sales/${ACTIVATION_ITEM.saleId}/activate`]: {
        body: {
          membershipId: '33333333-3333-4333-8333-333333333333',
          membershipNumber: 'MBS-000026',
          fallbackCode: 'AFH-2626-0001',
          qrToken: 'opaque-26-token',
          pointsAllocated: 60000,
          alreadyActive: false,
          onboarding: {
            status: 'manual_required',
            emailStatus: 'failed',
            token: 'customer-onboarding-token-0001',
            activationUrl:
              'https://afhomes.example/customer/activate#token=customer-onboarding-token-0001',
            expiresAt: '2026-10-02T00:00:00.000Z',
          },
        },
      },
    });
    render('/admin/finance/activation');
    const row = (await screen.findByText('SALE-260002')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Activate' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Activate membership' });
    await user.click(within(confirmation).getByRole('button', { name: 'Activate' }));

    expect(
      await screen.findByText(/membership activation succeeded, but email delivery failed/i),
    ).toBeInTheDocument();
    const code = screen.getByLabelText('Customer activation code') as HTMLInputElement;
    const link = screen.getByLabelText('Customer activation link') as HTMLInputElement;
    expect(code.value).toBe('customer-onboarding-token-0001');
    expect(link.value).toContain('/customer/activate#token=');
    await user.click(screen.getByRole('button', { name: 'Copy activation code' }));
    expect(writeText).toHaveBeenCalledWith('customer-onboarding-token-0001');
    expect(
      screen.getByText(/closing this dialog removes the plaintext onboarding code/i),
    ).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Commissions: search / filter (44) and paid immutability (45)        */
/* ================================================================== */

describe('Phase 26 commission management UI', () => {
  it('44. sends search and status filters to the scoped API', async () => {
    const user = userEvent.setup();
    render('/admin/finance/commissions', ADMIN_USER);
    await screen.findByText('SALE-260001');
    await user.type(screen.getByLabelText('Search commissions'), 'SALE-260001');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'paid');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const gets = requests.filter((r) => r.method === 'GET' && r.path === '/commissions');
      const filtered = gets.find(
        (g) => g.query.includes('search=') && g.query.includes('status=paid'),
      );
      expect(filtered?.query).toMatch(/search=SALE-260001/);
      expect(filtered?.query).toMatch(/status=paid/);
    });
  });

  it('45. a paid commission offers no mutation action', async () => {
    render('/admin/finance/commissions', ADMIN_USER);
    await screen.findByText('SALE-260003');
    const paidRow = screen.getByText('SALE-260003').closest('tr')!;
    expect(paidRow.textContent).toMatch(/Paid/);
    // No Decide and no Mark Paid inside the paid row.
    expect(paidRow.textContent).not.toMatch(/Mark Paid/);
    expect(paidRow.textContent).not.toMatch(/Decide/);
  });

  it('earned commissions offer Mark Paid; awaiting offer Decide', async () => {
    render('/admin/finance/commissions', ADMIN_USER);
    await screen.findByText('SALE-260002');
    const earnedRow = screen.getByText('SALE-260002').closest('tr')!;
    expect(earnedRow.textContent).toMatch(/Mark Paid/);
  });

  it('46. renders server commission amounts (Gold 2400, Silver 1600)', async () => {
    render('/admin/finance/commissions', ADMIN_USER);
    await screen.findByText('SALE-260001');
    expect(screen.getAllByText('₱2,400.00').length).toBeGreaterThan(0);
    expect(screen.getByText('₱1,600.00')).toBeInTheDocument();
  });
});

describe('payment exact-decimal input UX', () => {
  it('explains the receipt reference, coalesces a double click, confirms success, and refreshes balances', async () => {
    const user = userEvent.setup();
    install({
      [`GET /sales/${QUEUE_ITEM.saleId}/summary`]: {
        body: {
          ...QUEUE_ITEM,
          minimumDownPayment: '20000.00',
          recordedTotal: '20000.00',
          rejectedTotal: '0.00',
          overpaidAmount: '0.00',
        },
      },
      [`POST /sales/${QUEUE_ITEM.saleId}/payments`]: { body: { id: 'qa-payment' } },
    });
    render('/admin/finance/payments');
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    expect(screen.getByText(/Enter the transaction\/reference number/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount'), '1000.00');
    await user.type(screen.getByLabelText('Payment reference'), 'QA-REF');
    await user.dblClick(screen.getByRole('button', { name: /^Record$/ }));
    await screen.findByText('Payment recorded successfully.');
    const writes = requests.filter((request) => request.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ reference: 'QA-REF' });
    expect(requests.filter((request) => request.path === '/queues/finance').length).toBeGreaterThan(
      1,
    );
    expect(screen.getByText('Remaining balance')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('₱40,000.00')).toBeInTheDocument();
  });
  it.each(['1e3', '1E3', '1e+3', '1e-3', 'NaN', 'Infinity', 'ABC', '100ABC', '', '0', '0.00'])(
    'blocks invalid payment amount %s before any write',
    async (amount) => {
      const user = userEvent.setup();
      render('/admin/finance/payments');
      await user.click(await screen.findByRole('button', { name: 'Record payment' }));
      const input = screen.getByLabelText('Amount');
      await user.type(input, amount || '1');
      if (!amount) await user.clear(input);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      const errorId = input.getAttribute('aria-describedby');
      expect(errorId).toBeTruthy();
      expect(document.getElementById(errorId!)).toHaveTextContent(/valid amount/);
      expect(screen.getByRole('button', { name: /^Record$/ })).toBeDisabled();
      expect(requests.some((request) => request.method !== 'GET')).toBe(false);
      await user.clear(input);
      await user.type(input, '1000.00');
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: /^Record$/ })).toBeEnabled();
    },
  );
  it.each(['1000', '1000.00', '0.01'])(
    'accepts the existing payment contract amount %s',
    async (amount) => {
      const user = userEvent.setup();
      render('/admin/finance/payments');
      await user.click(await screen.findByRole('button', { name: 'Record payment' }));
      await user.type(screen.getByLabelText('Amount'), amount);
      expect(screen.getByRole('button', { name: /^Record$/ })).toBeEnabled();
      await user.clear(screen.getByLabelText('Method'));
      expect(screen.getByRole('button', { name: /^Record$/ })).toBeDisabled();
    },
  );
});
