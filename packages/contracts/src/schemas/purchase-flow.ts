import { z } from 'zod';
import {
  customerApplicationStatusSchema,
  reservationAgreementStatusSchema,
  paymentSchemeSchema,
  type CustomerApplicationStatus,
  type ReservationAgreementStatus,
} from './lifecycle.js';
import {
  agreementPaymentInputSchema,
  createReservationAgreementSchema,
  reservationHolderSchema,
  signatureStatusSchema,
  vipTierSchema,
  reservationAgreementSchema,
} from './official-forms.js';
import {
  financeQueueItemSchema,
  paymentSchema,
  recordPaymentSchema,
  verifyPaymentSchema,
} from './finance.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/);
const rate = z.string().regex(/^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/);
const timestamp = z.string().datetime({ offset: true });
const positiveMoney = money.refine((value) => /[1-9]/.test(value), 'Amount must be positive');
const cents = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const canonicalMoney = (value: string) => /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value);

const purchaseTermsObject = z.strictObject({
  id: uuid,
  applicationId: uuid,
  customerId: uuid,
  planId: uuid,
  sellerStaffId: uuid,
  version: z.number().int().positive(),
  captureKind: z.enum(['submission', 'review']),
  reason: z.string().trim().min(5).max(500).nullable(),
  capturedBy: uuid,
  capturedAt: timestamp,
  tier: vipTierSchema,
  paymentScheme: paymentSchemeSchema,
  totalPrice: positiveMoney,
  reservationFee: money,
  minimumDownPayment: money,
  requiredInitial: money,
  installmentMonths: z.number().int().positive().nullable(),
  monthlyAmount: money.nullable(),
  spotCashDays: z.number().int().positive(),
  validityMonths: z.number().int().positive(),
  discountPercent: z.number().int().min(0).max(100),
  yearlyPoints: z.number().int().nonnegative(),
  annualPointsTranches: z.number().int().positive(),
  holderLimit: z.number().int().min(1).max(2),
  inclusions: z.array(z.string().trim().min(1).max(300)).max(30),
  commissionRuleId: uuid.nullable(),
  commissionRate: rate,
  commissionBase: money,
  expectedCommission: money,
});
const validatePurchaseTerms = (
  value: Omit<
    z.infer<typeof purchaseTermsObject>,
    'id' | 'version' | 'capturedBy' | 'capturedAt' | 'reason'
  > & { reason?: string | null },
  ctx: z.RefinementCtx,
) => {
  if ('reason' in value && value.captureKind === 'review' && !value.reason)
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Review reason required' });
  if (
    [value.totalPrice, value.reservationFee, value.requiredInitial, value.commissionBase].every(
      canonicalMoney,
    )
  ) {
    if (cents(value.reservationFee) !== 1000000n)
      ctx.addIssue({
        code: 'custom',
        path: ['reservationFee'],
        message: 'Included reservation amount must be 10000.00',
      });
    if (
      cents(value.reservationFee) > cents(value.requiredInitial) ||
      cents(value.requiredInitial) > cents(value.totalPrice)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['requiredInitial'],
        message: 'Initial payment must include the reservation and fit the total',
      });
    if (cents(value.commissionBase) !== cents(value.totalPrice))
      ctx.addIssue({
        code: 'custom',
        path: ['commissionBase'],
        message: 'Commission basis must be the frozen total',
      });
  }
  if (value.validityMonths % 12 !== 0)
    ctx.addIssue({
      code: 'custom',
      path: ['validityMonths'],
      message: 'Validity must be whole years',
    });
  if (canonicalMoney(value.totalPrice) && canonicalMoney(value.requiredInitial)) {
    const total = cents(value.totalPrice);
    const initial = cents(value.requiredInitial);
    const expectedInitial =
      value.paymentScheme === 'move_b1_40_12'
        ? (total * 40n + 50n) / 100n
        : value.paymentScheme === 'move_b2_25_12'
          ? (total * 25n + 50n) / 100n
          : 1000000n;
    if (initial !== expectedInitial)
      ctx.addIssue({
        code: 'custom',
        path: ['requiredInitial'],
        message: 'Initial amount does not match scheme',
      });
    if (
      value.monthlyAmount !== null &&
      canonicalMoney(value.monthlyAmount) &&
      value.installmentMonths !== null &&
      cents(value.monthlyAmount) * BigInt(value.installmentMonths) !== total - initial
    )
      ctx.addIssue({
        code: 'custom',
        path: ['monthlyAmount'],
        message: 'Installments must cover the remaining total',
      });
  }
  if (
    (['move_a', 'installment_4_month'].includes(value.paymentScheme) &&
      value.installmentMonths !== 4) ||
    (['move_b1_40_12', 'move_b2_25_12'].includes(value.paymentScheme) &&
      value.installmentMonths !== 12)
  )
    ctx.addIssue({
      code: 'custom',
      path: ['installmentMonths'],
      message: 'Term does not match scheme',
    });
  if (
    canonicalMoney(value.commissionBase) &&
    canonicalMoney(value.expectedCommission) &&
    /^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/.test(value.commissionRate)
  ) {
    const [whole = '0', fraction = ''] = value.commissionRate.split('.');
    const scaledRate = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
    if (
      cents(value.expectedCommission) !==
      (cents(value.commissionBase) * scaledRate + 5000n) / 10000n
    )
      ctx.addIssue({
        code: 'custom',
        path: ['expectedCommission'],
        message: 'Commission must match frozen basis and rate',
      });
  }
  const noInstallment = value.paymentScheme === 'spot_cash';
  if (
    noInstallment
      ? value.installmentMonths !== null || value.monthlyAmount !== null
      : value.installmentMonths === null || value.monthlyAmount === null
  )
    ctx.addIssue({
      code: 'custom',
      path: ['installmentMonths'],
      message: 'Schedule does not match scheme',
    });
  if (value.tier !== 'GOLD' && value.holderLimit !== 1)
    ctx.addIssue({
      code: 'custom',
      path: ['holderLimit'],
      message: 'Secondary holder is Gold-only',
    });
  if (value.tier === 'BRONZE' && ['move_b1_40_12', 'move_b2_25_12'].includes(value.paymentScheme))
    ctx.addIssue({
      code: 'custom',
      path: ['paymentScheme'],
      message: 'Scheme is unavailable for Bronze',
    });
};
export const purchaseTermsSchema = purchaseTermsObject.superRefine(validatePurchaseTerms);
export type PurchaseTerms = z.infer<typeof purchaseTermsSchema>;

