import { z } from 'zod';
import { listResponseSchema } from './collection.js';
import { exactDecimalStringSchema } from './money.js';
const reference = z.string().trim().min(3).max(120);
export const serviceRefundRequestSchema = z
  .object({
    serviceValue: exactDecimalStringSchema,
    cashAmount: exactDecimalStringSchema,
    reference,
    reason: z.string().trim().min(3).max(1000),
    serviceReviewConfirmed: z.literal(true),
  })
  .strict();
export const serviceRefundDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'cancel']),
    serviceReviewConfirmed: z.literal(true),
  })
  .strict();
export const serviceRefundRepaymentSchema = z
  .object({
    amount: exactDecimalStringSchema,
    method: z.enum(['cash', 'bank_transfer', 'gcash', 'other']),
    reference,
    repaidAt: z.string().datetime({ offset: true }),
    receipt: z
      .object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
        dataBase64: z
          .string()
          .max(4 * 1024 * 1024)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export const serviceRefundIdSchema = z.object({ id: z.string().uuid() });
export const serviceRefundRowSchema = z.object({
  id: z.string().uuid(),
  purchaseId: z.string().uuid(),
  purchaseNumber: z.string(),
  reference: z.string(),
  status: z.enum([
    'pending_approval',
    'approved_pending_repayment',
    'partially_repaid',
    'completed',
    'rejected',
    'cancelled',
  ]),
  serviceValue: exactDecimalStringSchema,
  cashAmount: exactDecimalStringSchema,
  cashRepaid: exactDecimalStringSchema,
  cashOutstanding: exactDecimalStringSchema,
  pointsRestored: z.number().int().nonnegative(),
  earnedPointsAdjusted: z.number().int().nonnegative(),
  reason: z.string(),
  requestedAt: z.string(),
  receiptAttempts: z
    .array(
      z.object({
        auditId: z.string(),
        reference: z.string(),
        preparedAt: z.string(),
        status: z.enum(['unresolved', 'abandoned']),
      }),
    )
    .optional(),
  repayments: z.array(
    z.object({
      id: z.string().uuid(),
      amount: exactDecimalStringSchema,
      method: z.string(),
      reference: z.string(),
      repaidAt: z.string(),
      recordedBy: z.string(),
      receiptAttached: z.boolean().default(false),
    }),
  ),
});
export const serviceRefundListSchema = listResponseSchema(serviceRefundRowSchema);
export type ServiceRefundRow = z.infer<typeof serviceRefundRowSchema>;
export type ServiceRefundRequest = z.infer<typeof serviceRefundRequestSchema>;
export type ServiceRefundRepayment = z.infer<typeof serviceRefundRepaymentSchema>;

export const serviceRefundReceiptSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
});

export const serviceRefundReconciliationSchema = z
  .object({
    uploadAuditId: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine((value) => BigInt(value) <= 9223372036854775807n),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const serviceRefundReconciliationResultSchema = z.object({
  status: z.enum(['referenced', 'removed', 'cleanup_pending']),
});
