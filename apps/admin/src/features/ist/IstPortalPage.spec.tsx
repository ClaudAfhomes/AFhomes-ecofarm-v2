import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { IstPortalPage } from './IstPortalPage';
import { getTeamSalesAnalytics } from '../genealogy/services';
import { istDateRange } from './services';
import { istNavItemsForPermissions } from '../../app/navigation';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';

const mocks = vi.hoisted(() => ({ get: vi.fn(), imported: vi.fn() }));
vi.mock('./services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services')>()),
  getIstReport: mocks.get,
  getImportedSales: mocks.imported,
}));
vi.mock('../genealogy/services', () => ({
  getTeamSalesAnalytics: vi.fn().mockResolvedValue({
    window: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
    kpis: {
      totalTeamSales: 2,
      membersWithSales: 1,
      membersNoSales: 0,
      topSellerCount: 2,
      participationRate: 100,
    },
    members: [
      {
        staffId: 'seller',
        fullName: 'Mariel Soriano',
        role: 'ost',
        salesCount: 2,
        salesActivity: 'Top Seller',
      },
    ],
  }),
}));
vi.mock('../afhomes/SaleTeamAccreditationCard', () => ({
  SaleTeamAccreditationCard: () => <div>Accreditation details</div>,
}));
vi.mock('../account/profile-photo', () => ({
  useProfilePhoto: () => ({ photo: { data: null }, upload: {} }),
}));

const istUser: SessionUser = {
  id: 'sales-manager',
  name: 'MARIA SANTOS',
  email: 'maria@example.test',
  roleId: 'sm',
  roleSlug: 'sales_manager',
  roleName: 'Sales Manager',
  status: 'active',
  afHomesPermissions: [
    'dashboard.view',
    'sales.card_sales',
    'network.commissions',
    'network.genealogy',
    'network.members',
  ].map((moduleKey) => ({
    moduleKey,
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  })) as SessionUser['afHomesPermissions'],
};
const metrics = {
  salesCount: 2,
  qualifyingSales: 1,
  salesAmount: '60000.00',
  toEarn: '100.00',
  earned: '200.00',
  paid: '50.00',
};
const report = {
  from: '2026-10-01',
  to: '2026-10-23',
  account: {
    name: 'MARIA SANTOS',
    role: 'Sales Manager',
    status: 'active',
    staffNumber: null,
    head: 'JOSE REYES',
  },
  personal: metrics,
  ost: {
    ...metrics,
    toEarn: '300.00',
    earned: '400.00',
    paid: '150.00',
    withSales: 1,
    withoutSales: 1,
  },
  team: {
    total: 2,
    active: 1,
    salesCount: 1,
    salesAmount: '30000.00',
    withSales: 1,
    withoutSales: 1,
  },
  teamCommissionOverview: {
    role: 'sales_manager',
    scopeLabel: 'Your commissions and OST members directly assigned to you',
    availableRoles: ['sales_manager', 'ost'],
    totals: metrics,
    breakdown: [
      { role: 'sales_manager', recordCount: 1, toEarn: '100.00', earned: '200.00', paid: '50.00' },
      { role: 'ost', recordCount: 1, toEarn: '300.00', earned: '400.00', paid: '150.00' },
    ],
  },
  sales: [],
  commissions: [],
  total: 0,
  page: 1,
  pageSize: 25,
};
beforeEach(() => {
  mocks.imported
    .mockReset()
    .mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0 } });
  mocks.get.mockReset().mockResolvedValue(report);
});

it('shows finalized imported purchases in normal My Sales history', async () => {
  mocks.get.mockResolvedValue({
    ...report,
    sales: [
      {
        id: 'source-1',
        saleNumber: '26011500841G1C01S',
        customerName: 'Patricia Delos Reyes',
        tier: 'Gold',
        amount: '312000.00',
        status: 'active',
        createdAt: '2026-10-23T00:00:00Z',
      },
    ],
    total: 1,
  });
  renderWithProviders(<IstPortalPage view="my-sales" />);
  expect(await screen.findByText('26011500841G1C01S')).toBeInTheDocument();
  expect(screen.getByText('Patricia Delos Reyes')).toBeInTheDocument();
  expect(screen.queryByText('Imported customer records')).not.toBeInTheDocument();
  expect(mocks.imported).not.toHaveBeenCalled();
});