export const purchaseTermsProposalSchema = z.strictObject({
  applicationId: uuid,
  expectedProposalHash: z.string().regex(/^[0-9a-f]{64}$/),
  asOf: timestamp,
  offerKind: z.enum(['submission', 'newly_confirmed_offer']),
  terms: purchaseTermsObject
    .omit({ id: true, version: true, reason: true, capturedBy: true, capturedAt: true })
    .superRefine(validatePurchaseTerms),
});
export type PurchaseTermsProposal = z.infer<typeof purchaseTermsProposalSchema>;
const proposalConfirmation = {
  requestId: uuid,
  expectedProposalHash: z.string().regex(/^[0-9a-f]{64}$/),
  sellerCandidateId: uuid.optional(),
};
export const reviewPurchaseTermsSchema = z.strictObject({
  ...proposalConfirmation,
  reason: z.string().trim().min(5).max(500),
});
export type ReviewPurchaseTermsRequest = z.infer<typeof reviewPurchaseTermsSchema>;
export const submitPurchaseApplicationSchema = z.strictObject(proposalConfirmation);
export type SubmitPurchaseApplicationRequest = z.infer<typeof submitPurchaseApplicationSchema>;

const agreement = createReservationAgreementSchema.shape;
const mutableAgreement = {
  agreementDate: agreement.agreementDate.optional(),
  revisionNumber: agreement.revisionNumber,
  monthlyAmortizationStart: agreement.monthlyAmortizationStart,
  monthlyAmortizationEnd: agreement.monthlyAmortizationEnd,
  paymentDueDay: agreement.paymentDueDay,
  primarySignatureStatus: signatureStatusSchema.optional(),
  secondarySignatureStatus: signatureStatusSchema.optional(),
  scheduleNotes: z.array(agreementPaymentInputSchema.strict()).max(24).optional(),
};
const applicationCreate = z.strictObject({
  origin: z.literal('application'),
  requestId: uuid,
  customerApplicationId: uuid,
  purchaseTermsId: uuid,
  ...mutableAgreement,
  reservationDate: agreement.reservationDate,
  agreementDate: agreement.agreementDate,
  primarySignatureStatus: signatureStatusSchema,
  scheduleNotes: z.array(agreementPaymentInputSchema.strict()).max(24).default([]),
});
const saleCreate = createReservationAgreementSchema
  .safeExtend({
    origin: z.literal('sale'),
    requestId: uuid,
    primary: reservationHolderSchema.strict().extend({ holderType: z.literal('PRIMARY') }),
    secondary: reservationHolderSchema
      .strict()
      .extend({ holderType: z.literal('SECONDARY') })
      .optional(),
    scheduleNotes: z.array(agreementPaymentInputSchema.strict()).max(24).default([]),
  })
  .strict();
