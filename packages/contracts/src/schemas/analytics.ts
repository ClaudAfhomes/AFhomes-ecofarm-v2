import { z } from 'zod';
import { commissionStatusSchema } from './lifecycle.js';

export const analyticsPeriodSchema = z.enum(['day', 'week', 'month', 'year']);
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;

/**
 * Date range schema for custom date filtering.
 * Uses ISO date strings (YYYY-MM-DD).
 */
export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  (data) => {
    if (data.from && data.to) {
      return new Date(data.from) <= new Date(data.to);
    }
    return true;
  },
  { message: 'End date must be on or after start date', path: ['to'] }
);
export type DateRange = z.infer<typeof dateRangeSchema>;

export const analyticsScopeSchema = z.enum([
  'global',
  'finance',
  'organization',
  'team',
  'self',
  'redemption',
]);
const moneySchema = z.string().regex(/^(0|[1-9][0-9]*)\.\d{2}$/);
const countSchema = z.number().int().nonnegative();

export const analyticsTrendPointSchema = z.object({
  period: z.string(),
  sales: countSchema,
  saleValue: moneySchema,
  verifiedPayments: moneySchema,
  activations: countSchema,
  redemptions: countSchema,
  pointsRedeemed: countSchema,
});

export const analyticsOverviewSchema = z.object({
  period: analyticsPeriodSchema,
  window: z.object({ from: z.string(), to: z.string(), timezone: z.literal('UTC') }),
  scope: z.object({
    kind: analyticsScopeSchema,
    viewerStaffId: z.string().uuid(),
    viewerRole: z.string(),
    attributedSaleCount: countSchema,
    unattributedLegacySaleCount: countSchema,
    unattributedLegacySaleValue: moneySchema,
  }),
  headline: z.object({
    totalCustomers: countSchema,
    newCustomers: countSchema,
    totalCardSales: countSchema,
    periodSales: countSchema,
    grossFrozenSaleValue: moneySchema,
    periodVerifiedPayments: moneySchema,
    activatedMemberships: countSchema,
  }),
  queues: z.object({
    pendingPaymentVerification: countSchema,
    activationReadySales: countSchema,
    fullPaidSales: countSchema,
    rejectedPayments: countSchema,
    spotCashActive: countSchema,
    spotCashExpired: countSchema,
  }),
  sellers: z
    .object({
      directCount: countSchema,
      descendantCount: countSchema,
      active: countSchema,
      inactive: countSchema,
      byRole: z.record(z.string(), countSchema),
    })
    .nullable(),
  organization: z
    .object({
      totalStaff: countSchema,
      activeStaff: countSchema,
      inactiveStaff: countSchema,
      invitedStaff: countSchema,
      suspendedStaff: countSchema,
      activeDepartments: countSchema,
    })
    .nullable(),
  networkContext: z
    .object({
      upperline: z.object({ id: z.string().uuid(), name: z.string(), role: z.string() }).nullable(),
    })
    .nullable(),
  commissions: z.record(commissionStatusSchema, countSchema).nullable(),
  redemptions: z
    .object({
      count: countSchema,
      pointsRedeemed: countSchema,
      recent: z.array(
        z.object({
          id: z.string().uuid(),
          redemptionNumber: z.string(),
          itemName: z.string(),
          points: countSchema,
          createdAt: z.string(),
        }),
      ),
    })
    .nullable(),
  salesByPlan: z.array(
    z.object({
      planId: z.string().uuid(),
      planName: z.string(),
      count: countSchema,
      value: moneySchema,
    }),
  ),
  /**
   * Sales grouped by frozen payment scheme (VIP Stage 1). Every scoped sale
   * carries exactly one frozen scheme, so the counts partition the scoped
   * sales; pre-scheme rows read as `spot_cash` via the column default.
   */
  salesByScheme: z.array(
    z.object({
      scheme: z.string(),
      count: countSchema,
      value: moneySchema,
    }),
  ),
  trends: z.array(analyticsTrendPointSchema),
});

export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

/* ------------------------------------------------------------------ */
/* Sales Overview trend (AFHomes sales-trend pattern)                   */
/* ------------------------------------------------------------------ */

