import { z } from 'zod';
import { exactDecimalStringSchema } from './money.js';

/**
 * AF Homes points contracts.
 *
 * Two things this file must never do, because both are security properties
 * rather than conveniences:
 *
 * 1. Accept a points figure, a balance, a cap, or a peso value from the client.
 *    Every request schema here carries identifiers and a REQUESTED count only.
 *    The authoritative balance, the award, the cap and the conversion are all
 *    computed server-side; a tampered body cannot change what a claim is worth
 *    or what a discount costs.
 * 2. Treat points as money. Points are whole integers. No decimal, no rounding,
 *    and never an exact-decimal string.
 */

/** An exact whole-point amount. Points are not currency, so this is an integer. */
export const pointsAmountSchema = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000)
  .describe('An exact whole-point amount. Points are not currency.');

/** The three VIP tiers. Tier always resolves from card_plans.code, never a request. */
export const tierSchema = z.enum(['BRONZE', 'SILVER', 'GOLD']);

/** A points-year period, half-open [periodStart, periodEnd) in Asia/Manila. */
export const pointsPeriodSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  tier: tierSchema,
  /** The cap SNAPSHOT taken when the period opened, not a live lookup. */
  annualCap: pointsAmountSchema,
  earnedThisPeriod: pointsAmountSchema,
  redeemedThisPeriod: pointsAmountSchema,
});

/**
 * The customer's points position.
 *
 * `spendable` and `remainingEarningCapacity` are deliberately separate and must
 * never be conflated in a view: capacity is what may still be earned this
 * period, spendable is what can be spent right now. They differ whenever
 * reversal debt is outstanding, and a member must never read one as the other.
 */
export const pointsBalanceSummarySchema = z.object({
  membershipId: z.string().uuid(),
  balance: pointsAmountSchema,
  annualCap: pointsAmountSchema,
  /** How much more may be earned this period. NOT spendable. */
  remainingEarningCapacity: pointsAmountSchema,
  /** greatest(0, balance - reversalDebt). Zero while debt is outstanding. */
  spendable: pointsAmountSchema,
  /** Non-monetary. No automatic expiry, no waiver. */
  reversalDebt: pointsAmountSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  tier: tierSchema,
  earnedThisPeriod: pointsAmountSchema,
  redeemedThisPeriod: pointsAmountSchema,
});

export const customerPointsEntrySchema = z.object({
  id: z.string(),
  entryType: z.enum([
    'annual_allocation',
    'redemption',
    'adjustment',
    'reversal',
    'expiration',
    'earned',
    'annual_reset',
    'promotional_bonus',
    'cutover_baseline',
  ]),
  amount: z.number().int(),
  balanceAfter: pointsAmountSchema,
  reason: z.string().nullable(),
  occurredAt: z.string(),
  /** Present on an earned row, so the member can see which transaction paid. */
  reference: z.string().nullable(),
});

/**
 * A customer-bound earning claim. Returned by staff after creating one, and by
 * the customer after redeeming one.
 *
 * `qrToken` and `fallbackCode` are the ONLY time the plaintext exists. The
 * server stores SHA-256 hashes and cannot recover them, so a lost credential is
 * reissued, never looked up.
 */
export const earningClaimSchema = z.object({
  claimId: z.string().uuid(),
  claimNumber: z.string(),
  qrToken: z.string().optional(),
  fallbackCode: z.string().optional(),
  pointsRequested: pointsAmountSchema,
  pointsAwarded: pointsAmountSchema,
  /** The part of the award the cap refused. Recorded, never silently dropped. */
  pointsCapped: pointsAmountSchema,
  status: z.enum(['available', 'claimed', 'expired', 'reversed']),
  expiresAt: z.string(),
});

/**
 * Redeem a claim. The token may be a bare credential OR a full AF Homes claim
 * URL; the server parses the URL, extracts the credential, and still re-verifies
 * ownership before consuming anything.
 *
 * Request schemas are `.strict()`. Zod otherwise STRIPS unknown keys, so a
 * forged `balance` or `pesoValue` would be silently dropped. That is harmless to
 * the value but hides a tampering attempt; on a financial contract the field
 * must be a loud error instead, so an attempt is visible rather than invisible.
 */
export const claimEarningPointsRequestSchema = z
  .object({
    token: z.string().trim().min(1).max(2000),
  })
  .strict();

