/**
 * AFHomes Phase 2 - payments, activation, memberships, points, commissions.
 */
import { z } from 'zod';

import { exactDecimalRateSchema, exactDecimalStringSchema } from './money.js';
import { vipTierSchema } from './official-forms.js';
import {
  activationBlockerSchema,
  commissionStatusSchema,
  membershipStatusSchema,
  paymentSchemeSchema,
  paymentStatusSchema,
  paymentTypeSchema,
  pointsEntryTypeSchema,
  saleStatusSchema,
  spotCashStateSchema,
} from './lifecycle.js';

/* ================================================================== */
/* Payment Purpose                                                     */
/* ================================================================== */

export const paymentPurposeSchema = z.enum([
  'reservation_fee',
  'contractual_down_payment',
  'contractual_installment',
  'contractual_full',
]);
export type PaymentPurpose = z.infer<typeof paymentPurposeSchema>;

/* ================================================================== */
/* Payments                                                            */
/* ================================================================== */

export const paymentSchema = z.object({
  id: z.string().uuid(),
  saleId: z.string().uuid(),
  /** System payment ID (AF-PAY-XXXXX). Nullish only pre-migration. */
  paymentNumber: z.string().nullish(),
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
  /** Authoritative payment purpose. Server-controlled, never client-supplied. */
  paymentPurpose: paymentPurposeSchema.nullable(),
  /** Display names resolved server-side; UUIDs stay the source of truth. */
  recordedByName: z.string().nullable().optional(),
  verifiedByName: z.string().nullable().optional(),
  recordedAt: z.string(),
  verifiedAt: z.string().nullable(),
  /** Official Receipt number, when one was issued. */
  orNumber: z.string().nullable().optional(),
  /** Actual payment date on the receipt (YYYY-MM-DD); distinct from recordedAt/verifiedAt. */
  paidOn: z.string().nullable().optional(),
  /** Who paid. Information only - a relative may pay; never an identifier. */
  paidByName: z.string().nullable().optional(),
  /** Accounting month (YYYY-MM, Asia/Manila) stamped at verification. */
  postingPeriod: z.string().nullable().optional(),
});
export type Payment = z.infer<typeof paymentSchema>;

/** Optional receipt details Finance may add while a payment is pending. */
export const paymentReceiptDetailsShape = {
  orNumber: z.string().trim().min(1).max(60).optional(),
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  paidByName: z.string().trim().min(1).max(120).optional(),
} as const;

/**
 * Why a payment whose bank reference / OR also appears on ANOTHER contract is
 * legitimate (for example one transfer split across two contracts). Required
 * before such a payment can be verified.
 */
export const paymentDuplicateReviewSchema = z.object({
  duplicateReviewNote: z.string().trim().min(5).max(500),
});

/** A live payment on another contract sharing the reference or OR number. */
export const paymentReferenceMatchSchema = z.object({
  paymentId: z.string().uuid(),
  saleId: z.string().uuid().nullable(),
  reservationId: z.string().uuid().nullable(),
  amount: exactDecimalStringSchema,
  status: paymentStatusSchema,
  reference: z.string().nullable(),
  orNumber: z.string().nullable(),
  recordedAt: z.string(),
});
export type PaymentReferenceMatch = z.infer<typeof paymentReferenceMatchSchema>;

/** Figures for one accounting month: dashboard cards and the pre-close checklist. */
export const financePeriodSummarySchema = z.object({
  period: z.string(),
  status: z.enum(['open', 'ready_for_approval', 'closed']),
  verifiedCount: z.number(),
  verifiedTotal: exactDecimalStringSchema,
  latePostings: z.number(),
  pendingVerification: z.number(),
  heldForDuplicateReview: z.number(),
  proposedAdjustments: z.number(),
  earlierOpenPeriods: z.array(z.string()),
  /** Verified payments that belong to no period (should always be 0). */
  unassignedVerified: z.number().optional(),
  /** Fingerprint of the payments that make up the period. */
  paymentSetHash: z.string().optional(),
});
export type FinancePeriodSummary = z.infer<typeof financePeriodSummarySchema>;

