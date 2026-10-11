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
  pointRefundResultSchema,
  pointRefundRowSchema,
  pointPurchaseCancellationResultSchema,
  adjustedPointsSchema,
  appliedPointsDiscountSchema,
  purchaseRowSchema,
  servicePolicyStatusSchema,
  committedPointDiscountSchema,
  completedPurchaseSchema,
  pointDiscountQuoteSchema,
  pointRedemptionRuleSchema,
  purchaseFinancialSummarySchema,
  issuedEarningClaimSchema,
  pointEarningRuleSchema,
  purchaseReceiptSchema,
  reissuedEarningClaimSchema,
  claimRowSchema,
  serviceTierDiscountSchema,
  operationalSettlementSchema,
  resolvedMemberSchema,
  recordedPurchaseSchema,
  reversedPurchasePointsSchema,
  serviceCatalogItemSchema,
  exactDecimalStringSchema,
  type ServiceCatalogItemInput,
  type AdjustPointsInput,
  type CreatePurchaseInput,
  type PointEarningRuleInput,
  type PointRedemptionRuleInput,
  type PointRedemptionRulePatch,
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
 * What the SERVER priced for a recorded sale.
 *
 * `tierDiscountAmount` comes back down from the database, which resolved the
 * member's VIP tier and the active service rate. The request carries a quantity
 * and a unit price and nothing else: there is no rate field to send, so this
 * screen cannot express a discount it was not given.
 */
export type PricedPurchase = z.infer<typeof recordedPurchaseSchema> & {
  tierDiscountAmount?: string;
};

/**
 * Settle a purchase. This is the gate on earning: verified receipts must cover
 * the NET amount, and only a completed purchase can ever produce a claim.
 */
export const completePurchase = (purchaseId: string) =>
  post(`/earning/purchases/${purchaseId}/complete`, completedPurchaseSchema, undefined);

/**
 * Record a cash receipt against a purchase.
 *
 * A receipt is RECORDED, not money: it stays unverified until Finance accepts
 * it, and only verified receipts count toward settling the sale. The GSD who
 * records it can never be the one who verifies it.
 */
export const recordPurchaseReceipt = (input: {
  purchaseId: string;
  amount: string;
  method: string;
  reference?: string;
}) =>
  post(`/earning/purchases/${input.purchaseId}/payments`, purchaseReceiptSchema, {
    amount: input.amount,
    method: input.method,
    ...(input.reference ? { reference: input.reference } : {}),
  });

/** A purchase row as the staff list reports it. */
/** The four figures finance must keep apart, as the server reports them. */
/** A claim row, for history and investigation. */

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

export const listOwnPurchases = () => requestList('/earning/pos/purchases', purchaseRowSchema);
export const listPurchases = () => requestList('/earning/purchases', purchaseRowSchema);
export const setServicePolicyActive = (
  kind: 'rules' | 'tier-discounts',
  id: string,
  isActive: boolean,
) => patch(`/earning/${kind}/${id}`, servicePolicyStatusSchema, { isActive });
export const listFinancePurchases = () =>
  requestList('/earning/finance/purchases', purchaseRowSchema);
export { purchaseRowSchema };
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
  /** The VIP tier discount, kept separate from any points discount. */
  tierDiscountAmount?: string;
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
  request(
    `/redemptions/resolve?identifier=${encodeURIComponent(identifier)}`,
    resolvedMemberSchema,
  );

export const createService = (input: ServiceCatalogItemInput) =>
  post('/earning/services', serviceCatalogItemSchema, input);
export const updateService = (id: string, input: Partial<ServiceCatalogItemInput>) =>
  patch(`/earning/services/${id}`, serviceCatalogItemSchema, input);
export const uploadServicePhoto = (
  id: string,
  input: { replacePhotoId?: string; mimeType: string; dataBase64: string; alt: string },
) => post(`/earning/services/${id}/photos`, serviceCatalogItemSchema, input);

export const listEarningRules = () => requestList('/earning/rules', pointEarningRuleSchema);

/**
 * Operational Services VIP tier discounts: an admin-configured percentage per
 * service per tier.
 *
 * These are separate from `card_plans.discount_percent`, which discounts a CARD
 * purchase and is never applied to a service. The two never stack, and a tier
 * discount is not a points spend: the purchase carries them as two distinct
 * figures so a report can tell "the Gold rate took 25,000 off" from "the member
 * spent points worth 25,000".
 */
export const listTierDiscounts = () =>
  requestList('/earning/tier-discounts', serviceTierDiscountSchema);