/**
 * Create an earning claim for a purchase.
 *
 * The request names ONE thing: the purchase. There is deliberately no points
 * figure, no balance, no cap and no peso value, because all of those are
 * resolved inside the database from the rule, the tier and the remaining
 * capacity. `.strict()` so a forged field is a loud error rather than a silent
 * strip - a stripped field is harmless to the value but hides the attempt.
 */
/**
 * What a successful claim paid out.
 *
 * `pointsAwarded` is what the member actually received after the cap, and
 * `pointsCapped` is the part the cap refused. The capped figure is RETURNED, not
 * hidden: a member who earned 60,000 and received 40,000 is entitled to know the
 * other 20,000 was capped, not to silently lose it.
 */
export const claimEarningPointsResultSchema = z.object({
  claimNumber: z.string(),
  pointsAwarded: pointsAmountSchema,
  pointsCapped: pointsAmountSchema,
  balanceAfter: pointsAmountSchema,
});

export const createEarningClaimRequestSchema = z
  .object({
    purchaseId: z.string().uuid(),
  })
  .strict();

export type ClaimEarningPointsRequest = z.infer<typeof claimEarningPointsRequestSchema>;
export type ClaimEarningPointsResult = z.infer<typeof claimEarningPointsResultSchema>;
export type CreateEarningClaimRequest = z.infer<typeof createEarningClaimRequestSchema>;
export type ServiceCatalogItemInput = z.infer<typeof serviceCatalogItemInputSchema>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseInputSchema>;
export type AdjustPointsInput = z.infer<typeof adjustPointsInputSchema>;
export type ReversePurchaseInput = z.infer<typeof reversePurchaseInputSchema>;
export type PointRedemptionRuleInput = z.infer<typeof pointRedemptionRuleInputSchema>;
export type PurchaseReceiptInput = z.infer<typeof purchaseReceiptInputSchema>;
export type PurchaseReceiptDecision = z.infer<typeof purchaseReceiptDecisionSchema>;
export type PointEarningRuleInput = z.infer<typeof pointEarningRuleInputSchema>;

export type PointsBalanceSummary = z.infer<typeof pointsBalanceSummarySchema>;

export const serviceCatalogItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  basePrice: exactDecimalStringSchema,
  isActive: z.boolean(),
});

/**
 * A priced points-discount offer. Produced by a quote, spent by a commit.
 *
 * `pesoValue` is what the SERVER priced, never something the client computed, and
 * `eligibleLineTotal` is shown so a member can see the cap that limited them: on a
 * mixed purchase that figure is lower than the purchase total, and hiding it would
 * make the discount look arbitrary.
 */
export const pointDiscountQuoteSchema = z.object({
  quoteId: z.string().uuid(),
  quoteNumber: z.string(),
  pointsRequested: pointsAmountSchema,
  pesoValue: exactDecimalStringSchema,
  eligibleLineTotal: exactDecimalStringSchema,
  remainingPointsAfter: pointsAmountSchema,
  expiresAt: z.string(),
});

/** The result of committing a quote: points left the card, net went down. */
export const committedPointDiscountSchema = z.object({
  purchaseId: z.string().uuid(),
  pointsSpent: pointsAmountSchema,
  discountApplied: exactDecimalStringSchema,
  netAmount: exactDecimalStringSchema,
  balanceAfter: pointsAmountSchema,
});

export const serviceCatalogItemInputSchema = z
  .object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().default(null),
    basePrice: exactDecimalStringSchema,
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * A configurable earning rule.
 *
 * There is deliberately NO cap-exemption field: every award counts toward the
 * annual cap in this release, and no request may set otherwise.
 */
export const pointEarningRuleSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  pointsAmount: z.number().int().positive(),
  eligibleTiers: z.array(tierSchema).min(1),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  isActive: z.boolean(),
  minQuantity: z.number().int().positive(),
  maxAward: pointsAmountSchema.nullable(),
  promotionReference: z.string().nullable(),
});

/**
 * A points-spending promotion.
 *
 * This is what makes a NON-staycation service discountable, so every field is
 * deliberately constrained:
 *
 *  - `serviceId` is required and singular. There is no "all services" option: a
 *    promotion must be able to say exactly what it opened up.
 *  - `effectiveStart`/`effectiveEnd` are BOTH required and the window is
 *    half-open. An indefinite promotion is unrepresentable, not merely
 *    discouraged.
 *  - `promotionReference` is required, so an unnamed offer cannot be created.
 *  - `eligibleTiers` is a non-empty subset of the three known tiers.
 *
 * There is deliberately NO cap-exemption field: every award counts toward the
 * annual cap, and adding a switch for it would be a switch to a rule that does
 * not exist.
 */