export const accountingPeriodSchema = z.object({
  period: z.string(),
  status: z.enum(['open', 'ready_for_approval', 'closed']),
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  closedAt: z.string().nullable(),
  returnedReason: z.string().nullable(),
  /** The frozen figures stored at close; null until then. */
  snapshot: z.record(z.string(), z.unknown()).nullable(),
});
export type AccountingPeriod = z.infer<typeof accountingPeriodSchema>;

export const returnAccountingPeriodSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

/**
 * Reversal / returned check / refund of a VERIFIED payment. Proposals only: no
 * approval authority is configured, so a proposal never changes a balance.
 */
export const paymentAdjustmentKindSchema = z.enum(['reversal', 'returned_check', 'refund']);
export const proposePaymentAdjustmentSchema = z.object({
  kind: paymentAdjustmentKindSchema,
  amount: exactDecimalStringSchema.refine((v) => /[1-9]/.test(v), {
    message: 'amount must be greater than zero',
  }),
  reason: z.string().trim().min(5).max(500),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ProposePaymentAdjustmentRequest = z.infer<typeof proposePaymentAdjustmentSchema>;
export const paymentAdjustmentSchema = z.object({
  id: z.string().uuid(),
  paymentId: z.string().uuid(),
  kind: paymentAdjustmentKindSchema,
  amount: exactDecimalStringSchema,
  reason: z.string(),
  effectiveDate: z.string(),
  status: z.enum(['proposed', 'approved', 'rejected', 'withdrawn']),
  requestedBy: z.string().uuid(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
});
export type PaymentAdjustment = z.infer<typeof paymentAdjustmentSchema>;

/**
 * Record a payment. `amount` must be a positive exact-decimal string. The
 * caller never sends a paid total, a balance, or a resulting status - those are
 * computed server-side from the payment rows.
 */
export const recordPaymentSchema = z.object({
  /** Stable UUID for one recording action; mandatory when reference is absent. */
  requestId: z.string().uuid().optional(),
  amount: exactDecimalStringSchema.refine((v) => !v.startsWith('0') || /^0\.0[1-9]/.test(v), {
    message: 'amount must be greater than zero',
  }),
  paymentType: paymentTypeSchema,
  method: z.string().trim().min(1).max(40),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  /** Private bucket path for a receipt. Required. Never a public URL. */
  receiptStoragePath: z.string().trim().min(1).max(300),
  /** Authoritative payment purpose. Server-validated, not inferred from amount. */
  paymentPurpose: paymentPurposeSchema.optional(),
  ...paymentReceiptDetailsShape,
});

/** Types the private `afhomes-payment-receipts` bucket accepts (10 MB limit). */
export const PAYMENT_RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;
export const PAYMENT_RECEIPT_MAX_BYTES = 10_485_760;

/** Ask for a signed upload grant; the server chooses the object path. */
export const paymentReceiptUploadRequestSchema = z.object({
  contentType: z.enum(PAYMENT_RECEIPT_CONTENT_TYPES),
  byteSize: z.number().int().positive().max(PAYMENT_RECEIPT_MAX_BYTES),
});
export type PaymentReceiptUploadRequest = z.infer<typeof paymentReceiptUploadRequestSchema>;

/** PUT the file to `uploadUrl`, then send `receiptStoragePath` when recording the payment. */
export const paymentReceiptUploadGrantSchema = z.object({
  receiptStoragePath: z.string().min(1),
  uploadUrl: z.string().url(),
  expiresAt: z.string(),
});
export type PaymentReceiptUploadGrant = z.infer<typeof paymentReceiptUploadGrantSchema>;
export type RecordPaymentRequest = z.infer<typeof recordPaymentSchema>;

/** Same minimum the SQL verification and document-review functions enforce. */
export const REJECTION_REASON_MIN_LENGTH = 5;

export const verifyPaymentSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) =>
      v.decision !== 'rejected' ||
      (v.reason && v.reason.trim().length >= REJECTION_REASON_MIN_LENGTH),
    {
      message: `A rejection requires a reason of at least ${REJECTION_REASON_MIN_LENGTH} characters`,
      path: ['reason'],
    },
  );
export type VerifyPaymentRequest = z.infer<typeof verifyPaymentSchema>;

/* ================================================================== */
/* Activation                                                          */
/* ================================================================== */

export const activateSaleSchema = z.object({
  /**
   * Membership validity in months. New VIP sales carry a frozen validity on
   * the sale row and the RPC prefers it; this parameter remains the fallback
   * for pre-scheme sales. The ceiling covers the frozen 22-year Gold term
   * (264 months) with headroom.
   */
  validityMonths: z.number().int().min(1).max(360).default(12),
});
export type ActivateSaleRequest = z.infer<typeof activateSaleSchema>;

export const onboardingDeliverySchema = z.object({
  status: z.enum(['email_sent', 'manual_required', 'not_issued', 'already_active']),
  emailStatus: z.enum(['sent', 'failed', 'not_attempted']),
  token: z.string().min(20).max(400).nullable(),
  activationUrl: z.string().url().nullable(),
  expiresAt: z.string().nullable(),
});
export type OnboardingDelivery = z.infer<typeof onboardingDeliverySchema>;

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
  onboarding: onboardingDeliverySchema,
});
export type ActivationResult = z.infer<typeof activationResultSchema>;

