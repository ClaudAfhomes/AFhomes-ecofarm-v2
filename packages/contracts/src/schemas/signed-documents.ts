import { z } from 'zod';

/**
 * Signed purchase documents: the signed Customer Application (required before
 * approval) and the signed Reservation Agreement (required before execution).
 * Files live in the private `afhomes-signed-documents` bucket.
 */
export const SIGNED_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export const SIGNED_DOCUMENT_MAX_BYTES = 10_485_760;

export const signedDocumentKindSchema = z.enum([
  'signed_customer_application',
  'signed_reservation_agreement',
]);
export type SignedDocumentKind = z.infer<typeof signedDocumentKindSchema>;

export const signedDocumentStatusSchema = z.enum(['pending_review', 'accepted', 'rejected']);

/** Step 1: ask for a signed upload grant; the server chooses the path. */
export const signedDocumentUploadRequestSchema = z.object({
  contentType: z.enum(SIGNED_DOCUMENT_CONTENT_TYPES),
  byteSize: z.number().int().positive().max(SIGNED_DOCUMENT_MAX_BYTES),
});
export const signedDocumentUploadGrantSchema = z.object({
  storagePath: z.string().min(1),
  uploadUrl: z.string().url(),
  expiresAt: z.string(),
});
export type SignedDocumentUploadGrant = z.infer<typeof signedDocumentUploadGrantSchema>;

/** Step 2: after the PUT, register the uploaded object. sha256 is lowercase hex of the file bytes. */
export const registerSignedDocumentSchema = z.object({
  storagePath: z.string().trim().min(1).max(300),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum(SIGNED_DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(SIGNED_DOCUMENT_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type RegisterSignedDocumentRequest = z.infer<typeof registerSignedDocumentSchema>;

export const signedDocumentSchema = z.object({
  id: z.string().uuid(),
  kind: signedDocumentKindSchema,
  status: signedDocumentStatusSchema,
  applicationId: z.string().uuid(),
  reservationId: z.string().uuid().nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  uploadedBy: z.string().uuid(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNotes: z.string().nullable(),
});
export type SignedDocument = z.infer<typeof signedDocumentSchema>;

/** Step 3: accept or reject. The uploader may review their own document. */
export const reviewSignedDocumentSchema = z
  .object({
    decision: z.enum(['accepted', 'rejected']),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision !== 'rejected' || (v.notes?.trim().length ?? 0) >= 5, {
    message: 'A rejection requires a reason of at least 5 characters',
    path: ['notes'],
  });
export type ReviewSignedDocumentRequest = z.infer<typeof reviewSignedDocumentSchema>;

/** Short-lived link for previewing the private file. */
export const signedDocumentDownloadSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
});
