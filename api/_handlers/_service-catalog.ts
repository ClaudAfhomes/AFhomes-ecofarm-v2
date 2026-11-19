import { createHash, randomUUID } from 'node:crypto';
import {
  serviceCatalogItemInputSchema,
  serviceCatalogPatchSchema,
  servicePhotoInputSchema,
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { deny, fail, jsonBody, list, mapRpcError, method, type Db } from '../_lib/handler-kit.js';
import { extensionFor, signatureMatches } from '../_lib/media-signature.js';
import { serviceClient, userClient } from '../_lib/rest.js';
import { extractBearerToken } from '../_lib/token.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const SELECT =
  'id,code,name,description,base_price,is_active,is_staycation_eligible,published,availability,photos,details';
const BUCKET = 'afhomes-service-images';

async function present(db: Db, row: Record<string, unknown>) {
  const stored = Array.isArray(row.photos) ? (row.photos as { path: string; alt: string }[]) : [];
  const photos = await Promise.all(
    stored.map(async (photo) => {
      const result = await db.storage.from(BUCKET).createSignedUrl(photo.path, 300);
      if (result.error) throw result.error;
      return {
        id: createHash('sha256').update(photo.path).digest('hex'),
        url: result.data.signedUrl,
        alt: photo.alt,
      };
    }),
  );
  return presentRow(row, photos);
}

/** Row presentation shared by the signed-URL path and the Preview path. */
const presentRow = (
  row: Record<string, unknown>,
  photos: { id: string; url?: string; alt: string }[],
) => {
  const details = (row.details ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    basePrice: String(row.base_price),
    isActive: row.is_active === true,
    isStaycationEligible: row.is_staycation_eligible === true,
    published: row.published === true,
    availability: row.availability ?? 'available',
    photos,
    summary: details.summary ?? null,
    category: details.category ?? null,
    location: details.location ?? null,
    pricingUnit: details.pricingUnit ?? 'unit',
    highlights: details.highlights ?? [],
  };
};

/** Preview rows carry stored photo metadata but no signed URLs (see above). */
const toServiceRow = (row: Record<string, unknown>) => presentRow(row, []);

export async function handleServiceCatalog(req: VercelRequest, res: VercelResponse, path: string) {
  const svc = serviceClient();
  // Preview holds no service key: reads and metadata writes go through the
  // caller-bound wrappers. Photo bytes still need Storage, so uploads stay
  // service-only (503 below) and Preview lists carry no signed image URLs.
  const db = svc ?? userClient(extractBearerToken(req) ?? '');
  if (!db) return fail(res, 'INTERNAL', 'The service catalog is unavailable.', 500);
  const keyless = !svc;
  const verb = method(req);
  if ((path === 'services' || path === 'public/services') && verb === 'GET') {
    const publicRead = path === 'public/services';
    if (!publicRead) {
      const auth = await authorizeAfHomes(req, 'operations.catalog', 'view');
      if ('error' in auth) return deny(res, auth);
    }
    if (keyless && !publicRead) {
      const wrapped = await (db as Db).rpc('preview_staff_services');
      if (wrapped.error) return mapRpcError(res, wrapped.error);
      res.setHeader('Cache-Control', 'no-store');
      return list(res, ((wrapped.data ?? []) as Record<string, unknown>[]).map(toServiceRow));
    }
    // Public reads stay on the service path: unpublished rows must never leak
    // through a caller-scoped client.
    if (keyless) return fail(res, 'INTERNAL', 'The service catalog is unavailable.', 500);
    let query = (db as Db).from('service_catalog').select(SELECT).order('name').limit(200);
    if (publicRead) query = query.eq('published', true).eq('is_active', true);
    const { data, error } = await query;
    if (error) return mapRpcError(res, error);
    res.setHeader('Cache-Control', 'no-store');
    return list(res, await Promise.all((data ?? []).map((row: Record<string, unknown>) => present(db as Db, row))));
  }
  const patch = path.match(/^services\/([0-9a-f-]{36})$/i);
  const photo = path.match(/^services\/([0-9a-f-]{36})\/photos$/i);
  const changePhoto = path.match(/^services\/([0-9a-f-]{36})\/photos\/([a-f0-9]{64})(\/cover)?$/i);
  if (
    changePhoto &&
    ((verb === 'DELETE' && !changePhoto[3]) || (verb === 'PATCH' && changePhoto[3]))
  ) {
    const auth = await authorizeAfHomes(req, 'operations.catalog', 'update');
    if ('error' in auth) return deny(res, auth);
    // Keyless callers use the wrapper: same photo rules, actor bound to the JWT.
    const { data, error } = keyless
      ? await (db as Db).rpc('preview_staff_service_photo', {
          p_service_id: changePhoto[1],
          p_photo_id: changePhoto[2],
          p_operation: verb === 'DELETE' ? 'remove' : 'cover',
          p_path: null,
          p_alt: null,
        })
      : await (db as Db).rpc('manage_service_photo', {
      p_service_id: changePhoto[1],
      p_photo_id: changePhoto[2],
      p_operation: verb === 'DELETE' ? 'remove' : 'cover',
      p_path: null,
      p_alt: null,
      p_actor_id: auth.userId,
    });
    if (error) return mapRpcError(res, error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail(res, 'NOT_FOUND', 'Service photo not found.', 404);
    return res.status(200).json(keyless ? toServiceRow(row) : await present(db as Db, row));
  }
  if ((path === 'services' && verb === 'POST') || (patch && verb === 'PATCH')) {
    const auth = await authorizeAfHomes(req, 'operations.catalog', patch ? 'update' : 'create');
    if ('error' in auth) return deny(res, auth);
    const parsed = (patch ? serviceCatalogPatchSchema : serviceCatalogItemInputSchema).safeParse(
      jsonBody(req),
    );
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the service details.', 400);
    const input = { ...parsed.data };
    if ('code' in input) delete input.code;
    // Keyless callers use the wrapper: same catalog rules, actor bound to the JWT.
    const { data, error } = keyless
      ? await (db as Db).rpc('preview_staff_save_service', {
          p_service_id: patch?.[1] ?? null,
          p_input: input,
        })
      : await (db as Db).rpc('save_service_catalog', {
      p_service_id: patch?.[1] ?? null,
      p_input: input,
      p_actor_id: auth.userId,
    });
    if (error) return mapRpcError(res, error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail(res, 'NOT_FOUND', 'Service not found.', 404);
    return res.status(patch ? 200 : 201).json(keyless ? toServiceRow(row) : await present(db as Db, row));
  }
  if (photo && verb === 'POST') {
    const auth = await authorizeAfHomes(req, 'operations.catalog', 'update');
    if ('error' in auth) return deny(res, auth);
    // Photo bytes live in private Storage, which needs the service key.
    if (keyless)
      return fail(res, 'INTERNAL', 'Photo upload needs a configured backend.', 503);
    const parsed = servicePhotoInputSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Choose a JPEG, PNG or WebP image with descriptive text.',
        400,
      );
    const bytes = Buffer.from(parsed.data.dataBase64, 'base64');
    if (
      !bytes.length ||
      bytes.length > 3 * 1024 * 1024 ||
      !signatureMatches(parsed.data.mimeType, bytes)
    )
      return fail(res, 'VALIDATION_ERROR', 'The image is invalid or larger than 3 MB.', 400);
    const path = `${auth.userId}/${randomUUID()}.${extensionFor(parsed.data.mimeType)}`;
    const storage = db.storage.from(BUCKET);
    const upload = await storage.upload(path, bytes, {
      contentType: parsed.data.mimeType,
      upsert: false,
    });
    if (upload.error) return mapRpcError(res, upload.error);
    const { data, error } = await db.rpc(
      parsed.data.replacePhotoId ? 'manage_service_photo' : 'append_service_photo',
      {
        p_service_id: photo[1],
        p_path: path,
        p_alt: parsed.data.alt,
        p_actor_id: auth.userId,
        ...(parsed.data.replacePhotoId
          ? { p_photo_id: parsed.data.replacePhotoId, p_operation: 'replace' }
          : {}),
      },
    );
    if (error) {
      await storage.remove([path]);
      return fail(
        res,
        'CONFLICT',
        'Could not save the image. Check the service and its six-photo limit.',
        409,
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    return res.status(201).json(await present(db, row));
  }
  return fail(res, 'NOT_FOUND', 'Not found', 404);
}