/**
 * The one settlement answer for a purchase, from the database.
 *
 * Both the GSD screen and the Finance screen render THIS, so neither can drift
 * from the server's own view of what has been received and what is claimable.
 * It is a plain read: refreshing it never advances the transaction.
 */
export const getSettlement = (purchaseId: string) =>
  request(`/earning/purchases/${purchaseId}/settlement`, operationalSettlementSchema);

/**
 * Price a discount WITHOUT spending anything.
 *
 * A quote is cheap and re-runnable, but the typed amount must survive a
 * failure so staff do not retype it. The peso value is the server's, from the
 * staycation default or the matched promotion - never computed here.
 */
export const quotePointDiscount = (purchaseId: string, pointsRequested: number) =>
  post(`/earning/purchases/${purchaseId}/quote`, pointDiscountQuoteSchema, { pointsRequested });

/**
 * Spend the quoted points.
 *
 * NOT retried automatically: a commit is a single-use quote and a money
 * movement. A retried commit would be refused as an already-used quote and
 * would read like a failure for an action that actually succeeded.
 */
export const commitPointDiscount = (quoteId: string) =>
  post(`/earning/quotes/${quoteId}/commit`, committedPointDiscountSchema, undefined);

/**
 * Spend a member's points at the till, in one authorized step.
 *
 * Only a points figure and a POS reference are sent. The peso value comes from
 * the staycation default or the configured promotion, so nothing here can
 * influence what the member pays. `reference` is the idempotency key: a retry
 * returns the original figures instead of spending the points twice.
 */
export const applyPointsDiscount = (
  purchaseId: string,
  pointsRequested: number,
  reference: string,
) =>
  post(`/earning/purchases/${purchaseId}/points-discount`, appliedPointsDiscountSchema, {
    pointsRequested,
    reference,
  });

/**
 * Promotions: what makes a NON-staycation service discountable by points.
 *
 * One service per promotion, both dates mandatory, every award still counting
 * toward the cap. Readable by anyone who may sell; writable only through the
 * authorized catalog routes. There is no browser table privilege anywhere in
 * this flow.
 */
export const listRedemptionRules = () =>
  requestList('/earning/redemption-rules', pointRedemptionRuleSchema);

export const createRedemptionRule = (input: PointRedemptionRuleInput) =>
  post('/earning/redemption-rules', pointRedemptionRuleSchema, input);

/** Activate, deactivate or correct a promotion. There is no delete: a promotion
 * whose window has passed simply grants nothing, and its row stays as audit. */
export const updateRedemptionRule = (id: string, input: PointRedemptionRulePatch) =>
  patch(`/earning/redemption-rules/${id}`, pointRedemptionRuleSchema, input);

export const createTierDiscount = (input: {
  serviceId: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD';
  discountRate: number;
  effectiveStart: string;
  effectiveEnd: string;
}) => post('/earning/tier-discounts', serviceTierDiscountSchema, input);

export const createEarningRule = (input: PointEarningRuleInput) =>
  post('/earning/rules', pointEarningRuleSchema, input);

/**
 * Reorder, feature or delete a stored photo.
 *
 * `photoId` is the SHA-256 of the storage path, never the path itself: the browser
 * must not be able to name an object it does not own.
 */
export const manageServicePhoto = (
  serviceId: string,
  photoId: string,
  operation: 'remove' | 'cover',
) =>
  request(
    operation === 'cover'
      ? `/earning/services/${serviceId}/photos/${photoId}/cover`
      : `/earning/services/${serviceId}/photos/${photoId}`,
    serviceCatalogItemSchema,
    { method: operation === 'cover' ? 'PATCH' : 'DELETE' },
  );

export const listPointRefunds = (purchaseId: string) =>
  requestList('/earning/purchases/' + purchaseId + '/point-refunds', pointRefundRowSchema);
export const refundPurchasePoints = (
  purchaseId: string,
  input: { serviceValue: string; reference: string; reason: string; serviceReviewConfirmed: true },
) => post('/earning/purchases/' + purchaseId + '/point-refunds', pointRefundResultSchema, input);
export const cancelPointPurchase = (purchaseId: string, reason: string) =>
  post(
    '/earning/purchases/' + purchaseId + '/cancel-point-reservation',
    pointPurchaseCancellationResultSchema,
    { reason },
  );

export const listPurchasesPage = (page: number) =>
  requestList('/earning/purchases?page=' + page, purchaseRowSchema);
export const listClaimsPage = (page: number) =>
  requestList('/earning/claims?page=' + page, claimRowSchema);