export const pointRedemptionRuleInputSchema = z
  .object({
    serviceId: z.string().uuid(),
    // Shape AND positivity. The shape regex alone admits "0" and "0.00", which
    // the table CHECK (peso_value_per_point > 0) would reject anyway - but as an
    // opaque constraint violation rather than a field the admin can fix.
    pesoValuePerPoint: z
      .string()
      .regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/)
      .refine((v) => Number(v) > 0, 'pesoValuePerPoint must be greater than zero'),
    eligibleTiers: z.array(tierSchema).min(1),
    minPoints: z.number().int().positive().default(1),
    /** null means no ceiling. */
    maxPoints: z.number().int().positive().nullable().default(null),
    /** null means no floor. */
    minPurchaseAmount: exactDecimalStringSchema.nullable().default(null),
    effectiveStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isActive: z.boolean().default(true),
    promotionReference: z.string().trim().min(3).max(200),
  })
  .strict()
  .refine((v) => v.effectiveStart < v.effectiveEnd, {
    message: 'effectiveStart must be before effectiveEnd',
    path: ['effectiveEnd'],
  });

/**
 * A partial update to a promotion. Every field optional, but a zero is never
 * indistinguishable from "absent": `minPoints: 0` fails `.positive()` above.
 *
 * `.strict()` so a forged field is a loud error. There is no way to widen a
 * promotion to "everything" or to exempt it from the cap, because no such field
 * exists to send.
 */
export const pointRedemptionRulePatchSchema = z
  .object({
    pesoValuePerPoint: z
      .string()
      .regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/)
      .refine((v) => Number(v) > 0, 'pesoValuePerPoint must be greater than zero')
      .optional(),
    eligibleTiers: z.array(tierSchema).min(1).optional(),
    minPoints: z.number().int().positive().optional(),
    maxPoints: z.number().int().positive().nullable().optional(),
    minPurchaseAmount: exactDecimalStringSchema.nullable().optional(),
    effectiveStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    effectiveEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    isActive: z.boolean().optional(),
    promotionReference: z.string().trim().min(3).max(200).optional(),
  })
  .strict();

export const pointEarningRuleInputSchema = z
  .object({
    serviceId: z.string().uuid(),
    pointsAmount: z.number().int().positive(),
    eligibleTiers: z.array(tierSchema).min(1),
    effectiveStart: z.string(),
    effectiveEnd: z.string(),
    isActive: z.boolean().default(true),
    minQuantity: z.number().int().positive().default(1),
    maxAward: pointsAmountSchema.nullable().default(null),
    promotionReference: z.string().trim().max(200).nullable().default(null),
  })
  .strict()
  .refine((v) => v.effectiveStart < v.effectiveEnd, {
    message: 'effectiveStart must be before effectiveEnd',
    path: ['effectiveEnd'],
  });

/**
 * A configurable points-to-peso conversion.
 *
 * `pesoValuePerPoint` is CONFIGURED, never assumed. One point equalling one
 * peso is a row value, not a constant, so a promotion can set a different rate
 * without a deployment.
 *
 * `maxPoints`, `minPurchaseAmount` and the two dates are NULLABLE here because
 * that is what the table actually stores: null means "no ceiling", "no floor",
 * and - for the dates - never, because the table makes BOTH ends NOT NULL, so an
 * indefinite promotion cannot be created even by direct SQL. A stricter shape that
 * demanded non-null dates would describe a table that does not exist.
 */
export const pointRedemptionRuleSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  pesoValuePerPoint: z.string().regex(/^\d+(\.\d{1,4})?$/),
  eligibleTiers: z.array(tierSchema).min(1),
  minPoints: pointsAmountSchema,
  maxPoints: pointsAmountSchema.nullable(),
  minPurchaseAmount: exactDecimalStringSchema.nullable(),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  isActive: z.boolean(),
  promotionReference: z.string().nullable(),
});

/**
 * The ONLY thing a client may say about a discount: which purchase, and how many
 * points to spend. `pesoValue`, `netAmount` and the balance are all server
 * figures, so a tampered body cannot change what the discount is worth.
 */
export const createDiscountQuoteSchema = z
  .object({
    purchaseId: z.string().uuid(),
    pointsRequested: z.number().int().positive().max(1_000_000_000),
  })
  .strict();

