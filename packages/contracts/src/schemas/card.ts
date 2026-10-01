/**
 * AF Homes Phase 10 - membership card management.
 *
 * Hash-only credential storage (Phase 3) is the constraint this file is
 * designed around: the QR token and fallback code can never be recovered for
 * display, only rotated. The card view therefore carries everything printable
 * EXCEPT the codes, and the reissue response carries the plaintext pair
 * exactly once for immediate printing.
 *
 * Print and reissue are deliberately different operations. Printing records
 * that a physical card was produced (`mark-printed`); reissuing rotates the
 * credentials. A reprint of the same credentials is possible only while the
 * once-only plaintext is still on screen.
 */
import { z } from 'zod';

/**
 * Printable card data. No hashes, no customer/staff UUIDs: the membership id
 * is already in the URL, the member is a display name, and the tier comes
 * from the product catalogue.
 */
export const membershipCardSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  memberName: z.string(),
  customerStatus: z.string().nullable(),
  tierName: z.string(),
  tierCode: z.string(),
  categoryName: z.string().nullable(),
  status: z.string(),
  pointsBalance: z.number().int().nonnegative(),
  yearlyPointsAllocated: z.number().int().nonnegative(),
  activatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /**
   * Frozen membership validity in whole years, from the sale snapshot
   * (validity months / 12). Customer-safe: a duration, never economics.
   */
  validityYears: z.number().int().positive().nullable(),
  /**
   * Persistent identifiers for print and staff desks: the membership number
   * itself and the exact QR payload (`AFHOMES:<number>`). Printable because
   * they authorize nothing - every use is re-validated server-side.
   */
  memberCode: z.string(),
  qrPayload: z.string(),
  cardIssuedAt: z.string().nullable(),
  issuedBy: z.string().nullable(),
  lastPrintedAt: z.string().nullable(),
  printCount: z.number().int().nonnegative(),
});
export type MembershipCard = z.infer<typeof membershipCardSchema>;

/** Privileged rotation requires a written reason. No fee, no approval chain. */
export const reissueMembershipCardSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type ReissueMembershipCardRequest = z.infer<typeof reissueMembershipCardSchema>;

/**
 * Rotation result. The plaintext pair is returned exactly once for immediate
 * printing and is never stored, never logged, and never re-fetchable.
 */
export const reissuedMembershipCardSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  fallbackCode: z.string(),
  qrToken: z.string(),
  issuedAt: z.string(),
  previousCodesInvalidated: z.literal(true),
});
export type ReissuedMembershipCard = z.infer<typeof reissuedMembershipCardSchema>;

/** Print receipt. Recording a print never rotates credentials. */
export const markedPrintedSchema = z.object({
  membershipId: z.string().uuid(),
  printCount: z.number().int().nonnegative(),
  lastPrintedAt: z.string(),
  reprint: z.boolean(),
});
export type MarkedPrinted = z.infer<typeof markedPrintedSchema>;
