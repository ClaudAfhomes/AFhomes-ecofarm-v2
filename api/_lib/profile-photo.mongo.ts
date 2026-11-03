import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { profilePhotoInputSchema } from '@afhomes/contracts';
import type { resolveAfHomesPrincipal } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { decodeProfilePhoto } from './profile-photo-validation.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { consumeIdentifierAttempt } from './rate-limit.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

export async function setupMongoProfilePhotos(db: Db) {
  await db.collection('profile_photos').createIndex({ owner_id: 1 }, { unique: true });
  await db.collection('storage_cleanup_jobs').createIndex({ object_key: 1 }, { unique: true });
}
type Owner = { userId: string; canUpload: boolean };
type Denial = Extract<Awaited<ReturnType<typeof resolveAfHomesPrincipal>>, { error: unknown }>;
type Dependencies = {
  resolveStaff: typeof resolveAfHomesPrincipal;
  identity(req: VercelRequest): Promise<{ id: string } | null>;
  objects?: PrivateObjectStore;
};

/** Same owner-only staff/customer contract; file bytes never enter MongoDB. */
export function createMongoProfilePhotoHandler(
  db: Db,
  client: MongoClient,
  dependencies: Dependencies,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    objects = dependencies.objects;
  async function owner(
    req: VercelRequest,
    scope: string,
    session?: ClientSession,
  ): Promise<Owner | Denial> {
    if (scope === 'staff') {
      const principal = await dependencies.resolveStaff(req);
      if ('error' in principal) return principal;
      return {
        userId: principal.userId,
        canUpload: !principal.mustChangePassword && !principal.mfaRequired,
      };
    }
    const identity = await dependencies.identity(req);
    if (!identity) throw new CustomerActivationError(401, 'Sign in to continue');
    const customer = await col('customers').findOne(
      { auth_user_id: identity.id },
      { session, projection: { status: 1 } },
    );
    if (!customer) throw new CustomerActivationError(403, 'Customer access required');
    return { userId: identity.id, canUpload: customer.status === 'active' };
  }
  async function cleanup(key: string) {
    try {
      await objects!.remove(key);
      await col('storage_cleanup_jobs').updateOne(
        { object_key: key },
        { $set: { status: 'completed', completed_at: new Date().toISOString() } },
      );
    } catch {
      await col('storage_cleanup_jobs').updateOne(
        { object_key: key },
        {
          $setOnInsert: {
            _id: randomUUID(),
            object_key: key,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        },
        { upsert: true },
      );
    }
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const scope = subPath(req),
      verb = method(req);
    if (!['staff', 'customer'].includes(scope) || !['GET', 'PUT'].includes(verb))
      return fail(res, 'NOT_FOUND', 'Route not found', 404);
    let uploaded: string | undefined,
      saved = false;
    try {
      const principal = await owner(req, scope);
      if ('error' in principal) return deny(res, principal);
      if (verb === 'PUT' && !principal.canUpload)
        throw new CustomerActivationError(
          403,
          'Complete account verification before changing your photo',
        );
      if (!objects)
        throw new CustomerActivationError(503, 'Profile photos are unavailable. Please retry.');
      let metadata = await col('profile_photos').findOne({ owner_id: principal.userId });
      if (verb === 'PUT') {
        const verdict = consumeIdentifierAttempt(req, `photo:${principal.userId}`);
        if (!verdict.allowed) {
          res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
          return fail(res, 'RATE_LIMITED', 'Too many uploads. Try again shortly.', 429);
        }
        const parsed = profilePhotoInputSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          throw new CustomerActivationError(400, 'Choose a compressed profile image');
        if (parsed.data.expectedUserId !== principal.userId)
          throw new CustomerActivationError(
            409,
            'Your signed-in account changed. Reload before uploading.',
          );
        const bytes = decodeProfilePhoto(parsed.data.dataBase64);
        if (!bytes)
          throw new CustomerActivationError(
            400,
            'Use a valid JPEG up to 0.5 MB and 512 pixels per side',
          );
        uploaded = `profile-photos/${principal.userId}/${randomUUID()}.jpg`;
        await objects.put(uploaded, bytes, 'image/jpeg');
        const session = client.startSession();
        let previous: string | null = null;
        try {
          metadata = await session.withTransaction(async () => {
            if (scope === 'staff')
              await db
                .collection<{ _id: string; seq: number }>('counters')
                .updateOne(
                  { _id: 'organization-write' },
                  { $inc: { seq: 1 } },
                  { upsert: true, session },
                );
            const fresh = await owner(req, scope, session);
            if ('error' in fresh || fresh.userId !== principal.userId || !fresh.canUpload)
              throw new CustomerActivationError(
                403,
                'Complete account verification before changing your photo',
              );
            const target = scope === 'staff' ? 'staff_users' : 'customers';
            const filter =
              scope === 'staff'
                ? { _id: principal.userId, status: 'active', must_change_password: { $ne: true } }
                : { auth_user_id: principal.userId, status: 'active' };
            const locked = await col(target).updateOne(
              filter,
              { $set: { profile_photo_guard: randomUUID() } },
              { session },
            );
            if (!locked.matchedCount)
              throw new CustomerActivationError(403, 'Account access has changed');
            const before = await col('profile_photos').findOne(
              { owner_id: principal.userId },
              { session },
            );
            previous = typeof before?.object_key === 'string' ? before.object_key : null;
            const row = {
              owner_id: principal.userId,
              object_key: uploaded,
              content_type: 'image/jpeg',
              size: bytes.length,
              updated_at: new Date().toISOString(),
            };
            await col('profile_photos').updateOne(
              { owner_id: principal.userId },
              { $set: row, $setOnInsert: { _id: randomUUID() } },
              { upsert: true, session },
            );
            if (previous)
              await col('storage_cleanup_jobs').updateOne(
                { object_key: previous },
                {
                  $setOnInsert: {
                    _id: randomUUID(),
                    object_key: previous,
                    status: 'pending',
                    created_at: new Date().toISOString(),
                  },
                },
                { upsert: true, session },
              );
            return await col('profile_photos').findOne({ owner_id: principal.userId }, { session });
          });
        } finally {
          await session.endSession();
        }
        saved = true;
        if (previous) await cleanup(previous);
      }
      if (!metadata || !(await objects.exists(String(metadata.object_key))))
        return res
          .status(200)
          .json({ url: null, expiresAt: null, canUpload: principal.canUpload, notice: null });
      try {
        const signed = await objects.downloadURL(String(metadata.object_key), 300);
        return res.status(200).json({ ...signed, canUpload: principal.canUpload, notice: null });
      } catch {
        if (saved)
          return res.status(200).json({
            url: null,
            expiresAt: null,
            canUpload: principal.canUpload,
            notice: 'Photo saved. Refresh the preview to view it.',
          });
        throw new CustomerActivationError(503, 'Could not load your photo. Please retry.');
      }
    } catch (error) {
      // shortcut: if both storage cleanup and MongoDB fail, an unreferenced private object needs operator cleanup.
      if (uploaded && !saved && objects) {
        try {
          await cleanup(uploaded);
        } catch {}
      }
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 401
            ? 'UNAUTHORIZED'
            : error.status === 403
              ? 'FORBIDDEN'
              : error.status === 400
                ? 'VALIDATION_ERROR'
                : error.status === 409
                  ? 'CONFLICT'
                  : 'INTERNAL',
          error.message,
          error.status,
        );
      return fail(
        res,
        'INTERNAL',
        'Profile photos are unavailable. Refresh to check before retrying.',
        503,
      );
    }
  };
}
