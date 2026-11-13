/**
 * Signed purchase documents (signed Customer Application / signed Reservation
 * Agreement). Upload grant -> PUT bytes -> register -> review. Every shape is
 * the `@afhomes/contracts` signed-documents contract.
 */
import {
  signedDocumentDownloadSchema,
  signedDocumentSchema,
  signedDocumentUploadGrantSchema,
  type RegisterSignedDocumentRequest,
  type ReviewSignedDocumentRequest,
  type SignedDocument,
} from '@afhomes/contracts';
import { z } from 'zod';

import { protectedRequest as request, protectedRequestList as requestList } from '../../lib/api/client';

export type SignedDocumentOwner = 'applications' | 'reservations';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

export const requestSignedDocumentUpload = (
  owner: SignedDocumentOwner,
  id: string,
  input: { contentType: string; byteSize: number },
) =>
  post(`/official-forms/${owner}/${id}/signed-documents/upload`, signedDocumentUploadGrantSchema, input);

export const registerSignedDocument = (
  owner: SignedDocumentOwner,
  id: string,
  input: RegisterSignedDocumentRequest,
): Promise<{ id: string }> =>
  post(`/official-forms/${owner}/${id}/signed-documents`, z.object({ id: z.string().uuid() }), input);

export const listSignedDocuments = (owner: SignedDocumentOwner, id: string): Promise<SignedDocument[]> =>
  requestList(`/official-forms/${owner}/${id}/signed-documents`, signedDocumentSchema);

export const reviewSignedDocument = (
  docId: string,
  input: ReviewSignedDocumentRequest,
): Promise<{ id: string }> =>
  post(`/official-forms/signed-documents/${docId}/review`, z.object({ id: z.string().uuid() }), input);

export const getSignedDocumentDownload = (docId: string) =>
  request(`/official-forms/signed-documents/${docId}/download`, signedDocumentDownloadSchema);

/** Lowercase hex SHA-256 of the file bytes (the register contract requires it). */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
