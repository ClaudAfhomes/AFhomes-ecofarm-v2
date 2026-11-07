import { z } from 'zod';
import { exactDecimalStringSchema, exactDecimalRateSchema } from './money.js';
export const pointApprovalSchema = z.object({
  quoteId: z.string().uuid(),
  quoteNumber: z.string(),
  purchaseNumber: z.string(),
  serviceName: z.string(),
  lines: z.array(
    z.object({
      serviceName: z.string(),
      quantity: z.number().int().positive(),
      tierDiscountRate: z.number().min(0).max(100).nullable(),
    }),
  ),
  pesoValuePerPoint: exactDecimalRateSchema,
  pointsRequested: z.number().int().positive(),
  pesoValue: exactDecimalStringSchema,
  grossAmount: exactDecimalStringSchema,
  tierDiscountAmount: exactDecimalStringSchema,
  finalAmountPayable: exactDecimalStringSchema,
  serviceDates: z.object({ serviceDate: z.string().nullable().optional(), checkInDate: z.string().nullable().optional(), checkOutDate: z.string().nullable().optional() }).optional(),
  allowanceType: z.enum(['weekday', 'weekend', 'mixed']).nullable().optional(),
  weekdayPoints: z.number().int().nonnegative().nullable().optional(),
  weekendPoints: z.number().int().nonnegative().nullable().optional(),
  expiresAt: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'completed']),
});
export const pointApprovalDecisionSchema = z.object({ approve: z.boolean() }).strict();
export const pointApprovalDecisionResultSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});
export type PointApproval = z.infer<typeof pointApprovalSchema>;

export const pointRefundInputSchema = z
  .object({
    serviceValue: z.string().regex(/^(0|[1-9][0-9]*)([.][0-9]{1,2})?$/),
    reference: z.string().trim().min(3).max(120),
    reason: z.string().trim().min(3).max(1000),
    serviceReviewConfirmed: z.literal(true),
  })
  .strict();
export const pointRefundResultSchema = z.object({
  refundId: z.string().uuid(),
  pointsRestored: z.number().int().nonnegative(),
  balanceAfter: z.number().int().nonnegative(),
});
export const pointRefundRowSchema = z.object({
  id: z.string().uuid(),
  serviceValue: exactDecimalStringSchema,
  pointsRestored: z.number().int().nonnegative(),
  reference: z.string(),
  reason: z.string(),
  reviewedBy: z.string().uuid(),
  reviewedAt: z.string(),
});
export const pointPurchaseCancellationSchema = z
  .object({ reason: z.string().trim().min(3).max(1000) })
  .strict();
export const pointPurchaseCancellationResultSchema = z.object({ status: z.literal('reversed') });
