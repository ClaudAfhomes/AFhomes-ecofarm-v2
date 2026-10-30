import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db, MongoClient } from 'mongodb';
import {
  publicMediaSchema,
  publicMediaUploadMetaSchema,
  updatePublicMediaSchema,
  type PublicMedia,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { resolveCustomerPortalOrigin } from './customer-onboarding-url.js';
import { deny, fail } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { PublicMediaError, type PublicMediaStore, type PublicMediaWrite } from './public-media-store.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { toErrorEnvelope } from './envelope.js';

export const PUBLIC_MEDIA_COLLECTION = 'public_media_assets';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

function queryValue(req: VercelRequest, name: string): string | undefined {
  const value = req.query[name];
  return Array.isArray(value) ? value[0] : value;
}

function numberValue(req: VercelRequest, name: string, fallback: number, max: number): number {
  const raw = queryValue(req, name);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Number(raw), max);
}

function nodeError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  const payload = JSON.stringify({ error: toErrorEnvelope(code, message, status).error });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function mediaErrorStatus(error: PublicMediaError): number {
  switch (error.code) {
    case 'UNSUPPORTED_TYPE':
    case 'INVALID_CONTENT':
      return 400;
    case 'TOO_LARGE':
      return 413;
    case 'FULL':
      return 507;
    case 'NOT_FOUND':
      return 404;
    default:
      return 503;
  }
}

function mediaErrorCode(error: PublicMediaError): string {
  switch (error.code) {
    case 'UNSUPPORTED_TYPE':
    case 'INVALID_CONTENT':
      return 'VALIDATION_ERROR';
    case 'TOO_LARGE':
      return 'PAYLOAD_TOO_LARGE';
    case 'FULL':
      return 'INSUFFICIENT_STORAGE';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    default:
      return 'INTERNAL';
  }
}

function originalName(value: string): string {
  const base = value.replace(/\\/g, '/').split('/').pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return clean || 'media';
}

