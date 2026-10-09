/**
 * Staff points-earning API client.
 *
 * Thin, like every other client in this app: a path, a verb and a contract
 * schema. No business rule and no authorization decision lives in the browser.
 *
 * Three of these calls return a ONE-TIME SECRET (`issueEarningClaim`,
 * `reissueEarningClaim`). Those must never be cached, never retried and never
 * fired from a refetch, and the queries below mark them accordingly.
 */
import {
  adjustedPointsSchema,
  committedPointDiscountSchema,
  completedPurchaseSchema,
  pointDiscountQuoteSchema,
  purchaseFinancialSummarySchema,
  issuedEarningClaimSchema,
  pointEarningRuleSchema,
  pointRedemptionRuleSchema,
  purchaseReceiptSchema,
  reissuedEarningClaimSchema,
  resolvedMemberSchema,
  recordedPurchaseSchema,
  reversedPurchasePointsSchema,
  serviceCatalogItemSchema,
  exactDecimalStringSchema,
  type AdjustPointsInput,
  type CreatePurchaseInput,
  type PointEarningRuleInput,
  type PointRedemptionRuleInput,
  type ReversePurchaseInput,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

/** POST with a validated response, matching the rest of the admin client. */
const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body ?? {}) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body ?? {}) });

/**
 * Record a purchase. The gross is computed by the server from the lines, so no
 * total is sent from here: a tampered figure would simply be refused.
 */
export const recordPurchase = (input: CreatePurchaseInput) =>
  post('/earning/purchases', recordedPurchaseSchema, input);

/**
 * Settle a purchase. This is the gate on earning: verified receipts must cover
 * the NET amount, and only a completed purchase can ever produce a claim.
 */
export const completePurchase = (purchaseId: string) =>
  post(`/earning/purchases/${purchaseId}/complete`, completedPurchaseSchema, undefined);

/** A purchase row as the staff list reports it. */
export const purchaseRowSchema = z.object({
  id: z.string().uuid(),
  purchaseNumber: z.string(),
  customerId: z.string().uuid(),
  membershipId: z.string().uuid(),
  status: z.enum(['draft', 'completed', 'reversed']),
  grossAmount: exactDecimalStringSchema,
  pointsDiscountAmount: exactDecimalStringSchema,
  netAmount: exactDecimalStringSchema,
  completedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
  reversalReason: z.string().nullable(),
  createdAt: z.string().nullable(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      serviceId: z.string().uuid(),
      quantity: z.number().int(),
      unitAmount: exactDecimalStringSchema,
      lineTotal: exactDecimalStringSchema,
    }),
  ),
});

