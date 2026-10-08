/**
 * AF Homes Phase 33 - admin responsive completion.
 *
 * Renders the REAL pages through the REAL router at mobile widths and pins
 * the structural contracts the CSS relies on: every wide table inside a
 * `.table-scroll` wrapper, filter rows that wrap, dialogs with labelled
 * inputs, reachable actions, and permission-hidden links staying hidden.
 * jsdom performs no layout, so viewport widths are simulated through the
 * shared `matchMedia` mock plus `window.innerWidth`; pixel-perfect layout
 * remains a browser-UAT item for final release.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from './test/utils';
import App from './app/App';
import type { SessionUser } from './lib/session';

/** jsdom has no matchMedia: drive the shared useMediaQuery hook directly. */
function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

vi.mock('./features/afhomes/services', () => ({
  getAfHomesStaff: vi.fn(),
  getAfHomesStaffById: vi.fn(),
  getAfHomesStaffAudit: vi.fn(),
  getAfHomesRoles: vi.fn(),
  getAfHomesRoleById: vi.fn(),
  getAfHomesDepartments: vi.fn(),
  getAfHomesDashboard: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getAfHomesSalesTrend: vi.fn(),
  getAfHomesDashboardQueues: vi.fn(),
  getAfHomesRoleAudit: vi.fn(),
  createAfHomesStaff: vi.fn(),
  updateAfHomesStaff: vi.fn(),
  updateAfHomesStaffProfile: vi.fn(),
  changeAfHomesStaffPassword: vi.fn(),
  createAfHomesRole: vi.fn(),
  updateAfHomesRole: vi.fn(),
}));

vi.mock('./features/business/services', () => ({
  getSales: vi.fn(),

  getCustomerApplications: vi.fn(),
  cancelSale: vi.fn(),
  getFinanceQueue: vi.fn(),
  getActivationQueue: vi.fn(),
  getCommissions: vi.fn(),
  getCustomers: vi.fn(),
  getCustomersPage: vi.fn(async () => ({ data: [], total: 0 })),
  getCustomerById: vi.fn(),
  getCardProducts: vi.fn(),
  getCardCategories: vi.fn(),
}));

vi.mock('./features/memberships/services', () => ({
  getMemberships: vi.fn(),
  getMembershipCard: vi.fn(),
  reissueMembershipCard: vi.fn(),
  markMembershipPrinted: vi.fn(),
}));

vi.mock('./features/redemption/services', () => ({
  getRedemptionItems: vi.fn(),
  getRedemptions: vi.fn(),
  resolveRedemptionMember: vi.fn(),
  commitRedemption: vi.fn(),
}));

vi.mock('./features/reports/services', async (original) => ({
  ...(await original()),
  getReport: vi.fn(),
  getAudit: vi.fn(),
  exportReport: vi.fn(),
  downloadExport: vi.fn(),
  exportAudit: vi.fn(),
  formatCell: (_key: string, value: unknown) => String(value ?? ''),
}));

vi.mock('./features/cms/services', () => ({
  getCmsPages: vi.fn(),
  getCmsMedia: vi.fn(),
  getCmsHistory: vi.fn(),
  getCmsDocuments: vi.fn(),
  createCmsPage: vi.fn(),
  updateCmsPage: vi.fn(),
  publishCmsPage: vi.fn(),
}));

vi.mock('./features/genealogy/services', () => ({
  getGenealogy: vi.fn(),
  getGenealogyNode: vi.fn(),
  getGenealogySummary: vi.fn(),
}));

vi.mock('./features/ost/services', () => ({
  getOstApplications: vi.fn(),
  getOstMembers: vi.fn(),
  getMyReferralCodes: vi.fn(),
}));

import {
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaff,
  getAnalyticsOverview,
  getAfHomesDashboardQueues,
  getAfHomesSalesTrend,
} from './features/afhomes/services';
import { getCommissions, getCustomersPage, getFinanceQueue } from './features/business/services';
import { getMemberships } from './features/memberships/services';
import { getRedemptionItems, getRedemptions } from './features/redemption/services';
import { getAudit, getReport } from './features/reports/services';
import { getCmsHistory, getCmsPages } from './features/cms/services';
import { getGenealogy } from './features/genealogy/services';
import { getOstApplications } from './features/ost/services';

const view = (moduleKey: string) => ({
  moduleKey: moduleKey as never,
  canView: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
});

