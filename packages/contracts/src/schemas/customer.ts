/**
 * AF Homes Customer Portal contracts.
 *
 * Customer authorization is ownership-based (`auth.uid()` -> `customers`), never
 * permission-based, so nothing in this file is derived from the staff module
 * model. Read models here are deliberately narrower than the staff read models:
 * a customer must never be able to obtain a government ID number, an identity
 * document path, a commission row, or a membership credential hash.
 */
import { z } from 'zod';

import { listResponseSchema } from './collection.js';
import { membershipStatusSchema, pointsEntryTypeSchema } from './lifecycle.js';

/* ================================================================== */
/* Activation                                                          */
/* ================================================================== */

/**
 * The activation request carries ONLY what is needed to redeem the token and
 * choose a password. Customer id, membership id, email, role and status are all
 * resolved server-side from the token; a caller cannot assert them.
 */
export const customerActivationRequestSchema = z
  .object({
    /** The plaintext onboarding token exactly as it was issued. Never stored. */
    onboardingToken: z.string().trim().min(20).max(400),
    password: z.string().min(10).max(200),
    passwordConfirmation: z.string().min(1).max(200),
  })
  .refine((v) => v.password === v.passwordConfirmation, {
    message: 'The passwords do not match',
    path: ['passwordConfirmation'],
  })
  // A password must not be trivially guessable. Supabase Auth applies its own
  // checks; this keeps obviously weak choices from ever reaching GoTrue.
  .refine((v) => /[a-z]/.test(v.password) && /[A-Z]/.test(v.password) && /[0-9]/.test(v.password), {
    message: 'Password must contain a lowercase letter, an uppercase letter and a digit',
    path: ['password'],
  });
export type CustomerActivationRequest = z.infer<typeof customerActivationRequestSchema>;

/**
 * Deliberately does NOT return a session or any token. The customer signs in
 * through the normal Supabase Auth password flow on the client, so no
 * credential is ever minted or proxied by this endpoint.
 */
export const customerActivationResultSchema = z.object({
  customerId: z.string().uuid(),
  customerNumber: z.string(),
  email: z.string(),
  fullName: z.string(),
  /** Tells the UI which screen to send the customer to next. */
  nextStep: z.literal('sign_in'),
});
export type CustomerActivationResult = z.infer<typeof customerActivationResultSchema>;

/* ================================================================== */
/* Profile                                                             */
/* ================================================================== */

/**
 * The customer-facing profile. Note what is ABSENT compared with the staff
 * `customerSchema`: no `governmentIdNumber`, no government ID type, no
 * `createdBy` staff id, no referral ids, no address internals beyond the
 * display lines, and no notes.
 */
export const customerProfileSchema = z.object({
  id: z.string().uuid(),
  customerNumber: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  suffix: z.string().nullable(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  dateOfBirth: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  countryCode: z.string().nullable(),
  status: z.enum(['prospect', 'active', 'suspended', 'cancelled']),
  activatedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

/* ================================================================== */
/* Membership                                                           */
/* ================================================================== */

export const customerMembershipSchema = z.object({
  id: z.string().uuid(),
  membershipNumber: z.string(),
  productName: z.string().nullable(),
  productCode: z.string().nullable(),
  status: membershipStatusSchema,
  activatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  renewalDueAt: z.string().nullable(),
  yearlyPointsAllocated: z.number().int().nonnegative(),
  pointsBalance: z.number().int().nonnegative(),
  /**
   * Whether a readable QR / fallback code is currently available. It is NOT:
   * only hashes are stored at rest, so the plaintext exists exactly once, at
   * issuance. The UI uses this to offer a re-issue rather than pretending a
   * code can be displayed.
   */
  credentialsAvailable: z.literal(false),
  credentialsNote: z.string(),
});
export type CustomerMembership = z.infer<typeof customerMembershipSchema>;

/* ================================================================== */
/* Points (read only)                                                   */
/* ================================================================== */

export const customerPointsSummarySchema = z.object({
  membershipId: z.string().uuid(),
  balance: z.number().int().nonnegative(),
  lifetimeAllocated: z.number().int().nonnegative(),
  lifetimeRedeemed: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type CustomerPointsSummary = z.infer<typeof customerPointsSummarySchema>;

/** A points entry safe for the member: no actor id, no internal metadata. */
/**
 * A points entry as the MEMBER sees it. The redemption fields are present only on
 * a `redemption` row, and they are the only "extra" this read model carries: what
 * the points were spent on, and the reference number. No staff id, no internal
 * membership or customer ids, no audit metadata.
 */
export const customerPointsEntrySchema = z.object({
  id: z.string(),
  entryType: pointsEntryTypeSchema,
  amount: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  occurredAt: z.string(),
  redemptionNumber: z.string().optional(),
  itemName: z.string().optional(),
  itemCode: z.string().optional(),
  quantity: z.number().int().positive().optional(),
});
export type CustomerPointsEntry = z.infer<typeof customerPointsEntrySchema>;

export const customerPointsLedgerSchema = listResponseSchema(customerPointsEntrySchema);

/* ================================================================== */
/* Payment history (read only)                                          */
/* ================================================================== */

/**
 * A payment as the MEMBER sees it: only their own card sale's payments, and
 * only the safe columns. Staff ids, receipt storage paths, rejection reasons
 * and internal notes are never selected and so can never reach the portal.
 */
export const customerPaymentSchema = z.object({
  id: z.string().uuid(),
  saleId: z.string().uuid(),
  amount: z.string(),
  paymentType: z.string().nullable(),
  method: z.string(),
  reference: z.string().nullable(),
  status: z.string(),
  recordedAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type CustomerPayment = z.infer<typeof customerPaymentSchema>;

export const customerPaymentListSchema = listResponseSchema(customerPaymentSchema);

/* ================================================================== */
/* Credential re-issue (one-time plaintext)                             */
/* ================================================================== */

/**
 * Re-issuing rotates BOTH identifiers and returns the new plaintext exactly
 * once. The previous values stop working immediately, which is the point: only a
 * hash is ever at rest. Never cache or log this response.
 */
export const customerCredentialsSchema = z.object({
  membershipId: z.string().uuid(),
  membershipNumber: z.string(),
  fallbackCode: z.string(),
  qrToken: z.string(),
  issuedAt: z.string(),
  /** Always present, so the UI can warn instead of silently re-issuing. */
  previousCodesInvalidated: z.literal(true),
});
export type CustomerCredentials = z.infer<typeof customerCredentialsSchema>;

/* ================================================================== */
/* Activation error codes (stable, safe to branch on)                   */
/* ================================================================== */

export const CUSTOMER_ACTIVATION_ERRORS = [
  'TOKEN_NOT_FOUND',
  'TOKEN_ALREADY_CONSUMED',
  'TOKEN_EXPIRED',
  'TOKEN_WRONG_PURPOSE',
  'CUSTOMER_NOT_ACTIVE',
  'CUSTOMER_HAS_NO_ACTIVE_MEMBERSHIP',
  'CUSTOMER_ALREADY_ACTIVATED',
  'CUSTOMER_ALREADY_CLAIMED',
  'AUTH_USER_CONFLICT',
  'ACCOUNT_ACTIVATION_FAILED',
  'LINK_FAILED',
] as const;
export type CustomerActivationError = (typeof CUSTOMER_ACTIVATION_ERRORS)[number];
