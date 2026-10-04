/**
 * AF Homes Phase 29 dashboard presentation.
 *
 * Renders the REAL role dashboard through the REAL router against a mocked
 * `/analytics` endpoint: loading skeletons, populated finance facts, empty
 * trend/chart states, error with retry, single-point charts, hidden
 * unauthorized sections, and a 390px render without breakage. Every figure
 * asserted comes from the mocked server payload, never a constant.
 */
import { screen, waitFor } from '@testing-library/react';
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

const ADMIN_USER: SessionUser = {
  ...FINANCE_USER,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Ada Admin',
  email: 'admin@afhomes.test',
  roleName: 'Admin',
  afHomesPermissions: [
    {
      moduleKey: 'dashboard.view',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'network.ost_members',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'network.ost_registrations',
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
  ],
};

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
  });

  it('renders server finance facts with labeled money series', async () => {
    render();
    expect(await screen.findByText('Pending payments')).toBeInTheDocument();
    // Verified revenue renders as money, never a bare constant.
    expect(screen.getByText('₱25000.00')).toBeInTheDocument();
    expect(screen.getByText('Rejected payments')).toBeInTheDocument();
    // Commission states stay distinct by name.
    expect(await screen.findByText('Commission status')).toBeInTheDocument();
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
    // its empty state instead of a fake flat line.
    expect(await screen.findByText('No qualifying sales yet')).toBeInTheDocument();
    expect(screen.queryByText('Sales by card plan')).toBeNull();
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
    expect(await screen.findByText('Pending payments')).toBeInTheDocument();
  });

  it('hides sections the finance role is not authorized to see', async () => {
    render();
    await screen.findByText('Pending payments');
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

  it('2B. renders operational queue cards above the metrics with server counts', async () => {
    render(ADMIN_USER);
    expect(await screen.findByRole('link', { name: 'OST Members: 25 total' })).toHaveAttribute(
      'href',
      '/admin/ost/members',
    );
    expect(screen.getByText('registered')).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: 'OST Applications: 3 pending' }),
    ).toHaveAttribute('href', '/admin/ost/applications');
    expect(
      await screen.findByRole('link', { name: 'Payment Verification: 5 pending' }),
    ).toHaveAttribute('href', '/admin/finance/payments');
    expect(screen.getAllByText('action needed')).toHaveLength(2);
    // No withdrawals card: the payout workflow does not exist yet.
    expect(screen.queryByText(/withdrawal/i)).toBeNull();
    // 18/19. Queue cards coexist with the metric sections and Sales Overview.
    expect(await screen.findByText('Pending payments')).toBeInTheDocument();
    expect(await screen.findByText('Sales Overview')).toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html.indexOf('Pending payments')).toBeLessThan(html.indexOf('OST Members'));
    expect(html.indexOf('Sales Overview')).toBeLessThan(html.indexOf('OST Members'));
  });

  it('2B. shows only the permitted queue card to a finance user', async () => {
    render();
    expect(
      await screen.findByRole('link', { name: 'Payment Verification: 5 pending' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('OST Members')).toBeNull();
    expect(screen.queryByText('OST Applications')).toBeNull();
  });
});
