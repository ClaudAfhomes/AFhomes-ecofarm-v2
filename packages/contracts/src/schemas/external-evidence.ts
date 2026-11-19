import { z } from 'zod';

import { exactDecimalStringSchema } from './money.js';

/**
 * Verifiable evidence for a payment made OUTSIDE AF Homes: a live payroll
 * disbursement or a commission payout (migration 20270105000023, owner decision
 * 2026-11-19). A typed description alone is never evidence; each type needs its
 * own field. Rows are append-only; nothing here verifies a transaction.
 */
export const externalPaymentSubjectSchema = z.enum(['payroll_disbursement', 'commission_payout']);
export type ExternalPaymentSubject = z.infer<typeof externalPaymentSubjectSchema>;

export const externalEvidenceTypeSchema = z.enum([
  'uploaded_document',
  'external_transaction_reference',
  'official_receipt',
]);
export type ExternalEvidenceType = z.infer<typeof externalEvidenceTypeSchema>;

/** SUPPORTED = at least one evidence row; EVIDENCE_EXCEPTION = none yet. */
export const externalEvidenceStatusSchema = z.enum(['SUPPORTED', 'EVIDENCE_EXCEPTION']);
export type ExternalEvidenceStatus = z.infer<typeof externalEvidenceStatusSchema>;

const source = z.string().trim().min(2).max(120);
const description = z.string().trim().min(1).max(500).optional();
/** Amount on the bank statement / OR; every payment sharing the reference must fit in it. */
const transferAmount = exactDecimalStringSchema.refine(
  (v) => /[1-9]/.test(v),
  'Must be more than zero',
);

export const recordExternalEvidenceSchema = z.discriminatedUnion('evidenceType', [
  z
    .object({
      evidenceType: z.literal('uploaded_document'),
      source,
      /** The server-issued path from the upload grant. */
      storagePath: z.string().trim().min(1).max(300),
      description,
    })
    .strict(),
  z
    .object({
      evidenceType: z.literal('external_transaction_reference'),
      source,
      transactionReference: z.string().trim().min(3).max(100),
      transferAmount,
      description,
    })
    .strict(),
  z
    .object({
      evidenceType: z.literal('official_receipt'),
      source,
      orNumber: z.string().trim().min(1).max(60),
      transferAmount,
      description,
    })
    .strict(),
]);
export type RecordExternalEvidenceRequest = z.infer<typeof recordExternalEvidenceSchema>;

export const externalEvidenceUploadRequestSchema = z
  .object({
    contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    size: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();

export const externalEvidenceUploadGrantSchema = z.object({
  storagePath: z.string(),
  uploadUrl: z.string(),
  expiresAt: z.string(),
});
export type ExternalEvidenceUploadGrant = z.infer<typeof externalEvidenceUploadGrantSchema>;

export const externalEvidenceSchema = z.object({
  id: z.string().uuid(),
  evidenceType: externalEvidenceTypeSchema,
  source: z.string(),
  documentAttached: z.boolean(),
  transactionReference: z.string().nullable(),
  orNumber: z.string().nullable(),
  transferAmount: z.string().nullable().optional(),
  /** Other payments supported by the same reference (shared bulk transfer / OR). */
  sharedWith: z.number().int().nonnegative().optional(),
  description: z.string().nullable(),
  recordedBy: z.string().uuid(),
  recordedAt: z.string(),
});
export type ExternalEvidence = z.infer<typeof externalEvidenceSchema>;

export const externalEvidenceListSchema = z.object({
  subjectType: externalPaymentSubjectSchema,
  subjectId: z.string().uuid(),
  status: externalEvidenceStatusSchema,
  /** An authorized review explaining why no evidence exists, if one was recorded. */
  exceptionReview: z
    .object({ note: z.string(), reviewedBy: z.string().uuid(), reviewedAt: z.string() })
    .nullable(),
  items: z.array(externalEvidenceSchema),
});
export type ExternalEvidenceList = z.infer<typeof externalEvidenceListSchema>;

export const reviewEvidenceExceptionSchema = z
  .object({ note: z.string().trim().min(10).max(2000) })
  .strict();
export type ReviewEvidenceExceptionRequest = z.infer<typeof reviewEvidenceExceptionSchema>;
