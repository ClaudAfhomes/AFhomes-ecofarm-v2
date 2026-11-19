import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoSearchMaintenance } from './search-maintenance.mongo.js';
import {
  readMongoPublicVerificationSettings,
  SEARCH_CLEANUP_JOB,
  mongoSearchCleanupReady,
} from './public-verification-settings.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
let worker: ReturnType<typeof createMongoSearchMaintenance>,
  contender: ReturnType<typeof createMongoSearchMaintenance>;
const col = (name: string) => test.db.collection<MongoRow>(name);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
beforeAll(async () => {
  test = await createTestReplica();
  worker = createMongoSearchMaintenance(test.db, test.client);
  contender = createMongoSearchMaintenance(test.db, test.client);
}, 30000);
afterAll(async () => {
  await worker.stop();
  await contender.stop();
  await test.stop();
});

it('runs bounded source-compatible retention sweeps under a single lease without touching business data', async () => {
  expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(false);
  await col('sale_team_search_contacts').insertMany(
    Array.from({ length: 1001 }, (_, i) => ({ _id: `expired-${i}`, created_at: daysAgo(31) })),
  );
  await col('sale_team_search_contacts').insertOne({ _id: 'fresh', created_at: new Date() });
  await col('sale_team_search_disclosures').insertMany([
    { _id: 'old', disclosed_at: daysAgo(31) },
    { _id: 'fresh', disclosed_at: new Date() },
  ]);
  await col('sale_team_search_attempts').insertMany([
    { _id: 'old', updated_at: daysAgo(31) },
    { _id: 'fresh', updated_at: new Date() },
  ]);
  await col('counters').insertMany([
    { _id: 'public-search:old', last_used_at: daysAgo(31), seq: 1 },
    { _id: 'organization-write', last_used_at: daysAgo(31), seq: 1 },
  ]);
  const results = await Promise.all([worker.tick(), contender.tick()]);
  expect(results.filter((result) => result.claimed)).toHaveLength(1);
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(2);
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(1);
  expect(await col('sale_team_search_attempts').countDocuments()).toBe(1);
  expect(await col('counters').findOne({ _id: 'organization-write' })).toBeTruthy();
  expect(await col('counters').findOne({ _id: 'public-search:old' })).toBeNull();
  expect(await mongoSearchCleanupReady(test.db, 30)).toBe(true);
  await col('background_jobs').updateOne(
    { _id: SEARCH_CLEANUP_JOB },
    { $set: { last_success_at: daysAgo(1) } },
  );
  await worker.tick();
  await contender.tick();
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(1);
}, 30000);

it('does not accept stale, duplicate, expired or wrong-retention readiness metadata', async () => {
  await col('background_jobs').insertOne({ _id: 'duplicate', name: SEARCH_CLEANUP_JOB });
  expect(await mongoSearchCleanupReady(test.db, 30)).toBe(false);
  await col('background_jobs').deleteOne({ _id: 'duplicate' });
  expect(await mongoSearchCleanupReady(test.db, 7)).toBe(false);
  const settings = await readMongoPublicVerificationSettings(test.db);
  await col('public_verification_settings').insertOne({
    _id: 'public',
    ...settings,
    retentionDays: 1,
  });
  await col('sale_team_search_contacts').insertOne({
    _id: 'shorter-retention',
    created_at: daysAgo(2),
  });
  expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(false);
  await worker.tick();
  await contender.tick();
  expect(await col('sale_team_search_contacts').findOne({ _id: 'shorter-retention' })).toBeNull();
  expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(true);
  await col('background_jobs').updateOne(
    { _id: SEARCH_CLEANUP_JOB },
    { $set: { lease_expires_at: daysAgo(1) } },
  );
  expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(false);
}, 30000);

it('rolls back deletions on failure, reports unhealthy and can recover on the next real sweep', async () => {
  await col('sale_team_search_contacts').insertOne({ _id: 'rollback', created_at: daysAgo(2) });
  await col('background_jobs').updateOne({ _id: SEARCH_CLEANUP_JOB }, { $set: { state: 'error' } });
  await test.db.command({
    collMod: 'background_jobs',
    validator: { state: { $ne: 'healthy' } },
    validationLevel: 'strict',
  });
  try {
    const results = await Promise.allSettled([worker.tick(), contender.tick()]);
    expect(results.some((result) => result.status === 'rejected')).toBe(true);
    expect(await col('sale_team_search_contacts').findOne({ _id: 'rollback' })).toBeTruthy();
    expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(false);
  } finally {
    await test.db.command({ collMod: 'background_jobs', validator: {} });
  }
  await worker.tick();
  await contender.tick();
  expect(await col('sale_team_search_contacts').findOne({ _id: 'rollback' })).toBeNull();
  expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(true);
  await worker.stop();
  await contender.stop();
  expect((await readMongoPublicVerificationSettings(test.db)).cleanupReady).toBe(false);
}, 30000);
