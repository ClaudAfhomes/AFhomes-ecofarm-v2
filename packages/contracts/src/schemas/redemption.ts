/**
 * AF Homes staff redemption contracts.
 *
 * Two rules shape everything here.
 *
 * 1. The client never sends a price, a balance, a status or a staff identity.
 *    A redemption request carries only WHICH membership, WHICH item, HOW MANY and
 *    a de-duplication key. Everything else is resolved server-side, so a
 *    tampered body cannot change what a redemption costs. The schemas simply have
 *    no field to put those values in.
 *
 * 2. Points are whole units, not money. Every points figure is an exact integer
 *    with no decimal part, and none of it goes through the money helpers. There is
 *    no requirement for fractional points, so introducing one would be inventing
 *    policy.
 */
import { z } from 'zod';

import { listResponseSchema } from './collection.js';
import { membershipStatusSchema } from './lifecycle.js';

/* ================================================================== */
/* Catalog                                                             */
/* ================================================================== */

/** A whole number of points. Bounded so it cannot overflow a bigint. */
export const pointsAmountSchema = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000)
  .describe('An exact whole-point amount. Points are not currency.');

export const redemptionItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  pointsCost: pointsAmountSchema.refine((n) => n > 0, 'A redeemable item must cost points'),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RedemptionItem = z.infer<typeof redemptionItemSchema>;

export const createRedemptionItemRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dot, underscore or dash only')
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullish(),
  category: z.string().trim().min(1).max(40).default('general'),
  pointsCost: pointsAmountSchema.refine((n) => n > 0, 'A redeemable item must cost points'),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreateRedemptionItemRequest = z.infer<typeof createRedemptionItemRequestSchema>;

export const updateRedemptionItemRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    category: z.string().trim().min(1).max(40).optional(),
    pointsCost: pointsAmountSchema.optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    /**
     * Deactivating, never deleting: historical redemptions must keep a resolvable
     * item. There is deliberately no "delete" verb in this contract.
     */
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to change',
  });
export type UpdateRedemptionItemRequest = z.infer<typeof updateRedemptionItemRequestSchema>;

/* ================================================================== */
/* Identifier resolution -> a safe redemption preview                 */
/* ================================================================== */

/**
 * What a staff member sees after scanning a card. Deliberately minimal: it goes
 * to a counter or a shared terminal, so it carries the name a member expects to
 * be greeted by and nothing that could be used against them.
 *
 * Absent compared with the staff customer record: government ID, government ID
 * type, date of birth, address, phone, the creating staff member, referral
 * identifiers, and every Auth internal.
 */
export const redemptionPreviewSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  customerDisplayName: z.string(),
  productName: z.string().nullable(),
  membershipStatus: membershipStatusSchema,
  /** Derived from `expires_at`, which is authoritative. */
  expired: z.boolean(),
  /** True when the card can be redeemed against right now, and why not if not. */
  redeemable: z.boolean(),
  blockedReason: z.string().nullable(),
  /** Authoritative balance, read from `points_accounts` - never from the client. */
  pointsBalance: z.number().int().nonnegative(),
  /**
   * Which identifier matched, for the staff member's reassurance. Never the value.
   *
   * `qr` / `fallback_code` are the one-time secrets; `card_number` is the
   * persistent membership number (bare or the `AFHOMES:` QR envelope) from a
   * digital VIP card; `legacy_alias` is a pre-upgrade sequential code such as
   * `MBS-000004`, preserved by the `20261028000001` membership-code upgrade.
   * All four identify the same row, and none authorizes anything by itself.
   *
   * This must stay in step with `IdentifierKind` in `api/_lib/identifier.ts`,
   * which is the only producer. When it lagged, a legacy code resolved
   * successfully on the server and was then discarded by the client at this
   * schema - see `redemption.spec.ts`.
   */
  matchedBy: z.enum(['qr', 'fallback_code', 'card_number', 'legacy_alias']),
});
export type RedemptionPreview = z.infer<typeof redemptionPreviewSchema>;

