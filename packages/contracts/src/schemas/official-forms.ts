import { z } from 'zod';
import { exactDecimalStringSchema } from './money.js';
import {
  customerApplicationStatusSchema,
  paymentSchemeSchema,
  reservationAgreementStatusSchema,
} from './lifecycle.js';

export const vipTierSchema = z.enum(['BRONZE', 'SILVER', 'GOLD']);
export const holderTypeSchema = z.enum(['PRIMARY', 'SECONDARY']);
export const signatureStatusSchema = z.enum(['pending', 'received']);
export const acquisitionChannelSchema = z.enum([
  'CMP',
  'DRP',
  'GDP Corporate',
  'Walk-In',
  'GDP Public Servant',
  'Referral',
  'FB Ads',
]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const applicationHolderSchema = z.object({
  holderType: holderTypeSchema,
  lastName: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  suffix: z.string().trim().max(20).optional(),
  birthDate: dateSchema,
  sex: z.string().trim().max(30).optional(),
  citizenship: z.string().trim().max(80).optional(),
  civilStatus: z.string().trim().max(40).optional(),
  permanentAddressLine1: z.string().trim().min(1).max(200),
  permanentAddressLine2: z.string().trim().max(200).optional(),
  cityMunicipality: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
  landline: z.string().trim().max(30).optional(),
  mobile: z.string().trim().min(7).max(30),
  email: z.string().trim().toLowerCase().email().max(254),
  tinNumber: z.string().trim().max(40).optional(),
  occupationBusinessName: z.string().trim().max(160).optional(),
  officeBusinessAddress: z.string().trim().max(300).optional(),
  businessIndustry: z.string().trim().max(120).optional(),
  employedPosition: z.string().trim().max(120).optional(),
  printedName: z.string().trim().min(1).max(180),
});

export const createCustomerApplicationSchema = z
  .object({
    customerId: z.string().uuid(),
    saleId: z.string().uuid().optional(),
    planId: z.string().uuid(),
    tier: vipTierSchema,
    paymentScheme: paymentSchemeSchema,
    primary: applicationHolderSchema.extend({ holderType: z.literal('PRIMARY') }),
    secondary: applicationHolderSchema.extend({ holderType: z.literal('SECONDARY') }).optional(),
    salesManagerName: z.string().trim().max(160).optional(),
    vipRecommenderName: z.string().trim().max(160).optional(),
    recommenderContact: z.string().trim().max(30).optional(),
    recommenderEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    vipReferrer: z.string().trim().max(160).optional(),
    acquisitionChannels: z.array(acquisitionChannelSchema).max(7).default([]),
    consentAcknowledged: z.boolean(),
    acknowledgedAt: dateSchema,
    primarySignatureStatus: signatureStatusSchema,
    secondarySignatureStatus: signatureStatusSchema.optional(),
    validIdReceived: z.boolean(),
    reservationPaymentProofReceived: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.secondary && value.tier !== 'GOLD')
      ctx.addIssue({
        code: 'custom',
        path: ['secondary'],
        message: 'Secondary holder is Gold-only',
      });
    if (!value.secondary && value.secondarySignatureStatus)
      ctx.addIssue({
        code: 'custom',
        path: ['secondarySignatureStatus'],
        message: 'Secondary signature requires a secondary holder',
      });
  });

export const customerApplicationSchema = createCustomerApplicationSchema.extend({
  id: z.string().uuid(),
  applicationNumber: z.string(),
  vipAmount: exactDecimalStringSchema,
  discountPercent: z.number().int().min(0).max(100),
  validityYears: z.number().int().positive(),
  yearlyPoints: z.number().int().nonnegative(),
  annualPointsTranches: z.number().int().positive(),
  holderLimit: z.number().int().min(1).max(2),
  status: customerApplicationStatusSchema,
  createdBy: z.string().uuid().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
});

/** Staff review decision. `approved`/`rejected` leave `submitted` only; `cancelled` is terminal. */
export const customerApplicationDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'cancelled']),
  notes: z.string().trim().min(5).max(500).optional(),
});

export const agreementPaymentInputSchema = z.object({
  particular: z.string().trim().min(1).max(120),
  amount: exactDecimalStringSchema,
  paymentDate: dateSchema.optional(),
  remarks: z.string().trim().max(300).optional(),
});

export const reservationHolderSchema = z.object({
  holderType: holderTypeSchema,
  name: z.string().trim().min(1).max(180),
  address: z.string().trim().min(1).max(400),
  contactNumber: z.string().trim().min(7).max(30),
  email: z.string().trim().toLowerCase().email().max(254),
  tinNumber: z.string().trim().max(40).optional(),
});

