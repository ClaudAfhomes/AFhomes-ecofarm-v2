import { act, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { AnalyticsOverview, SalesTrendReport } from '@afhomes/contracts';
import type { SessionUser } from '../../lib/session';
import { renderWithProviders } from '../../test/utils';
import { useAfHomesSalesTrend } from './useAfHomesSalesTrend';

const deferred = vi.hoisted(() => {
  let releaseChart!: () => void;
  const chart = new Promise<void>((resolve) => {
    releaseChart = resolve;
  });
  return { chart, releaseChart, overview: vi.fn(), trend: vi.fn() };
});
vi.mock('./services', async (original) => ({
  ...(await original<typeof import('./services')>()),
  getAnalyticsOverview: deferred.overview,
  getAfHomesSalesTrend: deferred.trend,
}));
vi.mock('./AfHomesTrendChart', async () => {
  await deferred.chart;
  return {
    AfHomesTrendChart: () => {
      const query = useAfHomesSalesTrend('month');
      return <p>{query.data ? 'Trend ready' : 'Trend pending'}</p>;
    },
  };
});
vi.mock('./SaleTeamAccreditationCard', () => ({ SaleTeamAccreditationCard: () => null }));
vi.mock('./PendingPayrollApprovalsCard', () => ({ PendingPayrollApprovalsCard: () => null }));
vi.mock('../engagement/AnnouncementsFeedCard', () => ({ AnnouncementsFeedCard: () => null }));

import { AfHomesDashboardPage } from './AfHomesDashboardPage';

function overview(kind: AnalyticsOverview['scope']['kind']): AnalyticsOverview {
  return {
    period: 'month',
    window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'UTC' },
    scope: {
      kind,
      viewerStaffId: '00000000-0000-4000-8000-000000000001',
      viewerRole: 'admin',
      attributedSaleCount: 0,
      unattributedLegacySaleCount: 0,
      unattributedLegacySaleValue: '0.00',
    },
    headline: {
      totalCustomers: 0,
      newCustomers: 0,
      totalCardSales: 0,
      periodSales: 0,
      grossFrozenSaleValue: '0.00',
      periodVerifiedPayments: '0.00',
      activatedMemberships: 0,
    },
    queues: {
      pendingPaymentVerification: 0,
      activationReadySales: 0,
      fullPaidSales: 0,
      rejectedPayments: 0,
      spotCashActive: 0,
      spotCashExpired: 0,
    },
    sellers: null,
    organization:
      kind === 'organization'
        ? {
            totalStaff: 0,
            activeStaff: 0,
            inactiveStaff: 0,
            invitedStaff: 0,
            suspendedStaff: 0,
            activeDepartments: 0,
          }
        : null,
    networkContext: null,
    commissions: null,
    redemptions: null,
    salesByPlan: [],
    salesByScheme: [],
    trends: [],
  };
}

function renderDashboard(kind: AnalyticsOverview['scope']['kind'], salesAllowed: boolean) {
  deferred.overview.mockResolvedValue(overview(kind));
  const user: SessionUser = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'TEST OPERATOR',
    email: 'operator@fixture.test',
    roleId: 'admin-role',
    roleSlug: 'admin',
    roleName: 'Admin',
    status: 'active',
    afHomesPermissions: salesAllowed
      ? [
          {
            moduleKey: 'sales.card_sales',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
        ]
      : [],
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return renderWithProviders(<AfHomesDashboardPage />, { user, queryClient });
}

it('prefetches only a visible authorized trend while its chart code loads and reuses the read', async () => {
  const report: SalesTrendReport = {
    granularity: 'month',
    generatedAt: new Date().toISOString(),
    periods: [],
  };
  deferred.trend.mockResolvedValue(report);
  const denied = renderDashboard('finance', false);
  await screen.findByRole('heading', { name: 'Operations Overview' });
  expect(deferred.trend).not.toHaveBeenCalled();
  denied.unmount();
  denied.client.clear();
  const organization = renderDashboard('organization', true);
  await screen.findByRole('heading', { name: 'Operations Overview' });
  expect(deferred.trend).not.toHaveBeenCalled();
  organization.unmount();
  organization.client.clear();
  const allowed = renderDashboard('finance', true);
  try {
    await waitFor(() => expect(deferred.trend).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(allowed.client.getQueryState(['analytics', 'sales-trend', 'month'])?.status).toBe(
        'success',
      ),
    );
    expect(screen.queryByText('Trend ready')).not.toBeInTheDocument();
  } finally {
    await act(async () => deferred.releaseChart());
  }
  expect(await screen.findByText('Trend ready')).toBeInTheDocument();
  expect(deferred.trend).toHaveBeenCalledTimes(1);
});
