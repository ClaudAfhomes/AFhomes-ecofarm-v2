import { createHash, randomUUID } from 'node:crypto';

import {
  registerSignedDocumentSchema,
  reviewSignedDocumentSchema,
  signedDocumentUploadRequestSchema,
} from '@afhomes/contracts';

import { authorizeAfHomes } from './afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  mapRpcError,
  route,
  type Db,
} from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { UUID_PATTERN } from './payment-receipts.js';
import {
  createDownloadGrant,
  createUploadGrant,
  downloadObject,
  storageClient,
} from './storage.js';

/**
 * Signed purchase documents under the official-forms family:
 *
 *   POST applications/:id/signed-documents/upload   -> upload grant
 *   POST applications/:id/signed-documents          -> register the uploaded object
 *   GET  applications/:id/signed-documents          -> list
 *   (same three under reservations/:id)
 *   POST signed-documents/:docId/review             -> accept / reject
 *   GET  signed-documents/:docId/download           -> short-lived preview link
 *
 * Every rule (who, which states, path ownership, object existence) is
 * re-checked inside the SQL functions; this module only shapes requests.
 * Returns true when it handled the request.
 */
const BUCKET = 'afhomes-signed-documents';
const EXTENSION = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;

const SCOPES = {
  applications: {
    kind: 'signed_customer_application',
    column: 'application_id',
    module: 'sales.customers',
    action: 'update',
  },
  reservations: {
    kind: 'signed_reservation_agreement',
    column: 'reservation_id',
    module: 'sales.card_sales',
    action: 'create',
  },
} as const;
type Scope = keyof typeof SCOPES;

type Row = Record<string, unknown>;

async function shape(db: Db, rows: Row[]) {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.uploaded_by, r.reviewed_by]).filter((v) => typeof v === 'string'),
    ),
  ] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await db.from('staff_users').select('id, full_name').in('id', ids);
    if (error) throw error;
    for (const s of (data ?? []) as Row[]) names.set(String(s.id), String(s.full_name ?? ''));
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    applicationId: r.application_id,
    reservationId: isoOrNull(r.reservation_id),
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    uploadedBy: r.uploaded_by,
    uploadedByName: names.get(String(r.uploaded_by)) ?? null,
    uploadedAt: isoOrNull(r.uploaded_at) ?? '',
    reviewedBy: isoOrNull(r.reviewed_by),
    reviewedByName: typeof r.reviewed_by === 'string' ? (names.get(r.reviewed_by) ?? null) : null,
    reviewedAt: isoOrNull(r.reviewed_at),
    reviewNotes: isoOrNull(r.review_notes),
  }));
}

/** Roles that oversee every application. Everyone else sees only their own team's. */
const OVERSIGHT_ROLES: readonly string[] = ['admin', 'super_admin', 'finance'];

