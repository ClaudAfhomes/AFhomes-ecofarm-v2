/**
 * AF Homes Phase 2 - payments, activation, memberships, points, commissions.
 */
import { z } from 'zod';

import { exactDecimalRateSchema, exactDecimalStringSchema } from './money.js';
import {
  commissionStatusSchema,
  membershipStatusSchema,
  paymentStatusSchema,
  paymentTypeSchema,
  pointsEntryTypeSchema,
  spotCashStateSchema,
} from './lifecycle.js';

/* ================================================================== */
/* Payments                                                            */
/* ================================================================== */

export const paymentSchema = z.object({
  id: z.string().uuid(),
  saleId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  amount: exactDecimalStringSchema,
  paymentType: paymentTypeSchema,
  method: z.string(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  status: paymentStatusSchema,
  rejectionReason: z.string().nullable(),
  recordedBy: z.string().uuid(),
  verifiedBy: z.string().uuid().nullable(),
  recordedAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type Payment = z.infer<typeof paymentSchema>;

/**
 * Record a payment. `amount` must be a positive exact-decimal string. The
 * caller never sends a paid total, a balance, or a resulting status - those are
 * computed server-side from the payment rows.
 */
export const recordPaymentSchema = z.object({
  amount: exactDecimalStringSchema.refine((v) => !v.startsWith('0') || /^0\.0[1-9]/.test(v), {
    message: 'amount must be greater than zero',
  }),
  paymentType: paymentTypeSchema,
  method: z.string().trim().min(1).max(40),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  /** Private bucket path for a receipt. Never a public URL. */
  receiptStoragePath: z.string().trim().max(300).optional(),
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentSchema>;

export const verifyPaymentSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision !== 'rejected' || (v.reason && v.reason.trim().length >= 3), {
    message: 'A rejection requires a reason',
    path: ['reason'],
  });
export type VerifyPaymentRequest = z.infer<typeof verifyPaymentSchema>;

/* ================================================================== */
/* Activation                                                          */
/* ================================================================== */

export const activateSaleSchema = z.object({
  validityMonths: z.number().int().min(1).max(60).default(12),
});
export type ActivateSaleRequest = z.infer<typeof activateSaleSchema>;

/**
 * Result of a successful activation. The plaintext fallback code and QR token
 * are returned exactly once and are never stored in readable form.
 */
export const activationResultSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  fallbackCode: z.string().nullable(),
  qrToken: z.string().nullable(),
  pointsAllocated: z.number().int().nonnegative(),
  alreadyActive: z.boolean(),
});
export type ActivationResult = z.infer<typeof activationResultSchema>;

/* ================================================================== */
/* Memberships / cards                                                 */
/* ================================================================== */

export const membershipSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  customerStatus: z.string().nullable(),
  saleId: z.string().uuid(),
  membershipNumber: z.string(),
  productId: z.string().uuid().nullable(),
  productName: z.string().nullable(),
  categoryName: z.string().nullable(),
  status: membershipStatusSchema,
  pointsBalance: z.number().int().nonnegative(),
  yearlyPointsAllocated: z.number().int().nonnegative(),
  activatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  renewalDueAt: z.string().nullable(),
  cardIssuedAt: z.string().nullable(),
  issuedBy: z.string().nullable(),
  lastPrintedAt: z.string().nullable(),
  printCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Membership = z.infer<typeof membershipSchema>;

/**
 * Server-side identifier resolution. Identifiers never authorize anything on
 * their own - this is the single place that turns a scanned/typed identifier
 * into a membership, and the caller must still check status and permission.
 */
export const membershipResolutionSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  status: membershipStatusSchema,
  pointsBalance: z.number().int().nonnegative(),
  expired: z.boolean(),
});
export type MembershipResolution = z.infer<typeof membershipResolutionSchema>;

/* ================================================================== */
/* Points                                                              */
/* ================================================================== */

export const pointsAccountSchema = z.object({
  id: z.string().uuid(),
  membershipId: z.string().uuid(),
  balance: z.number().int().nonnegative(),
  lifetimeAllocated: z.number().int().nonnegative(),
  lifetimeRedeemed: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type PointsAccount = z.infer<typeof pointsAccountSchema>;

export const pointsLedgerEntrySchema = z.object({
  id: z.string(),
  accountId: z.string().uuid(),
  entryType: pointsEntryTypeSchema,
  amount: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type PointsLedgerEntry = z.infer<typeof pointsLedgerEntrySchema>;

/* ================================================================== */
/* Commissions                                                         */
/* ================================================================== */

export const commissionSchema = z.object({
  id: z.string().uuid(),
  saleId: z.string().uuid(),
  saleNumber: z.string(),
  beneficiaryType: z.enum(['staff', 'ost']),
  beneficiaryName: z.string(),
  rate: exactDecimalRateSchema,
  basisAmount: exactDecimalStringSchema,
  amount: exactDecimalStringSchema,
  status: commissionStatusSchema,
  qualificationNotes: z.string().nullable(),
  qualifiedAt: z.string().nullable(),
  earnedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Commission = z.infer<typeof commissionSchema>;

/**
 * Explicit qualification decision. This is the ONLY way a commission reaches
 * `earned`, and it is deliberately a separate, audited, permission-gated
 * action: the rule that permits qualification is not defined in this codebase
 * and is never inferred from payment state.
 */
export const qualifyCommissionSchema = z.object({
  decision: z.enum(['earned', 'cancelled']),
  notes: z.string().trim().min(5).max(500),
});
export type QualifyCommissionRequest = z.infer<typeof qualifyCommissionSchema>;

/**
 * Explicit paid decision. This is the ONLY way a commission reaches `paid`:
 * `earned -> paid`, permission-gated and audited. The amount and the
 * seller/upline snapshot never change here. `reference` is an optional
 * payout reference stored as `paid_reference` when the column exists.
 */
export const markCommissionPaidSchema = z.object({
  reference: z.string().trim().max(100).optional(),
});
export type MarkCommissionPaidRequest = z.infer<typeof markCommissionPaidSchema>;

/* ================================================================== */
/* Customer account onboarding                                         */
/* ================================================================== */

export const issueOnboardingTokenSchema = z.object({
  purpose: z.enum(['account_activation', 'password_reset']).default('account_activation'),
  validHours: z.number().int().min(1).max(168).default(72),
});
export type IssueOnboardingTokenRequest = z.infer<typeof issueOnboardingTokenSchema>;

/** The plaintext token is returned exactly once, to the issuing staff member. */
export const onboardingTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  purpose: z.string(),
});
export type OnboardingToken = z.infer<typeof onboardingTokenSchema>;

/* ================================================================== */
/* Queue summaries                                                     */
/* ================================================================== */

export const financeQueueItemSchema = z.object({
  saleId: z.string().uuid(),
  saleNumber: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  productName: z.string(),
  status: z.string(),
  cashPrice: exactDecimalStringSchema,
  verifiedTotal: exactDecimalStringSchema,
  remainingBalance: exactDecimalStringSchema,
  downPaymentSatisfied: z.boolean(),
  fullyPaid: z.boolean(),
  spotCashState: spotCashStateSchema,
  spotCashDeadline: z.string().nullable(),
  /** First VERIFIED payment instant (spot_cash_started_at). Null until one exists. */
  firstVerifiedPayment: z.string().nullable(),
  activatable: z.boolean(),
});
export type FinanceQueueItem = z.infer<typeof financeQueueItemSchema>;
