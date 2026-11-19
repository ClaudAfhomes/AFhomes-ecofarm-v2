import { z } from 'zod';

import { exactDecimalStringSchema } from './money.js';

/**
 * Commission operations (migration 20270105000004): holds, payout records and
 * PROPOSED recoveries. Nothing here approves, deducts, refunds or transfers
 * money; recoveries can only be proposed or dismissed.
 */
const reason = z.string().trim().min(5).max(500);

export const setCommissionHoldSchema = z.object({
  withheld: z.boolean(),
  reason,
});
export type SetCommissionHoldRequest = z.infer<typeof setCommissionHoldSchema>;

export const recordCommissionPayoutFailureSchema = z.object({
  reason,
  /** Required: failures are idempotent per (commission, reference). */
  bankReference: z.string().trim().min(1).max(100),
});
export type RecordCommissionPayoutFailureRequest = z.infer<
  typeof recordCommissionPayoutFailureSchema
>;

export const reconcileCommissionPayoutSchema = z.object({
  /** Optional when the payout already carries a reference. */
  bankReference: z.string().trim().min(3).max(100).optional(),
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, 'Enter a real calendar date.'),
});
export type ReconcileCommissionPayoutRequest = z.infer<typeof reconcileCommissionPayoutSchema>;

export const commissionRecoveryTriggerSchema = z.enum([
  'sale_cancellation',
  'rescission',
  'downgrade',
  'payment_default',
  'returned_check',
]);
export type CommissionRecoveryTrigger = z.infer<typeof commissionRecoveryTriggerSchema>;

export const proposeCommissionRecoverySchema = z.object({
  trigger: commissionRecoveryTriggerSchema,
  amount: exactDecimalStringSchema.refine((v) => /[1-9]/.test(v), {
    message: 'amount must be greater than zero',
  }),
  reason,
});
export type ProposeCommissionRecoveryRequest = z.infer<typeof proposeCommissionRecoverySchema>;

export const dismissCommissionRecoverySchema = z.object({ reason });
export type DismissCommissionRecoveryRequest = z.infer<typeof dismissCommissionRecoverySchema>;

export const commissionPayoutSchema = z.object({
  id: z.string().uuid(),
  commissionId: z.string().uuid(),
  amount: exactDecimalStringSchema,
  status: z.enum(['paid', 'failed', 'reconciled']),
  bankReference: z.string().nullable(),
  method: z.string().nullable(),
  paidOn: z.string().nullable(),
  failureReason: z.string().nullable(),
  recordedBy: z.string().uuid().nullable(),
  recordedAt: z.string(),
  reconciledBy: z.string().uuid().nullable(),
  reconciledAt: z.string().nullable(),
});
export type CommissionPayout = z.infer<typeof commissionPayoutSchema>;

export const commissionRecoveryCaseSchema = z.object({
  id: z.string().uuid(),
  commissionId: z.string().uuid(),
  trigger: commissionRecoveryTriggerSchema,
  paymentAdjustmentId: z.string().uuid().nullable(),
  proposedAmount: exactDecimalStringSchema,
  /** Always "0.00": no recovery path exists. */
  recoveredAmount: exactDecimalStringSchema,
  reason: z.string(),
  status: z.enum(['proposed', 'dismissed']),
  requestedBy: z.string().uuid(),
  requestedAt: z.string(),
  dismissedBy: z.string().uuid().nullable(),
  dismissedAt: z.string().nullable(),
  dismissalNote: z.string().nullable(),
});
export type CommissionRecoveryCase = z.infer<typeof commissionRecoveryCaseSchema>;

/** Result of a mutation: the affected row id. */
export const commissionOpResultSchema = z.object({ id: z.string().uuid() });
