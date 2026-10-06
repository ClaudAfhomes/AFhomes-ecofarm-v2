/**
 * AF Homes Phase 12 - identity document intake, OCR-assisted extraction, and
 * human-confirmed review.
 *
 * Two rules this handler exists to enforce:
 *
 * 1. OCR NEVER FINALIZES. Extraction writes suggestions to the document row
 *    only; customer and application records are never written from OCR output.
 *    A human reviews, edits, and explicitly confirms - the confirm payload is
 *    the only thing that becomes the reviewed record.
 * 2. BYTES STAY PRIVATE. Uploads arrive through server-issued signed URLs for
 *    server-generated paths; reads go through short-lived signed URLs issued
 *    per request to an authorized, in-scope caller. The raw storage path is
 *    never in a response, and ID numbers are masked on every read.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  currentDocumentQuerySchema,
  documentListQuerySchema,
  documentConfirmSchema,
  documentUploadRequestSchema,
} from '@afhomes/contracts';

import { authorizeAfHomes, type AfHomesPrincipal } from '../_lib/afhomes-access.js';
import {
  bucketForSubject,
  DOCUMENT_MAX_BYTES,
  documentObjectPath,
  hasPersistedFile,
  idNumberFromFields,
  maskExtractedFields,
  maskReviewedFields,
  mimeMatchesSignature,
  PENDING_SHA256,
  selectCurrentDocumentId,
  type DocumentMime,
} from '../_lib/documents.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
  mapRpcError,
  method,
  route,
  subPath,
} from '../_lib/handler-kit.js';
import { extractIdentityDocument, OCR_UNAVAILABLE } from '../_lib/ocr.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';
import { serviceClient } from '../_lib/rest.js';
import {
  createDownloadGrant,
  createUploadGrant,
  downloadObject,
  storageClient,
} from '../_lib/storage.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

type Subject = 'customer' | 'ost_application';

const MODULE_FOR_SUBJECT: Record<Subject, 'sales.id_documents' | 'network.ost_registrations'> = {
  customer: 'sales.id_documents',
  ost_application: 'network.ost_registrations',
};

const SELLER_ROLES = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'] as const;

type DocRow = Record<string, unknown>;
const reviewResultSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  isCurrent: z.boolean(),
  possibleDuplicate: z.boolean().nullable(),
});

const extractedOf = (
  row: DocRow,
): Record<string, { value: string | null; confidence: number | null }> => {
  const data = (row.extracted_data ?? {}) as Record<string, unknown>;
  const fields = (data.fields ?? {}) as Record<
    string,
    { value: string | null; confidence: number | null }
  >;
  return fields;
};

const reviewedOf = (row: DocRow): Record<string, string | null> | null => {
  const data = row.reviewed_data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return null;
  return (data.fields ?? null) as Record<string, string | null> | null;
};

/** Masked read model. Storage path and hashes never leave the server. */
const toDocument = (row: DocRow, subjectId: string, isCurrent: boolean) => {
  const reviewed = reviewedOf(row);
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId,
    originalFilename: row.original_filename,
    mime: row.mime_type,
    sizeBytes: Number(row.size_bytes ?? 0),
    hasFile: hasPersistedFile(row),
    ocrStatus: row.ocr_status,
    ocrProvider: isoOrNull(row.ocr_provider),
    verificationStatus: row.verification_status,
    // Server-derived authority from the canonical rule - never inferred client-side.
    isCurrent,
    extractedFields: maskExtractedFields(extractedOf(row)),
    warnings: ((): string[] => {
      const data = (row.extracted_data ?? {}) as Record<string, unknown>;
      return Array.isArray(data.warnings)
        ? (data.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
        : [];
    })(),
    reviewedFields: reviewed ? maskReviewedFields(reviewed) : null,
    possibleDuplicate: null,
    uploadedAt: isoOrNull(row.created_at) ?? '',
    reviewedAt: isoOrNull(row.reviewed_at),
  };
};

const splitStoragePath = (storagePath: string): { bucket: string; path: string } | null => {
  const slash = storagePath.indexOf('/');
  if (slash <= 0) return null;
  return { bucket: storagePath.slice(0, slash), path: storagePath.slice(slash + 1) };
};