export const purchaseReservationCreateSchema = z.discriminatedUnion('origin', [
  applicationCreate,
  saleCreate,
]);
export const purchaseReservationSchema = z.discriminatedUnion('origin', [
  reservationAgreementSchema.extend({ origin: z.literal('sale'), purchaseTermsId: z.null() }),
  reservationAgreementSchema.extend({
    origin: z.literal('application'),
    saleId: uuid.nullable(),
    customerApplicationId: uuid,
    customerId: uuid,
    sellerStaffId: uuid,
    purchaseTermsId: uuid,
  }),
]);
export type PurchaseReservation = z.infer<typeof purchaseReservationSchema>;
export type ReservationCreate = z.infer<typeof purchaseReservationCreateSchema>;
export const purchaseReservationUpdateSchema = z
  .strictObject({ requestId: uuid, ...mutableAgreement })
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'requestId'),
    'An agreement change is required',
  );
export type ReservationUpdate = z.infer<typeof purchaseReservationUpdateSchema>;

const sourcePayment = paymentSchema.extend({ amount: positiveMoney });
export const purchasePaymentSchema = z.discriminatedUnion('origin', [
  sourcePayment.extend({ origin: z.literal('sale'), saleId: uuid, reservationId: z.null() }),
  sourcePayment.extend({
    origin: z.literal('reservation'),
    saleId: uuid.nullable(),
    reservationId: uuid,
    customerId: uuid,
  }),
]);
export type PurchasePayment = z.infer<typeof purchasePaymentSchema>;
export const recordPurchasePaymentSchema = recordPaymentSchema
  .extend({ requestId: uuid, amount: positiveMoney })
  .strict();
export type RecordPurchasePaymentRequest = z.infer<typeof recordPurchasePaymentSchema>;
export const verifyPurchasePaymentSchema = verifyPaymentSchema
  .safeExtend({ requestId: uuid })
  .strict();
export type VerifyPurchasePaymentRequest = z.infer<typeof verifyPurchasePaymentSchema>;
export const finalizeReservationPurchaseSchema = z.strictObject({ requestId: uuid });

/**
 * The five historical printable records.
 *
 * A kind names an immutable evidence revision, never a live business view, so
 * adding one here forces a renderer branch rather than silently printing
 * today's numbers.
 */
export const purchaseDocumentKinds = [
  'reservation',
  'payment_recorded',
  'payment_verified',
  'purchase_finalized',
  'membership_activated',
] as const;
export type PurchaseDocumentKind = (typeof purchaseDocumentKinds)[number];
export const purchasePaymentVerificationResultSchema = z.strictObject({
  paymentId: uuid,
  reservationId: uuid.nullable(),
  saleId: uuid.nullable(),
  status: z.enum(['verified', 'rejected']),
  verifiedBefore: money,
  verifiedTotal: money,
  balanceBefore: money,
  remainingBalance: money,
  fullyPaid: z.boolean(),
  verifiedBy: uuid,
  verifiedAt: timestamp,
  documentEvidenceId: uuid.nullable(),
});
export type PurchasePaymentVerificationResult = z.infer<
  typeof purchasePaymentVerificationResultSchema
>;
const reservationFinance = {
  reservationId: uuid,
  reservationNumber: z.string().min(1),
  customerApplicationId: uuid,
  applicationNumber: z.string().min(1),
  purchaseTermsId: uuid,
  sellerStaffId: uuid,
  sellerName: z.string(),
  tier: vipTierSchema,
  customerId: uuid,
  customerName: z.string(),
  productName: z.string(),
  status: reservationAgreementStatusSchema,
  applicationStatus: customerApplicationStatusSchema,
  paymentScheme: paymentSchemeSchema,
  totalPrice: money,
  reservationFee: money,
  requiredInitial: money,
  installmentMonths: z.number().int().positive().nullable(),
  monthlyAmount: money.nullable(),
  validityMonths: z.number().int().positive(),
  verifiedTotal: money,
  remainingBalance: money,
  /**
   * Money collected beyond the frozen total, RETAINED rather than discarded.
   *
   * Exposed because Finance must be able to answer "has this customer overpaid?"
   * without recomputing it, and because hiding it invites a duplicate payment.
   */
  overpaidAmount: money,
  fullyPaid: z.boolean(),
  recordedPaymentCount: z.number().int().nonnegative(),
  firstVerifiedPayment: timestamp.nullable(),
  spotCashDeadline: timestamp.nullable(),
};
export const reservationFinanceSummarySchema = z.strictObject({
  ...reservationFinance,
  saleId: uuid.nullable(),
  payments: z.array(purchasePaymentSchema),
});
export type ReservationFinanceSummary = z.infer<typeof reservationFinanceSummarySchema>;
export const financeCollectionQueueItemSchema = z.discriminatedUnion('origin', [
  financeQueueItemSchema.extend({ origin: z.literal('sale') }),
  z.strictObject({
    ...reservationFinance,
    origin: z.literal('reservation'),
    saleId: z.null(),
    activatable: z.literal(false),
  }),
]);
export type FinanceCollectionQueueItem = z.infer<typeof financeCollectionQueueItemSchema>;
export function reservationAcceptsCollection(
  status: ReservationAgreementStatus,
  applicationStatus: CustomerApplicationStatus,
  saleId: string | null,
): boolean {
  return status === 'executed' && applicationStatus === 'approved' && saleId === null;
}

