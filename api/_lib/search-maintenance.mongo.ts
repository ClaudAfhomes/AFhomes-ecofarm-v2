import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import type { MongoRow } from './customer-activation.mongo.js';
import {
  readMongoPublicVerificationSettings,
  SEARCH_CLEANUP_JOB,
  SEARCH_CLEANUP_IMPLEMENTATION,
  SEARCH_CLEANUP_INTERVAL_MS,
  SEARCH_CLEANUP_LEASE_MS,
} from './public-verification-settings.mongo.js';

/** Explicit long-lived server worker. Never started by import, ping, health or a public request. */
export function createMongoSearchMaintenance(db: Db, client: MongoClient) {
  const col = (name: string) => db.collection<MongoRow>(name),
    owner = randomUUID();
  let timer: ReturnType<typeof setInterval> | undefined,
    stopped = false,
    firstSweep = true;
  let inFlight: Promise<{ claimed: boolean; swept: boolean }> | null = null;
  async function purge(
    table: string,
    field: string,
    cutoff: Date,
    session: ClientSession,
    filter: Record<string, unknown> = {},
  ) {
    const rows = await col(table)
      .find({ ...filter, [field]: { $lt: cutoff } }, { session, projection: { _id: 1 } })
      .sort({ [field]: 1, _id: 1 })
      .limit(1000)
      .toArray();
    if (!rows.length) return 0;
    const result = await col(table).deleteMany(
      { ...filter, _id: { $in: rows.map((row) => row._id) }, [field]: { $lt: cutoff } },
      { session },
    );
    return result.deletedCount;
  }
  async function run() {
    if (stopped) return { claimed: false, swept: false };
    const now = new Date();
    let job: MongoRow | null;
    try {
      job = await col('background_jobs').findOneAndUpdate(
        {
          _id: SEARCH_CLEANUP_JOB,
          $or: [
            { lease_owner: owner },
            { lease_expires_at: { $lte: now } },
            { lease_expires_at: { $exists: false } },
          ],
        },
        {
          $set: {
            name: SEARCH_CLEANUP_JOB,
            database: db.databaseName,
            active: true,
            implementation: SEARCH_CLEANUP_IMPLEMENTATION,
            ...(firstSweep ? { state: 'starting' } : {}),
            interval_ms: SEARCH_CLEANUP_INTERVAL_MS,
            lease_owner: owner,
            lease_expires_at: new Date(now.valueOf() + SEARCH_CLEANUP_LEASE_MS),
            heartbeat_at: now,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return { claimed: false, swept: false };
      throw new Error('Search cleanup could not acquire its lease');
    }
    if (!job) return { claimed: false, swept: false };
    const session = client.startSession();
    try {
      const settings = await readMongoPublicVerificationSettings(db);
      const last = job.last_success_at instanceof Date ? job.last_success_at.valueOf() : 0;
      const due =
        firstSweep ||
        job.state !== 'healthy' ||
        job.retention_days !== settings.retentionDays ||
        last <= now.valueOf() - SEARCH_CLEANUP_INTERVAL_MS;
      if (!due) return { claimed: true, swept: false };
      await session.withTransaction(async () => {
        const held = await col('background_jobs').updateOne(
          { _id: SEARCH_CLEANUP_JOB, lease_owner: owner },
          { $set: { state: 'running' } },
          { session },
        );
        if (held.matchedCount !== 1) throw new Error('Cleanup lease changed');
        const current = await readMongoPublicVerificationSettings(db, session),
          time = Date.now();
        const contactCutoff = new Date(time - current.retentionDays * 86400000),
          securityCutoff = new Date(time - 30 * 86400000);
        const counts = {
          contacts: await purge('sale_team_search_contacts', 'created_at', contactCutoff, session),
          disclosures: await purge(
            'sale_team_search_disclosures',
            'disclosed_at',
            securityCutoff,
            session,
          ),
          attempts: await purge('sale_team_search_attempts', 'updated_at', securityCutoff, session),
          locks: await purge('counters', 'last_used_at', securityCutoff, session, {
            _id: { $regex: '^public-search:' },
          }),
        };
        const completed = new Date();
        await col('background_jobs').updateOne(
          { _id: SEARCH_CLEANUP_JOB, lease_owner: owner },
          {
            $set: {
              state: 'healthy',
              last_success_at: completed,
              retention_days: current.retentionDays,
              last_counts: counts,
              last_error_code: null,
              lease_expires_at: new Date(completed.valueOf() + SEARCH_CLEANUP_LEASE_MS),
            },
          },
          { session },
        );
      });
      firstSweep = false;
      return { claimed: true, swept: true };
    } catch {
      try {
        await col('background_jobs').updateOne(
          { _id: SEARCH_CLEANUP_JOB, lease_owner: owner },
          { $set: { state: 'error', last_error_code: 'CLEANUP_FAILED' } },
        );
      } catch {
        /* A failed lease expires; settings reads also fail closed during database outages. */
      }
      throw new Error('Search cleanup failed');
    } finally {
      await session.endSession();
    }
  }
  function tick() {
    if (!inFlight)
      inFlight = run().finally(() => {
        inFlight = null;
      });
    return inFlight;
  }
  return {
    tick,
    async start() {
      if (stopped) throw new Error('Search cleanup worker has stopped');
      if (timer) return;
      await tick();
      timer = setInterval(() => {
        void tick().catch(() => {
          /* Health is persisted; the next heartbeat retries. */
        });
      }, 60000);
      timer.unref();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        await inFlight;
      } catch {
        /* Preserve controlled failure state while stopping. */
      }
      await col('background_jobs').updateOne(
        { _id: SEARCH_CLEANUP_JOB, lease_owner: owner },
        { $set: { active: false, state: 'stopped', lease_expires_at: new Date() } },
      );
    },
  };
}