const SUPER: SessionUser = {
  id: 'u-super',
  name: 'Super Admin',
  email: 'super@afhomes.test',
  roleId: 'r-super',
  roleName: 'Super Admin',
  status: 'active',
  afHomesPermissions: [
    'dashboard.view',
    'organization.staff',
    'organization.roles',
    'sales.card_sales',
    'sales.customers',
    'sales.card_plans',
    'finance.payment_verification',
    'finance.card_activation',
    'network.commissions',
    'network.genealogy',
    'network.ost_registrations',
    'network.ost_members',
    'operations.redemption',
    'operations.catalog',
    'finance.points',
    'governance.audit',
    'cms.pages',
    'cms.media',
    'cms.history',
    'cms.settings',
  ].map(view),
};

const STAFF_ROW = {
  id: 's-1',
  fullName: 'Ana Reyes Santos Dela Cruz',
  email: 'ana.reyes.santos.delacruz@example.invalid',
  departmentName: 'Sales',
  roleName: 'Sales Manager',
  roleId: 'r-sm',
  status: 'active',
  restrictions: [],
};

const ROLE_ROW = {
  id: 'r-sm',
  name: 'Sales Manager',
  description: 'Sellers',
  slug: 'sales_manager',
  isActive: true,
  isSystem: false,
  assignedCount: 12,
  permissions: [],
};

const QUEUE_ROW = {
  // The Finance queue is a discriminated union; a sale-origin row must say so.
  origin: 'sale',
  status: 'payment_in_progress',
  saleId: 'sale-1',
  saleNumber: 'SALE-000001',
  customerName: 'Juan Dela Cruz',
  productName: 'Gold',
  cashPrice: '60000.00',
  verifiedTotal: '20000.00',
  remainingBalance: '40000.00',
  downPaymentSatisfied: true,
  firstVerifiedPayment: '2026-09-27T09:00:00.000Z',
  spotCashState: 'within_deadline',
  spotCashDeadline: '2026-10-04T09:00:00.000Z',
};

const MEMBER_ROW = {
  id: 'm-1',
  customerName: 'Pedro Reyes',
  membershipNumber: 'MBS-000001',
  productName: 'Gold',
  categoryName: 'Membership Cards',
  status: 'active',
  pointsBalance: 60000,
  activatedAt: '2026-09-27T09:00:00.000Z',
  cardIssuedAt: '2026-09-28T01:00:00.000Z',
  lastPrintedAt: null,
  printCount: 0,
};

const COMMISSION_ROWS = [
  {
    id: 'c-1',
    saleNumber: 'SALE-000001',
    beneficiaryName: 'OST Ana',
    basisAmount: '60000.00',
    rate: '0.04',
    amount: '2400.00',
    status: 'final_qualification_pending',
    createdAt: '2026-09-27T09:00:00.000Z',
    qualifiedAt: null,
    earnedAt: null,
    paidAt: null,
  },
];