/**
 * Ownership scope for sellers. Admins and other non-sellers holding the grant
 * see every document of the type; sellers see documents on subjects they own
 * (customers they registered, applications they sponsor) or uploaded.
 */
async function inScope(db: Db, auth: AfHomesPrincipal, row: DocRow): Promise<boolean> {
  if (!(SELLER_ROLES as readonly string[]).includes(auth.roleSlug)) return true;
  if (row.uploaded_by === auth.userId) return true;
  if (row.subject_type === 'customer') {
    const { data: customer } = await db
      .from('customers')
      .select('created_by')
      .eq('id', row.customer_id)
      .maybeSingle();
    return (customer as { created_by?: string } | null)?.created_by === auth.userId;
  }
  const { data: application } = await db
    .from('ost_applications')
    .select('sponsor_staff_id')
    .eq('id', row.ost_application_id)
    .maybeSingle();
  return (application as { sponsor_staff_id?: string } | null)?.sponsor_staff_id === auth.userId;
}

/** Batch the existing seller ownership rule once per subject, never per document. */
async function ownedSubjects(db: Db, auth: AfHomesPrincipal, subjectType: Subject, ids: string[]) {
  if (!(SELLER_ROLES as readonly string[]).includes(auth.roleSlug)) return new Set(ids);
  if (!ids.length) return new Set<string>();
  const table = subjectType === 'customer' ? 'customers' : 'ost_applications';
  const owner = subjectType === 'customer' ? 'created_by' : 'sponsor_staff_id';
  const { data, error } = await db.from(table).select('id').in('id', ids).eq(owner, auth.userId);
  if (error) throw error;
  return new Set(((data ?? []) as DocRow[]).map((row) => String(row.id)));
}

/**
 * PostgREST applies embedded ordering/limit PER parent. The database considers
 * every eligible document before returning at most one winner per subject.
 * Batch parent IDs (at most the presentation page) to avoid per-document or
 * per-subject queries and unbounded history reads. Non-owned seller subjects
 * restrict the embedded candidates to that seller's uploads, as inScope does.
 */
async function currentDocumentsForSubjects(
  db: Db,
  auth: AfHomesPrincipal,
  subjectType: Subject,
  ids: string[],
  owned?: Set<string>,
): Promise<Map<string, DocRow>> {
  const result = new Map<string, DocRow>();
  if (!ids.length) return result;
  const authorizedOwners = owned ?? (await ownedSubjects(db, auth, subjectType, ids));
  const groups = [
    ids.filter((id) => authorizedOwners.has(id)),
    ids.filter((id) => !authorizedOwners.has(id)),
  ];
  const table = subjectType === 'customer' ? 'customers' : 'ost_applications';
  for (const [index, group] of groups.entries()) {
    if (!group.length) continue;
    let query = db
      .from(table)
      .select('id,current_documents:identity_documents(*)')
      .in('id', group)
      .eq('current_documents.subject_type', subjectType)
      .neq('current_documents.storage_path', '')
      .neq('current_documents.sha256', PENDING_SHA256)
      .neq('current_documents.verification_status', 'rejected')
      .order('created_at', { referencedTable: 'current_documents', ascending: false })
      .order('id', { referencedTable: 'current_documents', ascending: false })
      .limit(1, { referencedTable: 'current_documents' });
    if (index === 1) query = query.eq('current_documents.uploaded_by', auth.userId);
    const { data, error } = await query;
    if (error) throw error;
    for (const parent of (data ?? []) as DocRow[]) {
      const candidates = Array.isArray(parent.current_documents)
        ? (parent.current_documents as DocRow[])
        : [];
      // The existing SHA CHECK ensures every non-placeholder digest is valid.
      // Keep the pure canonical selector as the shared defensive eligibility rule.
      const id = selectCurrentDocumentId(candidates);
      const document = candidates.find((row) => row.id === id);
      if (document) result.set(String(parent.id), document);
    }
  }
  return result;
}

