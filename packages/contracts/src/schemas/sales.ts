/**
 * AF Homes Phase 2 - card products, customers, sales, and referrals.
 *
 * Money crosses the wire as an exact-decimal STRING everywhere (never a
 * number), matching the Phase 1 convention and the DB CHECK regexes.
 */
import { z } from 'zod';
import { customerCategorySchema } from './customer-import.js';

import {
  dateOfBirthSchema,
  emailSchema,
  normalizeAddressField,
  nullablePersonNameSchema,
  optionalPersonNameSchema,
  optionalPhoneSchema,
  personNameSchema,
  phoneSchema,
} from './input.js';
import { exactDecimalRateSchema, exactDecimalStringSchema } from './money.js';
import {
  customerStatusSchema,
  hierarchyRoleSchema,
  paymentSchemeSchema,
  saleStatusSchema,
  spotCashStateSchema,
} from './lifecycle.js';

/* ================================================================== */
/* Card products                                                       */
/* ================================================================== */

export const cardProductSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  /** Display name of the category (null when the category row is missing). */
  categoryName: z.string().nullable(),
  /** False when the plan's category is inactive or missing: not sellable. */
  categoryIsActive: z.boolean(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).nullable(),
  /** Spot Cash price (Stage 1 pre-opening value). */
  cashPrice: exactDecimalStringSchema,
  /** Standard 4-month installment total (a different total from Spot Cash). */
  installmentPrice: exactDecimalStringSchema,
  /** Reservation fee, included in every total (never added on top). */
  reservationFee: exactDecimalStringSchema,
  /** Days to settle a Spot Cash sale (informational; no auto-cancellation). */
  spotCashDays: z.number().int().positive(),
  /** Month count of the standard installment track. */
  standardInstallmentMonths: z.number().int().positive(),
  /** Membership validity in years, frozen onto each sale at creation. */
  validityYears: z.number().int().positive(),
  /** Internal moves allowed for this tier (Bronze: Move A only). */
  moveAEnabled: z.boolean(),
  moveB1Enabled: z.boolean(),
  moveB2Enabled: z.boolean(),
  /**
   * Legacy plan floor (pre-Stage-1 "minimum down payment"). Retained for
   * backward compatibility: the sellability coherence guard and historical
   * snapshots still reference it, but it is NOT authoritative for Stage 1
   * sale economics - the frozen scheme-specific required initial payment
   * governs new sales instead.
   */
  minimumDownPayment: exactDecimalStringSchema,
  yearlyPoints: z.number().int().nonnegative(),
  discountPercent: z.number().int().min(0).max(100),
  baseValidityYears: z.number().int().positive(),
  validityExtensionYears: z.number().int().nonnegative(),
  cardholderLimit: z.number().int().min(1).max(2),
  annualPointsTranches: z.number().int().positive(),
  totalLoyaltyValue: exactDecimalStringSchema,
  priorityReservation: z.boolean(),
  noMonthlyAnnualDues: z.boolean(),
  commissionRate: exactDecimalRateSchema,
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CardProduct = z.infer<typeof cardProductSchema>;

export const updateCardProductSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    code: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    categoryId: z.string().uuid().optional(),
    cashPrice: exactDecimalStringSchema.optional(),
    installmentPrice: exactDecimalStringSchema.optional(),
    reservationFee: exactDecimalStringSchema.optional(),
    spotCashDays: z.number().int().positive().optional(),
    standardInstallmentMonths: z.number().int().positive().optional(),
    validityYears: z.number().int().positive().optional(),
    moveAEnabled: z.boolean().optional(),
    moveB1Enabled: z.boolean().optional(),
    moveB2Enabled: z.boolean().optional(),
    minimumDownPayment: exactDecimalStringSchema.optional(),
    yearlyPoints: z.number().int().nonnegative().optional(),
    commissionRate: exactDecimalRateSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCardProductRequest = z.infer<typeof updateCardProductSchema>;

/**
 * A product edit must never leave the minimum down payment above the price, or
 * the sale would be un-payable. Enforced here and again server-side.
 */
export function assertProductEconomicsSane(input: {
  cashPrice: string;
  minimumDownPayment: string;
}): string | null {
  const price = BigInt(input.cashPrice.replace('.', '').padEnd(3, '0').slice(0, -1) || '0');
  const down = BigInt(input.minimumDownPayment.replace('.', '').padEnd(3, '0').slice(0, -1) || '0');
  return down <= price ? null : 'Minimum down payment cannot exceed the cash price';
}

/**
 * Phase 19 - card-plan codes are normalised to SCREAMING identifiers so
 * `gold`, ` Gold ` and `GOLD` can never become three different plans. The
 * existing Bronze/Silver/Gold rows already use this form and are untouched.
 */