export const redemptionQuoteSchema = z.object({
  quoteId: z.string().uuid(),
  quoteNumber: z.string(),
  pointsRequested: pointsAmountSchema,
  /** Computed server-side from the matched rule at quote time. */
  pesoValue: exactDecimalStringSchema,
  remainingPointsAfter: pointsAmountSchema,
  expiresAt: z.string(),
});

export const purchaseLineSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitAmount: exactDecimalStringSchema,
  lineTotal: exactDecimalStringSchema,
  /**
   * The Operational Services VIP discount ACTUALLY applied to this line, frozen
   * at sale time. Absent on a line whose service had no active rule for the
   * member's tier, which is why `tierDiscountRate` is nullable alongside it
   * rather than defaulting to zero and implying a 0% rule was configured.
   */
  tierDiscountAmount: exactDecimalStringSchema.optional(),
  tierDiscountRate: z.number().positive().max(100).optional(),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD']).optional(),
});

/**
 * A service purchase.
 *
 * The accounting identity is the point of this shape:
 *
 *     grossAmount - tierDiscountAmount - pointsDiscountAmount = netAmount
 *
 * `tierDiscountAmount` is the configured VIP tier rate, applied in pesos at
 * checkout. `pointsDiscountAmount` is a POINTS conversion, spent under the
 * separately approved redemption rules. They are different discounts with
 * different rules and are deliberately two columns: collapsing them would make
 * "the Gold rate took 25,000 off" indistinguishable from "the member spent
 * points worth 25,000".
 *
 * Neither is money received. Receipts live only in `purchase_payments`.
 */
export const purchaseSchema = z.object({
  id: z.string().uuid(),
  purchaseNumber: z.string(),
  customerId: z.string().uuid(),
  membershipId: z.string().uuid(),
  status: z.enum(['draft', 'completed', 'reversed']),
  grossAmount: exactDecimalStringSchema,
  tierDiscountAmount: exactDecimalStringSchema.optional(),
  pointsDiscountAmount: exactDecimalStringSchema,
  netAmount: exactDecimalStringSchema,
  completedAt: z.string().nullable(),
  lines: z.array(purchaseLineSchema),
});

/** Gross, each discount separately, net, and what has actually been received. */
export const purchaseFinancialSummarySchema = z.object({
  purchaseId: z.string().uuid(),
  grossAmount: exactDecimalStringSchema,
  tierDiscountAmount: exactDecimalStringSchema.optional(),
  pointsDiscountAmount: exactDecimalStringSchema,
  netAmount: exactDecimalStringSchema,
  recordedTotal: exactDecimalStringSchema,
  verifiedTotal: exactDecimalStringSchema,
  rejectedTotal: exactDecimalStringSchema,
  remainingBalance: exactDecimalStringSchema,
  overpaidAmount: exactDecimalStringSchema,
  /** Verified receipts cover the NET amount, not the gross. */
  fullyPaid: z.boolean(),
});

/**
 * An admin-configured Operational Services VIP discount: one rate per service,
 * per tier, for a half-open date window.
 *
 * `discountRate` is a PERCENTAGE, not a peso value: 25 means 25%. It is never
 * derived from `card_plans.discount_percent`, which discounts CARD purchases
 * only, and the two never stack in the Operational Services checkout.
 */
export const serviceTierDiscountSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD']),
  discountRate: z.number().positive().max(100),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  isActive: z.boolean(),
});

/**
 * Configuring a tier discount. Both dates are required, so an indefinite
 * promotion is unrepresentable rather than merely discouraged.
 */
export const serviceTierDiscountInputSchema = z
  .object({
    serviceId: z.string().uuid(),
    tier: z.enum(['BRONZE', 'SILVER', 'GOLD']),
    discountRate: z.number().positive().max(100),
    effectiveStart: z.string().min(1),
    effectiveEnd: z.string().min(1),
  })
  .strict();

/**
 * Spending a member's points at the till, in one step.
 *
 * `pointsRequested` and a POS `reference` are the ONLY inputs. There is no peso
 * value, no rate, no balance and no resulting net: all four are decided by the
 * server from the CONFIGURED conversion rate, so a tampered body cannot change
 * what a member pays.
 *
 * `reference` is the idempotency key. A retried request carrying the same
 * reference is the SAME operation and returns the original figures instead of
 * spending the member's points a second time.
 */
export const applyPointsDiscountInputSchema = z
  .object({
    pointsRequested: z.number().int().positive(),
    reference: z.string().trim().min(1).max(120),
  })
  .strict();

