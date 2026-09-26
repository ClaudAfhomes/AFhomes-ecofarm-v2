/**
 * AF Homes Phase 2 - card products, customers, sales, and referrals.
 *
 * Money crosses the wire as an exact-decimal STRING everywhere (never a
 * number), matching the Phase 1 convention and the DB CHECK regexes.
 */
import { z } from 'zod';

import { exactDecimalRateSchema, exactDecimalStringSchema } from './money.js';
import {
  customerStatusSchema,
  hierarchyRoleSchema,
  saleStatusSchema,
  spotCashStateSchema,
} from './lifecycle.js';

/* ================================================================== */
/* Card products                                                       */
/* ================================================================== */

export const cardProductSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  cashPrice: exactDecimalStringSchema,
  minimumDownPayment: exactDecimalStringSchema,
  yearlyPoints: z.number().int().nonnegative(),
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
    cashPrice: exactDecimalStringSchema.optional(),
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
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    province: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().max(20).optional(),
    countryCode: z.string().trim().length(2).default('PH'),
  })
  .refine((v) => !v.line2 || v.line2.trim().length > 0, {
    message: 'line2 must be omitted rather than blank',
  });
export type CustomerAddress = z.infer<typeof customerAddressSchema>;

/** `governmentIdNumber` is accepted on write and never returned on read. */
export const createCustomerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80),
  suffix: z.string().trim().max(20).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
    .refine((v) => {
      const d = new Date(v);
      return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
    }, 'dateOfBirth is not a real calendar date')
    .refine((v) => v < new Date().toISOString().slice(0, 10), 'dateOfBirth must be in the past'),
  gender: genderSchema.optional(),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'phone must be 7-15 digits, optionally + prefixed'),
  address: customerAddressSchema,
  governmentIdType: governmentIdTypeSchema.optional(),
  governmentIdNumber: z.string().trim().min(4).max(40).optional(),
  referralCode: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCustomerRequest = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    middleName: z.string().trim().max(80).nullable().optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    suffix: z.string().trim().max(20).nullable().optional(),
    gender: genderSchema.nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{7,15}$/)
      .optional(),
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
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  dateOfBirth: z.string().nullable(),
  gender: z.string().nullable(),
  address: z.unknown().nullable(),
  governmentIdType: z.string().nullable(),
  governmentIdMasked: z.string().nullable(),
  status: customerStatusSchema,
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
  // Commercial terms are snapshots taken at sale creation.
  cashPrice: exactDecimalStringSchema,
  minimumDownPayment: exactDecimalStringSchema,
  yearlyPoints: z.number().int().nonnegative(),
  commissionRate: exactDecimalRateSchema,
  expectedCommission: exactDecimalStringSchema,
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