export function createMongoMediaHandlers(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  store: PublicMediaStore | undefined,
  env: NodeJS.ProcessEnv = process.env,
  trustedOrigins: string[] = [],
) {
  const col = () => db.collection<MongoRow>(PUBLIC_MEDIA_COLLECTION);
  const origin = resolveCustomerPortalOrigin(env);
  const allowedOrigins = trustedOrigins.length
    ? trustedOrigins
    : origin
      ? [origin]
      : [];
  const publicUrl = (key: string) =>
    origin ? `${origin}${store?.publicPath(key) ?? `/media/${key}`}` : `/media/${key}`;

  const view = (row: MongoRow): PublicMedia =>
    publicMediaSchema.parse({
      id: String(row._id),
      name: String(row.original_name ?? ''),
      publicUrl: publicUrl(String(row.storage_key ?? '')),
      mimeType: String(row.mime_type ?? ''),
      mediaType: row.media_type === 'document' ? 'document' : 'image',
      altText: String(row.alt_text ?? ''),
      category: String(row.category ?? 'general'),
      sizeBytes: Number(row.size_bytes ?? 0),
      width: row.width === null || row.width === undefined ? null : Number(row.width),
      height: row.height === null || row.height === undefined ? null : Number(row.height),
      status: row.status === 'unpublished' ? 'unpublished' : 'published',
      uploadedBy: String(row.uploaded_by ?? ''),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    });

  const list = async (req: VercelRequest, res: VercelResponse) => {
    const principal = await authorize(req, 'cms.media', 'view');
    if ('error' in principal) return deny(res, principal);
    if (!store) return fail(res, 'INTERNAL', 'Media storage is not configured', 503);
    const limit = Math.max(1, numberValue(req, 'limit', 50, 100));
    const offset = Math.max(0, numberValue(req, 'offset', 0, 100_000));
    const search = (queryValue(req, 'search') ?? '').trim().slice(0, 100);
    const category = (queryValue(req, 'category') ?? '').trim().slice(0, 60);
    const status = queryValue(req, 'status');
    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;
    if (status === 'published' || status === 'unpublished') filter.status = status;
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ original_name: pattern }, { alt_text: pattern }, { category: pattern }];
    }
    const [rows, total] = await Promise.all([
      col()
        .find(filter)
        .sort({ created_at: -1, _id: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      col().countDocuments(filter),
    ]);
    return res.status(200).json({
      data: rows.map(view),
      meta: { total, limit, offset },
    });
  };

  const detail = async (
    req: VercelRequest,
    res: VercelResponse,
    id: string,
    action: 'view' | 'update' | 'delete',
  ) => {
    const principal = await authorize(req, 'cms.media', action);
    if ('error' in principal) return deny(res, principal);
    if (!store) return fail(res, 'INTERNAL', 'Media storage is not configured', 503);
    const row = await col().findOne({ _id: id });
    if (!row) return fail(res, 'NOT_FOUND', 'Media not found', 404);
    if (action === 'view') return res.status(200).json(view(row));
    if (action === 'update') {
      const parsed = updatePublicMediaSchema.safeParse(req.body);
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid media update', 400);
      const changes = parsed.data;
      if (changes.status === 'published' && row.status === 'unpublished')
        return fail(res, 'CONFLICT', 'Upload a replacement to publish this media again', 409);
      if (changes.status === 'unpublished' && row.status !== 'unpublished')
        await store.remove(String(row.storage_key));
      const now = new Date().toISOString();
      const set: Record<string, unknown> = { updated_at: now };
      if (changes.altText !== undefined) set.alt_text = changes.altText;
      if (changes.category !== undefined) set.category = changes.category;
      if (changes.status !== undefined) set.status = changes.status;
      const updated = { ...row, ...set } as MongoRow;
      const session = client.startSession();
      try {
        await session.withTransaction(
          async () => {
            await col().updateOne({ _id: id }, { $set: set }, { session });
            await db.collection<MongoRow>('audit_events').insertOne(
              {
                _id: randomUUID(),
                actor_id: principal.userId,
                action: changes.status === 'unpublished' ? 'MEDIA_UNPUBLISHED' : 'MEDIA_UPDATED',
                entity_type: 'public_media',
                entity_id: id,
                before_data: view(row),
                after_data: view(updated),
                created_at: new Date(),
              } as MongoRow,
              { session },
            );
          },
          { timeoutMS: 15_000 },
        );
      } finally {
        await session.endSession();
      }
      return res.status(200).json(view(updated));
    }
    if (queryValue(req, 'confirm') !== 'true')
      return fail(res, 'VALIDATION_ERROR', 'Confirm deletion explicitly', 400);
    await store.remove(String(row.storage_key));
    const session = client.startSession();
    try {
      await session.withTransaction(
        async () => {
          await col().deleteOne({ _id: id }, { session });
          await db.collection<MongoRow>('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: principal.userId,
              action: 'MEDIA_DELETED',
              entity_type: 'public_media',
              entity_id: id,
              before_data: view(row),
              created_at: new Date(),
            } as MongoRow,
            { session },
          );
        },
        { timeoutMS: 15_000 },
      );
    } finally {
      await session.endSession();
    }
    return res.status(200).json({ deleted: true });
  };

  const handler = async (req: VercelRequest, res: VercelResponse) => {
    const path = String(req.query.familyPath ?? '').replace(/^\/+|\/+$/g, '');
    if (path === '' && req.method === 'GET') return list(req, res);
    if (!UUID_RE.test(path)) return fail(res, 'NOT_FOUND', 'Media not found', 404);
    if (req.method === 'GET') return detail(req, res, path, 'view');
    if (req.method === 'PATCH') return detail(req, res, path, 'update');
    if (req.method === 'DELETE') return detail(req, res, path, 'delete');
    return fail(res, 'METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  };

  async function upload(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const replaceMatch = /^\/api\/v1\/media\/([0-9a-f-]{36})$/.exec(url.pathname);
    const replace = replaceMatch ? replaceMatch[1]! : undefined;
    if (url.pathname !== '/api/v1/media' && !replace) return false;
    if ((url.pathname === '/api/v1/media' && req.method !== 'POST') || (replace && req.method !== 'PUT'))
      return false;
    const requestOrigin = String(req.headers.origin ?? '');
    if (!allowedOrigins.includes(requestOrigin)) {
      req.resume();
      nodeError(res, 403, 'FORBIDDEN', 'Untrusted request origin');
      return true;
    }
    if (!store) {
      nodeError(res, 503, 'INTERNAL', 'Media storage is not configured');
      return true;
    }
    const principal = await authorize(
      req as unknown as VercelRequest,
      'cms.media',
      replace ? 'update' : 'create',
    );
    if ('error' in principal) {
      req.resume();
      nodeError(res, principal.error.status, principal.error.error.code, principal.error.error.message);
      return true;
    }
    const meta = publicMediaUploadMetaSchema.safeParse({
      name: originalName(url.searchParams.get('name') ?? ''),
      altText: url.searchParams.get('alt') ?? '',
      category: url.searchParams.get('category') ?? 'general',
    });
    if (!meta.success) {
      req.resume();
      nodeError(res, 400, 'VALIDATION_ERROR', 'Invalid media metadata');
      return true;
    }
    const previous = replace ? await col().findOne({ _id: replace }) : null;
    if (replace && !previous) {
      req.resume();
      nodeError(res, 404, 'NOT_FOUND', 'Media not found');
      return true;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > store.maxBytes) {
      req.resume();
      nodeError(res, 413, 'PAYLOAD_TOO_LARGE', 'Media exceeds the size limit');
      return true;
    }
    const mimeType = String(req.headers['content-type'] ?? '').split(';')[0] ?? '';
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > store.maxBytes) {
        nodeError(res, 413, 'PAYLOAD_TOO_LARGE', 'Media exceeds the size limit');
        req.destroy();
        return true;
      }
      chunks.push(bytes);
    }
    let written: PublicMediaWrite;
    try {
      written = await store.put(Buffer.concat(chunks), mimeType);
    } catch (error) {
      const mediaError =
        error instanceof PublicMediaError
          ? error
          : new PublicMediaError('UNAVAILABLE', 'Media storage is unavailable');
      nodeError(
        res,
        mediaErrorStatus(mediaError),
        mediaErrorCode(mediaError),
        mediaError.message,
      );
      return true;
    }
    const now = new Date().toISOString();
    const row = {
      _id: randomUUID(),
      storage_key: written.key,
      original_name: meta.data.name,
      mime_type: written.mimeType,
      media_type: written.mediaType,
      size_bytes: written.sizeBytes,
      width: written.width,
      height: written.height,
      alt_text: meta.data.altText,
      category: meta.data.category,
      status: 'published',
      uploaded_by: principal.userId,
      replaced_from: previous?._id ?? null,
      created_at: now,
      updated_at: now,
    } as MongoRow;
    const session = client.startSession();
    try {
      await session.withTransaction(
        async () => {
          await col().insertOne(row, { session });
          if (previous)
            await col().updateOne(
              { _id: previous._id, status: 'published' },
              {
                $set: {
                  status: 'unpublished',
                  replaced_by: row._id,
                  updated_at: now,
                },
              },
              { session },
            );
          await db.collection<MongoRow>('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: principal.userId,
              action: replace ? 'MEDIA_REPLACED' : 'MEDIA_UPLOADED',
              entity_type: 'public_media',
              entity_id: String(row._id),
              after_data: {
                name: row.original_name,
                mimeType: row.mime_type,
                sizeBytes: row.size_bytes,
                category: row.category,
                status: 'published',
              },
              created_at: new Date(),
            } as MongoRow,
            { session },
          );
        },
        { timeoutMS: 15_000 },
      );
    } catch {
      await store.remove(written.key).catch(() => {});
      nodeError(res, 503, 'INTERNAL', 'Media metadata could not be saved');
      return true;
    } finally {
      await session.endSession();
    }
    if (previous) await store.remove(String(previous.storage_key)).catch(() => {});
    const payload = JSON.stringify(view(row));
    res.writeHead(201, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(payload);
    return true;
  }

  return { handler, upload };
}