/** What the server priced and spent. `alreadyApplied` means "this was a retry". */
export const appliedPointsDiscountSchema = z.object({
  purchaseId: z.string().uuid(),
  pointsSpent: z.number().int().nonnegative(),
  discountApplied: exactDecimalStringSchema,
  netAmount: exactDecimalStringSchema,
  balanceAfter: z.number().int().nonnegative(),
  alreadyApplied: z.boolean(),
});

/**
 * The single settlement answer for one operational purchase.
 *
 * This is what both the GSD screen and the Finance screen render, so neither can
 * disagree with the other or with the database about whether money was received
 * and whether points are claimable. `claimable` is the conjunction: completed AND
 * verified receipts covering the net AND an available claim.
 */
export const operationalSettlementSchema = z.object({
  purchaseId: z.string().uuid(),
  purchaseNumber: z.string(),
  status: z.enum(['draft', 'completed', 'reversed']),
  grossAmount: exactDecimalStringSchema,
  tierDiscountAmount: exactDecimalStringSchema,
  pointsDiscountAmount: exactDecimalStringSchema,
  netAmount: exactDecimalStringSchema,
  recordedTotal: exactDecimalStringSchema,
  verifiedTotal: exactDecimalStringSchema,
  rejectedTotal: exactDecimalStringSchema,
  remainingAmount: exactDecimalStringSchema,
  verifiedReceipts: z.number().int().nonnegative(),
  rejectedReceipts: z.number().int().nonnegative(),
  pendingReceipts: z.number().int().nonnegative(),
  fullyPaid: z.boolean(),
  claimable: z.boolean(),
  claimId: z.string().uuid().nullable(),
  claimStatus: z.string().nullable(),
});

export const createPurchaseInputSchema = z
  .object({
    /**
     * ONLY the membership. The customer is derived from it server-side, so a
     * scanned card is enough, and pairing two ids could never bill one member
     * against another member's card.
     */
    membershipId: z.string().uuid(),
    /**
     * REQUIRED, and the idempotency key for the whole sale.
     *
     * A till that retries after a lost response - or a seller who double-clicks -
     * would otherwise create a SECOND real purchase with real lines that could
     * earn points. The database treats a repeated reference as the SAME sale and
     * returns the original, so the duplicate is impossible rather than merely
     * discouraged. It is deliberately required: making it optional would make
     * "no reference" the unprotected default.
     */
    reference: z.string().trim().min(1).max(120),
    lines: z
      .array(
        z.object({
          serviceId: z.string().uuid(),
          quantity: z.number().int().positive().max(99),
          unitAmount: exactDecimalStringSchema,
        }),
      )
      .min(1),
  })
  .strict();

/**
 * A card resolved from a QR scan or a typed member code.
 *
 * Carries no customer id and no contact details: it is enough to record a
 * purchase against, and nothing more. The display name is what the staff member
 * says back to the person in front of them, so they can confirm the right card.
 */
export const resolvedMemberSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  customerDisplayName: z.string(),
  productName: z.string().nullable(),
  membershipStatus: z.string(),
  expired: z.boolean(),
  redeemable: z.boolean(),
  blockedReason: z.string().nullable(),
  pointsBalance: z.number().int(),
  // The four values `api/_lib/identifier.ts` can actually return, spelled
  // exactly as `IdentifierKind` spells them. This enum previously declared
  // `['qr','fallback']` - two of the four, under names the resolver never emits
  // - so every membership-number and legacy-code resolve was silently dropped by
  // the client. Same defect, same fix, as `redemptionPreviewSchema`.
  matchedBy: z.enum(['qr', 'fallback_code', 'card_number', 'legacy_alias']),
});

/**
 * A staff-recorded purchase, as the API returns it.
 *
 * `tierDiscountAmount` is the Operational Services VIP discount the SERVER
 * resolved from the member's tier and the active service rate. It is optional so
 * a row recorded before the tier-discount migration still validates; when it is
 * absent the discount was zero.
 */
export const recordedPurchaseSchema = z.object({
  purchaseId: z.string().uuid(),
  purchaseNumber: z.string(),
  grossAmount: exactDecimalStringSchema,
  tierDiscountAmount: exactDecimalStringSchema.optional(),
  netAmount: exactDecimalStringSchema,
});

/** A settled purchase, as `complete_purchase` returns it. */
export const completedPurchaseSchema = z.object({
  purchaseId: z.string().uuid(),
  netAmount: exactDecimalStringSchema,
  verifiedTotal: exactDecimalStringSchema,
  fullyPaid: z.literal(true),
});

