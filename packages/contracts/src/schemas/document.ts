/**
 * AF Homes Phase 12 - identity documents and OCR-assisted extraction.
 *
 * OCR output is SUGGESTION data, never authoritative data. Nothing extracted
 * ever reaches a customer or application record without explicit human review
 * and confirmation, and nothing here can finalize identity on its own.
 *
 * Sensitivity rules this file exists to enforce:
 *
 * - The raw storage path is never part of any read model: delivery uses
 *   short-lived signed URLs issued per request.
 * - ID numbers are masked everywhere except the explicit confirmation form,
 *   which echoes back only what the reviewer just submitted.
 * - Audit payloads carry document ids and statuses, never ID numbers, OCR
 *   text, paths, URLs or secrets.
 */
import { z } from 'zod';
import { governmentIdTypeSchema } from './sales.js';

/** OCR pipeline state. Only the subset the server actually produces. */
export const ocrStatusSchema = z.enum(['not_requested', 'completed', 'failed', 'unavailable']);
export type OcrStatus = z.infer<typeof ocrStatusSchema>;

/** Human verification state. Separate from OCR success by design. */
export const documentVerificationStatusSchema = z.enum(['pending_review', 'confirmed', 'rejected']);
export type DocumentVerificationStatus = z.infer<typeof documentVerificationStatusSchema>;

export const documentSubjectSchema = z.enum(['customer', 'ost_application']);
export type DocumentSubject = z.infer<typeof documentSubjectSchema>;

export const documentMimeSchema = z.enum(['image/jpeg', 'image/png', 'application/pdf']);
export type DocumentMime = z.infer<typeof documentMimeSchema>;

/** One extracted suggestion: value plus provider confidence when known. */
export const ocrFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
export type OcrField = z.infer<typeof ocrFieldSchema>;

/** Masked read model. No storage path, no hashes, masked ID numbers. */
export const identityDocumentSchema = z.object({
  id: z.string().uuid(),
  subjectType: documentSubjectSchema,
  subjectId: z.string().uuid(),
  originalFilename: z.string(),
  mime: documentMimeSchema,
  sizeBytes: z.number().int().nonnegative(),
  hasFile: z.boolean(),
  ocrStatus: ocrStatusSchema,
  ocrProvider: z.string().nullable(),
  verificationStatus: documentVerificationStatusSchema,
  /**
   * Server-derived authority: the single Current ID for the subject under the
   * canonical rule (newest file-backed, non-rejected document by
   * created_at, id tiebreak). Required on every document read so the UI
   * never infers currentness locally. See `selectCurrentDocumentId`.
   */
  isCurrent: z.boolean(),
  extractedFields: z.record(z.string(), ocrFieldSchema),
  warnings: z.array(z.string()),
  reviewedFields: z.record(z.string(), z.string().nullable()).nullable(),
  possibleDuplicate: z.boolean().nullable(),
  uploadedAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type IdentityDocument = z.infer<typeof identityDocumentSchema>;

/** Page flags describe subject-wide currentness; a page may contain no current row. */
export const documentListQuerySchema = z.object({
  subjectType: documentSubjectSchema,
  subjectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export const currentDocumentQuerySchema = documentListQuerySchema
  .pick({
    subjectType: true,
    subjectId: true,
  })
  .required({ subjectId: true });
export const currentDocumentResponseSchema = z.object({
  currentDocument: identityDocumentSchema.nullable(),
});

/** Server-issued upload grant. The browser PUTs bytes to `uploadUrl`. */
export const documentUploadRequestSchema = z.object({
  idType: governmentIdTypeSchema.optional(),
  subjectType: documentSubjectSchema,
  subjectId: z.string().uuid(),
  mime: documentMimeSchema,
  sizeBytes: z.number().int().min(1).max(10485760),
  originalFilename: z.string().trim().min(1).max(255),
});
export type DocumentUploadRequest = z.infer<typeof documentUploadRequestSchema>;

export const documentUploadGrantSchema = z.object({
  documentId: z.string().uuid(),
  bucket: z.string(),
  uploadUrl: z.string(),
  expiresAt: z.string(),
});
export type DocumentUploadGrant = z.infer<typeof documentUploadGrantSchema>;

/** Reviewer confirmation. `fields` are the human-confirmed values. */
export const documentConfirmSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  fields: z
    .record(z.string(), z.string().nullable())
    .refine(
      (fields) => Object.keys(fields).length > 0 && Object.keys(fields).length <= 40,
      'At least one field is required',
    ),
  notes: z.string().trim().max(500).optional(),
});
export type DocumentConfirmRequest = z.infer<typeof documentConfirmSchema>;

/** Short-lived, single-document download grant for an authorized reviewer. */
export const documentAccessUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type DocumentAccessUrl = z.infer<typeof documentAccessUrlSchema>;
