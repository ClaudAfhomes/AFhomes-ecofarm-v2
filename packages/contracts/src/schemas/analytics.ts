import { z } from 'zod';
import { commissionStatusSchema } from './lifecycle.js';

export const analyticsPeriodSchema = z.enum(['day', 'week', 'month', 'year']);
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;

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
/* Sales Overview trend (JAD SalesTrendChart parity)                   */
/* ------------------------------------------------------------------ */

/**
 * Dedicated Sales Overview series, mirroring JAD's `salesTrendReportSchema`.
 * One bucket per period (`YYYY-MM` for months, `YYYY` for years) with the
 * count of qualifying sales and the exact-decimal sum of their frozen sale
 * value. Qualifying = sale status `active` (activated membership): activation
 * is AF Homes' explicit recognition decision after full verified payment, the
 * same role JAD's `QUALIFYING_SALE` transition plays after `PAYMENT_VERIFIED`.
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