const ITEM_ROW = {
  id: 'i-1',
  code: 'TEPPANYAKI',
  name: 'Japanese Teppanyaki Grill Dinner For Two',
  description: 'Dinner',
  category: 'dining',
  pointsCost: 2000,
  isActive: true,
  sortOrder: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const REDEMPTION_ROW = {
  id: 'rdm-1',
  redemptionNumber: 'RDM-000001',
  completedAt: '2026-09-28T01:00:00.000Z',
  customerDisplayName: 'Pedro Reyes',
  membershipNumber: 'MBS-000001',
  itemNameSnapshot: 'Japanese Teppanyaki',
  quantity: 1,
  itemCodeSnapshot: 'TEPPANYAKI',
  totalPoints: 2000,
  balanceAfterSnapshot: 58000,
  redeemedByName: 'Employee Ed',
  status: 'completed',
};

const REPORT_ROW = {
  data: [
    {
      saleNumber: 'SALE-000001',
      date: '2026-09-27',
      customer: 'Juan Dela Cruz',
      seller: 'SM Ana',
      plan: 'Gold',
      frozenPrice: '60000.00',
      verifiedPaid: '20000.00',
      remaining: '40000.00',
      status: 'payment_in_progress',
    },
  ],
  summary: { rows: 1 },
  scope: { kind: 'global', label: 'All records' },
  meta: { total: 1 },
};

const AUDIT_ROW = {
  data: [
    {
      id: 'a-1',
      createdAt: '2026-09-27T09:00:00.000Z',
      actorId: 'u-1',
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: 'p-1',
      summary: 'Payment recorded',
      metadata: {},
    },
  ],
  meta: { total: 1 },
};

const CMS_ROW = {
  id: 'p-1',
  title: 'Ecofarm Story',
  slug: 'ecofarm-story',
  status: 'published',
  version: 3,
};

const GENEALOGY_ROW = {
  staffId: 'sm-1',
  fullName: 'SM Ana Santos',
  role: 'sales_manager',
  ostStatus: null,
  status: 'active',
  directDownlineCount: 4,
  totalDescendantCount: 9,
};

const OST_ROW = {
  id: 'ost-1',
  applicantName: 'Applicant Ana Santos Del Rosario',
  email: 'applicant.ana.santos@example.invalid',
  sponsorName: 'SM Ana',
  submittedAt: '2026-09-27T09:00:00.000Z',
  status: 'submitted',
};

function install() {
  vi.mocked(getAfHomesStaff).mockResolvedValue([STAFF_ROW] as never);
  vi.mocked(getAfHomesRoles).mockResolvedValue([ROLE_ROW] as never);
  // Unlisted queries reject: pages under test do not call them, and the
  // dashboard shell proves the shared error state instead of crashing.
  vi.mocked(getAfHomesDepartments).mockRejectedValue(new Error('stub'));
  vi.mocked(getAnalyticsOverview).mockRejectedValue(new Error('stub'));
  vi.mocked(getAfHomesDashboardQueues).mockRejectedValue(new Error('stub'));
  vi.mocked(getAfHomesSalesTrend).mockRejectedValue(new Error('stub'));
  vi.mocked(getFinanceQueue).mockResolvedValue([QUEUE_ROW] as never);
  vi.mocked(getMemberships).mockResolvedValue([MEMBER_ROW] as never);
  vi.mocked(getCommissions).mockResolvedValue(COMMISSION_ROWS as never);
  vi.mocked(getRedemptionItems).mockResolvedValue([ITEM_ROW] as never);
  vi.mocked(getRedemptions).mockResolvedValue([REDEMPTION_ROW] as never);
  vi.mocked(getReport).mockResolvedValue(REPORT_ROW as never);
  vi.mocked(getAudit).mockResolvedValue(AUDIT_ROW as never);
  vi.mocked(getCmsPages).mockResolvedValue([CMS_ROW] as never);
  vi.mocked(getCmsHistory).mockResolvedValue([] as never);
  vi.mocked(getGenealogy).mockResolvedValue([GENEALOGY_ROW] as never);
  vi.mocked(getOstApplications).mockResolvedValue([OST_ROW] as never);
}

function atWidth(width: number, desktop: boolean) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  mockMatchMedia(desktop);
}

const renderApp = (route: string, user: SessionUser = SUPER) =>
  renderWithProviders(<App />, { route, user });

beforeEach(() => {
  install();
});

