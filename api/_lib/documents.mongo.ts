import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClientSession, Db, Filter, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  currentDocumentQuerySchema,
  documentListQuerySchema,
  documentUploadRequestSchema,
  documentConfirmSchema,
  identityDocumentSummarySchema,
} from '@afhomes/contracts';
import type { authorizeAfHomes, AfHomesPrincipal } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import {
  bucketForSubject,
  documentObjectPath,
  DOCUMENT_MAX_BYTES,
  hasPersistedFile,
  idNumberFromFields,
  maskExtractedFields,
  maskReviewedFields,
  mimeMatchesSignature,
  PENDING_SHA256,
  selectCurrentDocumentId,
  type DocumentMime,
} from './documents.js';
import { extractIdentityDocument, manualProvider, OCR_UNAVAILABLE } from './ocr.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import { consumeIdentifierAttempt } from './rate-limit.js';
import type { VercelRequest, VercelResponse } from './http.js';

type Subject = 'customer' | 'ost_application';
const sellerRoles = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
const modules = {
  customer: 'sales.id_documents',
  ost_application: 'network.ost_registrations',
} as const;
const fileBacked = (row: MongoRow) =>
  hasPersistedFile({ storage_path: row.storage_path, sha256: row.sha256 });
const subjectId = (row: MongoRow) => String(row.customer_id ?? row.ost_application_id);
const fieldsOf = (row: MongoRow) =>
  (row.reviewed_data as { fields?: Record<string, string | null> } | null)?.fields ?? {};
const grantSchema = z
  .object({ documentId: z.string().uuid(), nonce: z.string().uuid(), expires: z.number().int() })
  .strict();
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};

const currentFileFilter: Filter<MongoRow> = {
  storage_path: { $type: 'string', $ne: '' },
  sha256: { $regex: /^[0-9a-f]{64}$/, $ne: PENDING_SHA256 },
  verification_status: { $ne: 'rejected' },
};

/** Canonical current-file selection shared by scoped document reads and staff VIP lookup. */
export async function currentMongoIdentityDocument(db: Db, filter: Filter<MongoRow>, session?: ClientSession) {
  return db.collection<MongoRow>('identity_documents').findOne({ ...filter, ...currentFileFilter }, { session, sort: { created_at: -1, _id: -1 } });
}

/** One metadata query for the already-authorized, bounded VIP directory page. */
export async function currentMongoCustomerIdentityPaths(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string,string>();
  const rows = await db.collection('identity_documents').aggregate<{_id:string;path:string}>([
    { $match: { ...currentFileFilter, subject_type: 'customer', customer_id: { $in: ids } } },
    { $sort: { created_at: -1, _id: -1 } },
    { $group: { _id: '$customer_id', path: { $first: '$storage_path' } } },
  ]).toArray();
  return new Map(rows.map((row)=>[row._id,row.path]));
}

