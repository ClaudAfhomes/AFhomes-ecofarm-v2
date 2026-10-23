import { z } from 'zod';
import { commissionStatusSchema, saleStatusSchema } from './lifecycle.js';
import { exactDecimalStringSchema } from './money.js';
import { memberPositionSchema } from './member.js';

export const IST_ROLES = ['vice_director', 'senior_sales_manager', 'sales_manager'] as const;
export const isIstRole = (role: string | undefined) =>
  (IST_ROLES as readonly string[]).includes(role ?? '');
export const istPortalViewSchema = z.enum([
  'dashboard',
  'my-sales',
  'team-sales',
  'my-commissions',
  'team-commissions',
]);
export type IstPortalView = z.infer<typeof istPortalViewSchema>;
export const istPortalQuerySchema = z
  .object({
    view: istPortalViewSchema.default('dashboard'),
    from: z.iso.date(),
    to: z.iso.date(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .refine((v) => v.from <= v.to, 'Start date must not follow end date.');
export const istTeamCommissionQuerySchema = z
  .object({
    ...istPortalQuerySchema.shape,
    role: memberPositionSchema.optional(),
    status: commissionStatusSchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to, 'Start date must not follow end date.');
export type IstTeamCommissionFilters = Pick<
  z.infer<typeof istTeamCommissionQuerySchema>,
  'role' | 'status' | 'search'
>;
const metrics = z.object({
  salesCount: z.number().int().nonnegative().nullable(),
  qualifyingSales: z.number().int().nonnegative().nullable(),
  salesAmount: exactDecimalStringSchema.nullable(),
  toEarn: exactDecimalStringSchema.nullable(),
  earned: exactDecimalStringSchema.nullable(),
  paid: exactDecimalStringSchema.nullable(),
});
export const istPortalReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  account: z.object({
    name: z.string(),
    role: z.string(),
    status: z.string(),
    staffNumber: z.string().nullable(),
    head: z.string().nullable(),
  }),
  personal: metrics,
  ost: metrics.extend({ withSales: z.number().nullable(), withoutSales: z.number().nullable() }),
  team: z.object({
    total: z.number(),
    active: z.number(),
    salesCount: z.number().nullable(),
    salesAmount: exactDecimalStringSchema.nullable(),
    withSales: z.number().nullable(),
    withoutSales: z.number().nullable(),
  }),
  teamCommissionOverview: z
    .object({
      role: memberPositionSchema,
      scopeLabel: z.string(),
      availableRoles: z.array(memberPositionSchema),
      totals: metrics,
      breakdown: z.array(
        metrics.pick({ toEarn: true, earned: true, paid: true }).extend({
          role: memberPositionSchema,
          recordCount: z.number().int().nonnegative(),
        }),
      ),
    })
    .nullable()
    .default(null),
  sales: z.array(
    z.object({
      id: z.string(),
      saleNumber: z.string(),
      createdAt: z.string(),
      customerName: z.string().nullable(),
      tier: z.string().nullable(),
      amount: exactDecimalStringSchema,
      status: saleStatusSchema,
    }),
  ),
  commissions: z.array(
    z.object({
      id: z.string(),
      commissionNumber: z.string().nullable(),
      memberName: z.string(),
      memberRole: memberPositionSchema.nullable().default(null),
      saleNumber: z.string(),
      amount: exactDecimalStringSchema,
      status: commissionStatusSchema,
      createdAt: z.string(),
      earnedAt: z.string().nullable(),
      paidAt: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type IstPortalReport = z.infer<typeof istPortalReportSchema>;
