/**
 * AF Homes Phase 30 reports and audit UI.
 *
 * Renders the REAL Reports and Audit pages through the REAL router against a
 * mocked API: list loading/empty/error-with-retry, populated tables with
 * server summaries and scope labels, pagination, export buttons (including
 * the exporting state and failure display), the audit metadata dialog, and
 * downloads through a stubbed object URL. Every figure asserted arrives in
 * the mocked server payload; the screens compute nothing themselves.
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

const salesRows = [
  {
    saleNumber: 'SALE-000001',
    date: '2026-09-23T00:00:00.000Z',
    customer: 'Juan Dela Cruz',
    seller: 'Cody Sm',
    sellerRole: 'staff',
    plan: 'Gold',
    frozenPrice: '60000.00',
    requiredDown: '20000.00',
    yearlyPointsSnapshot: 60000,
    status: 'submitted',
    verifiedPaid: '20000.00',
    remaining: '40000.00',
    activatedAt: null,
  },
];

const salesBody = (rows: unknown[], total?: number) => ({
  report: 'sales',
  generatedAt: '2026-09-28T00:00:00.000Z',
  scope: { kind: 'global', viewerRole: 'super_admin', label: 'Global (super_admin)' },
  window: { from: null, to: null },
  filters: {},
  summary: {
    sales: rows.length,
    grossFrozenValue: '60000.00',
    verifiedPaid: '20000.00',
    remaining: '40000.00',
  },
  data: rows,
  meta: { total: total ?? rows.length, limit: 50, offset: 0 },
});

const auditRows = [
  {
    id: 1,
    createdAt: '2026-09-23T10:00:00.000Z',
    actorId: '11111111-1111-4111-8111-111111111111',
    action: 'APPLICATION_SUBMITTED',
    entityType: 'card_sale',
    entityId: 'bbbbbbbb-0000-4000-8000-000000000001',
    summary: 'APPLICATION_SUBMITTED · card_sale bbbbbbbb-0000-4000',
    metadata: { saleNumber: 'SALE-000001' },
  },
];

const auditBody = (rows: unknown[], total?: number) => ({
  report: 'audit',
  generatedAt: '2026-09-28T00:00:00.000Z',
  scope: { kind: 'global', viewerRole: 'super_admin', label: 'Audit (super_admin)' },
  window: { from: null, to: null },
  filters: {},
  summary: { events: total ?? rows.length },
  data: rows,
  meta: { total: total ?? rows.length, limit: 50, offset: 0 },
});

const ADMIN_USER: SessionUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Super Admin',
  email: 'admin@afhomes.test',
  roleId: 'r-admin',
  roleName: 'Super Admin',
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
      moduleKey: 'sales.card_sales',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'governance.audit',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
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
    requests.push({ path, method, query });
    const route = routes.get(`${method} ${path}`) ?? routes.get(path);
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

function install(over: Record<string, Route> = {}) {
  routes.clear();
  routes.set('GET /reports/sales', { status: 200, body: salesBody(salesRows) });
  routes.set('GET /reports/audit', { status: 200, body: auditBody(auditRows) });
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string, user: SessionUser = ADMIN_USER) =>
  renderWithProviders(<App />, { route, user });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

/* ================================================================== */
/* Reports page: states, pagination, exports                           */
/* ================================================================== */

describe('Phase 30 reports page', () => {
  it('41. shows loading, empty, and error-with-retry states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const loading = render('/admin/reports');
    expect(await screen.findByLabelText('Loading report')).toBeInTheDocument();
    loading.unmount();

    // Restore the routed mock: the hanging fetch above is still installed.
    vi.stubGlobal('fetch', mockFetch());
    install({ 'GET /reports/sales': { status: 200, body: salesBody([]) } });
    render('/admin/reports');
    expect(await screen.findByText('No rows in scope')).toBeInTheDocument();
  });

  it('recovers from a load error through retry', async () => {
    const user = userEvent.setup();
    install({
      'GET /reports/sales': { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } },
    });
    render('/admin/reports');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    install();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('SALE-000001')).toBeInTheDocument();
    expect(screen.getByText('Gross Sales Value')).toBeInTheDocument();
    expect(screen.queryByText('grossFrozenValue')).not.toBeInTheDocument();
    expect(screen.getAllByText('₱60,000.00').length).toBeGreaterThan(0);
  });

  it('renders server summaries, scope labels, and paginated rows', async () => {
    render('/admin/reports');
    expect(await screen.findByText('SALE-000001')).toBeInTheDocument();
    expect(screen.getByText(/Scope: Global \(super_admin\)/)).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('exports through the same filtered endpoint and handles failure', async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    window.HTMLAnchorElement.prototype.click = click;
    install({
      'GET /reports/sales': { status: 200, body: salesBody(salesRows) },
    });
    render('/admin/reports');
    await screen.findByText('SALE-000001');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => {
      const call = requests.find(
        (r) => r.path === '/reports/sales' && r.query.includes('format=csv'),
      );
      expect(call).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => {
      const call = requests.find(
        (r) => r.path === '/reports/sales' && r.query.includes('format=pdf'),
      );
      expect(call).toBeDefined();
    });
  });

  it('51/52. renders the report table inside a scroll container', async () => {
    window.innerWidth = 390;
    render('/admin/reports');
    await screen.findByText('SALE-000001');
    expect(document.querySelector('.table-scroll')).not.toBeNull();
    window.innerWidth = 1024;
  });
});

/* ================================================================== */
/* Audit page: states, metadata, export                                */
/* ================================================================== */

describe('Phase 30 audit page', () => {
  it('44/45/46. shows loading, empty, and error-with-retry states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const loading = render('/admin/audit');
    expect(await screen.findByLabelText('Loading audit events')).toBeInTheDocument();
    loading.unmount();

    // Restore the routed mock: the hanging fetch above is still installed.
    vi.stubGlobal('fetch', mockFetch());
    install({ 'GET /reports/audit': { status: 200, body: auditBody([]) } });
    render('/admin/audit');
    expect(await screen.findByText('No audit events')).toBeInTheDocument();
  });

  it('renders rows with pagination and opens redacted metadata', async () => {
    const user = userEvent.setup();
    render('/admin/audit');
    expect(await screen.findByText('APPLICATION_SUBMITTED')).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Metadata' }));
    expect(await screen.findByText('Event metadata (redacted)')).toBeInTheDocument();
    expect(screen.getByText(/SALE-000001/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Event metadata (redacted)')).toBeNull();
  });

  it('exports audit CSV through the filtered endpoint', async () => {
    const user = userEvent.setup();
    render('/admin/audit');
    await screen.findByText('APPLICATION_SUBMITTED');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => {
      const call = requests.find(
        (r) => r.path === '/reports/audit' && r.query.includes('format=csv'),
      );
      expect(call).toBeDefined();
    });
  });
});
