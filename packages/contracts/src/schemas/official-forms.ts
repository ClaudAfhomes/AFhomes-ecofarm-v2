import { z } from 'zod';
import {
  birthDateSchema,
  emailSchema,
  normalizeAddressField,
  normalizeGeographicName,
  normalizePersonName,
  optionalPersonNameSchema,
  optionalContactNumberSchema,
  optionalLandlineSchema,
  personNameSchema,
  phoneSchema,
  PERSON_NAME_RE,
} from './input.js';
import { geographicCodeSchema } from './address.js';
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

/**
 * Blank selector values (`""`) must never reach a UUID validator: an unchosen
 * customer/plan/sale is "missing", not "an invalid UUID". Coercing to
 * `undefined` turns the failure into `Required`, which the UI maps to a
 * friendly "select …" message instead of `customerId: Invalid uuid`.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && !value.trim() ? undefined : value;
const requiredUuid = z.preprocess(blankToUndefined, z.string().uuid());
const optionalUuid = z.preprocess(blankToUndefined, z.string().uuid().optional());

export const applicationHolderSchema = z.object({
  holderType: holderTypeSchema,
  lastName: personNameSchema,
  firstName: personNameSchema,
  middleName: optionalPersonNameSchema,
  suffix: z.preprocess(
    (value) => (typeof value === 'string' && /^n\/a$/i.test(value.trim()) ? undefined : value),
    optionalPersonNameSchema.refine((value) => value === undefined || value.length <= 20),
  ),
  birthDate: birthDateSchema,
  sex: z.string().trim().max(30).optional(),
  citizenship: z.string().trim().max(80).optional(),
  civilStatus: z.string().trim().max(40).optional(),
  permanentAddressLine1: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform((v) => normalizeAddressField(v)),
  permanentAddressLine2: z.string().trim().max(200).transform(normalizeAddressField).optional(),
  /**
   * The official geography. These three names come from the Philippine statistics
   * authority rather than from a person typing, so they keep the authority's
   * casing - see `normalizeGeographicName`. The street lines above stay
   * user-entered and keep the upper-case convention.
   */
  cityMunicipality: z.string().trim().min(1).max(100).transform(normalizeGeographicName),
  province: z.string().trim().min(1).max(100).transform(normalizeGeographicName),
  barangay: z.string().trim().max(100).transform(normalizeGeographicName).optional(),
  /**
   * The verified PSGC codes, which are the actual geographic identity. All three
   * or none: a half-verified hierarchy would persist a parent/child pair that
   * nobody confirmed. All absent is legitimate, and is every record created
   * before the structured selectors existed.
   */
  provinceCode: geographicCodeSchema.optional(),
  cityMunicipalityCode: geographicCodeSchema.optional(),
  barangayCode: geographicCodeSchema.optional(),
  postalCode: z.string().trim().max(20).optional(),
  landline: optionalLandlineSchema,
  mobile: phoneSchema,
  email: emailSchema,
  tinNumber: z.string().trim().max(40).optional(),
  occupationBusinessName: z.string().trim().max(160).transform(normalizeAddressField).optional(),
  officeBusinessAddress: z.string().trim().max(300).transform(normalizeAddressField).optional(),
  businessIndustry: z.string().trim().max(120).optional(),
  employedPosition: z.string().trim().max(120).transform(normalizeAddressField).optional(),
  printedName: z.string().trim().min(1).max(180).transform(normalizePersonName),
});

const customerApplicationInputSchema = z.object({
  /** Required by POST creation; existing-record PATCH does not require a token. */
  requestId: z.string().uuid().optional(),
  customerId: requiredUuid,
  saleId: optionalUuid,
  planId: requiredUuid,
  tier: vipTierSchema,
  paymentScheme: paymentSchemeSchema,
  primary: applicationHolderSchema.extend({ holderType: z.literal('PRIMARY') }),
  secondary: applicationHolderSchema.extend({ holderType: z.literal('SECONDARY') }).optional(),
  salesManagerName: z.string().trim().max(160).optional(),
  vipRecommenderName: z.string().trim().max(160).optional(),
  recommenderContact: optionalContactNumberSchema,
  recommenderEmail: z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
    emailSchema.optional(),
  ),
  vipReferrer: z.string().trim().max(160).optional(),
  acquisitionChannels: z.array(acquisitionChannelSchema).max(7).default([]),
  consentAcknowledged: z.boolean(),
  acknowledgedAt: dateSchema,
  primarySignatureStatus: signatureStatusSchema,
  secondarySignatureStatus: signatureStatusSchema.optional(),
  validIdReceived: z.boolean(),
  reservationPaymentProofReceived: z.boolean(),
});
/**
 * Codes arrive as a verified triple or not at all, and this is checked per
 * HOLDER rather than once for the application: a primary with codes and a
 * secondary without them is a real, reachable state, and each is judged on its
 * own. That the triple is internally CONSISTENT is the server's job - it has to
 * re-resolve it against the authoritative hierarchy, which no client check can
 * substitute for.
 */