const identityFields = {
  reservationNumber: z.string().nullable(),
  saleNumber: z.string().nullable(),
  applicationNumber: z.string().nullable(),
  customerNumber: z.string(),
  customerName: z.string(),
  sellerName: z.string(),
  actorName: z.string(),
  totalPrice: money,
};
const paymentFields = {
  ...identityFields,
  paymentNumber: z.string().min(1),
  amount: positiveMoney,
  method: z.string(),
  reference: z.string().nullable(),
  verifiedBefore: money,
  verifiedAfter: money,
  balanceBefore: money,
  balanceAfter: money,
};
const envelope = {
  id: uuid,
  sourceId: uuid,
  revision: z.number().int().positive(),
  schemaVersion: z.literal(1),
  actorId: uuid,
  capturedAt: timestamp,
};
const commercialFields = {
  ...identityFields,
  purchaseTermsId: uuid,
  termsVersion: z.number().int().positive(),
  tier: vipTierSchema,
  paymentScheme: paymentSchemeSchema,
  reservationFee: money,
  requiredInitial: money,
  yearlyPoints: z.number().int().nonnegative(),
  validityMonths: z.number().int().positive(),
  commissionRate: rate,
  expectedCommission: money,
  minimumDownPayment: money,
  installmentMonths: z.number().int().positive().nullable(),
  monthlyAmount: money.nullable(),
  spotCashDays: z.number().int().positive(),
  discountPercent: z.number().int().min(0).max(100),
  annualPointsTranches: z.number().int().positive(),
  holderLimit: z.number().int().min(1).max(2),
  inclusions: z.array(z.string().min(1).max(300)).max(30),
};
const agreementDocumentFields = {
  secondaryAddress: z.string().nullable(),
  schedule: z.array(
    z.strictObject({
      lineNumber: z.number().int().positive(),
      particular: z.string(),
      amount: money,
      paymentDate: z.string().date().nullable(),
      remarks: z.string().nullable(),
    }),
  ),
  reservationDate: z.string().date(),
  agreementDate: z.string().date(),
  revisionNumber: z.string().nullable(),
  monthlyAmortizationStart: z.string().date().nullable(),
  monthlyAmortizationEnd: z.string().date().nullable(),
  paymentDueDay: z.number().int().min(1).max(31).nullable(),
  primarySignatureStatus: signatureStatusSchema,
  secondarySignatureStatus: signatureStatusSchema.nullable(),
};
export const purchaseDocumentEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...envelope,
    kind: z.literal('reservation'),
    fields: z.strictObject({
      ...commercialFields,
      ...agreementDocumentFields,
      status: reservationAgreementStatusSchema,
      primaryName: z.string(),
      primaryAddress: z.string(),
      secondaryName: z.string().nullable(),
      verifiedTotal: money,
      balance: money,
    }),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal('payment_recorded'),
    fields: z.strictObject({ ...paymentFields, status: z.literal('recorded') }),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal('payment_verified'),
    fields: z.strictObject({ ...paymentFields, status: z.literal('verified') }),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal('purchase_finalized'),
    fields: z.strictObject({
      ...commercialFields,
      saleNumber: z.string().min(1),
      status: z.literal('payment_verified'),
      paymentNumbers: z.array(z.string()),
      verifiedTotal: money,
      remainingBalance: money,
      finalizedAt: timestamp,
    }),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal('membership_activated'),
    fields: z.strictObject({
      ...identityFields,
      membershipNumber: z.string().min(1),
      status: z.literal('active'),
      yearlyPoints: z.number().int().nonnegative(),
      pointsAllocated: z.number().int().nonnegative(),
      validityMonths: z.number().int().positive(),
      verifiedTotal: money,
      expiresAt: timestamp,
    }),
  }),
]);
export type PurchaseDocumentEvidence = z.infer<typeof purchaseDocumentEvidenceSchema>;