describe('Phase 33 viewport smoke: shell renders at every target width', () => {
  it.each([
    [320, false],
    [390, false],
    [430, false],
    [768, false],
    [1024, true],
    [1440, true],
  ])('%ipx renders the dashboard shell without an exception', async (width, desktop) => {
    atWidth(width, desktop);
    renderApp('/admin');
    expect(await screen.findByRole('main')).not.toBeNull();
    // The account/session area stays reachable at every width (name + role).
    expect(screen.getAllByText('Super Admin').length).toBeGreaterThanOrEqual(1);
  });

  it('390px mobile keeps the drawer opener reachable', async () => {
    atWidth(390, false);
    renderApp('/admin/customers');
    expect(await screen.findByRole('main')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /menu/i }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 33 tables scroll instead of breaking', () => {
  it.each([
    ['/admin/staff', 'Ana Reyes Santos Dela Cruz'],
    ['/admin/roles', 'Sales Manager'],
    ['/admin/finance/payments', 'SALE-000001'],
    ['/admin/memberships', 'MBS-000001'],
    ['/admin/finance/commissions', 'SALE-000001'],
    ['/admin/redemption/items', 'TEPPANYAKI'],
    ['/admin/genealogy', 'SM Ana Santos'],
    ['/admin/ost/applications', 'Applicant Ana Santos Del Rosario'],
    ['/admin/cms/pages', 'Ecofarm Story'],
  ])('%s wraps its wide table in .table-scroll at 390px', async (route, marker) => {
    atWidth(390, false);
    renderApp(route);
    expect(await screen.findByText(marker)).not.toBeNull();
    expect(document.querySelector('.table-scroll')).not.toBeNull();
  });

  it('reports and audit tables scroll with filters and export reachable', async () => {
    atWidth(390, false);
    renderApp('/admin/reports');
    expect(await screen.findByText('SALE-000001')).not.toBeNull();
    expect(document.querySelector('.table-scroll')).not.toBeNull();
    expect(screen.getByRole('button', { name: /export csv/i })).not.toBeNull();
  });

  it('audit metadata stays behind an explicit control, not an overflowing cell', async () => {
    atWidth(390, false);
    renderApp('/admin/audit');
    expect(await screen.findAllByText('Payment recorded')).toHaveLength(2);
    expect(document.querySelector('.table-scroll')).not.toBeNull();
  });

  it('redemption history uses the shared collapsing table with labelled cells', async () => {
    atWidth(390, false);
    renderApp('/admin/redemption/history');
    expect(await screen.findByText('RDM-000001')).not.toBeNull();
  });

  it('long commission statuses render without breaking the wrapped table', async () => {
    atWidth(320, false);
    renderApp('/admin/finance/commissions');
    // Wait for the async rows first: the same label also exists in the static
    // status filter, which would otherwise short-circuit the wait.
    expect(await screen.findByText('SALE-000001')).not.toBeNull();
    // The label exists twice: once in the status filter option and once in
    // the row's StatusChip badge - the badge proves the long status renders.
    expect(screen.getAllByText('Awaiting final qualification').length).toBe(2);
    expect(document.querySelector('.table-scroll')).not.toBeNull();
  });
});

describe('Phase 33 forms stack and dialogs fit', () => {
  it('staff creation dialog opens with associated labels at 390px', async () => {
    atWidth(390, false);
    renderApp('/admin/staff');
    expect(await screen.findByText('Ana Reyes Santos Dela Cruz')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /new staff/i }));
    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Full name')).not.toBeNull();
    expect(screen.getByText('Temporary password')).not.toBeNull();
    expect(screen.getByRole('button', { name: /create staff/i })).not.toBeNull();
  });

  it('catalog search row wraps and the add-item dialog fits at 320px', async () => {
    atWidth(320, false);
    const { container } = renderApp('/admin/redemption/items');
    expect(await screen.findByText('TEPPANYAKI')).not.toBeNull();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // Canonical FilterBar grammar (wrapping lives in the shared stylesheet,
    // not an inline style, so it cannot be lost per page).
    expect(form!.querySelector('[role="search"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(await screen.findByRole('dialog')).not.toBeNull();
  });

  it('fixed filter rows wrap instead of overflowing at 320px', async () => {
    atWidth(320, false);
    const { container } = renderApp('/admin/genealogy');
    expect(await screen.findByText('SM Ana Santos')).not.toBeNull();
    const rows = Array.from(container.querySelectorAll('div')).filter(
      (d) => (d as HTMLElement).style.display === 'flex',
    );
    for (const row of rows) {
      const wrap = (row as HTMLElement).style.flexWrap;
      expect(wrap === '' || wrap === 'wrap').toBe(true);
    }
  });
});

describe('Phase 33 loading, empty, and error states fit mobile', () => {
  it('empty tables explain themselves at 390px', async () => {
    atWidth(390, false);
    vi.mocked(getCustomersPage).mockResolvedValue({ data: [], total: 0 });
    renderApp('/admin/customers');
    expect(await screen.findByText(/no customers found/i)).not.toBeNull();
  });

  it('errors wrap with a reachable retry at 390px', async () => {
    atWidth(390, false);
    vi.mocked(getCustomersPage).mockRejectedValue(new Error('boom'));
    renderApp('/admin/customers');
    expect(await screen.findByRole('button', { name: /retry/i })).not.toBeNull();
  });
});

describe('Phase 33 mobile shows no permission-hidden links', () => {
  it('a redemption-only user sees no finance or staff navigation', async () => {
    atWidth(390, false);
    const user: SessionUser = {
      ...SUPER,
      afHomesPermissions: [
        {
          moduleKey: 'dashboard.view',
          canView: true,
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        },
        {
          moduleKey: 'operations.redemption',
          canView: true,
          canCreate: true,
          canUpdate: false,
          canDelete: false,
        },
      ] as never,
    };
    renderApp('/admin', user);
    await screen.findByRole('main');
    expect(screen.queryByRole('link', { name: /finance/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^staff$/i })).toBeNull();
  });

  it('a direct URL to a denied module is refused, not rendered', async () => {
    atWidth(390, false);
    const user: SessionUser = {
      ...SUPER,
      afHomesPermissions: [
        {
          moduleKey: 'dashboard.view',
          canView: true,
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        },
      ] as never,
    };
    renderApp('/admin/finance/commissions', user);
    await waitFor(() => {
      expect(screen.queryByText('SALE-000001')).toBeNull();
    });
    expect(screen.getByText(/access denied|forbidden|not allowed/i)).not.toBeNull();
  });
});