/** The application a route id belongs to, or null when the record does not exist. */
async function applicationIdFor(db: Db, scope: Scope, id: string): Promise<string | null> {
  if (scope === 'applications') {
    const { data, error } = await db
      .from('customer_applications')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? String(data.id) : null;
  }
  const { data, error } = await db
    .from('reservation_agreements')
    .select('customer_application_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data?.customer_application_id ? String(data.customer_application_id) : null;
}

/**
 * Row-level scope. A signed document is full customer PII, so a module
 * permission alone is not enough: the caller must be an oversight role, the
 * application's creator, its seller of record, or an upline (two levels) of
 * that seller.
 */
async function canAccessApplication(
  db: Db,
  auth: { userId: string; roleSlug: string },
  applicationId: string,
): Promise<boolean> {
  if (OVERSIGHT_ROLES.includes(auth.roleSlug)) return true;
  const { data: app, error } = await db
    .from('customer_applications')
    .select('created_by')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw error;
  if (!app) return false;
  if (app.created_by === auth.userId) return true;
  const { data: terms, error: termsError } = await db
    .from('customer_application_purchase_terms')
    .select('seller_staff_id, version')
    .eq('application_id', applicationId)
    .order('version', { ascending: false })
    .limit(1);
  if (termsError) throw termsError;
  const seller = ((terms ?? []) as Row[])[0]?.seller_staff_id;
  if (typeof seller !== 'string') return false;
  if (seller === auth.userId) return true;
  const uplinesOf = async (ids: string[]) => {
    if (!ids.length) return [] as string[];
    const { data, error: relError } = await db
      .from('referral_relationships')
      .select('upline_staff_id')
      .in('subject_staff_id', ids)
      .eq('is_active', true);
    if (relError) throw relError;
    return ((data ?? []) as Row[]).map((r) => String(r.upline_staff_id));
  };
  const first = await uplinesOf([seller]);
  if (first.includes(auth.userId)) return true;
  return (await uplinesOf(first)).includes(auth.userId);
}

export async function handleSignedDocuments(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  const scoped = (verb: string, tail: string) =>
    route(
      req,
      verb,
      new RegExp(`^(applications|reservations)/([0-9a-f-]+)/signed-documents${tail}$`),
    );

  const upload = scoped('POST', '/upload');
  const register = scoped('POST', '');
  const listing = scoped('GET', '');
  const match = upload ?? register ?? listing;
  if (match) {
    const scope = SCOPES[match[1] as Scope];
    const id = match[2]!;
    const auth = await authorizeAfHomes(
      req,
      scope.module,
      ...(listing ? [] : ([scope.action] as const)),
    );
    if ('error' in auth) return (deny(res, auth), true);
    if (!UUID_PATTERN.test(id)) return (fail(res, 'NOT_FOUND', 'Record not found', 404), true);
    // Unknown and out-of-scope records answer the same, so ids cannot be probed.
    const applicationId = await applicationIdFor(db, match[1] as Scope, id);
    if (!applicationId || !(await canAccessApplication(db, auth, applicationId)))
      return (fail(res, 'NOT_FOUND', 'Record not found', 404), true);

    if (listing) {
      const { data, error } = await db
        .from('purchase_signed_documents')
        .select('*')
        .eq(scope.column, id)
        .eq('kind', scope.kind)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (list(res, await shape(db, (data ?? []) as Row[])), true);
    }

    if (upload) {
      const parsed = signedDocumentUploadRequestSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return (
          fail(res, 'VALIDATION_ERROR', 'The file must be a PDF, JPEG or PNG up to 10 MB', 400),
          true
        );
      const storage = storageClient();
      if (!storage) return (fail(res, 'INTERNAL', 'Document storage is not configured', 500), true);
      // Server-chosen path under the entity's own folder; the SQL re-checks the prefix.
      const storagePath = `${match[1]}/${id.toLowerCase()}/${randomUUID()}.${EXTENSION[parsed.data.contentType]}`;
      const grant = await createUploadGrant(storage, BUCKET, storagePath, 7200);
      res.status(201).json({ storagePath, ...grant });
      return true;
    }

    const parsed = registerSignedDocumentSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return (fail(res, 'VALIDATION_ERROR', 'Invalid signed document', 400), true);
    // The stored hash and size are evidence, so the server computes them from
    // the uploaded bytes instead of trusting the browser.
    const storage = storageClient();
    if (!storage) return (fail(res, 'INTERNAL', 'Document storage is not configured', 500), true);
    const object = await downloadObject(storage, BUCKET, parsed.data.storagePath);
    if ('error' in object)
      return (
        fail(res, 'VALIDATION_ERROR', 'Upload the signed document before registering it.', 400),
        true
      );
    const actualSha = createHash('sha256').update(object.bytes).digest('hex');
    if (actualSha !== parsed.data.sha256 || object.bytes.byteLength !== parsed.data.sizeBytes)
      return (
        fail(
          res,
          'VALIDATION_ERROR',
          'The uploaded file does not match the details sent. Upload it again.',
          400,
        ),
        true
      );
    const { data, error } = await db.rpc('register_purchase_signed_document_once', {
      p_actor_id: auth.userId,
      p_kind: scope.kind,
      p_entity_id: id,
      p_storage_path: parsed.data.storagePath,
      p_original_filename: parsed.data.originalFilename,
      p_mime_type: parsed.data.mimeType,
      p_size_bytes: parsed.data.sizeBytes,
      p_sha256: parsed.data.sha256,
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(201).json({ id: data });
    return true;
  }

  const review = route(req, 'POST', /^signed-documents\/([0-9a-f-]+)\/review$/);
  if (review) {
    const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
    if ('error' in auth) return (deny(res, auth), true);
    if (!UUID_PATTERN.test(review[1]!))
      return (fail(res, 'NOT_FOUND', 'Document not found', 404), true);
    const { data: doc, error: docError } = await db
      .from('purchase_signed_documents')
      .select('application_id')
      .eq('id', review[1]!)
      .maybeSingle();
    if (docError) throw docError;
    if (!doc || !(await canAccessApplication(db, auth, String(doc.application_id))))
      return (fail(res, 'NOT_FOUND', 'Document not found', 404), true);
    const parsed = reviewSignedDocumentSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return (
        fail(res, 'VALIDATION_ERROR', 'A rejection needs a reason of at least 5 characters', 400),
        true
      );
    const { data, error } = await db.rpc('review_purchase_signed_document_once', {
      p_actor_id: auth.userId,
      p_document_id: review[1],
      p_decision: parsed.data.decision,
      p_notes: parsed.data.notes ?? null,
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(200).json({ id: data });
    return true;
  }

  const download = route(req, 'GET', /^signed-documents\/([0-9a-f-]+)\/download$/);
  if (download) {
    const auth = await authorizeAfHomes(req, 'sales.customers');
    if ('error' in auth) return (deny(res, auth), true);
    if (!UUID_PATTERN.test(download[1]!))
      return (fail(res, 'NOT_FOUND', 'Document not found', 404), true);
    const { data, error } = await db
      .from('purchase_signed_documents')
      .select('storage_path, application_id')
      .eq('id', download[1]!)
      .maybeSingle();
    if (error) throw error;
    if (!data || !(await canAccessApplication(db, auth, String(data.application_id))))
      return (fail(res, 'NOT_FOUND', 'Document not found', 404), true);
    const storage = storageClient();
    if (!storage) return (fail(res, 'INTERNAL', 'Document storage is not configured', 500), true);
    const grant = await createDownloadGrant(storage, BUCKET, String(data.storage_path));
    // Every view of a signed document is on the record.
    await audit(
      db,
      auth.userId,
      'SIGNED_DOCUMENT_VIEWED',
      'purchase_signed_document',
      download[1]!,
    );
    res.status(200).json(grant);
    return true;
  }

  return false;
}
