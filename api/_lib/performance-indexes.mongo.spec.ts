import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  inspectMongoPerformanceIndexes,
  installMongoPerformanceIndexes,
  MONGO_PERFORMANCE_INDEXES,
} from './performance-indexes.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>;
const col = (name: string) => test.db.collection<MongoRow>(name);
const queries = () => [
  col('card_sale_hierarchy_snapshots').find(
    { ancestor_staff_id: 'staff-7' },
    { projection: { _id: 0, sale_id: 1 } },
  ),
  col('card_sales')
    .find({ origin: 'normal', seller_staff_id: 'staff-7', created_at: { $gte: '2026-10-01' } })
    .sort({ created_at: -1, _id: 1 }),
  col('card_sales')
    .find({ origin: 'normal', seller_ost_id: 'staff-7', created_at: { $gte: '2026-10-01' } })
    .sort({ created_at: -1, _id: 1 }),
  col('customer_import_rows').find({
    committed_at: { $ne: null },
    $or: [
      { 'raw_data.referrer_staff_id': 'staff-7' },
      { 'raw_data.recommender_staff_id': 'staff-7' },
    ],
  }),
  col('customer_import_purchase_sources').find({ original_row_id: 'row-7', superseded_by: null }),
];
beforeAll(async () => {
  test = await createTestReplica();
  const size = 10000,
    date = '2026-10-02T00:00:00.000Z';
  await col('card_sales').insertMany(
    Array.from({ length: size }, (_, n) => ({
      _id: `sale-${n}`,
      origin: 'normal',
      seller_staff_id: `staff-${n % 200}`,
      seller_ost_id: `staff-${n % 200}`,
      created_at: date,
    })),
  );
  await col('card_sale_hierarchy_snapshots').insertMany(
    Array.from({ length: size }, (_, n) => ({
      _id: `snapshot-${n}`,
      sale_id: `sale-${n}`,
      ancestor_staff_id: `staff-${n % 200}`,
    })),
  );
  await col('card_sale_hierarchy_snapshots').createIndex(
    { sale_id: 1, ancestor_staff_id: 1 },
    { unique: true },
  );
  await col('customer_import_rows').insertMany(
    Array.from({ length: size }, (_, n) => ({
      _id: `row-${n}`,
      committed_at: date,
      raw_data: {
        referrer_staff_id: `staff-${n % 200}`,
        recommender_staff_id: `staff-${(n + 1) % 200}`,
      },
    })),
  );
  await col('customer_import_purchase_sources').insertMany(
    Array.from({ length: size }, (_, n) => ({
      _id: `source-${n}`,
      original_row_id: `row-${n}`,
      superseded_by: null,
      created_at: date,
    })),
  );
}, 30000);
afterAll(async () => test?.stop());
it('reduces documents/keys examined on the same 10000-row workloads without changing results', async () => {
  const before = [],
    results = [];
  for (const query of queries()) {
    before.push((await query.clone().explain('executionStats')).executionStats);
    results.push(await query.toArray());
  }
  const plan = await inspectMongoPerformanceIndexes(test.db);
  const seeded = new Set(
    (await test.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  for (const entry of plan.entries)
    expect(entry.status, entry.name).toBe(
      seeded.has(entry.collection) ? 'missing' : 'missing-collection',
    );
  await expect(installMongoPerformanceIndexes(test.db, 'stale')).rejects.toThrow('changed');
  expect((await installMongoPerformanceIndexes(test.db, plan.digest)).added).toHaveLength(6);
  const measurements = [];
  for (const [i, query] of queries().entries()) {
    const after = (await query.clone().explain('executionStats')).executionStats;
    expect((await query.toArray()).map((row) => row._id ?? row.sale_id).sort()).toEqual(
      results[i].map((row) => row._id ?? row.sale_id).sort(),
    );
    expect(after.totalDocsExamined + after.totalKeysExamined).toBeLessThan(
      (before[i].totalDocsExamined + before[i].totalKeysExamined) / 10,
    );
    measurements.push({
      query: i,
      returned: after.nReturned,
      beforeDocs: before[i].totalDocsExamined,
      beforeKeys: before[i].totalKeysExamined,
      afterDocs: after.totalDocsExamined,
      afterKeys: after.totalKeysExamined,
    });
  }
  process.stdout.write(`Disposable query work: ${JSON.stringify(measurements)}\n`);
  expect(
    (await col('card_sale_hierarchy_snapshots').listIndexes().toArray()).some(
      (index) => index.unique,
    ),
  ).toBe(true);
  const installed = await inspectMongoPerformanceIndexes(test.db);
  expect((await installMongoPerformanceIndexes(test.db, installed.digest)).added).toEqual([]);
});
it('defers uninitialized import collections instead of creating collections or bypassing core setup', async () => {
  await col('customer_import_purchase_sources').drop();
  const names = async () =>
    (await test.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  const before = await names();
  const plan = await inspectMongoPerformanceIndexes(test.db);
  const { deferred } = await installMongoPerformanceIndexes(test.db, plan.digest);
  expect(deferred).toContain('customer_import_purchase_sources/read_import_original_source');
  // Every entry on a collection this database has not initialized is deferred, never created.
  expect(deferred).toEqual(
    MONGO_PERFORMANCE_INDEXES.filter((entry) => !before.includes(entry.collection)).map(
      (entry) => `${entry.collection}/${entry.name}`,
    ),
  );
  expect(await names()).toEqual(before);
});
it('rejects a conflicting index name before creating any other index', async () => {
  const candidate = MONGO_PERFORMANCE_INDEXES[0];
  await col(candidate.collection).dropIndex(candidate.name);
  await col(candidate.collection).createIndex({ unexpected: 1 }, { name: candidate.name });
  const plan = await inspectMongoPerformanceIndexes(test.db);
  expect(plan.entries[0].status).toBe('index-name-conflict');
  await expect(installMongoPerformanceIndexes(test.db, plan.digest)).rejects.toThrow('conflicts');
  expect(
    (await col(candidate.collection).listIndexes().toArray()).find(
      (index) => index.name === candidate.name,
    )?.key,
  ).toEqual({ unexpected: 1 });
});
it('keeps proposed read indexes out of core setup and requires the digest-bound afhomes_dev apply', async () => {
  const { setupMongoPhase5 } = await import('./mongo-runtime.js');
  const fresh = test.client.db('afhomes_dev_core_only');
  await setupMongoPhase5(fresh);
  for (const entry of MONGO_PERFORMANCE_INDEXES) {
    const exists = await fresh.listCollections({ name: entry.collection }).hasNext();
    const indexes = exists ? await fresh.collection(entry.collection).listIndexes().toArray() : [];
    expect(
      indexes.map((index) => index.name),
      entry.name,
    ).not.toContain(entry.name);
  }
  await expect(installMongoPerformanceIndexes(fresh, '0'.repeat(64))).rejects.toThrow(
    'afhomes_dev',
  );
  await expect(installMongoPerformanceIndexes(test.db, '0'.repeat(64))).rejects.toThrow(
    'Index plan changed',
  );
  await fresh.dropDatabase();
  // Runs the whole core setup on a fresh database: allow more than the 5 s default.
}, 30_000);
it('installs the session token index as unique and refuses to replace a non-unique one', async () => {
  const sessions = col('auth_sessions');
  await sessions.insertMany([
    { _id: 'session-1', token: 'token-1', userId: 'user-1' },
    { _id: 'session-2', token: 'token-2', userId: 'user-1' },
  ]);
  const token = (plan: Awaited<ReturnType<typeof inspectMongoPerformanceIndexes>>) =>
    plan.entries.find((entry) => entry.name === 'unique_auth_session_token')!;
  // A conflicting entry elsewhere (previous test) would block any apply; restore it first.
  const candidate = MONGO_PERFORMANCE_INDEXES[0];
  await col(candidate.collection).dropIndex(candidate.name);
  // An existing non-unique index on the same key must be reviewed, never silently kept or replaced.
  await sessions.createIndex({ token: 1 }, { name: 'manual_token' });
  const clash = await inspectMongoPerformanceIndexes(test.db);
  expect(token(clash).status).toBe('index-option-conflict');
  await expect(installMongoPerformanceIndexes(test.db, clash.digest)).rejects.toThrow('conflicts');
  await sessions.dropIndex('manual_token');
  const plan = await inspectMongoPerformanceIndexes(test.db);
  expect(token(plan).status).toBe('missing');
  const { added } = await installMongoPerformanceIndexes(test.db, plan.digest);
  expect(added).toContain('auth_sessions/unique_auth_session_token');
  expect(added).toContain('auth_sessions/read_auth_session_user');
  const created = (await sessions.listIndexes().toArray()).find(
    (index) => index.name === 'unique_auth_session_token',
  );
  expect(created?.unique).toBe(true);
  await expect(
    sessions.insertOne({ _id: 'session-3', token: 'token-1', userId: 'user-2' }),
  ).rejects.toMatchObject({ code: 11000 });
  expect(token(await inspectMongoPerformanceIndexes(test.db)).status).toBe('present');
});