/** The four figures finance must keep apart, as the server reports them. */
/** A claim row, for history and investigation. */
export const claimRowSchema = z.object({
  id: z.string().uuid(),
  claimNumber: z.string(),
  customerId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  status: z.enum(['available', 'claimed', 'expired', 'reversed']),
  pointsRequested: z.number().int(),
    pointsReserved: z.number().int(),
  pointsAwarded: z.number().int(),
  pointsCapped: z.number().int(),
  expiresAt: z.string().nullable(),
  claimedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

/** What recording a receipt returns. `recorded` is explicitly NOT settled. */
export const purchaseReceiptWriteSchema = z.object({
  paymentId: z.string().uuid(),
  paymentNumber: z.string(),
  amount: exactDecimalStringSchema,
  status: z.string(),
});

/** What verifying or rejecting returns, with the purchase's new verified total. */
export const purchaseReceiptDecisionResultSchema = z.object({
  paymentId: z.string().uuid(),
  status: z.string(),
  verifiedTotal: exactDecimalStringSchema,
});

export const listPurchases = () => requestList('/earning/purchases', purchaseRowSchema);
export type PurchaseRow = z.infer<typeof purchaseRowSchema>;

/** Claims, for investigation. Read-only: there is no edit verb anywhere. */
export const listClaims = () => requestList('/earning/claims', claimRowSchema);
export type ClaimRow = z.infer<typeof claimRowSchema>;

/**
 * Record a cash receipt.
 *
 * Returns `status: 'recorded'`, which is NOT yet money - it does not count toward
 * the amount due until verified, so the UI must not present a recorded payment as
 * settling the purchase.
 */
export const recordReceipt = (
  purchaseId: string,
  input: { amount: string; method: string; reference: string | null },
) => post(`/earning/purchases/${purchaseId}/payments`, purchaseReceiptWriteSchema, input);

export const listReceipts = (purchaseId: string) =>
  requestList(`/earning/purchases/${purchaseId}/payments`, purchaseReceiptSchema);

/** Accept or reject a recorded receipt. This is the moment the money becomes real. */
export const decideReceipt = (
  paymentId: string,
  input: { decision: 'verified' | 'rejected'; rejectionReason: string | null },
) => post(`/earning/payments/${paymentId}/verify`, purchaseReceiptDecisionResultSchema, input);

export type PurchaseSummaryRow = {
  purchaseId: string;
  grossAmount: string;
  pointsDiscountAmount: string;
  netAmount: string;
  recordedTotal: string;
  verifiedTotal: string;
  rejectedTotal: string;
  remainingBalance: string;
  overpaidAmount: string;
  fullyPaid: boolean;
};

export const getPurchaseSummary = (purchaseId: string) =>
  request(`/earning/purchases/${purchaseId}/summary`, purchaseFinancialSummarySchema);

/**
 * Price a discount WITHOUT spending anything.
 *
 * `retry: 0` and a preserved input: a quote is cheap and re-runnable, but the
 * typed amount must survive a failure so staff do not retype it.
 */
export const quotePointDiscount = (purchaseId: string, pointsRequested: number) =>
  post(`/earning/purchases/${purchaseId}/quote`, pointDiscountQuoteSchema, { pointsRequested });

/**
 * Spend the quoted points.
 *
 * NOT retried automatically: a commit is a single-use quote and a money movement.
 * A retried commit would be refused as an already-used quote and would read like
 * a failure for an action that actually succeeded.
 */
export const commitPointDiscount = (quoteId: string) =>
  post(`/earning/quotes/${quoteId}/commit`, committedPointDiscountSchema, undefined);

export const reversePurchasePoints = (input: ReversePurchaseInput) =>
  post(`/earning/purchases/${input.purchaseId}/reverse`, reversedPurchasePointsSchema, {
    reason: input.reason,
  });

/**
 * Create an earning claim and hand the member their code.
 *
 * Returns the plaintext credential EXACTLY ONCE. Never cached, never retried: a
 * duplicate call would be refused as "already has a claim", and the code the
 * member needs would already be gone.
 */
export const issueEarningClaim = (purchaseId: string) =>
  post('/earning/claims', issuedEarningClaimSchema, { purchaseId });

/** Rotate a claim's credential. Also single-use plaintext. Never cached. */
export const reissueEarningClaim = (claimId: string) =>
  post(`/earning/claims/${claimId}/reissue`, reissuedEarningClaimSchema, undefined);

export const adjustPoints = (input: AdjustPointsInput) =>
  post('/earning/adjust', adjustedPointsSchema, {
    membershipId: input.membershipId,
    amount: input.amount,
    reason: input.reason,
  });

export const listServices = () => requestList('/earning/services', serviceCatalogItemSchema);

/**
 * Resolve a scanned card QR or typed member code to a membership.
 *
 * This deliberately reuses the EXISTING `/redemptions/resolve` endpoint rather
 * than adding an earning-specific one. `api/_lib/identifier.ts` is the single
 * place a QR token or fallback code becomes a membership, so a second resolver
 * would be a second definition of "valid card" that could drift from the first.
 *
 * The response carries no customer id and no PII beyond a display name: the
 * purchase derives its customer from the membership server-side.
 */
export const resolveMemberIdentifier = (identifier: string) =>
  request(`/redemptions/resolve?identifier=${encodeURIComponent(identifier)}`, resolvedMemberSchema);

export const createService = (input: {
  code: string;
  name: string;
  basePrice: string;
}) => post('/earning/services', serviceCatalogItemSchema, input);

export const listEarningRules = () => requestList('/earning/rules', pointEarningRuleSchema);

/**
 * Promotions: what makes a NON-staycation service discountable by points.
 *
 * Readable with the points-read permission, writable only through the authorized
 * catalog routes. There is no browser table privilege anywhere in this flow.
 */
export const listRedemptionRules = () =>
  requestList('/earning/redemption-rules', pointRedemptionRuleSchema);

export const createRedemptionRule = (input: PointRedemptionRuleInput) =>
  post('/earning/redemption-rules', pointRedemptionRuleSchema, input);

/** A partial update. There is no field here that could remove an end date. */
export const updateRedemptionRule = (input: { id: string; isActive: boolean }) =>
  patch(`/earning/redemption-rules/${input.id}`, pointRedemptionRuleSchema, {
    isActive: input.isActive,
  });

export const createEarningRule = (input: PointEarningRuleInput) =>
  post('/earning/rules', pointEarningRuleSchema, input);