export const createReservationAgreementSchema = z
  .object({
    saleId: z.string().uuid(),
    customerApplicationId: z.string().uuid().optional(),
    /**
     * Imported tier context (IST XLSX `vip_tier`). The server never trusts it
     * for economics: the sale's plan tier is authoritative, and a conflict is
     * rejected. Present so previews and saves can validate Gold-only holders.
     */
    vipTier: vipTierSchema.optional(),
    reservationDate: dateSchema,
    agreementDate: dateSchema,
    revisionNumber: z.string().trim().max(40).optional(),
    monthlyAmortizationStart: dateSchema.optional(),
    monthlyAmortizationEnd: dateSchema.optional(),
    paymentDueDay: z.number().int().min(1).max(31).optional(),
    primarySignatureStatus: signatureStatusSchema,
    secondarySignatureStatus: signatureStatusSchema.optional(),
    primary: reservationHolderSchema.extend({ holderType: z.literal('PRIMARY') }),
    secondary: reservationHolderSchema.extend({ holderType: z.literal('SECONDARY') }).optional(),
    scheduleNotes: z.array(agreementPaymentInputSchema).max(24).default([]),
  })
  .superRefine((value, ctx) => {
    if (!value.secondary && value.secondarySignatureStatus)
      ctx.addIssue({
        code: 'custom',
        path: ['secondarySignatureStatus'],
        message: 'Secondary signature requires a secondary holder',
      });
  });

export const reservationAgreementSchema = z.object({
  id: z.string().uuid(),
  reservationNumber: z.string(),
  saleId: z.string().uuid(),
  tier: vipTierSchema,
  totalPrice: exactDecimalStringSchema,
  reservationFee: exactDecimalStringSchema,
  downPayment: exactDecimalStringSchema,
  totalPaymentReceived: exactDecimalStringSchema,
  balance: exactDecimalStringSchema,
  monthlyAmortization: exactDecimalStringSchema.nullable(),
  installmentMonths: z.number().int().positive().nullable(),
  paymentScheme: paymentSchemeSchema,
  discountPercent: z.number().int(),
  validityYears: z.number().int().positive(),
  yearlyPoints: z.number().int().nonnegative(),
  annualPointsTranches: z.number().int().positive(),
  holderLimit: z.number().int().min(1).max(2),
  revisionNumber: z.string().optional(),
  reservationDate: dateSchema,
  agreementDate: dateSchema,
  customerApplicationId: z.string().uuid().optional(),
  planId: z.string().uuid(),
  inclusions: z.record(z.string(), z.unknown()),
  monthlyAmortizationStart: dateSchema.optional(),
  monthlyAmortizationEnd: dateSchema.optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  primarySignatureStatus: signatureStatusSchema,
  secondarySignatureStatus: signatureStatusSchema.optional(),
  primary: reservationHolderSchema.extend({ holderType: z.literal('PRIMARY') }),
  secondary: reservationHolderSchema.extend({ holderType: z.literal('SECONDARY') }).optional(),
  schedule: z.array(
    agreementPaymentInputSchema.extend({ lineNumber: z.number().int().positive() }),
  ),
  status: reservationAgreementStatusSchema,
  createdBy: z.string().uuid().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable(),
  executedAt: z.string().nullable(),
});

/** IST review decision. `executed` finalizes the contract; `cancelled` voids the draft chain. */
export const reservationAgreementDecisionSchema = z.object({
  decision: z.enum(['executed', 'cancelled']),
  notes: z.string().trim().min(5).max(500).optional(),
});

export const officialFormListQuerySchema = z.object({
  status: z.string().trim().max(30).optional(),
  tier: vipTierSchema.optional(),
  seller: z.string().uuid().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const formImportPreviewSchema = z.object({
  kind: z.enum(['customer_application', 'reservation_agreement']),
  fields: z.record(z.string(), z.string()),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
  requiresReview: z.literal(true),
});

export type ApplicationHolder = z.infer<typeof applicationHolderSchema>;
export type CreateCustomerApplicationRequest = z.infer<typeof createCustomerApplicationSchema>;
export type CustomerApplication = z.infer<typeof customerApplicationSchema>;
export type CustomerApplicationDecision = z.infer<typeof customerApplicationDecisionSchema>;
export type CreateReservationAgreementRequest = z.infer<typeof createReservationAgreementSchema>;
export type ReservationAgreement = z.infer<typeof reservationAgreementSchema>;
export type ReservationAgreementDecision = z.infer<typeof reservationAgreementDecisionSchema>;
export type FormImportPreview = z.infer<typeof formImportPreviewSchema>;
