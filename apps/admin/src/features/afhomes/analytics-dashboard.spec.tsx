/**
 * AF Homes Phase 29 dashboard presentation.
 *
 * Renders the REAL role dashboard through the REAL router against a mocked
 * `/analytics` endpoint: loading skeletons, populated finance facts, empty
 * trend/chart states, error with retry, single-point charts, hidden
 * unauthorized sections, and a 390px render without breakage. Every figure
 * asserted comes from the mocked server payload, never a constant.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';

type Route = { status?: number; body: unknown };
const routes = new Map<string, Route>();
const requests: { path: string; method: string; query: string }[] = [];

/**
 * jsdom has no ResizeObserver; recharts ResponsiveContainer needs one. The
 * stub reports a fixed 800x280 viewport on observe so the chart renders
 * synchronously enough for assertions.
 */
class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [
        {
          target: { clientWidth: 800, clientHeight: 280 } as unknown as Element,
          contentRect: { width: 800, height: 280 } as unknown as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  };
  unobserve = () => {};
  disconnect = () => {};
}

const g = globalThis as unknown as { ResizeObserver?: unknown };
g.ResizeObserver = g.ResizeObserver ?? ResizeObserverStub;

const financeOverview = (over: Record<string, unknown> = {}) => ({
  period: 'month',
  window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'UTC' },
  scope: {
    kind: 'finance',
    viewerStaffId: '11111111-1111-4111-8111-111111111111',
    viewerRole: 'finance',
    attributedSaleCount: 0,
    unattributedLegacySaleCount: 0,
    unattributedLegacySaleValue: '0.00',
  },
  headline: {
    totalCustomers: 4,
    newCustomers: 1,
    totalCardSales: 3,
    periodSales: 2,
    grossFrozenSaleValue: '60000.00',
    periodVerifiedPayments: '25000.00',
    activatedMemberships: 1,
  },
  queues: {
    pendingPaymentVerification: 2,
    activationReadySales: 1,
    fullPaidSales: 1,
    rejectedPayments: 3,
    spotCashActive: 0,
    spotCashExpired: 1,
  },
  sellers: null,
  organization: null,
  networkContext: null,
  commissions: {
    pending: 1,
    payment_verified: 0,
    final_qualification_pending: 1,
    earned: 2,
    paid: 3,
    cancelled: 0,
  },
  redemptions: null,
  salesByPlan: [
    {
      planId: '33333333-3333-4333-8333-333333333333',
      planName: 'Gold',
      count: 1,
      value: '60000.00',
    },
  ],
  salesByScheme: [{ scheme: 'spot_cash', count: 1, value: '60000.00' }],
  trends: [
    {
      period: '2026-09-15',
      sales: 2,
      saleValue: '60000.00',
      verifiedPayments: '25000.00',
      activations: 1,
      redemptions: 0,
      pointsRedeemed: 0,
    },
  ],
  ...over,
});

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
    // The finance baseline holds `sales.card_sales` view, so the dashboard
    // sales sections stay visible for this fixture.
    {
      moduleKey: 'sales.card_sales',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'finance.payment_verification',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'finance.card_activation',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

/** Staff with dashboard access but no Sales access: every sales section hides. */
const NO_SALES_USER: SessionUser = {
  ...FINANCE_USER,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'No Sales Staff',
  email: 'nosales@afhomes.test',
  afHomesPermissions: FINANCE_USER.afHomesPermissions.filter(
    (permission) => permission.moduleKey !== 'sales.card_sales',
  ),
};

function install(over: Record<string, Route> = {}) {
  routes.clear();
  routes.set('GET /analytics', { status: 200, body: financeOverview() });
  routes.set('GET /analytics/sales-trend', { status: 200, body: salesTrendReport() });
  routes.set('GET /queues/dashboard', {
    status: 200,
    body: { ostMembers: 25, ostApplications: 3, paymentVerification: 5 },
  });
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

/** Dedicated Sales Overview series stub (independent of the overview payload). */
const salesTrendReport = (periods = defaultTrendPeriods()) => ({
  granularity: 'month',
  generatedAt: '2026-09-30T00:00:00.000Z',
  periods,
});

const defaultTrendPeriods = () => [
  { key: '2026-07', count: 1, total: '60000.00' },
  { key: '2026-08', count: 2, total: '55000.00' },
  { key: '2026-09', count: 1, total: '60000.00' },
];

const emptyTrendPeriods = () => [
  { key: '2026-08', count: 0, total: '0.00' },
  { key: '2026-09', count: 0, total: '0.00' },
];

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const [bare, query = ''] = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?');
    requests.push({ path: bare!, method: init?.method ?? 'GET', query });
    const route = routes.get(`${init?.method ?? 'GET'} ${bare}`) ?? routes.get(`${'GET'} ${bare}`);
    if (!route) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const render = (user: SessionUser = FINANCE_USER) =>
  renderWithProviders(<App />, { route: '/admin', user });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
});