export function normalizePlanCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Parse an exact-decimal rate into ten-thousandths, or null when malformed. */
function rateToBasisPoints(rate: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(rate);
  if (!match) return null;
  return Number(match[1]) * 10000 + Number((match[2] ?? '').padEnd(4, '0'));
}

/** A commission rate is valid only inside the closed interval 0..1. */
export function assertCommissionRateInRange(rate: string): string | null {
  const basisPoints = rateToBasisPoints(rate);
  if (basisPoints === null || basisPoints < 0 || basisPoints > 10000)
    return 'Commission rate must be between 0 and 1';
  return null;
}

/**
 * Full Phase 19 plan validation with exact-decimal arithmetic (never float):
 * cash_price > 0, minimum_down_payment in 0..price, yearly_points >= 0,
 * commission_rate in 0..1. Shape errors (regex, int) are reported by Zod;
 * this reports the cross-field and range errors.
 *
 * VIP Stage 1 adds optional scheme-economics validation: when the new pricing
 * fields are supplied they must be coherent (installment total > 0, the
 * reservation inside both totals, positive day/month/year counts). Absent
 * fields are not validated here - the database defaults fill them.
 */
export function assertCardPlanEconomicsSane(input: {
  cashPrice: string;
  minimumDownPayment: string;
  yearlyPoints: number;
  commissionRate: string;
  installmentPrice?: string;
  reservationFee?: string;
  spotCashDays?: number;
  standardInstallmentMonths?: number;
  validityYears?: number;
}): string | null {
  const toCentavos = (v: string) => BigInt(v.replace('.', '').padEnd(3, '0').slice(0, -1) || '0');
  if (toCentavos(input.cashPrice) <= 0n) return 'Cash price must be greater than zero';
  if (toCentavos(input.minimumDownPayment) < 0n) return 'Minimum down payment cannot be negative';
  if (toCentavos(input.minimumDownPayment) > toCentavos(input.cashPrice))
    return 'Minimum down payment cannot exceed the cash price';
  if (!Number.isInteger(input.yearlyPoints) || input.yearlyPoints < 0)
    return 'Yearly points cannot be negative';
  const rateError = assertCommissionRateInRange(input.commissionRate);
  if (rateError) return rateError;
  if (input.installmentPrice !== undefined && toCentavos(input.installmentPrice) <= 0n)
    return 'Installment price must be greater than zero';
  if (input.reservationFee !== undefined) {
    if (toCentavos(input.reservationFee) < 0n) return 'Reservation fee cannot be negative';
    if (toCentavos(input.reservationFee) > toCentavos(input.cashPrice))
      return 'Reservation fee cannot exceed the cash price';
    if (
      input.installmentPrice !== undefined &&
      toCentavos(input.reservationFee) > toCentavos(input.installmentPrice)
    )
      return 'Reservation fee cannot exceed the installment price';
  }
  if (input.spotCashDays !== undefined && input.spotCashDays <= 0)
    return 'Spot cash days must be positive';
  if (input.standardInstallmentMonths !== undefined && input.standardInstallmentMonths <= 0)
    return 'Standard installment months must be positive';
  if (input.validityYears !== undefined && input.validityYears <= 0)
    return 'Validity years must be positive';
  return null;
}

export const createCardProductSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().uuid().optional(),
  cashPrice: exactDecimalStringSchema,
  installmentPrice: exactDecimalStringSchema.optional(),
  reservationFee: exactDecimalStringSchema.optional(),
  spotCashDays: z.number().int().positive().optional(),
  standardInstallmentMonths: z.number().int().positive().optional(),
  validityYears: z.number().int().positive().optional(),
  moveAEnabled: z.boolean().optional(),
  moveB1Enabled: z.boolean().optional(),
  moveB2Enabled: z.boolean().optional(),
  /**
   * Legacy plan floor, kept for backward compatibility only. It is NOT the
   * Stage 1 required initial payment (that is scheme-specific and frozen per
   * sale). Omitted values default to the reservation fee server-side; the
   * management UI no longer offers this field.
   */
  minimumDownPayment: exactDecimalStringSchema.optional(),
  yearlyPoints: z.number().int().nonnegative(),
  commissionRate: exactDecimalRateSchema,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateCardProductRequest = z.infer<typeof createCardProductSchema>;

/* ================================================================== */
/* Card categories                                                     */
/* ================================================================== */

/** Database slug rule (`card_categories.slug CHECK`): lowercase slug form. */
export const CATEGORY_SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/;

export const cardCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Plans currently filed under this category (list views only). */
  planCount: z.number().int().nonnegative().optional(),
});
export type CardCategory = z.infer<typeof cardCategorySchema>;

export const createCardCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().toLowerCase().min(1).max(64).regex(CATEGORY_SLUG_RE),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateCardCategoryRequest = z.infer<typeof createCardCategorySchema>;