/* ================================================================== */
/* Memberships / cards                                                 */
/* ================================================================== */

export const membershipSchema = z.object({
  vipCardNumber: z.string().nullable().optional(),
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
  /** Frozen scheme of the originating sale (display only, never economics). */
  paymentScheme: paymentSchemeSchema.nullable(),
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
  /** Public commission ID (AF-COM-XXXXX). Nullish only pre-migration. */
  commissionNumber: z.string().nullish(),
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

export const commissionRuleTargetSchema = z.enum(['role', 'staff', 'ost']);
/** A commission rate is a fraction of the sale: 0 to 1 (1 = 100%). */
const commissionRateSchema = exactDecimalRateSchema.refine((rate) => Number(rate) <= 1, {
  message: 'Rate cannot exceed 1',
});
export const commissionRuleSchema = z.object({
  id: z.string().uuid(),
  targetType: commissionRuleTargetSchema,
  targetId: z.string().uuid(),
  targetName: z.string().nullable(),
  rate: exactDecimalRateSchema,
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  accreditedOnOrAfter: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createCommissionRuleSchema = z
  .object({
    targetType: commissionRuleTargetSchema,
    targetId: z.string().uuid(),
    rate: commissionRateSchema,
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    accreditedOnOrAfter: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((v) => !v.effectiveUntil || v.effectiveUntil >= v.effectiveFrom, {
    message: 'Effective until cannot precede effective from',
    path: ['effectiveUntil'],
  });
export const updateCommissionRuleSchema = z
  .object({
    rate: commissionRateSchema.optional(),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    effectiveUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    accreditedOnOrAfter: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type CommissionRule = z.infer<typeof commissionRuleSchema>;
export type CreateCommissionRuleRequest = z.infer<typeof createCommissionRuleSchema>;
export type UpdateCommissionRuleRequest = z.infer<typeof updateCommissionRuleSchema>;

/**
 * Commission roster: every active seller with their sales activity and the rate
 * that would apply to their next sale. `source` says where that rate comes from:
 * their own rule (`custom`), their position default (`position`) or nothing (`none`, 0%).
 */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const commissionRosterQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  position: z.string().trim().max(60).optional(),
  sales: z.enum(['all', 'with', 'without']).default('all'),
  needsRate: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const commissionRosterMemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  positionSlug: z.string(),
  positionName: z.string(),
  salesCount: z.number().int().nonnegative(),
  lastSaleAt: z.string().nullable(),
  rate: exactDecimalRateSchema,
  source: z.enum(['custom', 'position', 'none']),
  ruleId: z.string().uuid().nullable(),
});
export const commissionRosterPositionSchema = z.object({
  roleId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
  defaultRuleId: z.string().uuid().nullable(),
  defaultRate: exactDecimalRateSchema.nullable(),
});
export const commissionRosterSchema = z.object({
  positions: z.array(commissionRosterPositionSchema),
  members: z.array(commissionRosterMemberSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  needsRateCount: z.number().int().nonnegative(),
});
export const bulkCommissionRuleSchema = z
  .object({
    memberIds: z.array(z.string().uuid()).min(1).max(200),
    rate: commissionRateSchema,
    // Always open-ended: it replaces whatever personal rule is running from this date.
    effectiveFrom: dateOnly,
  })
  .refine((v) => new Set(v.memberIds).size === v.memberIds.length, {
    message: 'Members must be unique',
    path: ['memberIds'],
  });
export const bulkCommissionRuleResultSchema = z.object({
  created: z.number().int().nonnegative(),
  replaced: z.number().int().nonnegative(),
});
export type CommissionRosterQuery = z.infer<typeof commissionRosterQuerySchema>;
export type CommissionRosterMember = z.infer<typeof commissionRosterMemberSchema>;
export type CommissionRosterPosition = z.infer<typeof commissionRosterPositionSchema>;
export type CommissionRoster = z.infer<typeof commissionRosterSchema>;
export type BulkCommissionRuleRequest = z.infer<typeof bulkCommissionRuleSchema>;
export type BulkCommissionRuleResult = z.infer<typeof bulkCommissionRuleResultSchema>;

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

/** Authorized staff recovery response. The token exists only inside the one-time URL. */
export const customerOnboardingRecoverySchema = z.object({
  status: z.enum(['email_sent', 'manual_required']),
  emailStatus: z.enum(['sent', 'failed']),
  email: z.string().email(),
  activationUrl: z.string().url(),
  expiresAt: z.string(),
});
export type CustomerOnboardingRecovery = z.infer<typeof customerOnboardingRecoverySchema>;

/* ================================================================== */
/* Queue summaries                                                     */
/* ================================================================== */

export const financeQueueItemSchema = z.object({
  saleId: z.string().uuid(),
  saleNumber: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  productName: z.string(),
  /** VIP tier from the sale's card plan code; null only for a non-tier plan. */
  tier: vipTierSchema.nullable(),
  /** Authoritative sale lifecycle state; unknown codes are rejected, never coerced. */
  status: saleStatusSchema,
  cashPrice: exactDecimalStringSchema,
  paymentScheme: paymentSchemeSchema,
  reservationFee: exactDecimalStringSchema,
  requiredInitial: exactDecimalStringSchema,
  installmentMonths: z.number().int().positive().nullable(),
  monthlyAmount: exactDecimalStringSchema.nullable(),
  validityMonths: z.number().int().positive().nullable(),
  verifiedTotal: exactDecimalStringSchema,
  remainingBalance: exactDecimalStringSchema,
  downPaymentSatisfied: z.boolean(),
  fullyPaid: z.boolean(),
  spotCashState: spotCashStateSchema,
  spotCashDeadline: z.string().nullable(),
  /** First VERIFIED payment instant (spot_cash_started_at). Null until one exists. */
  firstVerifiedPayment: z.string().nullable(),
  activatable: z.boolean(),
  /** Server-computed reason activation is unavailable; null exactly when `activatable`. */
  activationBlocker: activationBlockerSchema.nullable(),
});
export type FinanceQueueItem = z.infer<typeof financeQueueItemSchema>;

/* ================================================================== */
/* Commission Records (pre-finalization entitlements)                  */
/* ================================================================== */

export const commissionRecordSchema = z.object({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
  saleId: z.string().uuid().nullable(),
  beneficiaryType: z.enum(['staff', 'ost']),
  beneficiaryStaffId: z.string().uuid().nullable(),
  beneficiaryOstId: z.string().uuid().nullable(),
  commissionRuleId: z.string().uuid().nullable(),
  rateSnapshot: exactDecimalRateSchema,
  basisAmountSnapshot: exactDecimalStringSchema,
  expectedAmount: exactDecimalStringSchema,
  cumulativeVerified: exactDecimalStringSchema,
  status: z.enum(['pending', 'eligible', 'paid', 'cancelled']),
  eligibleAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  paidReference: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CommissionRecord = z.infer<typeof commissionRecordSchema>;

export const requestCommissionPayoutSchema = z.object({
  reference: z.string().trim().min(3).max(100),
});
export type RequestCommissionPayoutRequest = z.infer<typeof requestCommissionPayoutSchema>;
