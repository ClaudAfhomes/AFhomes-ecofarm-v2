/**
 * AF Homes Phase 8 - OST registration and approval workflow.
 *
 * Reuses the Phase 1 tables (`referral_codes`, `ost_applications`,
 * `ost_members`) and the Phase 7 genealogy model. No new status vocabulary
 * beyond the Phase 1 CHECKs: `submitted` IS the pending state.
 *
 * Two rules this file exists to enforce:
 *
 * - The browser never names a sponsor. Public submission carries the raw
 *   referral CODE; the sponsor is resolved and frozen server-side from the
 *   code hash. There is deliberately no `sponsorStaffId` field in the public
 *   request schema, so a tampered body cannot override the code.
 * - A referral QR is transport only. `buildOstRegistrationUrl` encodes the
 *   code into a registration link; backend validation remains authoritative
 *   and the URL carries no secret besides the shareable code itself.
 */
import { z } from 'zod';

import {
  birthDateSchema,
  emailSchema,
  optionalPersonNameSchema,
  personNameSchema,
  phoneSchema,
} from './input.js';
import { customerAddressSchema } from './sales.js';

/* ------------------------------------------------------------------ */
/* Lifecycle (single source - mirrors the Phase 1 CHECKs)              */
/* ------------------------------------------------------------------ */

/** `submitted` is the pending state; there is no separate `pending`. */
export const ostApplicationStatusSchema = z.enum([
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
]);
export type OstApplicationStatus = z.infer<typeof ostApplicationStatusSchema>;

/** States that are still reviewable (not terminal). */
export const OST_REVIEWABLE_STATUSES: readonly OstApplicationStatus[] = [
  'submitted',
  'under_review',
  'changes_requested',
];

/** Terminal states. An approved/rejected/withdrawn application never moves. */
export const OST_TERMINAL_STATUSES: readonly OstApplicationStatus[] = [
  'approved',
  'rejected',
  'withdrawn',
];

const OST_TRANSITIONS: Record<OstApplicationStatus, readonly OstApplicationStatus[]> = {
  submitted: ['under_review', 'approved', 'rejected', 'withdrawn'],
  under_review: ['changes_requested', 'approved', 'rejected', 'withdrawn'],
  changes_requested: ['under_review', 'withdrawn'],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export const canTransitionOstApplication = (
  from: OstApplicationStatus,
  to: OstApplicationStatus,
): boolean => (OST_TRANSITIONS[from] ?? []).includes(to);

export const ostMemberStatusSchema = z.enum(['active', 'inactive', 'suspended']);
export type OstMemberStatus = z.infer<typeof ostMemberStatusSchema>;

/* ------------------------------------------------------------------ */
/* Referral codes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Shareable SM referral code. Distinct `OST-` prefix on purpose: the member
 * fallback code is `AFH-XXXX-XXXX`, so the two can never be confused by a
 * scanner or a support desk reading them aloud.
 */
export const ostReferralCodeSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^OST-[0-9A-F]{6}-[0-9A-F]{6}$/, 'referralCode must look like OST-XXXXXX-XXXXXX');
export type OstReferralCode = z.infer<typeof ostReferralCodeSchema>;

/** Case and surrounding whitespace are noise for a hex code (unlike base64). */
export function normalizeOstReferralCode(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/[\s]/g, '');
  const nosep = compact.replace(/-/g, '');
  if (/^OST[0-9A-F]{12}$/.test(nosep)) {
    return `OST-${nosep.slice(3, 9)}-${nosep.slice(9, 15)}`;
  }
  return compact;
}

/** Registration link a referral QR encodes. Transport only, never a credential. */
export function buildOstRegistrationUrl(code: string, webBase = ''): string {
  const base = webBase.replace(/\/+$/, '');
  const path = `/ost/register?code=${encodeURIComponent(code)}`;
  return `${base}${path}`;
}

/** Safe sponsor preview. No ids, no hashes, no secrets. */
export const ostReferralResolutionSchema = z.object({
  sponsorName: z.string(),
  codeHint: z.string(),
  expiresAt: z.string(),
});
export type OstReferralResolution = z.infer<typeof ostReferralResolutionSchema>;

/* ------------------------------------------------------------------ */
/* Public submission (no sponsor field by design)                       */
/* ------------------------------------------------------------------ */

export const submitOstApplicationSchema = z.object({
  referralCode: z.string().trim().min(8).max(64),
  firstName: personNameSchema,
  middleName: optionalPersonNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  birthDate: birthDateSchema,
  address: customerAddressSchema,
});
export type SubmitOstApplicationRequest = z.infer<typeof submitOstApplicationSchema>;

export const ostApplicationSubmittedSchema = z.object({
  applicationId: z.string().uuid(),
  referenceNumber: z.string().uuid(),
  status: ostApplicationStatusSchema,
  submittedAt: z.string(),
});
export type OstApplicationSubmitted = z.infer<typeof ostApplicationSubmittedSchema>;

/* ------------------------------------------------------------------ */
/* Review (staff)                                                      */
/* ------------------------------------------------------------------ */

export const ostApplicationSchema = z.object({
  id: z.string().uuid(),
  applicantName: z.string(),
  email: z.string(),
  phone: z.string(),
  birthDate: z.string(),
  address: z.unknown().nullable(),
  sponsorStaffId: z.string().uuid(),
  sponsorName: z.string(),
  referralCodeHint: z.string(),
  status: ostApplicationStatusSchema,
  reviewNotes: z.string().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type OstApplication = z.infer<typeof ostApplicationSchema>;

export const rejectOstApplicationSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type RejectOstApplicationRequest = z.infer<typeof rejectOstApplicationSchema>;

export const requestOstApplicationChangesSchema = z.object({
  notes: z.string().trim().min(5).max(500),
});
export type RequestOstApplicationChangesRequest = z.infer<
  typeof requestOstApplicationChangesSchema
>;

export const ostMemberSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  sponsorStaffId: z.string().uuid(),
  sponsorName: z.string(),
  ostNumber: z.string(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  status: ostMemberStatusSchema,
  approvedBy: z.string().uuid(),
  approvedAt: z.string(),
  createdAt: z.string(),
});
export type OstMember = z.infer<typeof ostMemberSchema>;

/* ------------------------------------------------------------------ */
/* Referral-code management (SM self-service)                           */
/* ------------------------------------------------------------------ */

export const createOstReferralCodeSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(10),
  expiresInHours: z.number().int().min(24).max(720).default(168),
});
export type CreateOstReferralCodeRequest = z.infer<typeof createOstReferralCodeSchema>;

/** Raw code is returned exactly once at issuance and never stored. */
export const ostReferralCodeIssuedSchema = z.object({
  code: ostReferralCodeSchema,
  codeHint: z.string(),
  expiresAt: z.string(),
  maxUses: z.number().int(),
});
export type OstReferralCodeIssued = z.infer<typeof ostReferralCodeIssuedSchema>;

export const ostReferralCodeRecordSchema = z.object({
  id: z.string().uuid(),
  codeHint: z.string(),
  expiresAt: z.string(),
  maxUses: z.number().int(),
  useCount: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type OstReferralCodeRecord = z.infer<typeof ostReferralCodeRecordSchema>;