it('keeps personal and OST performance visibly separate', async () => {
  renderWithProviders(<IstPortalPage />);
  expect(await screen.findByRole('heading', { name: 'Personal Performance' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'OST Team Performance' })).toBeInTheDocument();
  expect(screen.getByText('MARIA SANTOS')).toBeInTheDocument();
  expect(screen.getByText('JOSE REYES')).toBeInTheDocument();
  expect(screen.getByText(/UTC/)).toBeInTheDocument();
});
it('renders a read-only commission history and pagination', async () => {
  mocks.get.mockResolvedValue({
    ...report,
    commissions: [
      {
        id: '1',
        commissionNumber: 'COM-001',
        memberName: 'ANA REYES',
        memberRole: 'ost',
        saleNumber: 'SALE-001',
        amount: '10.00',
        status: 'paid',
        createdAt: '2026-10-03T00:00:00Z',
        earnedAt: null,
        paidAt: '2026-10-04T00:00:00Z',
      },
    ],
    total: 26,
  });
  renderWithProviders(<IstPortalPage view="team-commissions" />);
  expect(await screen.findByText('ANA REYES')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /qualify|mark.*paid/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.any(AbortSignal),
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: undefined, status: undefined, search: undefined, page: 1 }),
      expect.any(AbortSignal),
    ),
  );
});

it.each(['my-commissions', 'my-sales', 'team-sales'] as const)(
  'uses the shared light theme for %s',
  async (view) => {
    const { container } = renderWithProviders(<IstPortalPage view={view} />);
    expect(await screen.findByText(/No (commissions|sales) in this period/)).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('lightPage');
    expect(screen.queryByLabelText('Salesperson role')).not.toBeInTheDocument();
  },
);

it('uses the light Team Commissions layout and separates personal and OST earnings', async () => {
  const { container } = renderWithProviders(<IstPortalPage view="team-commissions" />);
  expect(await screen.findByRole('heading', { name: 'My Commissions' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'OST Team Commissions' })).toBeInTheDocument();
  expect(container.firstElementChild?.className).toContain('lightPage');
  expect(screen.getByText('My Total Commission')).toBeInTheDocument();
  expect(screen.getByText('OST Team Commission Pending')).toBeInTheDocument();
  expect(
    screen.getByText('Your commissions and OST members directly assigned to you'),
  ).toBeInTheDocument();
});

it('shows the VD organization overview and role breakdown', async () => {
  mocks.get.mockResolvedValue({
    ...report,
    teamCommissionOverview: {
      ...report.teamCommissionOverview,
      role: 'vice_director',
      availableRoles: ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'],
      breakdown: ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].map((role) => ({
        role,
        recordCount: 1,
        earned: '100.00',
        toEarn: '50.00',
        paid: '10.00',
      })),
    },
  });
  renderWithProviders(<IstPortalPage view="team-commissions" />);
  expect(await screen.findByText('Total Team Commission Earned')).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'Commission breakdown by position' }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByLabelText('Salesperson role')).getByRole('option', {
      name: 'Senior Sales Manager',
    }),
  ).toBeInTheDocument();
});

it('applies table role, status and search filters and resets pagination', async () => {
  renderWithProviders(<IstPortalPage view="team-commissions" />, {
    route: '/sales/ist/team-commissions?page=3',
  });
  const role = await screen.findByLabelText('Salesperson role');
  expect(within(role).queryByRole('option', { name: 'Vice Director' })).not.toBeInTheDocument();
  await userEvent.selectOptions(role, 'ost');
  await userEvent.selectOptions(screen.getByLabelText('Commission status'), 'paid');
  await userEvent.type(screen.getByLabelText('Search team commissions'), 'ANA');
  await userEvent.click(screen.getByRole('button', { name: 'Apply search' }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'ost', status: 'paid', search: 'ANA', page: 1 }),
      expect.any(AbortSignal),
    ),
  );
});
it('changes presets and validates custom ranges before loading', async () => {
  renderWithProviders(<IstPortalPage view="my-sales" />);
  await screen.findByText('No sales in this period');
  await userEvent.selectOptions(screen.getByLabelText('Reporting period'), '7');
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  await userEvent.selectOptions(screen.getByLabelText('Reporting period'), 'custom');
  await userEvent.clear(screen.getByLabelText('Custom Start Date'));
  expect(screen.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
});
it('shows a recoverable API error', async () => {
  mocks.get.mockRejectedValue(new Error('Unavailable'));
  renderWithProviders(<IstPortalPage />);
  expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
});
it('uses trailing UTC dates and clamps the six-month calendar boundary', () => {
  const now = new Date('2026-08-31T23:55:00Z');
  expect(istDateRange('today', now)).toEqual({ from: '2026-08-31', to: '2026-08-31' });
  expect(istDateRange('7', now)).toEqual({ from: '2026-08-25', to: '2026-08-31' });
  expect(istDateRange('28', now)).toEqual({ from: '2026-08-04', to: '2026-08-31' });
  expect(istDateRange('6months', now)).toEqual({ from: '2026-02-28', to: '2026-08-31' });
});
it('reuses the existing Sales Network links and hides denied commission links', () => {
  const nav = istNavItemsForPermissions(
    ['dashboard.view', 'sales.card_sales', 'network.genealogy', 'network.members'].map(
      (moduleKey) => ({
        moduleKey,
        canView: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      }),
    ) as never,
  );
  expect(nav.find((n) => n.label === 'Sales Network')?.dropdown).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ to: '/admin/genealogy' }),
      expect.objectContaining({ to: '/admin/network/members' }),
    ]),
  );
  expect(nav.find((n) => n.label === 'Commissions')).toBeUndefined();
});