const validateHolderLocationCodes = (
  holder: { provinceCode?: string; cityMunicipalityCode?: string; barangayCode?: string } | undefined,
  path: string,
  ctx: z.RefinementCtx,
) => {
  if (!holder) return;
  const present = [holder.provinceCode, holder.cityMunicipalityCode, holder.barangayCode].filter(
    Boolean,
  ).length;
  if (present !== 0 && present !== 3) {
    ctx.addIssue({
      code: 'custom',
      path: [path, 'provinceCode'],
      message: 'Provide all three location codes together, or none for a legacy free-text address',
    });
  }
};

const validateApplicationHolders = (
  value: {
    tier: string;
    secondary?: unknown;
    secondarySignatureStatus?: unknown;
    primary?: unknown;
  },
  ctx: z.RefinementCtx,
) => {
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
  validateHolderLocationCodes(
    value.primary as { provinceCode?: string } | undefined,
    'primary',
    ctx,
  );
  validateHolderLocationCodes(
    value.secondary as { provinceCode?: string } | undefined,
    'secondary',
    ctx,
  );
};
export const createCustomerApplicationSchema = customerApplicationInputSchema.superRefine(
  validateApplicationHolders,
);

export const registerCustomerApplicationSchema = customerApplicationInputSchema
  .omit({ customerId: true })
  .extend({ registerNewCustomer: z.literal(true) })
  .superRefine(validateApplicationHolders);
export type RegisterCustomerApplicationRequest = z.infer<typeof registerCustomerApplicationSchema>;

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
  /**
   * The exact frozen terms this application points at, or null before any terms
   * were captured.
   *
   * An IDENTIFIER, not a figure: it tells the UI which record a reservation would
   * be built from, and the server revalidates it against the immutable row before
   * writing anything. Null is the honest "Purchase Terms Review Required" state.
   */
  purchaseTermsId: z.string().uuid().nullable().optional(),
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
  // Historical application suffixes used N/A for an absent suffix. Normalize
  // only that exact trailing marker; all other name validation remains intact.
  name: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+n\/a$/i, '') : value),
    z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(PERSON_NAME_RE, 'Use letters, spaces, apostrophes and hyphens only - no numbers')
      .transform(normalizePersonName),
  ),
  address: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .transform((v) => normalizeAddressField(v)),
  contactNumber: phoneSchema,
  email: emailSchema,
  tinNumber: z.string().trim().max(40).optional(),
});

export const createReservationAgreementSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    /**
     * Required for the LEGACY sale-origin form, absent for an application-origin
     * reservation. `purchaseReservationCreateSchema` is the application-origin
     * contract and carries no sale id at all, so the two shapes cannot be
     * confused for one another.
     */
    saleId: optionalUuid,
    customerApplicationId: optionalUuid,
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
  /**
   * Null for an application-origin reservation.
   *
   * A first-time purchase has NO card sale until Finance finalizes it, and
   * calling that reservation a sale before the money is verified is exactly the
   * confusion this flow exists to remove.
   */
  saleId: optionalUuid,
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
  /**
   * Operational queue, not a data filter.
   *
   * `application_work` returns only applications that still require APPLICATION
   * work: once a live reservation exists, the reservation/payment stage owns the
   * customer. It is opt-in and omitted by default, so history stays reachable.
   *
   * `reservation_work` returns only agreements that still require IST RESERVATION
   * work. An EXECUTED agreement is finalized: Finance owns collection from then
   * on, so it leaves this queue exactly as an application leaves the application
   * queue. Also opt-in, also never destructive.
   */
  queue: z.enum(['application_work', 'reservation_work']).optional(),
  /** Reservations created from this application (application-origin link). */
  application: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Lists return commercial snapshot summaries, not editable holder details. */
const officialFormSummaryFields = {
  id: z.string().uuid(),
  tier_snapshot: vipTierSchema,
  applicant_name: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  submitted_at: z.string().nullable(),
};
export const customerApplicationListItemSchema = z
  .object({
    ...officialFormSummaryFields,
    application_number: z.string(),
    seller_name: z.string().nullable().optional(),
    status: customerApplicationStatusSchema,
  })
  .transform((row) => ({
    id: row.id,
    applicationNumber: row.application_number,
    sellerName: row.seller_name ?? null,
    tier: row.tier_snapshot,
    applicantName: row.applicant_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    status: row.status,
  }));
export const reservationAgreementListItemSchema = z
  .object({
    ...officialFormSummaryFields,
    reservation_number: z.string(),
    sale_id: z.string().uuid().nullable(),
    payment_scheme_snapshot: paymentSchemeSchema,
    total_price_snapshot: exactDecimalStringSchema,
    primary_signature_status: signatureStatusSchema,
    secondary_signature_status: signatureStatusSchema.nullable(),
    has_secondary_holder: z.boolean(),
    status: reservationAgreementStatusSchema,
  })
  .transform((row) => ({
    id: row.id,
    reservationNumber: row.reservation_number,
    saleId: row.sale_id,
    paymentScheme: row.payment_scheme_snapshot,
    totalPrice: row.total_price_snapshot,
    primarySignatureStatus: row.primary_signature_status,
    secondarySignatureStatus: row.secondary_signature_status,
    hasSecondaryHolder: row.has_secondary_holder,
    tier: row.tier_snapshot,
    applicantName: row.applicant_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    status: row.status,
  }));
export type CustomerApplicationListItem = z.infer<typeof customerApplicationListItemSchema>;
export type ReservationAgreementListItem = z.infer<typeof reservationAgreementListItemSchema>;

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
