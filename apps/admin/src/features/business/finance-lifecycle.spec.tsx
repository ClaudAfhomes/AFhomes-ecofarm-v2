/**
 * AFHomes Phase 26 finance UI.
 *
 * Proves the Finance queues and the Commission management screen render real
 * backend state (never mocks), with loading/empty/error handling, search and
 * status filtering, and per-state actions (a paid commission offers no
 * mutation).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { RecordPaymentDialog } from './BusinessFinanceQueuePage';
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
  tier: 'GOLD',
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
  activationBlocker: 'outstanding_balance',
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
  activationBlocker: null,
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

const RECEIPT_PATH = 'payments/receipts/sale-1/receipt.png';
const RECEIPT_GRANT = {
  receiptStoragePath: RECEIPT_PATH,
  uploadUrl: 'https://storage.test/storage/receipt-upload',
  expiresAt: '2026-11-11T12:00:00.000Z',
};
const receiptFile = (name = 'receipt.png', type = 'image/png') =>
  new File(['receipt-bytes'], name, { type });
/** Picks a receipt and waits until it is uploaded and the path is held. */
async function attachReceipt(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/Payment receipt/), receiptFile());
  await screen.findByText(/Uploaded: receipt\.png/);
}

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
  routes.set(`POST /sales/${QUEUE_ITEM.saleId}/payments/receipt-upload`, {
    status: 201,
    body: RECEIPT_GRANT,
  });
  routes.set('PUT /storage/receipt-upload', { body: {} });
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string, user: SessionUser = FINANCE_USER) =>
  renderWithProviders(<App />, { route, user });