/** Existing document API, native persistence. Byte grants authorize one bounded upload, never identity approval. */
export function createMongoDocumentHandlers(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  env: NodeJS.ProcessEnv,
  objects?: PrivateObjectStore,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const secret = createHmac('sha256', env.BETTER_AUTH_SECRET!)
    .update('afhomes-document-upload-v1')
    .digest();
  const signature = (token: string) => createHmac('sha256', secret).update(token).digest();
  async function authorized(
    req: VercelRequest,
    type: Subject,
    id: string,
    doc?: MongoRow,
    session?: ClientSession,
  ) {
    const auth = await authorize(req, modules[type]);
    if ('error' in auth) return auth;
    const subject = await col(type === 'customer' ? 'customers' : 'ost_applications').findOne(
      { _id: id },
      { session },
    );
    if (!subject) return refuse(404, 'Document subject not found');
    if (
      sellerRoles.includes(auth.roleSlug) &&
      subject[type === 'customer' ? 'created_by' : 'sponsor_staff_id'] !== auth.userId &&
      doc?.uploaded_by !== auth.userId
    )
      return refuse(403, 'That document is outside your authorized scope');
    return auth;
  }
  async function scopeFilter(
    type: Subject,
    id: string,
    auth: AfHomesPrincipal,
    session?: ClientSession,
  ) {
    const subject = await col(type === 'customer' ? 'customers' : 'ost_applications').findOne(
      { _id: id },
      { session },
    );
    const owned =
      subject?.[type === 'customer' ? 'created_by' : 'sponsor_staff_id'] === auth.userId;
    return {
      subject_type: type,
      [type === 'customer' ? 'customer_id' : 'ost_application_id']: id,
      ...(sellerRoles.includes(auth.roleSlug) && !owned ? { uploaded_by: auth.userId } : {}),
    };
  }
  async function candidates(
    type: Subject,
    id: string,
    auth: AfHomesPrincipal,
    session?: ClientSession,
  ) {
    const row = await currentMongoIdentityDocument(db, await scopeFilter(type,id,auth,session), session);
    return row ? [row] : [];
  }
  async function view(row: MongoRow, auth: AfHomesPrincipal, session?: ClientSession) {
    const extraction = row.extracted_data as
      | {
          fields?: Record<string, { value: string | null; confidence: number | null }>;
          warnings?: string[];
        }
      | undefined;
    const current = selectCurrentDocumentId(
      (await candidates(row.subject_type as Subject, subjectId(row), auth, session)).map(
        (item) => ({ ...item, id: item._id }),
      ),
    );
    return {
      id: row._id,
      subjectType: row.subject_type,
      subjectId: subjectId(row),
      originalFilename: row.original_filename,
      mime: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      hasFile: fileBacked(row),
      ocrStatus: row.ocr_status,
      ocrProvider: row.ocr_provider ?? null,
      verificationStatus: row.verification_status,
      isCurrent: row._id === current,
      extractedFields: maskExtractedFields(extraction?.fields ?? {}),
      warnings: extraction?.warnings ?? [],
      reviewedFields: maskReviewedFields(fieldsOf(row)),
      possibleDuplicate: null,
      uploadedAt: row.created_at,
      reviewedAt: row.reviewed_at ?? null,
    };
  }
  async function audit(
    actor: string,
    action: string,
    id: string,
    after: Record<string, unknown>,
    session: ClientSession,
  ) {
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actor,
        action,
        entity_type: 'identity_document',
        entity_id: id,
        after_data: { documentId: id, ...after },
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  async function mutate<T>(
    req: VercelRequest,
    type: Subject,
    id: string,
    document: string | undefined,
    work: (auth: AfHomesPrincipal, row: MongoRow | null, session: ClientSession) => Promise<T>,
  ) {
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        for (const lock of ['organization-write', `document-subject:${type}:${id}`])
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne({ _id: lock }, { $inc: { seq: 1 } }, { upsert: true, session });
        const row = document
          ? await col('identity_documents').findOne({ _id: document }, { session })
          : null;
        if (document && !row) return refuse(404, 'Document not found');
        const auth = await authorized(req, type, id, row ?? undefined, session);
        if ('error' in auth) return refuse(auth.error.status, auth.error.error.message);
        return work(auth, row, session);
      });
    } finally {
      await session.endSession();
    }
  }
  async function persisted(row: MongoRow) {
    if (!objects) return refuse(503, 'Private document storage is unavailable');
    if (!row.storage_path) return refuse(409, 'The file has not been uploaded yet');
    const object = await objects.read(String(row.storage_path), DOCUMENT_MAX_BYTES);
    if (!object) return refuse(409, 'Upload is incomplete. Retry after the file is saved.');
    if (
      !object.bytes.length ||
      object.bytes.length !== Number(row.size_bytes) ||
      !mimeMatchesSignature(String(row.mime_type), object.bytes)
    )
      return refuse(400, 'The saved file does not match its declared size or type');
    return object.bytes;
  }
  const handler = async (req: VercelRequest, res: VercelResponse) => {
    try {
      const path = subPath(req),
        verb = method(req);
      const upload = path.match(/^(customer|ost_application)\/upload-url$/);
      if (upload && verb === 'POST') {
        const parsed = documentUploadRequestSchema.safeParse(jsonBody(req));
        if (!parsed.success || parsed.data.subjectType !== upload[1])
          return fail(
            res,
            'VALIDATION_ERROR',
            'A valid document subject and file are required',
            400,
          );
        const input = parsed.data;
        const auth = await authorized(req, input.subjectType, input.subjectId);
        if ('error' in auth) return deny(res, auth);
        if (!objects) return fail(res, 'INTERNAL', 'Private document storage is unavailable', 503);
        if (!consumeIdentifierAttempt(req, auth.userId).allowed)
          return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);
        const id = randomUUID(),
          nonce = randomUUID(),
          expires = Date.now() + 300000;
        const token = Buffer.from(JSON.stringify({ documentId: id, nonce, expires })).toString(
          'base64url',
        );
        await mutate(
          req,
          input.subjectType,
          input.subjectId,
          undefined,
          async (fresh, _row, session) => {
            await col('identity_documents').insertOne(
              {
                _id: id,
                subject_type: input.subjectType,
                customer_id: input.subjectType === 'customer' ? input.subjectId : null,
                ost_application_id:
                  input.subjectType === 'ost_application' ? input.subjectId : null,
                storage_path: '',
                original_filename: input.originalFilename,
                mime_type: input.mime,
                size_bytes: input.sizeBytes,
                sha256: PENDING_SHA256,
                upload_nonce: nonce,
                upload_expires: expires,
                upload_state: 'pending',
                extracted_data: {},
                reviewed_data: { fields: input.idType ? { idType: input.idType } : {} },
                ocr_status: 'not_requested',
                verification_status: 'pending_review',
                uploaded_by: fresh.userId,
                created_at: new Date().toISOString(),
              },
              { session },
            );
            await audit(
              fresh.userId,
              'IDENTITY_DOCUMENT_UPLOADED',
              id,
              {
                subjectType: input.subjectType,
                subjectId: input.subjectId,
                mime: input.mime,
                sizeBytes: input.sizeBytes,
              },
              session,
            );
          },
        );
        return res
          .status(201)
          .json({
            documentId: id,
            bucket: bucketForSubject(input.subjectType),
            uploadUrl: `/api/v1/documents/${id}/upload-bytes?token=${token}&signature=${signature(token).toString('hex')}`,
            expiresAt: new Date(expires).toISOString(),
          });
      }
      if (path === 'current' && verb === 'GET') {
        const parsed = currentDocumentQuerySchema.safeParse(req.query);
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'A valid subject is required', 400);
        const { subjectType: type, subjectId: id } = parsed.data;
        // An unowned subject may still have documents uploaded by this seller.
        const auth = await authorize(req, modules[type]);
        if ('error' in auth) return deny(res, auth);
        const rows = await candidates(type, id, auth);
        const current = selectCurrentDocumentId(rows.map((row) => ({ ...row, id: row._id })));
        const row = rows.find((item) => item._id === current);
        return res.status(200).json({ currentDocument: row ? await view(row, auth) : null });
      }
      if (path === '' && verb === 'GET') {
        const parsed = documentListQuerySchema.safeParse(req.query);
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid document list query', 400);
        const { subjectType: type, subjectId: id, limit, offset, view: mode } = parsed.data;
        const auth = await authorize(req, modules[type]);
        if ('error' in auth) return deny(res, auth);
        const filter = id
          ? await scopeFilter(type, id, auth)
          : {
              subject_type: type,
              ...(sellerRoles.includes(auth.roleSlug) ? { uploaded_by: auth.userId } : {}),
            };
        const [page, total] = await Promise.all([
          col('identity_documents')
            .find(filter)
            .sort({ created_at: -1, _id: -1 })
            .skip(offset)
            .limit(limit)
            .toArray(),
          col('identity_documents').countDocuments(filter),
        ]);
        const data = await Promise.all(
          page.map(async (row) => {
            const result = await view(row, auth);
            return mode === 'summary' ? identityDocumentSummarySchema.parse(result) : result;
          }),
        );
        return res.status(200).json({ data, meta: { total } });
      }
      const match = path.match(/^([0-9a-f-]{36})(?:\/(access-url|complete-upload|confirm|ocr))?$/);
      if (
        !match ||
        (match[2] ? !['access-url'].includes(match[2]) && verb !== 'POST' : verb !== 'GET') ||
        (match[2] === 'access-url' && verb !== 'GET')
      )
        return fail(res, 'NOT_FOUND', 'Document endpoint not found', 404);
      const row = await col('identity_documents').findOne({ _id: match[1]! });
      // Authenticate even when a document does not exist.
      const auth = await authorize(
        req,
        modules[row?.subject_type === 'ost_application' ? 'ost_application' : 'customer'],
      );
      if ('error' in auth) return deny(res, auth);
      if (!row) return fail(res, 'NOT_FOUND', 'Document not found', 404);
      const type = row.subject_type as Subject,
        id = subjectId(row);
      const scoped = await authorized(req, type, id, row);
      if ('error' in scoped) return deny(res, scoped);
      if (!match[2]) return res.status(200).json(await view(row, scoped));
      if (match[2] === 'access-url') {
        if (!fileBacked(row))
          return fail(res, 'CONFLICT', 'The file has not been uploaded yet', 409);
        if (!objects) return fail(res, 'INTERNAL', 'Private document storage is unavailable', 503);
        return res.status(200).json(await objects.downloadURL(String(row.storage_path), 60));
      }
      if (match[2] === 'complete-upload') {
        if (fileBacked(row)) return res.status(200).json(await view(row, scoped));
        const bytes = await persisted(row);
        const result = await mutate(req, type, id, row._id, async (fresh, latest, session) => {
          if (!fileBacked(latest!)) {
            if (latest!.storage_path !== row.storage_path || latest!.upload_state !== 'uploaded')
              return refuse(409, 'Upload changed. Retry verification.');
            await col('identity_documents').updateOne(
              { _id: row._id },
              { $set: { sha256: createHash('sha256').update(bytes).digest('hex') } },
              { session },
            );
            latest!.sha256 = createHash('sha256').update(bytes).digest('hex');
            await audit(fresh.userId, 'IDENTITY_DOCUMENT_UPLOAD_VERIFIED', row._id, {}, session);
          }
          return view(latest!, fresh, session);
        });
        return res.status(200).json(result);
      }
      if (match[2] === 'confirm') {
        const parsed = documentConfirmSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'A decision with reviewed fields is required', 400);
        const fields: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(parsed.data.fields))
          if (/^[A-Za-z][A-Za-z0-9_ ]{0,39}$/.test(key))
            fields[key] = value === null ? null : value.trim().slice(0, 200);
        if (!Object.keys(fields).length)
          return fail(res, 'VALIDATION_ERROR', 'At least one reviewable field is required', 400);
        const result = await mutate(req, type, id, row._id, async (fresh, latest, session) => {
          const merged = { ...fieldsOf(latest!), ...fields },
            notes = parsed.data.notes?.trim() || null;
          const number = idNumberFromFields(fields);
          const duplicate =
            parsed.data.decision === 'confirmed'
              ? !!number &&
                !!(await col('customers').findOne({ government_id_number: number }, { session }))
              : null;
          const previous = latest!.reviewed_data as { notes?: string | null } | undefined;
          const sameFields =
            JSON.stringify(Object.entries(fieldsOf(latest!)).sort()) ===
            JSON.stringify(Object.entries(merged).sort());
          if (
            latest!.verification_status !== parsed.data.decision ||
            !sameFields ||
            (previous?.notes ?? null) !== notes
          ) {
            const now = new Date().toISOString();
            const patch = {
              verification_status: parsed.data.decision,
              reviewed_by: fresh.userId,
              reviewed_at: now,
              reviewed_data: { fields: merged, notes, confirmedAt: now, confirmedBy: fresh.userId },
            };
            await col('identity_documents').updateOne(
              { _id: row._id },
              { $set: patch },
              { session },
            );
            Object.assign(latest!, patch);
            await audit(
              fresh.userId,
              parsed.data.decision === 'confirmed'
                ? 'IDENTITY_DOCUMENT_CONFIRMED'
                : 'IDENTITY_DOCUMENT_REJECTED',
              row._id,
              { decision: parsed.data.decision, possibleDuplicate: duplicate },
              session,
            );
          }
          if (type === 'customer' && parsed.data.decision === 'confirmed' && !duplicate) {
            const customer = await col('customers').findOne({ _id: id }, { session });
            await col('customers').updateOne(
              { _id: id },
              {
                $set: {
                  government_id_type: customer!.government_id_type ?? merged.idType ?? null,
                  government_id_number: customer!.government_id_number ?? number,
                },
              },
              { session },
            );
          }
          return { ...(await view(latest!, fresh, session)), possibleDuplicate: duplicate };
        });
        return res.status(200).json(result);
      }
      if (!consumeIdentifierAttempt(req, scoped.userId).allowed)
        return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);
      if (row.ocr_status === 'completed' && !(jsonBody(req) as { refresh?: boolean })?.refresh)
        return res.status(200).json(await view(row, scoped));
      const bytes = await persisted(row);
      // Runtime injection prevents disposable fixtures from using the operator's external OCR configuration.
      const extraction = await extractIdentityDocument(
        bytes,
        String(row.mime_type),
        env.OCR_PROVIDER_URL ? undefined : manualProvider,
      );
      const result = await mutate(req, type, id, row._id, async (fresh, latest, session) => {
        const patch = {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ocr_status: Object.keys(extraction.fields).length
            ? 'completed'
            : extraction.warnings.includes(OCR_UNAVAILABLE)
              ? 'unavailable'
              : 'failed',
          ocr_provider: extraction.provider,
          extracted_data: { ...extraction, extractedAt: new Date().toISOString() },
        };
        await col('identity_documents').updateOne({ _id: row._id }, { $set: patch }, { session });
        await audit(fresh.userId, 'IDENTITY_DOCUMENT_OCR_REQUESTED', row._id, {}, session);
        await audit(
          fresh.userId,
          'IDENTITY_DOCUMENT_OCR_COMPLETED',
          row._id,
          { provider: extraction.provider, ocrStatus: patch.ocr_status },
          session,
        );
        return view({ ...latest!, ...patch }, fresh, session);
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : error.status === 409
                ? 'CONFLICT'
                : 'VALIDATION_ERROR',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Document service is unavailable', 503);
    }
  };

  async function upload(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = url.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})\/upload-bytes$/);
    if (!match) return false;
    const respond = (status: number) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(
        JSON.stringify(
          status === 200
            ? { uploaded: true }
            : {
                error: {
                  code: status === 403 ? 'FORBIDDEN' : 'UPLOAD_FAILED',
                  message: 'Private upload could not be completed',
                },
              },
        ),
      );
      return true;
    };
    let claim: string | undefined, key: string | undefined;
    try {
      const token = url.searchParams.get('token') ?? '',
        signed = url.searchParams.get('signature') ?? '';
      if (
        req.method !== 'PUT' ||
        !objects ||
        token.length > 1024 ||
        !/^[a-f0-9]{64}$/.test(signed) ||
        !timingSafeEqual(signature(token), Buffer.from(signed, 'hex'))
      )
        return respond(403);
      const payload = grantSchema.parse(JSON.parse(Buffer.from(token, 'base64url').toString()));
      if (
        payload.documentId !== match[1] ||
        payload.expires <= Date.now() ||
        payload.expires > Date.now() + 300000
      )
        return respond(403);
      claim = randomUUID();
      const doc = await col('identity_documents').findOneAndUpdate(
        {
          _id: payload.documentId,
          upload_nonce: payload.nonce,
          upload_expires: payload.expires,
          sha256: PENDING_SHA256,
          $or: [
            { upload_state: 'pending' },
            { upload_state: 'uploading', upload_claimed_at: { $lt: Date.now() - 120000 } },
          ],
        },
        { $set: { upload_state: 'uploading', upload_claim: claim, upload_claimed_at: Date.now() } },
        { returnDocument: 'after' },
      );
      if (!doc) return respond(409);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > Number(doc.size_bytes) || size > DOCUMENT_MAX_BYTES)
          return refuse(400, 'Upload is too large');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (size !== Number(doc.size_bytes) || !mimeMatchesSignature(String(doc.mime_type), bytes))
        return refuse(400, 'Upload size or type is invalid');
      key = `${bucketForSubject(doc.subject_type as Subject)}/${documentObjectPath(doc.subject_type as Subject, subjectId(doc), doc.mime_type as DocumentMime, claim)}`;
      await objects.put(key, bytes, String(doc.mime_type));
      const saved = await col('identity_documents').updateOne(
        { _id: doc._id, upload_claim: claim, upload_state: 'uploading' },
        {
          $set: { storage_path: key, upload_state: 'uploaded' },
          $unset: { upload_claim: '', upload_claimed_at: '' },
        },
      );
      if (saved.modifiedCount !== 1) return refuse(409, 'Upload changed');
      return respond(200);
    } catch (error) {
      if (key && objects)
        await objects.remove(key).catch(async () => {
          await col('storage_cleanup_jobs').updateOne(
            { object_key: key },
            {
              $setOnInsert: {
                _id: randomUUID(),
                object_key: key,
                created_at: new Date().toISOString(),
                status: 'pending',
              },
            },
            { upsert: true },
          );
        });
      if (claim)
        await col('identity_documents').updateOne(
          { _id: match[1]!, upload_claim: claim },
          {
            $set: { upload_state: 'pending' },
            $unset: { upload_claim: '', upload_claimed_at: '' },
          },
        );
      return respond(
        error instanceof CustomerActivationError
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 403
            : 503,
      );
    }
  }
  return { handler, upload };
}