/**
 * Dedicated Sales Overview series, mirroring the predecessor `salesTrendReportSchema`.
 * One bucket per period (`YYYY-MM` for months, `YYYY` for years) with the
 * count of qualifying sales and the exact-decimal sum of their frozen sale
 * value. Qualifying = sale status `active` (activated membership): activation
 * is AFHomes' explicit recognition decision after full verified payment, the
 * same role the predecessor's `QUALIFYING_SALE` transition plays after `PAYMENT_VERIFIED`.
 * Pipeline and cancelled sales are never counted.
 */
export const salesTrendGranularitySchema = z.enum(['month', 'year']);
export type SalesTrendGranularity = z.infer<typeof salesTrendGranularitySchema>;

export const salesTrendPeriodSchema = z.object({
  /** `YYYY-MM` (month granularity) or `YYYY` (year granularity); month 01-12. */
  key: z.string().regex(/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/),
  count: countSchema,
  /** Exact-decimal sum of `cash_price_snapshot` for the period. */
  total: moneySchema,
});
export type SalesTrendPeriod = z.infer<typeof salesTrendPeriodSchema>;

export const salesTrendReportSchema = z.object({
  granularity: salesTrendGranularitySchema,
  generatedAt: z.string(),
  periods: z.array(salesTrendPeriodSchema),
});
export type SalesTrendReport = z.infer<typeof salesTrendReportSchema>;

/* ------------------------------------------------------------------ */
/* Team Sales Activity Analytics                                      */
/* ------------------------------------------------------------------ */

/**
 * Sales activity classification for a team member.
 * Based on qualifying sales count within the reporting period.
 */
export const teamSalesActivitySchema = z.enum([
  'Top Seller',
  'With Sales',
  'Low Sales',
  'No Sales',
]);
export type TeamSalesActivity = z.infer<typeof teamSalesActivitySchema>;

/**
 * Individual member's sales performance within a team.
 */
export const teamSalesMemberSchema = z.object({
  staffId: z.string().uuid(),
  fullName: z.string(),
  role: z.string(),
  status: z.string(),
  salesCount: countSchema,
  salesActivity: teamSalesActivitySchema,
});
export type TeamSalesMember = z.infer<typeof teamSalesMemberSchema>;

/**
 * Team sales analytics for a single team (VD/SSM/SM view).
 * Returns KPIs and ranked member list for the viewer's authorized team.
 */
export const teamSalesAnalyticsSchema = z.object({
  period: analyticsPeriodSchema,
  window: z.object({ from: z.string(), to: z.string(), timezone: z.literal('UTC') }),
  viewerStaffId: z.string().uuid(),
  viewerRole: z.string(),
  kpis: z.object({
    totalTeamSales: countSchema,
    membersWithSales: countSchema,
    membersNoSales: countSchema,
    topSellerCount: countSchema,
    participationRate: z.number().min(0).max(100),
  }),
  members: z.array(teamSalesMemberSchema),
});
export type TeamSalesAnalytics = z.infer<typeof teamSalesAnalyticsSchema>;

/**
 * Team comparison entry for admin global overview.
 */
export const teamSalesTeamSchema = z.object({
  teamHead: z.object({
    staffId: z.string().uuid(),
    fullName: z.string(),
    role: z.string(),
  }),
  memberCount: countSchema,
  totalSales: countSchema,
  membersWithSales: countSchema,
  membersNoSales: countSchema,
});
export type TeamSalesTeam = z.infer<typeof teamSalesTeamSchema>;

/**
 * Admin global team sales overview.
 * Compares all VD-led teams by sales performance.
 */
export const teamSalesOverviewSchema = z.object({
  period: analyticsPeriodSchema,
  window: z.object({ from: z.string(), to: z.string(), timezone: z.literal('UTC') }),
  totalSales: countSchema,
  totalEligibleSellers: countSchema,
  sellersWithSales: countSchema,
  sellersNoSales: countSchema,
  topTeam: teamSalesTeamSchema.nullable(),
  teams: z.array(teamSalesTeamSchema),
});
export type TeamSalesOverview = z.infer<typeof teamSalesOverviewSchema>;