/**
 * A newly created earning claim, INCLUDING the plaintext credential.
 *
 * `qrToken` and `fallbackCode` exist ONLY in this response. They are the sole
 * moment the member's claim code is readable; the server keeps hashes and cannot
 * recover them, so a lost code is reissued rather than looked up. A client must
 * therefore never cache or retry this response.
 */
export const issuedEarningClaimSchema = earningClaimSchema.extend({
  pointsReserved: pointsAmountSchema,
});

/** A rotated claim credential. Also the only time the new plaintext exists. */
export const reissuedEarningClaimSchema = z.object({
  claimId: z.string().uuid(),
  claimNumber: z.string(),
  qrToken: z.string(),
  fallbackCode: z.string(),
  expiresAt: z.string(),
});

/** The outcome of reversing a purchase's points. */
export const reversedPurchasePointsSchema = z.object({
  reversedPoints: pointsAmountSchema,
  /** Non-monetary debt. Survives the annual reset; never waived automatically. */
  reversalDebt: pointsAmountSchema,
  balanceAfter: pointsAmountSchema,
});

/** The result of a manual adjustment. */
export const adjustedPointsSchema = z.object({
  membershipId: z.string().uuid(),
  amount: z.number().int(),
  balanceAfter: pointsAmountSchema,
  reversalDebt: pointsAmountSchema,
});

/** Manual points adjustment. Always audited; never a silent balance edit. */
/**
 * Ask for a priced points discount.
 *
 * `pointsRequested` is the ONLY thing the client may say. There is deliberately no
 * `pesoValue`, no `rate` and no `netAmount`, because all three are the server's to
 * compute from the matched promotion and the eligible line total. `.strict()` so a
 * forged figure is a loud error rather than a silent strip.
 */
export const quotePointDiscountSchema = z
  .object({
    pointsRequested: z.number().int().positive().max(1_000_000_000),
  })
  .strict();

/**
 * Record a cash receipt against a purchase.
 *
 * This is the ONLY place money enters a service purchase, and it is strictly
 * separate from a points discount: a discount reduces what is DUE, a receipt is
 * money that arrived. There is deliberately no field here that could turn a
 * points figure into a receipt.
 *
 * `amount` is a POSITIVE-ONLY exact-decimal string, so neither zero nor a
 * negative can be recorded - both would be meaningless or dangerous, and the
 * database refuses them as well.
 */
export const purchaseReceiptInputSchema = z
  .object({
    amount: z.string().regex(/^[1-9][0-9]*(\.[0-9]{1,2})?$/),
    method: z.string().trim().min(1).max(60),
    /**
     * REQUIRED on the Operational Services till.
     *
     * It is the idempotency key for the receipt: `purchase_payments` carries a
     * unique (purchase_id, reference) index, so a retried request after a lost
     * response records the SAME cash once. With a null reference that index is
     * simply not consulted, and a double-click would double the recorded money
     * for one real payment.
     */
    reference: z.string().trim().min(1).max(120),
  })
  .strict();

/**
 * Accept or reject a recorded receipt.
 *
 * This is the moment money becomes real, so it is a separate attributed act from
 * recording it. A REJECTION REQUIRES a reason: an unexplained rejection is
 * unreviewable, and it is how money goes missing from a report with no trail.
 */
export const purchaseReceiptDecisionSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    rejectionReason: z.string().trim().max(500).nullable().default(null),
  })
  .strict()
  .refine((v) => v.decision !== 'rejected' || (v.rejectionReason ?? '').length > 0, {
    message: 'a rejection requires a reason',
    path: ['rejectionReason'],
  });

/** A recorded or verified cash receipt, as staff see it. */
export const purchaseReceiptSchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
  amount: exactDecimalStringSchema,
  method: z.string(),
  reference: z.string().nullable(),
  status: z.enum(['recorded', 'verified', 'rejected', 'voided']),
  recordedBy: z.string().uuid().nullable(),
  verifiedBy: z.string().uuid().nullable(),
  recordedAt: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});

export const adjustPointsInputSchema = z
  .object({
    membershipId: z.string().uuid(),
    amount: z.number().int().refine((v) => v !== 0, 'amount must not be zero'),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

/** Reversal. The reason is mandatory, because the ledger row is permanent. */
export const reversePurchaseInputSchema = z
  .object({
    purchaseId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