/**
 * Row actions live behind the three-dots menu: open it, then pick an item.
 * Every queue row is also clickable — clicking opens its details directly.
 */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, recordNumber: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${recordNumber}` }));
}

async function pickMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('menuitem', { name }));
}

async function openRecordDialog(user: ReturnType<typeof userEvent.setup>) {
  await openRowMenu(user, QUEUE_ITEM.saleNumber);
  await pickMenuItem(user, 'Record & verify payment');
}

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
    const user = userEvent.setup();
    render('/admin/finance/payments', {
      ...FINANCE_USER,
      afHomesPermissions: FINANCE_USER.afHomesPermissions.map((permission) => ({
        ...permission,
        canUpdate: false,
      })),
    });
    await screen.findByText(QUEUE_ITEM.saleNumber);
    await openRowMenu(user, QUEUE_ITEM.saleNumber);
    expect(screen.getByRole('menuitem', { name: 'Record & verify payment' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Verify' })).toBeDisabled();
    await pickMenuItem(user, 'View details');
    const detail = within(screen.getByRole('dialog'));
    expect(detail.getByRole('button', { name: 'Verify payment' })).toBeDisabled();
    expect(detail.getByRole('button', { name: 'Record & verify payment' })).toBeDisabled();
    expect(requests.some((request) => request.method !== 'GET')).toBe(false);
  });
  it('41. shows a skeleton loading state while the queue is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render('/admin/finance/payments');
    expect(await screen.findByLabelText('Loading payment queue')).toBeInTheDocument();
    expect(screen.queryByText('Loading queue…')).toBeNull();
    // Even the table headers stay skeleton until the rows arrive.
    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(screen.queryByText('Record')).toBeNull();
  });

  it('42. shows an empty state when nothing awaits payment', async () => {
    install({ 'GET /queues/finance': list([]) });
    render('/admin/finance/payments');
    expect(await screen.findByText('Nothing to handle')).toBeInTheDocument();
  });

  it('shows a cap notice when the queue exceeds the page', async () => {
    install({
      'GET /queues/finance': {
        status: 200,
        body: { data: [QUEUE_ITEM], meta: { total: 3, limit: 200, offset: 0 } },
      },
    });
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    expect(screen.getByText('Queue capped')).toBeInTheDocument();
  });

  it('keeps the loaded rows on screen while the next search resolves', async () => {
    const user = userEvent.setup();
    // Slow searches, instant initial load: the settled search takes 800ms to
    // answer empty, so the previous page must cover the gap.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const [bare, query = ''] = url
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api\/v1/, '')
          .split('?');
        const method = init?.method ?? 'GET';
        requests.push({
          path: bare!,
          method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          query,
        });
        if (bare === '/queues/finance' && query.includes('search=')) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return new Response(
            JSON.stringify({ data: [], meta: { total: 0, limit: 200, offset: 0 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const route = routes.get(`${method} ${bare}`);
        if (!route) {
          return new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    await user.type(screen.getByLabelText('Search payments'), 'ZZZ');
    await waitFor(() => {
      expect(requests.some((r) => r.path === '/queues/finance' && r.query.includes('ZZZ'))).toBe(
        true,
      );
    });
    // While the slow search is in flight, the previous page stays — no skeleton.
    expect(screen.getByText('SALE-260001')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading payment queue')).toBeNull();
    // And the empty search result still lands afterwards.
    expect(
      await screen.findByText('No matching records.', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
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
    const user = userEvent.setup();
    render('/admin/finance/payments');
    // The server-sent exact-decimal strings, formatted without float math.
    expect(await screen.findByText('SALE-260001')).toBeInTheDocument();
    // The row carries the outstanding balance; frozen total and verified paid
    // live in the payment details.
    expect(screen.getByText('₱40,000.00')).toBeInTheDocument();
    await openRowMenu(user, QUEUE_ITEM.saleNumber);
    await pickMenuItem(user, 'View details');
    const detail = within(screen.getByRole('dialog'));
    expect(detail.getByText('₱60,000.00')).toBeInTheDocument();
    expect(detail.getAllByText('₱20,000.00').length).toBeGreaterThan(0);
    const get = requests.find((r) => r.method === 'GET' && r.path === '/queues/finance');
    expect(get).toBeDefined();
  });

  it('badges queue statuses capitalized, never snake_case', async () => {
    render('/admin/finance/payments');
    const row = (await screen.findByText('SALE-260001')).closest('tr')!;
    expect(within(row).getByText('Payment In Progress')).toBeInTheDocument();
    expect(within(row).getByText('Partially Paid')).toBeInTheDocument();
    expect(screen.queryByText('payment_in_progress')).toBeNull();
  });

  it('shows the sale lifecycle (Overdue) separately from payment progress', async () => {
    install({
      'GET /queues/finance': list([
        { ...QUEUE_ITEM, status: 'overdue' },
        {
          ...QUEUE_ITEM,
          saleId: 'bbbbbbbb-0000-4000-8000-000000002699',
          saleNumber: 'SALE-260099',
          status: 'payment_pending',
          verifiedTotal: '0.00',
          remainingBalance: '60000.00',
        },
      ]),
    });
    render('/admin/finance/payments');
    const overdue = (await screen.findByText('SALE-260001')).closest('tr')!;
    expect(within(overdue).getByText('Overdue')).toBeInTheDocument();
    expect(within(overdue).getByText('Partially Paid')).toBeInTheDocument();
    const unpaid = screen.getByText('SALE-260099').closest('tr')!;
    expect(within(unpaid).getByText('Awaiting Payment')).toBeInTheDocument();
    expect(within(unpaid).getByText('No Verified Payments')).toBeInTheDocument();
    expect(screen.getByText('Overdue: 1')).toBeInTheDocument();
  });

  it('filters by payment progress with the same words the Payment column shows', async () => {
    const user = userEvent.setup();
    install({
      'GET /queues/finance': list([
        QUEUE_ITEM,
        {
          ...QUEUE_ITEM,
          saleId: 'bbbbbbbb-0000-4000-8000-000000002698',
          saleNumber: 'SALE-260098',
          verifiedTotal: '60000.00',
          remainingBalance: '0.00',
          fullyPaid: true,
        },
      ]),
    });
    render('/admin/finance/payments');
    await screen.findByText('SALE-260098');
    const filter = screen.getByLabelText('Filter by payment progress');
    expect(within(filter).getByRole('option', { name: 'Fully Paid' })).toBeInTheDocument();
    await user.selectOptions(filter, 'full');
    expect(screen.queryByText('SALE-260001')).toBeNull();
    const paid = screen.getByText('SALE-260098').closest('tr')!;
    expect(within(paid).getByText('Fully Paid')).toBeInTheDocument();
    await user.selectOptions(filter, 'partial');
    expect(screen.queryByText('SALE-260098')).toBeNull();
    expect(screen.getByText('SALE-260001')).toBeInTheDocument();
  });

  it('shows the VIP tier from the authoritative tier field, not the product name', async () => {
    install({
      'GET /queues/finance': list([{ ...QUEUE_ITEM, productName: 'GOLD Promo Plan', tier: 'BRONZE' }]),
    });
    render('/admin/finance/payments');
    const row = (await screen.findByText('SALE-260001')).closest('tr')!;
    expect(within(row).getByText('BRONZE')).toBeInTheDocument();
    expect(within(row).queryByText('GOLD')).toBeNull();
  });

  it('opens payment details by clicking the row', async () => {
    const user = userEvent.setup();
    render('/admin/finance/payments');
    const row = await screen.findByRole('link', {
      name: 'Record a payment for SALE-260001',
    });
    await user.click(row);
    expect(await screen.findByText('Within 7 days')).toBeInTheDocument();
  });

  it('opens payment details from the row menu', async () => {
    const user = userEvent.setup();
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    await openRowMenu(user, QUEUE_ITEM.saleNumber);
    await pickMenuItem(user, 'View details');
    expect(await screen.findByText('Within 7 days')).toBeInTheDocument();
  });

  it('shows first verified payment and deadline status from the server', async () => {
    const user = userEvent.setup();
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    await openRowMenu(user, QUEUE_ITEM.saleNumber);
    await pickMenuItem(user, 'View details');
    // First verified instant and the derived 7-day state are displayed.
    expect(screen.getByText('Within 7 days')).toBeInTheDocument();
  });

  it('skeletonizes the payment timeline while ledger rows load', async () => {
    const user = userEvent.setup();
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    // Hang every fetch from here on: the loaded queue and its figures stay,
    // but the ledger the timeline needs never resolves.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    await openRowMenu(user, QUEUE_ITEM.saleNumber);
    await pickMenuItem(user, 'View details');
    expect(await screen.findByText('Payment timeline')).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Loading payments' })).toBeInTheDocument();
    expect(screen.queryByText('No payments recorded.')).toBeNull();
  });

  it('skeletonizes the record dialog while sale figures load', async () => {
    const user = userEvent.setup();
    render('/admin/finance/payments');
    await screen.findByText('SALE-260001');
    // Hang every fetch from here on: the loaded queue stays, but the sale
    // summary the dialog needs never resolves.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    await openRecordDialog(user);
    expect(await screen.findByRole('status', { name: 'Loading payment form' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Activation queue                                                    */
/* ================================================================== */

describe('Phase 26 activation queue', () => {
  it('shows fully-paid rows as eligible with deadline context', async () => {
    render('/admin/finance/activation');
    const row = (await screen.findByText('SALE-260002')).closest('tr')!;
    expect(within(row).getByText('Eligible')).toBeInTheDocument();
    expect(within(row).getByText('Payment Verified')).toBeInTheDocument();
    expect(within(row).getByText('Fully Paid')).toBeInTheDocument();
    expect(within(row).getByText('GOLD')).toBeInTheDocument();
  });

  it('never calls a fully paid but non-activatable sale underpaid', async () => {
    install({
      'GET /queues/activation': list([
        {
          ...ACTIVATION_ITEM,
          status: 'payment_in_progress',
          activatable: false,
          activationBlocker: 'not_ready',
        },
      ]),
    });
    render('/admin/finance/activation');
    const row = (await screen.findByText('SALE-260002')).closest('tr')!;
    expect(within(row).getByText('Sale Not Ready')).toBeInTheDocument();
    expect(within(row).getByText('Fully Paid')).toBeInTheDocument();
    expect(within(row).queryByText('Outstanding Balance')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(screen.getByText('Not eligible: 1')).toBeInTheDocument();
    expect(screen.queryByText(/Short/)).toBeNull();
  });

  it('identifies an already activated sale and an underpaid one by their real reason', async () => {
    install({
      'GET /queues/activation': list([
        { ...ACTIVATION_ITEM, status: 'active', activatable: false, activationBlocker: 'already_active' },
        {
          ...ACTIVATION_ITEM,
          saleId: 'bbbbbbbb-0000-4000-8000-000000002697',
          saleNumber: 'SALE-260097',
          verifiedTotal: '40000.00',
          remainingBalance: '20000.00',
          fullyPaid: false,
          activatable: false,
          activationBlocker: 'outstanding_balance',
        },
      ]),
    });
    render('/admin/finance/activation');
    const active = (await screen.findByText('SALE-260002')).closest('tr')!;
    expect(within(active).getByText('Already Activated')).toBeInTheDocument();
    expect(within(active).getByText('Active')).toBeInTheDocument();
    const short = screen.getByText('SALE-260097').closest('tr')!;
    expect(within(short).getByText('Outstanding Balance')).toBeInTheDocument();
    expect(within(short).getByText('Partially Paid')).toBeInTheDocument();
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

/**
 * Commission qualification lives in Commissions ONLY.
 *
 * A commission awaiting final qualification is an explicit, audited, permission
 * gated decision. Rendering it inside the Activation Queue duplicated the
 * workflow and left staff unsure which screen owned it.
 */
describe('commission qualification ownership', () => {
  const AWAITING = {
    id: '99990000-0000-4000-8000-000000002699',
    saleId: 'bbbbbbbb-0000-4000-8000-000000002699',
    saleNumber: 'SALE-QUALIFY',
    beneficiaryType: 'staff',
    beneficiaryName: 'Sam Seller',
    rate: '0.04',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'final_qualification_pending',
    qualificationNotes: null,
    qualifiedAt: null,
    earnedAt: null,
    paidAt: null,
    createdAt: '2026-09-27T10:00:00.000Z',
  };

  it('keeps the awaiting-qualification commission OUT of the Activation Queue', async () => {
    install({ 'GET /commissions': list([AWAITING]) });
    render('/admin/finance/activation', ADMIN_USER);
    await screen.findByText(ACTIVATION_ITEM.saleNumber);
    expect(screen.queryByText('Commissions awaiting final qualification')).not.toBeInTheDocument();
    expect(screen.queryByText('SALE-QUALIFY')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decide' })).not.toBeInTheDocument();
  });

  it('offers the qualification action on the Commissions page instead', async () => {
    install({ 'GET /commissions': list([AWAITING]) });
    render('/admin/finance/commissions', ADMIN_USER);
    const row = (await screen.findByText('SALE-QUALIFY')).closest('tr')!;
    expect(row.textContent).toMatch(/Awaiting final qualification/);
    expect(within(row).getByRole('button', { name: 'Decide' })).toBeEnabled();
  });

  it('lists recorded progress steps in order and flags only rows needing a decision', async () => {
    install({
      'GET /commissions': list([
        AWAITING,
        {
          ...AWAITING,
          id: '99990000-0000-4000-8000-000000002700',
          saleNumber: 'SALE-PAIDOUT',
          status: 'paid',
          qualifiedAt: '2026-09-28T10:00:00.000Z',
          earnedAt: '2026-09-28T10:00:00.000Z',
          paidAt: '2026-09-30T10:00:00.000Z',
        },
        {
          ...AWAITING,
          id: '99990000-0000-4000-8000-000000002701',
          saleNumber: 'SALE-VOIDED',
          status: 'cancelled',
          qualifiedAt: '2026-09-28T10:00:00.000Z',
        },
      ]),
    });
    render('/admin/finance/commissions', ADMIN_USER);
    const steps = (sale: string) =>
      within(screen.getByText(sale).closest('tr')!)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('span')?.textContent);

    const awaitingRow = (await screen.findByText('SALE-QUALIFY')).closest('tr')!;
    expect(steps('SALE-PAIDOUT')).toEqual(['Created', 'Qualified', 'Earned', 'Paid']);
    expect(steps('SALE-VOIDED')).toEqual(['Created', 'Cancelled']);
    expect(awaitingRow).toHaveAttribute('data-attention');
    expect(screen.getByText('SALE-PAIDOUT').closest('tr')).not.toHaveAttribute('data-attention');
  });
});

/* ================================================================== */
/* Record & verify payment: one flow                                   */
/* ================================================================== */

const NEW_PAYMENT_ID = 'cccccccc-0000-4000-8000-000000009901';
const SUMMARY_PATH = `GET /sales/${QUEUE_ITEM.saleId}/summary`;
const LEDGER_PATH = `GET /sales/${QUEUE_ITEM.saleId}/payments`;
const RECORD_PATH = `POST /sales/${QUEUE_ITEM.saleId}/payments`;
const VERIFY_PATH = `POST /payments/${NEW_PAYMENT_ID}/verify`;

const INSTALLMENT_SUMMARY = {
  ...QUEUE_ITEM,
  paymentScheme: 'installment_4_month',
  cashPrice: '100000.00',
  reservationFee: '10000.00',
  requiredInitial: '40000.00',
  installmentMonths: 12,
  monthlyAmount: '5000.00',
  verifiedTotal: '0.00',
  remainingBalance: '100000.00',
  minimumDownPayment: '40000.00',
  recordedTotal: '0.00',
  rejectedTotal: '0.00',
  overpaidAmount: '0.00',
};
const ledgerRow = (over: Record<string, unknown> = {}) => ({
  id: 'cccccccc-0000-4000-8000-000000009800',
  saleId: QUEUE_ITEM.saleId,
  paymentNumber: 'AF-PAY-0001',
  customerId: QUEUE_ITEM.customerId,
  amount: '10000.00',
  paymentType: 'installment',
  method: 'bank_transfer',
  reference: null,
  notes: null,
  status: 'verified',
  rejectionReason: null,
  recordedBy: ADMIN_USER.id,
  verifiedBy: ADMIN_USER.id,
  paymentPurpose: 'reservation_fee',
  recordedAt: '2026-10-08T00:00:00.000Z',
  verifiedAt: '2026-10-08T01:00:00.000Z',
  ...over,
});
const VERIFY_RESULT = {
  saleId: QUEUE_ITEM.saleId,
  status: 'payment_in_progress',
  verifiedTotal: '10000.00',
  remainingBalance: '90000.00',
  fullyPaid: false,
  spotCashDeadline: null,
};
function installSale(
  ledger: unknown[] = [],
  summary: Record<string, unknown> = INSTALLMENT_SUMMARY,
  over: Record<string, Route> = {},
) {
  install({
    [SUMMARY_PATH]: { body: summary },
    [LEDGER_PATH]: list(ledger),
    [RECORD_PATH]: { status: 201, body: { id: NEW_PAYMENT_ID } },
    [VERIFY_PATH]: { body: VERIFY_RESULT },
    ...over,
  });
}
const writes = () => requests.filter((r) => r.method === 'POST' && !r.path.endsWith('/receipt-upload'));
const nextButton = () => screen.getByRole('button', { name: 'Next' });
const purposeSelect = () => screen.findByRole('combobox', { name: 'Payment is for' });
const purposeLabels = async () =>
  within(await purposeSelect())
    .getAllByRole('option')
    .map((o) => o.textContent);

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:proof');
  URL.revokeObjectURL = vi.fn();
});

describe('payment queue next-step button', () => {
  it('shows one primary button that opens the dialog pre-loaded with that purpose', async () => {
    const user = userEvent.setup();
    installSale([ledgerRow()], INSTALLMENT_SUMMARY, {
      'GET /queues/finance': list([
        { ...QUEUE_ITEM, ...INSTALLMENT_SUMMARY, verifiedTotal: '10000.00', remainingBalance: '90000.00' },
      ]),
    });
    render('/admin/finance/payments');
    const row = (await screen.findByText('SALE-260001')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Record down payment' }));
    expect(await screen.findByRole('combobox', { name: 'Payment is for' })).toHaveValue(
      'contractual_down_payment',
    );
    expect(screen.getByLabelText('Amount')).toHaveValue('30,000.00');
  });
});

describe('record & verify: purposes and prefill', () => {
  it('offers the reservation payment first and pre-fills each purpose', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await openRecordDialog(user);
    expect(await purposeLabels()).toEqual(['Reservation payment', 'Down payment']);
    expect(screen.getByLabelText('Amount')).toHaveValue('10,000.00');
    await user.selectOptions(await purposeSelect(), 'contractual_down_payment');
    expect(screen.getByLabelText('Amount')).toHaveValue('40,000.00');
  });

  it('after a verified reservation fee only the remaining down payment is offered', async () => {
    const user = userEvent.setup();
    installSale([ledgerRow()]);
    render('/admin/finance/payments');
    await openRecordDialog(user);
    expect(await purposeLabels()).toEqual(['Down payment']);
    expect(screen.getByLabelText('Amount')).toHaveValue('30,000.00');
  });

  it('a pending reservation fee also blocks a second one', async () => {
    const user = userEvent.setup();
    installSale([ledgerRow({ status: 'recorded', verifiedAt: null, verifiedBy: null })]);
    render('/admin/finance/payments');
    await openRecordDialog(user);
    expect(await purposeLabels()).toEqual(['Down payment']);
  });

  it('after the down payment: monthly installment (editable) and a locked full payment', async () => {
    const user = userEvent.setup();
    installSale([
      ledgerRow(),
      ledgerRow({
        id: 'cccccccc-0000-4000-8000-000000009801',
        amount: '30000.00',
        paymentPurpose: 'contractual_down_payment',
        paymentType: 'down_payment',
      }),
    ]);
    render('/admin/finance/payments');
    await openRecordDialog(user);
    expect(await purposeLabels()).toEqual(['Monthly installment', 'Full payment (remaining balance)']);
    expect(screen.getByLabelText('Amount')).toHaveValue('5,000.00');
    expect(screen.getByLabelText('Amount')).not.toHaveAttribute('readonly');
    await user.selectOptions(await purposeSelect(), 'contractual_full');
    expect(screen.getByLabelText('Amount')).toHaveValue('60,000.00');
    expect(screen.getByLabelText('Amount')).toHaveAttribute('readonly');
  });

  it('offers nothing when the purchase is fully committed', async () => {
    const user = userEvent.setup();
    installSale([
      ledgerRow({ amount: '100000.00', paymentPurpose: 'contractual_full', paymentType: 'full' }),
    ]);
    render('/admin/finance/payments');
    await openRecordDialog(user);
    expect(await screen.findByText(/No payment can be recorded/)).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });

  it.each(['1e3', '1E3', 'NaN', 'Infinity', 'ABC', '100ABC', '0', '0.00', '10000.01'])(
    'blocks invalid amount %s before the next step',
    async (amount) => {
      const user = userEvent.setup();
      installSale();
      render('/admin/finance/payments');
      await openRecordDialog(user);
      const input = await screen.findByLabelText('Amount');
      await user.clear(input);
      await user.type(input, amount);
      expect(nextButton()).toBeDisabled();
      expect(writes()).toHaveLength(0);
      await user.clear(input);
      await user.type(input, '10000.00');
      expect(nextButton()).toBeEnabled();
    },
  );
});

describe('record & verify: proof upload', () => {
  async function toProof(user: ReturnType<typeof userEvent.setup>) {
    await openRecordDialog(user);
    await purposeSelect();
    await user.click(nextButton());
  }

  it('keeps Next disabled until a receipt is uploaded', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await toProof(user);
    expect(screen.getByLabelText(/Payment receipt/)).toBeRequired();
    expect(nextButton()).toBeDisabled();
    await attachReceipt(user);
    expect(nextButton()).toBeEnabled();
  });

  it('replacing the file requests a new grant and re-uploads', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await toProof(user);
    await attachReceipt(user);
    await user.upload(
      screen.getByLabelText(/Payment receipt/),
      receiptFile('second.pdf', 'application/pdf'),
    );
    await screen.findByText(/Uploaded: second\.pdf/);
    const grants = requests.filter((r) => r.path.endsWith('/payments/receipt-upload'));
    expect(grants.map((g) => g.body)).toEqual([
      { contentType: 'image/png', byteSize: 13 },
      { contentType: 'application/pdf', byteSize: 13 },
    ]);
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(2);
  });

  it('refuses a wrong type or an oversize file before any request', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await toProof(user);
    const input = screen.getByLabelText(/Payment receipt/);
    fireEvent.change(input, { target: { files: [receiptFile('x.gif', 'image/gif')] } });
    expect(await screen.findByText('Receipt must be a JPEG, PNG or PDF file.')).toBeInTheDocument();
    const big = receiptFile('big.png');
    Object.defineProperty(big, 'size', { value: 10_485_761 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/at most 10 MB/)).toBeInTheDocument();
    expect(requests.some((r) => r.path.endsWith('/receipt-upload') || r.method === 'PUT')).toBe(
      false,
    );
    expect(nextButton()).toBeDisabled();
  });

  it('shows an upload failure and stays blocked', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, { 'PUT /storage/receipt-upload': { status: 500, body: {} } });
    render('/admin/finance/payments');
    await toProof(user);
    await user.upload(screen.getByLabelText(/Payment receipt/), receiptFile());
    expect(await screen.findByText('The file could not be uploaded. Try again.')).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });
});

describe('record & verify: review, record then verify', () => {
  async function toReview(user: ReturnType<typeof userEvent.setup>, ref = 'QA-REF') {
    await openRecordDialog(user);
    await purposeSelect();
    await user.type(screen.getByLabelText('Payment reference(Optional)'), ref);
    await user.click(nextButton());
    await attachReceipt(user);
    await user.click(nextButton());
    await screen.findByRole('region', { name: 'Payment review' });
  }

  it('shows every detail, the purchase figures and the proof next to Back / Verify and record', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await toReview(user);
    const review = within(screen.getByRole('region', { name: 'Payment review' }));
    expect(review.getByText('Ana R Reyes')).toBeInTheDocument();
    expect(review.getByText('SALE-260001')).toBeInTheDocument();
    expect(review.getByText('Reservation payment')).toBeInTheDocument();
    expect(review.getByText('QA-REF')).toBeInTheDocument();
    const dd = (label: string) => review.getByText(label).nextElementSibling!;
    expect(dd('Amount')).toHaveTextContent('10,000.00');
    expect(dd('Price')).toHaveTextContent('100,000.00');
    expect(dd('Verified so far')).toHaveTextContent('0.00');
    expect(dd('Balance before')).toHaveTextContent('100,000.00');
    expect(dd('Balance after')).toHaveTextContent('90,000.00');
    expect(screen.getByRole('img', { name: 'Payment proof preview' })).toHaveAttribute(
      'src',
      'blob:proof',
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Verify and record' })).toBeEnabled();
    expect(writes()).toHaveLength(0);
  });

  it('records with the purpose and receipt, then verifies the returned payment once', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, {
      [LEDGER_PATH]: list([]),
    });
    render('/admin/finance/payments');
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Verify and record' }));
    expect(await screen.findByText('Payment Recorded and Verified')).toBeInTheDocument();
    const [record, verify, ...rest] = writes();
    expect(rest).toHaveLength(0);
    expect(record?.path).toBe(`/sales/${QUEUE_ITEM.saleId}/payments`);
    expect(record?.body).toMatchObject({
      amount: '10000.00',
      paymentPurpose: 'reservation_fee',
      paymentType: 'installment',
      method: 'bank_transfer',
      reference: 'QA-REF',
      receiptStoragePath: RECEIPT_PATH,
    });
    expect(typeof (record?.body as { requestId?: string }).requestId).toBe('string');
    expect(verify?.path).toBe(`/payments/${NEW_PAYMENT_ID}/verify`);
    expect(verify?.body).toEqual({ decision: 'verified' });
    expect(
      requests.filter((r) => r.path === '/queues/finance').length,
    ).toBeGreaterThan(1);
  });

  it('a failed verification leaves it Recorded and Retry verification never records twice', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, {
      [VERIFY_PATH]: {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'Verification is temporarily unavailable.' } },
      },
    });
    render('/admin/finance/payments');
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Verify and record' }));
    expect(await screen.findByText('Recorded, not verified')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    const alert = (await screen.findAllByRole('alert')).map((a) => a.textContent).join(' ');
    expect(alert).toMatch(/recorded but NOT verified/);
    expect(alert).toMatch(/remains in the queue as Recorded/);
    expect(writes().map((r) => r.path)).toEqual([
      `/sales/${QUEUE_ITEM.saleId}/payments`,
      `/payments/${NEW_PAYMENT_ID}/verify`,
    ]);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    // The server recovers: retry verifies the SAME payment, no second record.
    routes.set(VERIFY_PATH, { body: VERIFY_RESULT });
    await user.click(screen.getByRole('button', { name: 'Retry verification' }));
    expect(await screen.findByText('Payment Recorded and Verified')).toBeInTheDocument();
    expect(writes().map((r) => r.path)).toEqual([
      `/sales/${QUEUE_ITEM.saleId}/payments`,
      `/payments/${NEW_PAYMENT_ID}/verify`,
      `/payments/${NEW_PAYMENT_ID}/verify`,
    ]);
  });

  it('shows a safe domain error and records nothing more when the record is refused', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, {
      [RECORD_PATH]: {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'That reference already exists.' } },
      },
    });
    render('/admin/finance/payments');
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Verify and record' }));
    await screen.findByText('Unable to Record Payment');
    expect(screen.getByText('That reference already exists.')).toBeInTheDocument();
    expect(writes().map((r) => r.path)).toEqual([`/sales/${QUEUE_ITEM.saleId}/payments`]);
    expect(screen.queryByText('Recorded, not verified')).toBeNull();
  });
});

describe('record & verify: reservation origin', () => {
  const RES_ID = 'dddddddd-0000-4000-8000-000000002601';
  const RES_PAYMENT_ID = 'dddddddd-0000-4000-8000-000000009901';
  const resRow = (over: Record<string, unknown> = {}) => ({
    ...ledgerRow({ saleId: null }),
    origin: 'reservation',
    reservationId: RES_ID,
    saleId: null,
    customerId: QUEUE_ITEM.customerId,
    ...over,
  });
  const finance = (payments: unknown[]) => ({
    reservationId: RES_ID,
    reservationNumber: 'AF-RSV-0001',
    customerApplicationId: 'eeeeeeee-0000-4000-8000-000000002601',
    applicationNumber: 'AF-APP-0001',
    purchaseTermsId: 'eeeeeeee-0000-4000-8000-000000002602',
    sellerStaffId: ADMIN_USER.id,
    sellerName: 'Seller',
    tier: 'GOLD',
    customerId: QUEUE_ITEM.customerId,
    customerName: 'Ana R Reyes',
    productName: 'Gold',
    status: 'executed',
    applicationStatus: 'approved',
    paymentScheme: 'installment_4_month',
    totalPrice: '100000.00',
    reservationFee: '10000.00',
    requiredInitial: '40000.00',
    installmentMonths: 12,
    monthlyAmount: '5000.00',
    validityMonths: 84,
    verifiedTotal: '0.00',
    remainingBalance: '100000.00',
    overpaidAmount: '0.00',
    fullyPaid: false,
    recordedPaymentCount: payments.length,
    firstVerifiedPayment: null,
    spotCashDeadline: null,
    saleId: null,
    payments,
  });

  it('finds the just-recorded payment in the finance summary and verifies it via the reservation endpoint', async () => {
    const user = userEvent.setup();
    const recorded = resRow({
      id: RES_PAYMENT_ID,
      status: 'recorded',
      verifiedAt: null,
      verifiedBy: null,
      reference: 'QA-REF',
      recordedAt: '2026-11-11T00:00:00.000Z',
    });
    install({
      [`GET /official-forms/reservations/${RES_ID}/finance`]: { body: finance([]) },
      [`GET /official-forms/reservations/${RES_ID}/payments`]: list([]),
      [`POST /official-forms/reservations/${RES_ID}/payments/receipt-upload`]: {
        status: 201,
        body: RECEIPT_GRANT,
      },
      [`POST /official-forms/reservations/${RES_ID}/payments`]: {
        status: 201,
        body: finance([recorded]),
      },
      [`POST /official-forms/reservations/${RES_ID}/payments/${RES_PAYMENT_ID}/verify`]: {
        body: finance([{ ...recorded, status: 'verified' }]),
      },
    });
    renderWithProviders(
      <RecordPaymentDialog
        saleId={RES_ID}
        origin="reservation"
        customerName="Ana R Reyes"
        recordLabel="AF-RSV-0001"
        onDone={async () => {}}
        onClose={() => {}}
      />,
      { route: '/admin/finance/payments', user: FINANCE_USER },
    );
    await purposeSelect();
    await user.click(nextButton());
    await attachReceipt(user);
    await user.click(nextButton());
    await user.click(await screen.findByRole('button', { name: 'Verify and record' }));
    expect(await screen.findByText('Payment Recorded and Verified')).toBeInTheDocument();
    const [record, verify] = writes();
    expect(record?.path).toBe(`/official-forms/reservations/${RES_ID}/payments`);
    expect(record?.body).toMatchObject({
      paymentPurpose: 'reservation_fee',
      paymentType: 'installment',
      receiptStoragePath: RECEIPT_PATH,
    });
    expect(verify?.path).toBe(
      `/official-forms/reservations/${RES_ID}/payments/${RES_PAYMENT_ID}/verify`,
    );
    expect(verify?.body).toMatchObject({ decision: 'verified' });
    expect(
      requests.some(
        (r) => r.path === `/official-forms/reservations/${RES_ID}/payments/receipt-upload`,
      ),
    ).toBe(true);
  });
});

describe('verifying or rejecting an already-recorded payment', () => {
  const PENDING_ID = 'cccccccc-0000-4000-8000-000000009777';
  it('still verifies and rejects (with a reason of at least 5 characters) from the queue', async () => {
    const user = userEvent.setup();
    installSale(
      [ledgerRow({ id: PENDING_ID, status: 'recorded', verifiedAt: null, verifiedBy: null })],
      INSTALLMENT_SUMMARY,
      { [`POST /payments/${PENDING_ID}/verify`]: { body: VERIFY_RESULT } },
    );
    render('/admin/finance/payments');
    await openRowMenu(user, QUEUE_ITEM.saleNumber);
    await pickMenuItem(user, 'Verify');
    await screen.findByText(/awaiting verification/);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText(/Reason/), 'bad');
    expect(screen.getByRole('button', { name: 'Confirm reject' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'dly');
    expect(screen.getByRole('button', { name: 'Confirm reject' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }));
    await waitFor(() =>
      expect(writes().at(-1)?.body).toEqual({ decision: 'rejected', reason: 'baddly' }),
    );
  });
});

describe('activation queue permission and count', () => {
  it('disables Activate without finance.card_activation update', async () => {
    render('/admin/finance/activation', {
      ...FINANCE_USER,
      afHomesPermissions: FINANCE_USER.afHomesPermissions.map((p) =>
        p.moduleKey === 'finance.card_activation' ? { ...p, canUpdate: false } : p,
      ),
    });
    const row = (await screen.findByText('SALE-260002')).closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Activate' })).toBeDisabled();
  });

  it('enables Activate with the permission and requests an explicit limit', async () => {
    render('/admin/finance/activation');
    const row = (await screen.findByText('SALE-260002')).closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Activate' })).toBeEnabled();
    const request = requests.find((r) => r.path === '/queues/activation');
    expect(request?.query).toContain('limit=200');
  });

  it('says how many of the total are shown instead of silently capping', async () => {
    install({
      'GET /queues/activation': {
        status: 200,
        body: { data: [ACTIVATION_ITEM], meta: { total: 73 } },
      },
    });
    render('/admin/finance/activation');
    expect(await screen.findByText(/Showing 1 of 73/)).toBeInTheDocument();
    expect(screen.getByText('Total: 73')).toBeInTheDocument();
  });
});

describe('activate now after the final payment', () => {
  const fullyPaidResult = { ...VERIFY_RESULT, fullyPaid: true, remainingBalance: '0.00' };
  async function recordFinalPayment(user: ReturnType<typeof userEvent.setup>) {
    await openRecordDialog(user);
    await purposeSelect();
    await user.click(nextButton());
    await attachReceipt(user);
    await user.click(nextButton());
    await user.click(await screen.findByRole('button', { name: 'Verify and record' }));
  }

  it('offers Activate now, which opens that sale’s manual activation dialog', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, {
      [VERIFY_PATH]: { body: fullyPaidResult },
      'GET /queues/activation': list([
        { ...ACTIVATION_ITEM, saleId: QUEUE_ITEM.saleId, saleNumber: 'SALE-260001' },
      ]),
    });
    render('/admin/finance/payments');
    await recordFinalPayment(user);
    expect(await screen.findByText(/now fully paid\. Activate the membership now\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate now' }));
    // The activation dialog opens for that sale; nothing is activated until confirmed.
    expect(await screen.findByRole('dialog', { name: 'Activate membership' })).toBeInTheDocument();
    expect(requests.some((r) => r.path.endsWith('/activate'))).toBe(false);
  });

  it('shows no Activate now without finance.card_activation update', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, { [VERIFY_PATH]: { body: fullyPaidResult } });
    render('/admin/finance/payments', {
      ...FINANCE_USER,
      afHomesPermissions: FINANCE_USER.afHomesPermissions.map((p) =>
        p.moduleKey === 'finance.card_activation' ? { ...p, canUpdate: false } : p,
      ),
    });
    await recordFinalPayment(user);
    expect(await screen.findByText('Payment Recorded and Verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate now' })).toBeNull();
  });

  it('a payment that leaves a balance only confirms', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await recordFinalPayment(user);
    expect(await screen.findByText('Payment Recorded and Verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate now' })).toBeNull();
  });
});

/* ================================================================== */
/* Finance phase 2: receipt details, duplicate hold, adjustments       */
/* ================================================================== */

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const MATCHES_PATH = `GET /sales/payments/${NEW_PAYMENT_ID}/reference-matches`;
const REVIEW_PATH = `POST /sales/payments/${NEW_PAYMENT_ID}/duplicate-review`;
const HOLD_MESSAGE =
  'This bank reference or OR number already appears on another contract. Add a reason to continue.';

describe('finance phase 2: receipt details', () => {
  async function toDetails(user: ReturnType<typeof userEvent.setup>) {
    await openRecordDialog(user);
    await purposeSelect();
  }

  it('sends OR number, payment date and payer, and shows them on the review step', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await toDetails(user);
    expect(screen.getByLabelText('Payment date')).toHaveValue(localToday());
    await user.type(screen.getByLabelText('OR number(Optional)'), 'OR-1234');
    await user.type(screen.getByLabelText('Paid by(Optional)'), 'Juan dela Cruz');
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-01' } });
    await user.click(nextButton());
    await attachReceipt(user);
    await user.click(nextButton());
    const review = within(await screen.findByRole('region', { name: 'Payment review' }));
    expect(review.getByText('OR-1234')).toBeInTheDocument();
    expect(review.getByText('2026-10-01')).toBeInTheDocument();
    expect(review.getByText('Juan dela Cruz')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verify and record' }));
    await screen.findByText('Payment Recorded and Verified');
    expect(writes()[0]?.body).toMatchObject({
      orNumber: 'OR-1234',
      paidOn: '2026-10-01',
      paidByName: 'Juan dela Cruz',
    });
  });

  it('blocks a future payment date', async () => {
    const user = userEvent.setup();
    installSale();
    render('/admin/finance/payments');
    await toDetails(user);
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2999-01-01' } });
    expect(await screen.findByText('The payment date cannot be in the future.')).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });
});

describe('finance phase 2: duplicate hold', () => {
  it('keeps the payment Recorded, requires a reason, then verifies the SAME payment', async () => {
    const user = userEvent.setup();
    installSale([], INSTALLMENT_SUMMARY, {
      [VERIFY_PATH]: {
        status: 409,
        body: { error: { code: 'PAYMENT_REFERENCE_REVIEW_REQUIRED', message: HOLD_MESSAGE } },
      },
      [MATCHES_PATH]: list([
        {
          paymentId: 'cccccccc-0000-4000-8000-000000009955',
          saleId: 'bbbbbbbb-0000-4000-8000-000000002699',
          reservationId: null,
          amount: '7500.00',
          status: 'verified',
          reference: 'QA-REF',
          orNumber: 'OR-77',
          recordedAt: '2026-10-02T00:00:00.000Z',
        },
      ]),
      [REVIEW_PATH]: { body: { id: NEW_PAYMENT_ID } },
    });
    render('/admin/finance/payments');
    await openRecordDialog(user);
    await purposeSelect();
    await user.type(screen.getByLabelText('Payment reference(Optional)'), 'QA-REF');
    await user.click(nextButton());
    await attachReceipt(user);
    await user.click(nextButton());
    await user.click(await screen.findByRole('button', { name: 'Verify and record' }));

    const panel = within(await screen.findByRole('region', { name: 'Duplicate review' }));
    expect(await panel.findByText(/7,500\.00/)).toBeInTheDocument();
    expect(panel.getByText(/OR OR-77/)).toBeInTheDocument();
    const save = panel.getByRole('button', { name: 'Save reason and verify' });
    expect(save).toBeDisabled();
    await user.type(panel.getByLabelText('Why is this allocation correct?'), 'abc');
    expect(save).toBeDisabled();
    await user.type(panel.getByLabelText('Why is this allocation correct?'), 'de - split transfer');

    routes.set(VERIFY_PATH, { body: VERIFY_RESULT });
    await user.click(save);
    expect(await screen.findByText('Payment Recorded and Verified')).toBeInTheDocument();
    expect(writes().map((r) => [r.path, r.body])).toEqual([
      [`/sales/${QUEUE_ITEM.saleId}/payments`, expect.anything()],
      [`/payments/${NEW_PAYMENT_ID}/verify`, { decision: 'verified' }],
      [
        `/sales/payments/${NEW_PAYMENT_ID}/duplicate-review`,
        { duplicateReviewNote: 'abcde - split transfer' },
      ],
      [`/payments/${NEW_PAYMENT_ID}/verify`, { decision: 'verified' }],
    ]);
  });
});

describe('finance phase 2: propose adjustment', () => {
  const VERIFIED_ID = 'cccccccc-0000-4000-8000-000000009800';
  const ADJ_PATH = `/sales/payments/${VERIFIED_ID}/adjustments`;

  async function openProposal(user: ReturnType<typeof userEvent.setup>) {
    installSale([ledgerRow()], INSTALLMENT_SUMMARY, {
      [`GET ${ADJ_PATH}`]: list([]),
      [`POST ${ADJ_PATH}`]: { status: 201, body: { id: 'adj-1' } },
    });
    render('/admin/finance/payments');
    await user.click(await screen.findByRole('link', { name: 'Record a payment for SALE-260001' }));
    await user.click(await screen.findByRole('button', { name: 'Propose adjustment' }));
    return within(await screen.findByRole('dialog', { name: 'Propose adjustment' }));
  }

  it('prefills and caps the amount, posts the proposal and shows awaiting approval', async () => {
    const user = userEvent.setup();
    const dialog = await openProposal(user);
    expect(dialog.getByText('A proposal does not change the balance.')).toBeInTheDocument();
    const amount = dialog.getByLabelText('Amount');
    expect(amount).toHaveValue('10000.00');
    const propose = dialog.getByRole('button', { name: 'Propose' });
    await user.clear(amount);
    await user.type(amount, '10000.01');
    expect(propose).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '4000.00');
    await user.type(dialog.getByLabelText('Reason'), 'Bank reversed the transfer');
    expect(propose).toBeEnabled();
    await user.click(propose);
    expect(await dialog.findByText('Proposed — awaiting approval')).toBeInTheDocument();
    const post = requests.find((r) => r.method === 'POST' && r.path === ADJ_PATH);
    expect(post?.body).toEqual({
      kind: 'reversal',
      amount: '4000.00',
      reason: 'Bank reversed the transfer',
      effectiveDate: localToday(),
    });
  });

  it('offers no approve control anywhere', async () => {
    const user = userEvent.setup();
    await openProposal(user);
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });
});
