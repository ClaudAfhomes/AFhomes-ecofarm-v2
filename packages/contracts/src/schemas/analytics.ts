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
  trends: z.array(analyticsTrendPointSchema),
});

export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