/* ================================================================== */
/* Redemption request and receipt                                     */
/* ================================================================== */

/**
 * The de-duplication key. A client-generated opaque string; see the notes on
 * `clientTransactionId` below. It authorizes nothing and carries no membership
 * data.
 */
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Use an opaque token: letters, digits, dot, dash, colon or underscore');

/**
 * Create a redemption.
 *
 * There is no `pointsCost`, no `balance`, no `status`, no `product` and no
 * `redeemedBy` field. The staff identity is taken from the authenticated session,
 * and the price from the catalog row, both server-side. `clientTransactionId` is
 * the de-duplication key for double-click, retry and refresh safety.
 */
export const createRedemptionRequestSchema = z.object({
  membershipId: z.string().uuid(),
  redemptionItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1),
  /** Opaque de-duplication key, unique per staff member. */
  clientTransactionId: idempotencyKeySchema,
});
export type CreateRedemptionRequest = z.infer<typeof createRedemptionRequestSchema>;

/**
 * The receipt. `balanceBefore` and `balanceAfter` are read from the transaction
 * itself, not computed in the browser, so a receipt can never disagree with the
 * ledger.
 */
export const redemptionReceiptSchema = z.object({
  redemptionId: z.string().uuid(),
  redemptionNumber: z.string(),
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  customerDisplayName: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unitPoints: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  totalPoints: z.number().int().positive(),
  balanceBefore: z.number().int().nonnegative(),
  balanceAfter: z.number().int().nonnegative(),
  /** Staff display name, for the receipt. Never a staff UUID. */
  redeemedByName: z.string(),
  completedAt: z.string(),
  /** True when this response is a replay of an earlier identical request. */
  replayed: z.boolean(),
});
export type RedemptionReceipt = z.infer<typeof redemptionReceiptSchema>;

/* ================================================================== */
/* History                                                             */
/* ================================================================== */

/**
 * `status` includes `voided` because the schema accommodates a future,
 * explicitly-specified void rule. Nothing in this phase can produce one.
 */
export const redemptionStatusSchema = z.enum(['completed', 'voided']);
export type RedemptionStatus = z.infer<typeof redemptionStatusSchema>;

export const redemptionSchema = z.object({
  id: z.string().uuid(),
  redemptionNumber: z.string(),
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  customerId: z.string().uuid(),
  customerDisplayName: z.string(),
  redemptionItemId: z.string().uuid(),
  /** Snapshots: what the item was called and cost AT THE TIME. */
  itemCodeSnapshot: z.string(),
  itemNameSnapshot: z.string(),
  pointsCostSnapshot: z.number().int().positive(),
  quantity: z.number().int().positive(),
  totalPoints: z.number().int().positive(),
  balanceBeforeSnapshot: z.number().int().nonnegative(),
  balanceAfterSnapshot: z.number().int().nonnegative(),
  status: redemptionStatusSchema,
  redeemedBy: z.string().uuid(),
  redeemedByName: z.string(),
  createdAt: z.string(),
  completedAt: z.string(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
});
export type Redemption = z.infer<typeof redemptionSchema>;

export const redemptionListSchema = listResponseSchema(redemptionSchema);

/* ================================================================== */
/* Customer-facing history                                             */
/* ================================================================== */

/**
 * A redemption as the MEMBER sees it in their points history. Carries the item
 * and the points spent, and nothing else: no staff id, no audit metadata, no
 * other customer, and no internal membership ids.
 */
export const customerRedemptionSchema = z.object({
  redemptionNumber: z.string(),
  itemName: z.string(),
  itemCode: z.string(),
  quantity: z.number().int().positive(),
  totalPoints: z.number().int().positive(),
  completedAt: z.string(),
  /** The balance immediately after this redemption, as recorded at the time. */
  balanceAfter: z.number().int().nonnegative(),
});
export type CustomerRedemption = z.infer<typeof customerRedemptionSchema>;

export const customerRedemptionListSchema = listResponseSchema(customerRedemptionSchema);