export const updateCardCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    slug: z.string().trim().toLowerCase().min(1).max(64).regex(CATEGORY_SLUG_RE).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCardCategoryRequest = z.infer<typeof updateCardCategorySchema>;

/**
 * Normalise a category slug to its canonical form (trimmed, lowercase), so
 * `Membership`, ` Membership ` and `membership` can never become three
 * different categories. The existing `membership` row already uses it.
 */
export function normalizeCategorySlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/* ================================================================== */
/* Customers                                                           */
/* ================================================================== */

export const governmentIdTypeSchema = z.enum([
  'philippine_id',
  'drivers_license',
  'passport',
  'tax_id',
  'other',
]);
export type GovernmentIdType = z.infer<typeof governmentIdTypeSchema>;

export const genderSchema = z.enum(['male', 'female', 'other', 'undisclosed']);

export const customerAddressSchema = z
  .object({
    line1: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .transform((v) => normalizeAddressField(v)),
    line2: z.string().trim().max(200).transform(normalizeAddressField).optional(),
    city: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((v) => normalizeAddressField(v)),
    province: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((v) => normalizeAddressField(v)),
    postalCode: z.string().trim().max(20).optional(),
    countryCode: z.string().trim().toUpperCase().length(2).default('PH'),
  })
  .refine((v) => !v.line2 || v.line2.trim().length > 0, {
    message: 'line2 must be omitted rather than blank',
  });
export type CustomerAddress = z.infer<typeof customerAddressSchema>;

