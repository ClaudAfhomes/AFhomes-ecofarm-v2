import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { inspectMongoDatabaseReadiness } from './database-readiness.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
let target: Awaited<ReturnType<typeof createTestReplica>>,
  reference: Awaited<ReturnType<typeof createTestReplica>>;
const col = (name: string) => target.db.collection<MongoRow>(name);
beforeAll(async () => {
  target = await createTestReplica();
  reference = await createTestReplica();
  await reference.db.collection('memberships').createIndex({ sale_id: 1 }, { unique: true });
  await reference.db.createCollection('points_accounts');
  await reference.db.createCollection('future_required_collection');
  await col('memberships').insertOne({
    _id: 'member',
    customer_id: 'customer',
    sale_id: 'sale',
    status: 'active',
    points_balance: 70,
  });
  await col('customers').insertOne({ _id: 'customer' });
  await col('card_sales').insertOne({
    _id: 'sale',
    customer_id: 'customer',
    plan_id: 'plan',
    cash_price_snapshot: '9007199254740993.01',
  });
  await col('card_plans').insertOne({ _id: 'plan' });
  await col('points_accounts').insertOne({ _id: 'points', membership_id: 'member', balance: 100 });
  await col('payments').insertMany([
    { _id: 'verified', sale_id: 'sale', amount: '9007199254740992.01', status: 'verified' },
    { _id: 'recorded', sale_id: 'sale', amount: '1.00', status: 'recorded' },
    { _id: 'orphan', sale_id: 'absent', amount: 'invalid', status: 'rejected' },
  ]);
}, 30000);
afterAll(async () => {
  await target?.stop();
  await reference?.stop();
});

it('reports orphan historical provenance without exposing or changing stored evidence', async () => {
  await col('customer_external_import_receipts').insertOne({ _id: 'synthetic-orphan-receipt', source_id: 'missing-source',
    application_id: 'missing-application', reason: 'Private synthetic attestation' });
  const before = await col('customer_external_import_receipts').find().toArray();
  const result = await inspectMongoDatabaseReadiness(target.db, reference.db);
  expect(result.brokenReferences).toContainEqual({ relationship: 'customer_external_import_receipts.source_id -> customer_import_purchase_sources', count: 1 });
  expect(JSON.stringify(result)).not.toContain('Private synthetic attestation');
  expect(await col('customer_external_import_receipts').find().toArray()).toEqual(before);
  await col('customer_external_import_receipts').deleteOne({ _id: 'synthetic-orphan-receipt' });
});
it('finds schema gaps, orphan references, unverified money and points mirror drift without repairing records', async () => {
  const before = await col('memberships').find().toArray();
  const result = await inspectMongoDatabaseReadiness(target.db, reference.db);
  expect(result.schemaComplete).toBe(false);
  expect(result.missingCollections).toEqual(['future_required_collection']);
  expect(result.missingIndexes).toEqual([
    { collection: 'memberships', key: { sale_id: 1 }, unique: true },
  ]);
  expect(result.brokenReferences).toContainEqual({
    relationship: 'payments.sale_id -> card_sales',
    count: 1,
  });
  expect(result.issues).toMatchObject({
    malformedMoney: 1,
    activeMembershipWithoutFullVerifiedPayment: 1,
    membershipPointsMismatch: 1,
  });
  expect(await col('memberships').find().toArray()).toEqual(before);
  expect(await target.db.listCollections({ name: 'future_required_collection' }).hasNext()).toBe(
    false,
  );
  expect(JSON.stringify(result)).not.toContain('9007199254740992');
});
it('accepts consistent core data and equivalent constraints under another name', async () => {
  await col('payments').deleteOne({ _id: 'orphan' });
  await col('payments').updateOne({ _id: 'recorded' }, { $set: { status: 'verified' } });
  await col('memberships').updateOne({ _id: 'member' }, { $set: { points_balance: 100 } });
  await col('memberships').createIndex({ sale_id: 1 }, { unique: true, name: 'custom_name' });
  await target.db.createCollection('future_required_collection');
  const result = await inspectMongoDatabaseReadiness(target.db, reference.db);
  expect(result.schemaComplete).toBe(true);
  expect(result.checkedDataConsistent).toBe(true);
  expect(result.brokenReferences).toEqual([]);
});
