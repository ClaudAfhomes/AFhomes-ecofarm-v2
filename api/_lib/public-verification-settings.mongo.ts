import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import {
  publicVerificationFieldsSchema,
  publicVerificationSettingsSchema,
  updatePublicVerificationSettingsSchema,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { purchaseFingerprint } from './purchase-records.mongo.js';
import { deny, fail, method } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

export const SEARCH_CLEANUP_JOB = 'afhomes-sale-team-search-cleanup';
export const SEARCH_CLEANUP_IMPLEMENTATION = 'mongo-search-cleanup-v1';
export const SEARCH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const SEARCH_CLEANUP_LEASE_MS = 2 * 60 * 1000;

/** Defaults are disabled and unapproved. GET never seeds a settings or identity record. */
function initialSettings() {
  return publicVerificationSettingsSchema.parse({
    enabled: false,
    dailyLimitEnabled: true,
    privacyApproved: false,
    cleanupReady: false,
    verificationPhone: '+639604316867',
    retentionDays: 30,
    noticeVersion: 'unconfigured',
    revision: 1,
    updatedAt: new Date(0).toISOString(),
    privacyNotice:
      'Public verification is disabled. An administrator must enter and approve the AFHomes privacy notice, contact information and retention settings before this service can collect contact details or disclose accreditation information.',
  });
}

/** Health comes from a single live server-owned lease and completed sweep, never from a browser flag. */
export async function mongoSearchCleanupReady(
  db: Db,
  retentionDays: number,
  session?: ClientSession,
) {
  const jobs = await db
    .collection<MongoRow>('background_jobs')
    .find({ name: SEARCH_CLEANUP_JOB }, { session })
    .limit(2)
    .toArray();
  if (jobs.length !== 1) return false;
  const job = jobs[0]!,
    now = Date.now(),
    success = job.last_success_at instanceof Date ? job.last_success_at.valueOf() : NaN;
  return (
    job._id === SEARCH_CLEANUP_JOB &&
    job.database === db.databaseName &&
    job.active === true &&
    job.state === 'healthy' &&
    job.implementation === SEARCH_CLEANUP_IMPLEMENTATION &&
    job.interval_ms === SEARCH_CLEANUP_INTERVAL_MS &&
    job.retention_days === retentionDays &&
    typeof job.lease_owner === 'string' &&
    job.lease_owner.length > 0 &&
    job.lease_expires_at instanceof Date &&
    job.lease_expires_at.valueOf() > now &&
    Number.isFinite(success) &&
    success <= now &&
    success > now - SEARCH_CLEANUP_INTERVAL_MS - 5 * 60 * 1000
  );
}

export async function readMongoPublicVerificationSettings(db: Db, session?: ClientSession) {
  const saved = await db
    .collection<MongoRow>('public_verification_settings')
    .findOne({ _id: 'public' }, { session });
  const settings = publicVerificationSettingsSchema.parse(saved ?? initialSettings());
  return {
    ...settings,
    cleanupReady: await mongoSearchCleanupReady(db, settings.retentionDays, session),
  };
}

export function createMongoPublicVerificationSettingsHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const verb = method(req);
    if (!['GET', 'PUT'].includes(verb)) return fail(res, 'NOT_FOUND', 'Route not found', 404);
    const action = verb === 'GET' ? 'view' : 'update';
    const access = await authorize(req, 'governance.config', action);
    if ('error' in access) return deny(res, access);
    if (!['admin', 'super_admin'].includes(access.roleSlug))
      return fail(res, 'FORBIDDEN', 'Administrator access is required', 403);
    try {
      if (verb === 'GET')
        return res.status(200).json(await readMongoPublicVerificationSettings(db));
      const parsed = updatePublicVerificationSettingsSchema.safeParse(req.body);
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Check the public verification settings', 400);
      const session = client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne(
              { _id: 'organization-write' },
              { $inc: { seq: 1 } },
              { upsert: true, session },
            );
          const fresh = await authorize(req, 'governance.config', 'update');
          if ('error' in fresh || !['admin', 'super_admin'].includes(fresh.roleSlug))
            throw new CustomerActivationError(403, 'Settings access was refused');
          const before = await readMongoPublicVerificationSettings(db, session);
          const { expectedRevision, ...fields } = parsed.data;
          if (expectedRevision !== before.revision)
            throw new CustomerActivationError(409, 'Settings changed. Reload before saving again');
          const { enabled: _beforeEnabled, ...oldNotice } =
            publicVerificationFieldsSchema.parse(before);
          const { enabled: _nextEnabled, ...newNotice } = fields;
          const noticeVersion =
            purchaseFingerprint(oldNotice) === purchaseFingerprint(newNotice)
              ? before.noticeVersion
              : randomUUID();
          const after = {
            ...fields,
            noticeVersion,
            revision: before.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await col('public_verification_settings').updateOne(
            { _id: 'public' },
            { $set: after },
            { upsert: true, session },
          );
          const auditView = (value: typeof before | typeof after) => ({
            enabled: value.enabled,
            privacyApproved: value.privacyApproved,
            dailyLimitEnabled: value.dailyLimitEnabled,
            retentionDays: value.retentionDays,
            revision: value.revision,
            noticeVersion: value.noticeVersion,
          });
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: fresh.userId,
              action: 'PUBLIC_VERIFICATION_SETTINGS_UPDATED',
              entity_type: 'public_verification_settings',
              entity_id: 'singleton',
              before_data: auditView(before),
              after_data: auditView(after),
              created_at: new Date().toISOString(),
            },
            { session },
          );
          return readMongoPublicVerificationSettings(db, session);
        });
        return res.status(200).json(result);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403 ? 'FORBIDDEN' : 'CONFLICT',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Settings could not be loaded or saved', 503);
    }
  };
}