it('routes the actual IST portal and retains reporting dates through sidebar navigation', async () => {
  renderWithProviders(<App />, {
    user: istUser,
    route: '/sales?from=2026-10-01&to=2026-10-23&period=custom',
  });
  expect(await screen.findByRole('heading', { name: 'IST Dashboard' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Commissions' }));
  const link = screen.getByRole('link', { name: 'My Commissions' });
  expect(link).toHaveAttribute(
    'href',
    '/sales/ist/my-commissions?from=2026-10-01&to=2026-10-23&period=custom',
  );
  await userEvent.click(link);
  expect(await screen.findByRole('heading', { name: 'My Commissions' })).toBeInTheDocument();
  expect(mocks.get).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'my-commissions', from: '2026-10-01', to: '2026-10-23' }),
    expect.any(AbortSignal),
  );
});

it('opens and closes the responsive sidebar while navigating to team sales', async () => {
  renderWithProviders(<App />, { user: istUser, route: '/sales' });
  await screen.findByRole('heading', { name: 'IST Dashboard' });
  await userEvent.click(screen.getAllByRole('button', { name: 'Open navigation' })[0]!);
  const drawer = screen.getByRole('dialog', { name: 'AFHomes administration' });
  await userEvent.click(within(drawer).getByRole('button', { name: 'Sales' }));
  await userEvent.click(within(drawer).getByRole('link', { name: 'Team Sales' }));
  expect(await screen.findByRole('heading', { name: 'Team Sales' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('renders personal sales with named mobile fields and an accessible table caption', async () => {
  mocks.get.mockResolvedValue({
    ...report,
    sales: [
      {
        id: 'sale-1',
        saleNumber: 'SALE-001',
        createdAt: '2026-10-03T00:00:00Z',
        customerName: 'ANA REYES',
        tier: 'Gold',
        amount: '60000.00',
        status: 'active',
      },
    ],
    total: 1,
  });
  renderWithProviders(<IstPortalPage view="my-sales" />);
  const table = await screen.findByRole('table', { name: 'My Sales history' });
  expect(within(table).getByText('ANA REYES')).toHaveAttribute('data-label', 'Customer');
  expect(within(table).getByText('Gold')).toHaveAttribute('data-label', 'VIP tier');
});
it.each(['vice_director', 'senior_sales_manager', 'sales_manager'])(
  'shows Team Sales Activity in Team Sales for %s without a separate imported-record section',
  async (roleSlug) => {
    renderWithProviders(<IstPortalPage view="team-sales" />, { user: { ...istUser, roleSlug } });
    expect(await screen.findByRole('heading', { name: 'Team Sales Activity' })).toBeInTheDocument();
    expect(await screen.findByText('Mariel Soriano')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Imported customer records' }),
    ).not.toBeInTheDocument();
  },
);

it('retains the original independent activity presets and custom date filters in Team Sales', async () => {
  const user = userEvent.setup();
  vi.mocked(getTeamSalesAnalytics).mockClear();
  renderWithProviders(<IstPortalPage view="team-sales" />, { user: istUser });
  await screen.findByText('Mariel Soriano');
  expect(getTeamSalesAnalytics).toHaveBeenCalledWith(istUser.id, 'month', '', '');
  const activity = within(screen.getByRole('region', { name: 'Team sales activity' }));
  const start = activity.getByLabelText(/Start Date/);
  const end = activity.getByLabelText(/End Date/);
  for (const [label, days] of [
    ['Today', 0],
    ['Past 7 Days', 7],
    ['Past 28 Days', 28],
    ['Past 6 Months', 180],
  ] as const) {
    await user.click(activity.getByRole('button', { name: label }));
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    await waitFor(() =>
      expect(getTeamSalesAnalytics).toHaveBeenLastCalledWith(
        istUser.id,
        'month',
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      ),
    );
    expect(start).toHaveValue(from.toISOString().slice(0, 10));
    expect(end).toHaveValue(to.toISOString().slice(0, 10));
  }
  fireEvent.change(start, { target: { value: '2026-01-02' } });
  fireEvent.change(end, { target: { value: '2026-01-10' } });
  await waitFor(() =>
    expect(getTeamSalesAnalytics).toHaveBeenLastCalledWith(
      istUser.id,
      'month',
      '2026-01-02',
      '2026-01-10',
    ),
  );
  expect(activity.getByText('Custom range: 2026-01-02 to 2026-01-10 (UTC)')).toBeInTheDocument();
  expect(activity.getByText('Top Seller', { selector: 'dt' })).toBeInTheDocument();
  expect(activity.getByRole('columnheader', { name: 'Sales' })).toBeInTheDocument();
});
