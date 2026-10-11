import { describe, expect, it } from 'vitest';
import type { AnalyticsOverview } from '@afhomes/contracts';
import { dashboardMetrics } from './AfHomesDashboardPage';

const overview = (kind: AnalyticsOverview['scope']['kind']): AnalyticsOverview => ({
  period: 'month',
  window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'UTC' },
  scope: {
    kind,
    viewerStaffId: '00000000-0000-4000-8000-000000000001',
    viewerRole: 'test',
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
    spotCashExpired: 0,
  },
  sellers: null,
  organization:
    kind === 'organization'
      ? {
          totalStaff: 9,
          activeStaff: 6,
          inactiveStaff: 1,
          invitedStaff: 1,
          suspendedStaff: 1,
          activeDepartments: 3,
        }
      : null,
  networkContext: null,
  commissions: null,
  redemptions: kind === 'redemption' ? { count: 5, pointsRedeemed: 1000, recent: [] } : null,
  salesByPlan: [],
  salesByScheme: [],
  trends: [],
});

describe('Phase 25 role dashboard presentation', () => {
  it('gives every operational scope the same four headline cards', () => {
    for (const kind of ['global', 'finance', 'team', 'self'] as const) {
      expect(dashboardMetrics(overview(kind)).map(([label]) => label)).toEqual([
        'Total Customers',
        'New Applications',
        'Card Sales',
        'Total Sales',
      ]);
    }
  });

  it('carries the server figures behind the fixed headline labels', () => {
    expect(dashboardMetrics(overview('finance'))).toContainEqual(['Total Customers', 4]);
    expect(dashboardMetrics(overview('finance'))).toContainEqual(['New Applications', 1]);
    expect(dashboardMetrics(overview('finance'))).toContainEqual(['Card Sales', 2]);
    expect(dashboardMetrics(overview('finance'))).toContainEqual(['Total Sales', '₱60,000.00']);
  });

  it('gives HR real organization facts without financial metrics', () => {
    const metrics = dashboardMetrics(overview('organization'));
    expect(metrics).toContainEqual(['Total staff', 9]);
    expect(metrics.map(([label]) => label)).not.toContain('Total Sales');
  });

  /**
   * The dashboard caps the same server-computed set at four headline cards
   * rather than reordering or hand-picking it, so the ranking a role depends on
   * stays the ranking `dashboardMetrics` already defines.
   */
  it('ranks the headline metrics so the first four survive the dashboard cap', () => {
    expect(dashboardMetrics(overview('finance')).slice(0, 4).map(([label]) => label)).toEqual([
      'Total Customers',
      'New Applications',
      'Card Sales',
      'Total Sales',
    ]);
  });
});
