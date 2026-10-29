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
  expect(plan.entries.every((entry) => entry.status === 'missing')).toBe(true);
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
  const plan = await inspectMongoPerformanceIndexes(test.db);
  expect((await installMongoPerformanceIndexes(test.db, plan.digest)).deferred).toEqual([
    'customer_import_purchase_sources/read_import_original_source',
  ]);
  expect(
    await test.db.listCollections({ name: 'customer_import_purchase_sources' }).hasNext(),
  ).toBe(false);
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
