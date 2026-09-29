/**
 * FilterBar adoption + UI safety scans (JAD parity completion).
 *
 * Every eligible admin list renders the canonical FilterBar (role="search")
 * instead of a one-off toolbar wrapper, and no migrated feature uses a
 * blocking browser dialog. Finance/Activation queues intentionally carry no
 * FilterBar: a queue is status-defined, not filterable.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/utils';
import type { SessionUser } from '../lib/session';
import { AfHomesStaffPage } from '../features/afhomes/AfHomesStaffPage';
import { BusinessCommissionsPage } from '../features/business/BusinessCommissionsPage';
import { BusinessCustomersPage } from '../features/business/BusinessCustomersPage';
import { BusinessProductsPage } from '../features/business/BusinessProductsPage';
import { BusinessSalesPage } from '../features/business/BusinessSalesPage';
import { PaymentSchemeGuidePage } from '../features/business/PaymentSchemeGuidePage';
import { DocumentsPage } from '../features/documents/DocumentsPage';
import { GenealogyPage } from '../features/genealogy/GenealogyPage';
import { MembershipsPage } from '../features/memberships/MembershipsPage';
import { OstApplicationsPage } from '../features/ost/OstApplicationsPage';
import { RedemptionCatalogPage } from '../features/redemption/RedemptionCatalogPage';
import { RedemptionHistoryPage } from '../features/redemption/RedemptionHistoryPage';
import { AuditPage } from '../features/reports/AuditPage';
import { ReportsPage } from '../features/reports/ReportsPage';

vi.mock('../features/afhomes/services', () => ({
  getAfHomesStaff: vi.fn(async () => []),
  getAfHomesRoles: vi.fn(async () => []),
  getAfHomesDepartments: vi.fn(async () => []),
  inviteAfHomesStaff: vi.fn(),
  updateAfHomesStaff: vi.fn(),
}));
vi.mock('../features/business/services', () => ({
  getCardProducts: vi.fn(async () => []),
  getCardProduct: vi.fn(),
  createCardProduct: vi.fn(),
  updateCardProduct: vi.fn(),
  getCardCategories: vi.fn(async () => []),
  createCardCategory: vi.fn(),
  updateCardCategory: vi.fn(),
  getCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  getSales: vi.fn(async () => []),
  createSale: vi.fn(),
  getSaleSummary: vi.fn(),
  getSalePayments: vi.fn(),
  recordPayment: vi.fn(),
  verifyPayment: vi.fn(),
  activateSale: vi.fn(),
  getFinanceQueue: vi.fn(async () => []),
  getActivationQueue: vi.fn(async () => []),
  getCommissions: vi.fn(async () => []),
  markCommissionPaid: vi.fn(),
  qualifyCommission: vi.fn(),
}));
vi.mock('../features/redemption/services', () => ({
  getRedemptionItems: vi.fn(async () => []),
  getRedemptions: vi.fn(async () => []),
  createRedemptionItem: vi.fn(),
  updateRedemptionItem: vi.fn(),
}));
vi.mock('../features/ost/services', () => ({
  getOstApplications: vi.fn(async () => []),
  getOstApplication: vi.fn(),
  approveOstApplication: vi.fn(),
  rejectOstApplication: vi.fn(),
  requestOstApplicationChanges: vi.fn(),
  getOstMembers: vi.fn(async () => []),
}));
vi.mock('../features/memberships/services', () => ({
  getMemberships: vi.fn(async () => []),
  getMembershipCard: vi.fn(),
  reissueMembershipCard: vi.fn(),
  markMembershipPrinted: vi.fn(),
}));
vi.mock('../features/genealogy/services', () => ({
  getGenealogy: vi.fn(async () => []),
}));
vi.mock('../features/reports/services', () => ({
  getReport: vi.fn(async () => ({
    report: 'sales',
    generatedAt: '2026-09-28T00:00:00.000Z',
    scope: { kind: 'global', viewerRole: 'super_admin', label: 'Global' },
    window: { from: null, to: null },
    filters: {},
    summary: { sales: 0 },
    data: [],
    meta: { total: 0, limit: 50, offset: 0 },
  })),
  exportReport: vi.fn(),
  downloadExport: vi.fn(),
  formatCell: (_key: string, value: unknown) => String(value ?? ''),
  getAudit: vi.fn(async () => ({
    report: 'audit',
    generatedAt: '2026-09-28T00:00:00.000Z',
    scope: { kind: 'global', viewerRole: 'super_admin', label: 'Audit' },
    window: { from: null, to: null },
    filters: {},
    summary: { events: 0 },
    data: [],
    meta: { total: 0, limit: 50, offset: 0 },
  })),
  exportAudit: vi.fn(),
}));
vi.mock('../features/documents/services', () => ({
  getDocuments: vi.fn(async () => []),
  requestUploadGrant: vi.fn(),
  putUploadBytes: vi.fn(),
  runDocumentOcr: vi.fn(),
  ACCEPTED_MIME: ['image/jpeg'],
  MAX_BYTES: 1,
}));

const STAFF: SessionUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Super Admin',
  email: 'admin@afhomes.test',
  roleId: 'r-admin',
  roleName: 'Super Admin',
  status: 'active',
  afHomesPermissions: [
    { moduleKey: 'dashboard.view', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'sales.card_sales', canView: true, canCreate: true, canUpdate: false, canDelete: false },
    { moduleKey: 'sales.customers', canView: true, canCreate: true, canUpdate: false, canDelete: false },
    { moduleKey: 'sales.card_plans', canView: true, canCreate: true, canUpdate: true, canDelete: false },
    { moduleKey: 'finance.payment_verification', canView: true, canCreate: false, canUpdate: true, canDelete: false },
    { moduleKey: 'finance.card_activation', canView: true, canCreate: false, canUpdate: true, canDelete: false },
    { moduleKey: 'network.commissions', canView: true, canCreate: false, canUpdate: true, canDelete: false },
    { moduleKey: 'operations.redemption', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'operations.catalog', canView: true, canCreate: true, canUpdate: true, canDelete: false },
    { moduleKey: 'network.genealogy', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'network.ost_registrations', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'governance.audit', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'sales.id_documents', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'organization.staff', canView: true, canCreate: true, canUpdate: true, canDelete: false },
  ],
};

afterEach(() => vi.clearAllMocks());

async function showsFilterBar(ui: ReactElement) {
  renderWithProviders(ui, { user: STAFF });
  expect(await screen.findByRole('search')).toBeInTheDocument();
}

describe('FilterBar adoption', () => {
  it('staff renders search + status in one toolbar', async () => {
    await showsFilterBar(<AfHomesStaffPage />);
    expect(screen.getByLabelText('Search staff')).toBeInTheDocument();
  });

  it('sales renders its status filter in one toolbar', async () => {
    await showsFilterBar(<BusinessSalesPage />);
  });

  it('customers renders search in one toolbar', async () => {
    await showsFilterBar(<BusinessCustomersPage />);
    expect(screen.getByLabelText('Search customers')).toBeInTheDocument();
  });

  it('card plans renders search + status in one toolbar', async () => {
    await showsFilterBar(<BusinessProductsPage />);
    expect(screen.getByLabelText('Search card plans')).toBeInTheDocument();
  });

  it('commissions renders search, status, and apply/clear in one toolbar', async () => {
    await showsFilterBar(<BusinessCommissionsPage />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('catalog renders search + status in one toolbar', async () => {
    await showsFilterBar(<RedemptionCatalogPage />);
    expect(screen.getByLabelText('Search catalog items')).toBeInTheDocument();
  });

  it('history renders membership, item, and date filters in one toolbar', async () => {
    await showsFilterBar(<RedemptionHistoryPage />);
    expect(screen.getByLabelText('Membership number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('OST applications renders its status filter in one toolbar', async () => {
    await showsFilterBar(<OstApplicationsPage />);
  });

  it('memberships renders search + status in one toolbar', async () => {
    await showsFilterBar(<MembershipsPage />);
    expect(screen.getByLabelText('Search member or number')).toBeInTheDocument();
  });

  it('genealogy renders search + role + status in one toolbar', async () => {
    await showsFilterBar(<GenealogyPage />);
    expect(screen.getByLabelText('Search genealogy')).toBeInTheDocument();
  });

  it('reports renders selector, dates, status, search, and exports in one toolbar', async () => {
    await showsFilterBar(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('audit renders action, entity, dates, and export in one toolbar', async () => {
    await showsFilterBar(<AuditPage />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('documents renders its scope selector in one toolbar', async () => {
    await showsFilterBar(<DocumentsPage />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
  });

  it('the internal guide carries no filterable surface', async () => {
    renderWithProviders(<PaymentSchemeGuidePage />, { user: STAFF });
    expect(await screen.findByText('Payment Scheme Guide')).toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });
});

describe('no blocking browser dialogs in migrated features', () => {
  const sources = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...sources(full));
      } else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  };

  it('uses ConfirmDialog, never window.confirm/alert', () => {
    const dir = join(__dirname, '..', 'features');
    const offenders: string[] = [];
    for (const file of sources(dir)) {
      const text = readFileSync(file, 'utf8');
      if (/window\.(confirm|alert)\s*\(/.test(text) || /[^a-zA-Z_.]alert\s*\(/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
