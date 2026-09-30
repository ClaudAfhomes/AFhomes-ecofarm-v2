/**
 * AF Homes Phase 12 identity-document API client (staff side).
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@jad/contracts`. The binary PUT to a signed upload URL is the one
 * exception: it is a raw byte transfer, not a JSON API call, and it carries
 * no credentials or session - the URL signature is the authorization.
 */
import {
  documentAccessUrlSchema,
  documentUploadGrantSchema,
  identityDocumentSchema,
  type DocumentAccessUrl,
  type DocumentConfirmRequest,
  type DocumentUploadGrant,
  type DocumentUploadRequest,
  type IdentityDocument,
} from '@jad/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

export const getDocuments = (params: {
  subjectType: 'customer' | 'ost_application';
  subjectId?: string;
}): Promise<IdentityDocument[]> => {
  const query = new URLSearchParams({ subjectType: params.subjectType });
  if (params.subjectId) query.set('subjectId', params.subjectId);
  return requestList(`/documents?${query.toString()}`, identityDocumentSchema);
};

export const getDocument = (id: string): Promise<IdentityDocument> =>
  request(`/documents/${id}`, identityDocumentSchema);

export const requestUploadGrant = (input: DocumentUploadRequest): Promise<DocumentUploadGrant> =>
  post(
    `/documents/${input.subjectType === 'customer' ? 'customer' : 'ost_application'}/upload-url`,
    documentUploadGrantSchema,
    input,
  );

/** Raw byte transfer to the signed URL. Retried never: a repeat PUT is a new attempt. */
export const putUploadBytes = async (uploadUrl: string, file: File): Promise<void> => {
  const response = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!response.ok) throw new Error('The file could not be uploaded. Try again.');
};

export const runDocumentOcr = (id: string, refresh = false): Promise<IdentityDocument> =>
  post(`/documents/${id}/ocr`, identityDocumentSchema, { refresh });

export const confirmDocument = (
  id: string,
  input: DocumentConfirmRequest,
): Promise<IdentityDocument> => post(`/documents/${id}/confirm`, identityDocumentSchema, input);

export const getDocumentAccessUrl = (id: string): Promise<DocumentAccessUrl> =>
  request(`/documents/${id}/access-url`, documentAccessUrlSchema);

/** Client-side pre-check mirroring the server allowlist (convenience only). */
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;