describe('Phase 29 role dashboard', () => {
  it('42. shows loading skeletons while analytics load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render();
    expect(await screen.findByLabelText('Loading dashboard')).toBeInTheDocument();
    // Even static headings stay skeleton until the data arrives.
    expect(screen.queryByRole('heading', { name: 'Operations Overview' })).toBeNull();
    expect(screen.queryByText('AF Homes · Staff console')).toBeNull();
    expect(screen.queryByText('Key metrics')).toBeNull();
    expect(screen.queryByText('Sales Overview')).toBeNull();
    expect(screen.queryByText(/Loading trend/)).toBeNull();
  });

  it('renders server headline facts with labeled money series', async () => {
    render();
    expect(await screen.findByText('Total Customers')).toBeInTheDocument();
    expect(screen.getByText('New Applications')).toBeInTheDocument();
    expect(screen.getByText('Card Sales')).toBeInTheDocument();
    // Total sales renders as grouped money, never a raw decimal string.
    // The same 60000.00 figure also feeds both breakdown tables.
    expect(screen.getAllByText('₱60,000.00')).toHaveLength(3);
    expect(screen.queryByText('₱60000.00')).toBeNull();
    expect(requests.some((r) => r.path === '/analytics' && r.query.includes('period=month'))).toBe(
      true,
    );
  });

  it('39/40. renders empty and single-point chart states without crashing', async () => {
    install({
      'GET /analytics': { status: 200, body: financeOverview({ trends: [], salesByPlan: [] }) },
      'GET /analytics/sales-trend': { status: 200, body: salesTrendReport(emptyTrendPeriods()) },
    });
    render();
    // The Sales Overview owns its data: an all-zero qualifying series shows
    // its empty state instead of a fake flat line. The chart library loads on
    // demand, so the first render waits past the default timeout for the chunk.
    expect(await screen.findByText('No qualifying sales yet', {}, { timeout: 5000 }))
      .toBeInTheDocument();
    expect(screen.queryByText('Card Plans')).toBeNull();
  });

  it('renders a single trend point as a line chart', async () => {
    const { container } = render();
    await screen.findByText('Sales Overview');
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
  });

  it('20. keeps the Sales Overview independent of the page-level period selector', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('Sales Overview');
    await user.selectOptions(screen.getByLabelText('Analytics period'), 'week');
    await waitFor(() => {
      expect(requests.some((r) => r.path === '/analytics' && r.query.includes('period=week'))).toBe(
        true,
      );
    });
    // The overview refetched for the new window; the Sales Overview stayed on
    // its own Monthly series and never followed the page selector.
    const trendCalls = requests.filter((r) => r.path === '/analytics/sales-trend');
    expect(trendCalls.length).toBeGreaterThan(0);
    for (const call of trendCalls) expect(call.query).toContain('granularity=month');
    expect(await screen.findByText('Value this month')).toBeInTheDocument();
  });

  it('41. recovers from a load error through retry', async () => {
    const user = userEvent.setup();
    install({
      'GET /analytics': { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } },
    });
    render();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    install();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Total Customers')).toBeInTheDocument();
  });

  it('hides sections the finance role is not authorized to see', async () => {
    render();
    await screen.findByText('Total Customers');
    // No organization block, no redemption block, no team block for finance.
    expect(screen.queryByText('Current team')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Total staff|Points redeemed/);
  });

  it('49/50. renders the plan table inside a scroll container at 390px', async () => {
    window.innerWidth = 390;
    render();
    await screen.findByText('Gold');
    expect(document.querySelector('.table-scroll')).not.toBeNull();
    window.innerWidth = 1024;
  });

  /**
   * The dashboard is deliberately four cards, one graph and two tables. This
   * pins the cap AND the trimming, so neither can quietly grow back.
   */
  it('renders exactly four cards, one graph and two tables', async () => {
    const { container } = render();
    await screen.findByText('Total Customers');

    // Four headline cards only.
    const metrics = screen.getByRole('region', { name: 'Key metrics' });
    expect(metrics.querySelectorAll('article')).toHaveLength(4);
    // Shown in the fixed headline order, not re-picked per role.
    for (const label of ['Total Customers', 'New Applications', 'Card Sales', 'Total Sales']) {
      expect(within(metrics).getByText(label)).toBeInTheDocument();
    }
    // The old queue labels are gone from the headline set.
    expect(screen.queryByText('Pending payments')).toBeNull();
    expect(screen.queryByText('Activation queue')).toBeNull();

    // Exactly one graph. recharts paints asynchronously, so wait for it.
    await waitFor(() => expect(container.querySelectorAll('svg.recharts-surface')).toHaveLength(1));

    // Exactly two tables: scheme breakdown and plan breakdown.
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'Payment Schemes' })).getByText('Spot Cash'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Card Plans' })).getByText('Gold'),
    ).toBeInTheDocument();
    // Every money VALUE is grouped, never a raw decimal string. Scoped to the
    // metric cards and table cells: the chart's own axis ticks are labels
    // (e.g. "₱0"), not figures, and are formatted by the chart itself.
    // MetricCard exposes "<label>: <value>" on its aria-label, so the value is
    // read from the accessible name rather than a hashed CSS-module class.
    const moneyValues = [
      ...[...screen.getByRole('region', { name: 'Key metrics' }).querySelectorAll('article')].map(
        (card) => (card.getAttribute('aria-label') ?? '').split(': ').slice(1).join(': '),
      ),
      ...[...screen.getAllByRole('table')].flatMap((table) =>
        [...table.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
      ),
    ].filter((text) => text.includes('₱'));
    expect(moneyValues.length).toBeGreaterThan(0);
    for (const text of moneyValues) {
      expect(text).toMatch(/₱[\d,]+\.\d{2}\s*$/);
      // An ungrouped run of four or more digits is exactly the defect.
      expect(text).not.toMatch(/₱\d{4,}/);
    }
  });

  /**
   * Everything else was removed from this page: the eleven-link shortcut rail,
   * the queue cards, and the secondary metric strips. Each asserted-absent item
   * is content this page used to carry.
   */
  /**
   * The heading is a stable product title, not a role string. It carries no
   * subtitle either: the scope strip below it already states whose numbers
   * these are, so a second explanatory line would just repeat it.
   */
  it('presents a stable title with no subtitle, not a role name', async () => {
    render();
    await screen.findByText('Total Customers');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Operations Overview' }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Super Admin Dashboard/);
    expect(document.body.textContent).not.toMatch(
      /Live operational facts limited to your effective permissions/,
    );
    expect(document.body.textContent).not.toMatch(
      /Sales, finance and membership activity for your scope/,
    );
  });

  /**
   * Breakdown rows are coloured by what the data IS: the scheme is a frozen
   * property of the sale, and a plan carries its metallic tier. Each row also
   * keeps a readable share bar, so the colour is never the only signal.
   */
  it('colours breakdown rows by scheme and by plan tier', async () => {
    const { container } = render();
    await screen.findByText('Total Customers');
    const schemeRow = screen.getByText('Spot Cash').closest('tr');
    const planRow = screen.getByText('Gold').closest('tr');
    expect(schemeRow).toBeTruthy();
    expect(planRow).toBeTruthy();
    // Each row carries a tone class AND a decorative dot.
    expect(schemeRow?.className).toMatch(/tone/);
    expect(planRow?.className).toMatch(/tone/);
    expect(schemeRow?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    // The share bar is decorative; the exact amount stays the readable value.
    const bars = container.querySelectorAll('[aria-hidden="true"][style*="width"]');
    expect(bars.length).toBeGreaterThan(0);
    // One grouped figure per breakdown table plus the Total Sales headline
    // card (all three carry 60000.00 here).
    expect(screen.getAllByText('₱60,000.00')).toHaveLength(3);
  });

  it('shows nothing beyond the six blocks', async () => {
    render();
    await screen.findByText('Total Customers');
    expect(screen.queryByRole('navigation', { name: 'Dashboard actions' })).toBeNull();
    expect(screen.queryByText('OST Members')).toBeNull();
    expect(screen.queryByText('Payment Verification')).toBeNull();
    expect(screen.queryByRole('region', { name: 'More metrics' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Commission status' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Current team' })).toBeNull();
    expect(document.body.textContent).not.toContain('Direct reports');
  });

  /**
   * The scope bound is stated before any figure is read: every number below it
   * is permission- and scope-limited, and the raw enum is a developer token.
   */
  it('names the data scope and window before any figure is read', async () => {
    render();
    await screen.findByText('Total Customers');
    const scope = within(screen.getByRole('group', { name: 'Data scope' }));
    expect(scope.getByText('Finance')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Scope:\s*finance/);
    expect(scope.getByText(/to\s*Oct 1, 2026/)).toBeInTheDocument();
    expect(scope.getByText('As of today')).toBeInTheDocument();
  });

  it('hides every sales section for staff without sales.card_sales view', async () => {
    render(NO_SALES_USER);
    await screen.findByText('Total Customers');
    // Customer headlines stay; sales headlines go.
    expect(screen.getByText('New Applications')).toBeInTheDocument();
    expect(screen.queryByText('Card Sales')).toBeNull();
    expect(screen.queryByText('Total Sales')).toBeNull();
    // The Sales Overview chart (and its empty state) never mounts.
    expect(screen.queryByText('Sales Overview')).toBeNull();
    expect(screen.queryByText('No qualifying sales yet')).toBeNull();
    // Both sales breakdown tables stay off the page.
    expect(screen.queryByRole('region', { name: 'Payment Schemes' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Card Plans' })).toBeNull();
    // Key metrics keeps only the two customer cards.
    expect(
      screen.getByRole('region', { name: 'Key metrics' }).querySelectorAll('article'),
    ).toHaveLength(2);
    // The trend chart never mounts, so its endpoint is never called.
    await waitFor(() => {
      expect(requests.some((r) => r.path === '/analytics')).toBe(true);
    });
    expect(requests.some((r) => r.path === '/analytics/sales-trend')).toBe(false);
  });

  it('groups whole dashboard counts with thousands separators', async () => {
    install({
      'GET /analytics': {
        status: 200,
        body: financeOverview({
          headline: {
            totalCustomers: 8000,
            newCustomers: 1500,
            totalCardSales: 8000,
            periodSales: 8000,
            grossFrozenSaleValue: '60000.00',
            periodVerifiedPayments: '25000.00',
            activatedMemberships: 1200,
          },
          salesByPlan: [
            {
              planId: '33333333-3333-4333-8333-333333333333',
              planName: 'Gold',
              count: 8000,
              value: '60000.00',
            },
          ],
          salesByScheme: [{ scheme: 'spot_cash', count: 8000, value: '60000.00' }],
        }),
      },
      'GET /analytics/sales-trend': {
        status: 200,
        body: salesTrendReport([{ key: '2026-09', count: 8000, total: '60000.00' }]),
      },
    });
    render();
    await screen.findByText('Total Customers');
    // Headline cards, both breakdown tables, and the trend KPI all group.
    expect(screen.getAllByText('8,000').length).toBeGreaterThan(0);
    expect(screen.getByText('1,500')).toBeInTheDocument();
    // No raw ungrouped count reaches the page as its own text.
    expect(screen.queryByText('8000')).toBeNull();
    expect(screen.queryByText('1500')).toBeNull();
  });
});