/** `governmentIdNumber` is accepted on write and never returned on read. */
export const createCustomerSchema = z.object({
  firstName: personNameSchema,
  middleName: optionalPersonNameSchema,
  lastName: personNameSchema,
  suffix: z.string().trim().max(20).optional(),
  dateOfBirth: dateOfBirthSchema,
  gender: genderSchema.optional(),
  email: emailSchema,
  phone: phoneSchema,
  address: customerAddressSchema,
  governmentIdType: governmentIdTypeSchema.optional(),
  governmentIdNumber: z.string().trim().min(4).max(40).optional(),
  referralCode: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCustomerRequest = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    firstName: personNameSchema.optional(),
    middleName: nullablePersonNameSchema,
    lastName: personNameSchema.optional(),
    suffix: z.string().trim().max(20).nullable().optional(),
    gender: genderSchema.nullable().optional(),
    email: emailSchema.optional(),
    phone: optionalPhoneSchema,
    address: customerAddressSchema.optional(),
    governmentIdType: governmentIdTypeSchema.nullable().optional(),
    governmentIdNumber: z.string().trim().min(4).max(40).nullable().optional(),
    status: customerStatusSchema.optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCustomerRequest = z.infer<typeof updateCustomerSchema>;

/** Read model. The government ID number is reduced to a mask, never returned. */
export const customerSchema = z.object({
  id: z.string().uuid(),
  customerNumber: z.string(),
  /**
   * Customer Code (AF-CC-XXXXXXXX): the customer's own stable reference code.
   * NOT the Customer ID in `customerNumber`, and not an authorization token.
   * Nullish only so a pre-migration payload still parses.
   */
  customerCode: z.string().nullish(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  dateOfBirth: z.string().nullable(),
  gender: z.string().nullable(),
  address: z.unknown().nullable(),
  governmentIdType: z.string().nullable(),
  governmentIdMasked: z.string().nullable(),
  status: customerStatusSchema,
  /** Safe lifecycle flags; auth user IDs and membership rows are never exposed. */
  hasActiveMembership: z.boolean().optional(),
  /**
   * Membership facts mirrored from general Customer Lookup so the customer
   * detail page carries everything the lookup shows. Card plan code when the
   * customer holds a membership, else null. Never a membership number: codes
   * are transaction credentials and stay off this read model.
   */
  tier: z.string().nullable().optional(),
  /** Membership status when a membership exists, else null. Never a code. */
  membershipStatus: z.string().nullable().optional(),
  membershipExpiresAt: z.string().nullable().optional(),
  derivedCategory: customerCategorySchema.optional(),
  portalAccountActivated: z.boolean().optional(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customer = z.infer<typeof customerSchema>;

/** Mask a government ID for display: keep the last 4 characters only. */
export function maskGovernmentId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return `${'*'.repeat(Math.max(trimmed.length - 4, 3))}${trimmed.slice(-4)}`;
}

/* ================================================================== */
/* Card sales                                                          */
/* ================================================================== */

export const createSaleSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  /**
   * Optional target seller. Omit to sell as yourself. A caller may only name a
   * seller inside their own downline; the server resolves and validates it.
   * This is a request, never an assertion of identity.
   */
  sellerStaffId: z.string().uuid().optional(),
  /**
   * Selected VIP payment scheme. The client sends the scheme code only - every
   * figure (total, reservation, required initial, months, monthly amount,
   * validity) is resolved server-side from the plan row and frozen onto the
   * sale, so a tampered body cannot change what a sale costs. Defaults to
   * Spot Cash, preserving the pre-scheme request shape.
   */
  paymentScheme: paymentSchemeSchema.default('spot_cash'),
});
export type CreateSaleRequest = z.infer<typeof createSaleSchema>;

export const saleSchema = z.object({
  id: z.string().uuid(),
  saleNumber: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  productId: z.string().uuid(),
  productName: z.string(),
  productCode: z.string(),
  status: saleStatusSchema,
  sellerStaffId: z.string().uuid().nullable(),
  sellerName: z.string().nullable(),
  // Commercial terms are snapshots taken at sale creation. `cashPrice` is the
  // frozen SELECTED total (Spot Cash total on the spot track, installment
  // total on the installment track) - never re-read from the plan. The column
  // keeps its historical name; for Stage 1 sales read it as "selected frozen
  // sale total", not a literal cash price.
  cashPrice: exactDecimalStringSchema,
  /**
   * Legacy floor snapshot (pre-Stage-1 "minimum down payment"). Retained so
   * historical sales keep their meaning; the live threshold for new sales is
   * `requiredInitial` below.
   */
  minimumDownPayment: exactDecimalStringSchema,
  /** Frozen scheme code (lifecycle paymentSchemeSchema). */
  paymentScheme: paymentSchemeSchema,
  /** Frozen reservation fee included in the total (never added on top). */
  reservationFee: exactDecimalStringSchema,
  /** Frozen required initial payment (reservation for standard tracks, DP for B1/B2). */
  requiredInitial: exactDecimalStringSchema,
  /** Frozen installment month count (null when the scheme has no installments). */
  installmentMonths: z.number().int().positive().nullable(),
  /** Frozen monthly amount (null when the scheme has no installments). */
  monthlyAmount: exactDecimalStringSchema.nullable(),
  /** Frozen membership validity in months, from the plan's validity years. */
  validityMonths: z.number().int().positive().nullable(),
  yearlyPoints: z.number().int().nonnegative(),
  commissionRate: exactDecimalRateSchema,
  expectedCommission: exactDecimalStringSchema,
  /** VERIFIED payments only; recorded/rejected/voided amounts do not count. */
  paidAmount: exactDecimalStringSchema,
  balance: exactDecimalStringSchema,
  spotCashDeadline: z.string().nullable(),
  submittedAt: z.string().nullable(),
  paymentVerifiedAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Sale = z.infer<typeof saleSchema>;

/* ================================================================== */
/* Financial summary (server-computed, never client-supplied)           */
/* ================================================================== */

export const saleFinancialSummarySchema = z.object({
  saleId: z.string().uuid(),
  status: saleStatusSchema,
  cashPrice: exactDecimalStringSchema,
  minimumDownPayment: exactDecimalStringSchema,
  paymentScheme: paymentSchemeSchema,
  reservationFee: exactDecimalStringSchema,
  requiredInitial: exactDecimalStringSchema,
  installmentMonths: z.number().int().positive().nullable(),
  monthlyAmount: exactDecimalStringSchema.nullable(),
  recordedTotal: exactDecimalStringSchema,
  verifiedTotal: exactDecimalStringSchema,
  rejectedTotal: exactDecimalStringSchema,
  remainingBalance: exactDecimalStringSchema,
  overpaidAmount: exactDecimalStringSchema,
  downPaymentSatisfied: z.boolean(),
  fullyPaid: z.boolean(),
  spotCashDeadline: z.string().nullable(),
  spotCashState: spotCashStateSchema,
});
export type SaleFinancialSummary = z.infer<typeof saleFinancialSummarySchema>;

/* ================================================================== */
/* Referrals / uplines                                                 */
/* ================================================================== */

export const referralRelationshipSchema = z.object({
  id: z.string().uuid(),
  subjectStaffId: z.string().uuid(),
  subjectName: z.string(),
  subjectRole: z.string(),
  uplineStaffId: z.string().uuid(),
  uplineName: z.string(),
  hierarchyRole: hierarchyRoleSchema,
  isAuthoritative: z.boolean(),
  isActive: z.boolean(),
  assignedAt: z.string(),
});
export type ReferralRelationship = z.infer<typeof referralRelationshipSchema>;

export const createReferralSchema = z.object({
  subjectStaffId: z.string().uuid(),
  uplineStaffId: z.string().uuid(),
  hierarchyRole: hierarchyRoleSchema,
});
export type CreateReferralRequest = z.infer<typeof createReferralSchema>;

export const correctReferralSchema = z.object({
  uplineStaffId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
export type CorrectReferralRequest = z.infer<typeof correctReferralSchema>;
