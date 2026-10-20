import { z } from 'zod';
import { companyApplicationPrefillSchema } from './customer-workbook.js';
import { exactDecimalStringSchema } from './money.js';

const uuid = z.uuid();
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const importReviewTokensSchema = z.strictObject({
  expectedSourceHash: revision,
  expectedTargetVersion: revision,
});
export const importClaimDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('record'),
    proofDocumentId: uuid,
    distinctPaymentReason: z.string().trim().min(5).max(500).optional(),
  }),
  z.strictObject({
    kind: z.literal('match'),
    paymentId: uuid,
    reason: z.string().trim().min(5).max(500),
  }),
  z.strictObject({ kind: z.literal('hold'), reason: z.string().trim().min(5).max(500) }),
  z.strictObject({ kind: z.literal('reject'), reason: z.string().trim().min(5).max(500) }),
]);
export type ImportClaimDecision = z.infer<typeof importClaimDecisionSchema>;
export const importClaimReconcileSchema = z.strictObject({
  requestId: uuid,
  expectedClaimVersion: revision,
  expectedTargetVersion: revision,
  decision: importClaimDecisionSchema,
});
export const importContinuationRequestSchema = importReviewTokensSchema.extend({ requestId: uuid });
export const customerImportContinuationSchema = importReviewTokensSchema.extend({
  externallyVerified: z.boolean().optional(),
  externalSummary: z
    .object({
      stage: z.enum(['application', 'reservation', 'finance', 'activation']),
      paid: exactDecimalStringSchema,
      balance: exactDecimalStringSchema,
      total: exactDecimalStringSchema,
    })
    .optional(),
  expectedTeamVersion: revision,
  rowId: uuid,
  sourceId: uuid.nullable(),
  customerId: uuid.nullable(),
  applicationId: uuid.nullable(),
  reservationId: uuid.nullable(),
  saleId: uuid.nullable(),
  stage: z.enum(['application', 'reservation', 'finance', 'activation', 'complete', 'review']),
  missingRequirements: z.array(z.string()),
  conflicts: z.array(z.object({ field: z.string(), message: z.string() })),
  nextAction: z
    .object({ label: z.string(), path: z.string().regex(/^\/admin\/[a-zA-Z0-9/?=&_%.-]+$/) })
    .nullable(),
  proposedFields: z.array(z.object({ field: z.string(), value: z.unknown() })).default([]),
  claimCount: z.number().int().nonnegative().default(0),
  customerName: z.string().nullable().optional(),
  purchaseReference: z.string().nullable().optional(),
  purchaseStatement: z
    .object({
      tier: z.string().nullable(),
      total: z.string().nullable(),
      reservationFee: z.string().nullable(),
    })
    .optional(),
});
export type CustomerImportContinuation = z.infer<typeof customerImportContinuationSchema>;
export const importPaymentClaimSchema = z.object({
  id: uuid,
  sourceId: uuid,
  paymentKey: z.string(),
  purpose: z.string(),
  amount: exactDecimalStringSchema,
  date: z.iso.date(),
  method: z.string(),
  reference: z.string(),
  notes: z.string().default(''),
  status: z.enum(['claim', 'held', 'rejected', 'recorded', 'matched', 'verified']),
  paymentId: uuid.nullable(),
  expectedClaimVersion: revision,
  expectedTargetVersion: revision,
  duplicateCandidates: z.array(
    z.object({ paymentId: uuid, reference: z.string(), amount: exactDecimalStringSchema }),
  ),
  proofDocumentId: uuid.nullable().default(null),
  proofUploaded: z.boolean().default(false),
});
export type ImportPaymentClaim = z.infer<typeof importPaymentClaimSchema>;
export const importSourceIntakeSchema = z.object({
  continuation: customerImportContinuationSchema,
  prefill: companyApplicationPrefillSchema,
  claims: z.array(importPaymentClaimSchema),
  purchaseReference: z.string().nullable().default(null),
  team: z
    .object({
      svdStaffId: uuid.optional(),
      ssmStaffId: uuid.optional(),
      smStaffId: uuid.optional(),
      referrerStaffId: uuid.optional(),
    })
    .default({}),
});