export async function currentIdForSubject(
  db: Db,
  auth: AfHomesPrincipal,
  subjectType: Subject,
  subjectId: string,
): Promise<string | null> {
  const current = await currentDocumentsForSubjects(db, auth, subjectType, [subjectId]);
  return current.has(subjectId) ? String(current.get(subjectId)!.id) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    /* ---------------- issue an upload grant ---------------- */
    const upload = route(req, 'POST', /^(customer|ost_application)\/upload-url$/);
    if (upload) {
      const subjectType = upload[1] as Subject;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      const verdict = consumeIdentifierAttempt(req, auth.userId);
      if (!verdict.allowed)
        return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);

      const parsed = documentUploadRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success || parsed.data.subjectType !== subjectType)
        return fail(res, 'VALIDATION_ERROR', 'Invalid upload request', 400);
      const input = parsed.data;

      const subjectTable = subjectType === 'customer' ? 'customers' : 'ost_applications';
      const ownerColumn = subjectType === 'customer' ? 'created_by' : 'sponsor_staff_id';
      const { data: subject } = await db
        .from(subjectTable)
        .select(`id, ${ownerColumn}`)
        .eq('id', input.subjectId)
        .maybeSingle();
      if (!subject) return fail(res, 'NOT_FOUND', 'Upload target not found', 404);
      if (
        (SELLER_ROLES as readonly string[]).includes(auth.roleSlug) &&
        (subject as Record<string, unknown>)[ownerColumn] !== auth.userId
      ) {
        return fail(res, 'FORBIDDEN', 'That record is outside your authorized scope', 403);
      }

      const bucket = bucketForSubject(subjectType);
      const objectPath = documentObjectPath(
        subjectType,
        input.subjectId,
        input.mime as DocumentMime,
      );
      const storage = storageClient();
      if (!storage) return fail(res, 'INTERNAL', 'Document storage is not configured', 500);
      let grant: { uploadUrl: string; expiresAt: string };
      try {
        grant = await createUploadGrant(storage, bucket, objectPath);
      } catch {
        return fail(res, 'INTERNAL', 'Document storage is not configured', 500);
      }

      // The row precedes the bytes: sha256 is a documented all-zero
      // placeholder until the first server-side download verifies real bytes.
      // It is never returned to any caller.
      const { data: created, error: insertError } = await db
        .from('identity_documents')
        .insert({
          subject_type: subjectType === 'customer' ? 'customer' : 'ost_application',
          customer_id: subjectType === 'customer' ? input.subjectId : null,
          ost_application_id: subjectType === 'ost_application' ? input.subjectId : null,
          storage_path: `${bucket}/${objectPath}`,
          original_filename: input.originalFilename,
          mime_type: input.mime,
          size_bytes: input.sizeBytes,
          sha256: PENDING_SHA256,
          extracted_data: {},
          reviewed_data: input.idType ? { fields: { idType: input.idType } } : {},
          ocr_status: 'not_requested',
          verification_status: 'pending_review',
          uploaded_by: auth.userId,
        })
        .select('*')
        .single();
      if (insertError) throw insertError;

      await audit(
        db,
        auth.userId,
        'IDENTITY_DOCUMENT_UPLOADED',
        'identity_document',
        String((created as { id: string }).id),
        null,
        {
          documentId: String((created as { id: string }).id),
          subjectType,
          subjectId: input.subjectId,
          bucket,
          mime: input.mime,
          sizeBytes: input.sizeBytes,
        },
      );
      return res.status(201).json({
        documentId: String((created as { id: string }).id),
        bucket,
        uploadUrl: grant.uploadUrl,
        expiresAt: grant.expiresAt,
      });
    }

    /* ---------------- verify persisted upload (not human identity approval) ---------------- */
    const completeUpload = route(req, 'POST', /^([0-9a-f-]+)\/complete-upload$/);
    if (completeUpload) {
      const { data: row, error } = await db
        .from('identity_documents')
        .select('*')
        .eq('id', completeUpload[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!row) return fail(res, 'NOT_FOUND', 'Document not found', 404);
      const doc = row as DocRow;
      const subjectType: Subject =
        doc.subject_type === 'ost_application' ? 'ost_application' : 'customer';
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      if (!(await inScope(db, auth, doc)))
        return fail(res, 'FORBIDDEN', 'That document is outside your authorized scope', 403);
      const subjectId = String(doc.customer_id ?? doc.ost_application_id ?? '');
      if (hasPersistedFile(doc)) {
        const retryCurrentId = await currentIdForSubject(db, auth, subjectType, subjectId);
        return res.status(200).json(toDocument(doc, subjectId, doc.id === retryCurrentId));
      }
      const verdict = consumeIdentifierAttempt(req, auth.userId);
      if (!verdict.allowed)
        return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);
      const split = splitStoragePath(String(doc.storage_path ?? ''));
      const storage = storageClient();
      if (!split || !storage)
        return fail(res, 'INTERNAL', 'Document storage is not configured', 500);
      const downloaded = await downloadObject(storage, split.bucket, split.path);
      if ('error' in downloaded)
        return fail(
          res,
          'CONFLICT',
          'Upload is incomplete. Retry verification after the file is saved.',
          409,
        );
      const bytes = downloaded.bytes;
      if (
        !bytes.length ||
        bytes.length > DOCUMENT_MAX_BYTES ||
        !mimeMatchesSignature(String(doc.mime_type), bytes)
      )
        return fail(
          res,
          'VALIDATION_ERROR',
          'The saved file is empty, too large or does not match its declared type.',
          400,
        );
      const { data: updated, error: updateError } = await db
        .from('identity_documents')
        .update({
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size_bytes: bytes.length,
        })
        .eq('id', doc.id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      if (!updated)
        return fail(res, 'CONFLICT', 'Upload verification could not be saved. Try again.', 409);
      const completedCurrentId = await currentIdForSubject(db, auth, subjectType, subjectId);
      return res
        .status(200)
        .json(
          toDocument(updated as DocRow, subjectId, (updated as DocRow).id === completedCurrentId),
        );
    }

    /* ---------------- subject-wide current, independent of presentation pages ---------------- */
    if (subPath(req) === 'current' && method(req) === 'GET') {
      const parsed = currentDocumentQuerySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'A valid subject is required', 400);
      const { subjectType, subjectId } = parsed.data;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      const current = (await currentDocumentsForSubjects(db, auth, subjectType, [subjectId])).get(
        subjectId,
      );
      return res
        .status(200)
        .json({ currentDocument: current ? toDocument(current, subjectId, true) : null });
    }

    /* ---------------- list (scoped, presentation pagination only) ---------------- */
    if (subPath(req) === '' && method(req) === 'GET') {
      const parsed = documentListQuerySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid document list query', 400);
      const { subjectType, subjectId, limit, offset } = parsed.data;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      const column = subjectType === 'customer' ? 'customer_id' : 'ost_application_id';
      const owned = subjectId ? await ownedSubjects(db, auth, subjectType, [subjectId]) : undefined;
      let query = db
        .from('identity_documents')
        .select('*', { count: 'exact' })
        .eq('subject_type', subjectType)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit - 1);
      if (subjectId) {
        query = query.eq(column, subjectId);
        if (!owned?.has(subjectId)) query = query.eq('uploaded_by', auth.userId);
      } else if ((SELLER_ROLES as readonly string[]).includes(auth.roleSlug)) {
        // Preserve the existing unfiltered seller list's own-uploads restriction.
        query = query.eq('uploaded_by', auth.userId);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data ?? []) as DocRow[];
      const ids = [...new Set(rows.map((row) => String(row[column])))];
      const current = await currentDocumentsForSubjects(db, auth, subjectType, ids, owned);
      const visible = rows.map((row) =>
        toDocument(row, String(row[column]), row.id === current.get(String(row[column]))?.id),
      );
      return res
        .status(200)
        .json({ data: visible, meta: { total: count ?? rows.length, limit, offset } });
    }

    /* ---------------- read one (masked, scoped) ---------------- */
    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const { data: row, error } = await db
        .from('identity_documents')
        .select('*')
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!row) return fail(res, 'NOT_FOUND', 'Document not found', 404);
      const subjectType = (
        row.subject_type === 'ost_application' ? 'ost_application' : 'customer'
      ) as Subject;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      if (!(await inScope(db, auth, row as DocRow)))
        return fail(res, 'FORBIDDEN', 'That document is outside your authorized scope', 403);
      const detailSubjectId = String(
        (row as DocRow).customer_id ?? (row as DocRow).ost_application_id ?? '',
      );
      const detailCurrentId = await currentIdForSubject(db, auth, subjectType, detailSubjectId);
      return res
        .status(200)
        .json(toDocument(row as DocRow, detailSubjectId, row.id === detailCurrentId));
    }

    /* ---------------- short-lived reviewer download ---------------- */
    const accessUrl = route(req, 'GET', /^([0-9a-f-]+)\/access-url$/);
    if (accessUrl) {
      const { data: row, error } = await db
        .from('identity_documents')
        .select('*')
        .eq('id', accessUrl[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!row) return fail(res, 'NOT_FOUND', 'Document not found', 404);
      const subjectType = (
        row.subject_type === 'ost_application' ? 'ost_application' : 'customer'
      ) as Subject;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      if (!(await inScope(db, auth, row as DocRow)))
        return fail(res, 'FORBIDDEN', 'That document is outside your authorized scope', 403);
      const split = splitStoragePath(String((row as DocRow).storage_path ?? ''));
      const storage = storageClient();
      if (!split || !storage)
        return fail(res, 'INTERNAL', 'Document storage is not configured', 500);
      try {
        const grant = await createDownloadGrant(storage, split.bucket, split.path, 60);
        return res.status(200).json({ url: grant.url, expiresAt: grant.expiresAt });
      } catch {
        return fail(res, 'INTERNAL', 'Document storage is not configured', 500);
      }
    }

    /* ---------------- run OCR (suggestions only) ---------------- */
    const ocr = route(req, 'POST', /^([0-9a-f-]+)\/ocr$/);
    if (ocr) {
      const { data: row, error } = await db
        .from('identity_documents')
        .select('*')
        .eq('id', ocr[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!row) return fail(res, 'NOT_FOUND', 'Document not found', 404);
      const doc = row as DocRow;
      const subjectType = (
        doc.subject_type === 'ost_application' ? 'ost_application' : 'customer'
      ) as Subject;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      if (!(await inScope(db, auth, doc)))
        return fail(res, 'FORBIDDEN', 'That document is outside your authorized scope', 403);
      const verdict = consumeIdentifierAttempt(req, auth.userId);
      if (!verdict.allowed)
        return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);

      const refresh = ((jsonBody(req) ?? {}) as Record<string, unknown>).refresh === true;
      const ocrSubjectId = String(doc.customer_id ?? doc.ost_application_id ?? '');
      const ocrCurrentId = await currentIdForSubject(db, auth, subjectType, ocrSubjectId);
      if (doc.ocr_status === 'completed' && !refresh) {
        return res.status(200).json(toDocument(doc, ocrSubjectId, doc.id === ocrCurrentId));
      }

      const split = splitStoragePath(String(doc.storage_path ?? ''));
      const storage = storageClient();
      if (!split || !storage)
        return fail(res, 'INTERNAL', 'Document storage is not configured', 500);
      const downloaded = await downloadObject(storage, split.bucket, split.path);
      if ('error' in downloaded) {
        // The bytes never arrived: the upload grant was issued but the PUT
        // never completed. Retryable - the document stays not_requested.
        return fail(res, 'CONFLICT', 'The file has not been uploaded yet', 409);
      }
      const bytes = downloaded.bytes;
      const failOcr = async (warning: string) => {
        await db
          .from('identity_documents')
          .update({
            ocr_status: 'failed',
            ocr_provider: 'local',
            extracted_data: { provider: 'local', fields: {}, warnings: [warning] },
          })
          .eq('id', doc.id);
        await audit(
          db,
          auth.userId,
          'IDENTITY_DOCUMENT_OCR_COMPLETED',
          'identity_document',
          String(doc.id),
          null,
          {
            documentId: String(doc.id),
            provider: 'local',
            ocrStatus: 'failed',
          },
        );
        const { data: reread } = await db
          .from('identity_documents')
          .select('*')
          .eq('id', doc.id)
          .maybeSingle();
        return res
          .status(200)
          .json(
            toDocument(
              (reread ?? doc) as DocRow,
              String(doc.customer_id ?? doc.ost_application_id ?? ''),
              ((reread ?? doc) as DocRow).id === ocrCurrentId,
            ),
          );
      };

      if (bytes.length === 0) return failOcr('EMPTY_FILE');
      if (bytes.length > DOCUMENT_MAX_BYTES) return failOcr('FILE_TOO_LARGE');
      if (!mimeMatchesSignature(String(doc.mime_type), bytes)) {
        return failOcr('SIGNATURE_MIME_MISMATCH');
      }

      // First verified sight of the bytes: replace the placeholder hash and
      // record the actual size. Never trusted from the browser.
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const { error: persistenceError } = await db
        .from('identity_documents')
        .update({ sha256, size_bytes: bytes.length })
        .eq('id', doc.id);
      if (persistenceError) throw persistenceError;

      await audit(
        db,
        auth.userId,
        'IDENTITY_DOCUMENT_OCR_REQUESTED',
        'identity_document',
        String(doc.id),
        null,
        {
          documentId: String(doc.id),
        },
      );
      const extraction = await extractIdentityDocument(bytes, String(doc.mime_type));
      const ocrStatus =
        Object.keys(extraction.fields).length > 0
          ? 'completed'
          : extraction.warnings.includes(OCR_UNAVAILABLE)
            ? 'unavailable'
            : 'failed';
      await db
        .from('identity_documents')
        .update({
          ocr_status: ocrStatus,
          ocr_provider: extraction.provider,
          extracted_data: {
            provider: extraction.provider,
            fields: extraction.fields,
            warnings: extraction.warnings,
            extractedAt: new Date().toISOString(),
          },
        })
        .eq('id', doc.id);
      await audit(
        db,
        auth.userId,
        'IDENTITY_DOCUMENT_OCR_COMPLETED',
        'identity_document',
        String(doc.id),
        null,
        {
          documentId: String(doc.id),
          provider: extraction.provider,
          ocrStatus,
        },
      );
      const { data: reread } = await db
        .from('identity_documents')
        .select('*')
        .eq('id', doc.id)
        .maybeSingle();
      const ocrCurrentIdFinal = await currentIdForSubject(db, auth, subjectType, ocrSubjectId);
      return res
        .status(200)
        .json(
          toDocument(
            (reread ?? doc) as DocRow,
            ocrSubjectId,
            ((reread ?? doc) as DocRow).id === ocrCurrentIdFinal,
          ),
        );
    }

    /* ---------------- human confirmation (the only authority) ---------------- */
    const confirm = route(req, 'POST', /^([0-9a-f-]+)\/confirm$/);
    if (confirm) {
      const { data: row, error } = await db
        .from('identity_documents')
        .select('*')
        .eq('id', confirm[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!row) return fail(res, 'NOT_FOUND', 'Document not found', 404);
      const doc = row as DocRow;
      const subjectType = (
        doc.subject_type === 'ost_application' ? 'ost_application' : 'customer'
      ) as Subject;
      const auth = await authorizeAfHomes(req, MODULE_FOR_SUBJECT[subjectType]);
      if ('error' in auth) return deny(res, auth);
      if (!(await inScope(db, auth, doc)))
        return fail(res, 'FORBIDDEN', 'That document is outside your authorized scope', 403);

      const parsed = documentConfirmSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'A decision with reviewed fields is required', 400);
      // Sanitize reviewer input: known key shape, capped length. Unknown or
      // oversized keys are dropped, never stored.
      const fields: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(parsed.data.fields)) {
        if (!/^[A-Za-z][A-Za-z0-9_ ]{0,39}$/.test(key)) continue;
        fields[key] = value === null ? null : value.trim().slice(0, 200);
      }
      if (Object.keys(fields).length === 0)
        return fail(res, 'VALIDATION_ERROR', 'At least one reviewable field is required', 400);

      const { data, error: reviewError } = await db.rpc('review_identity_document', {
        p_document_id: doc.id,
        p_actor_id: auth.userId,
        p_decision: parsed.data.decision,
        p_fields: fields,
        p_notes: parsed.data.notes ?? null,
        p_id_number: idNumberFromFields(fields),
      });
      if (reviewError) throw reviewError;
      const review = reviewResultSchema.parse(data);
      const reviewed = review.document;
      const subjectId = String(reviewed.customer_id ?? reviewed.ost_application_id ?? '');
      const body = toDocument(reviewed, subjectId, review.isCurrent);
      return res.status(200).json({ ...body, possibleDuplicate: review.possibleDuplicate });
    }

    return fail(res, 'NOT_FOUND', 'Document endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] documents:', error instanceof Error ? error.message : error);
    return mapRpcError(res, error as { message?: string });
  }
}
