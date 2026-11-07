import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoImportClaims } from './import-claim-records.mongo.js';
import { setupMongoImportJobs } from './customer-import-jobs.mongo.js';
import {
  inspectMongoImportInitialization,
  installMongoImportInitialization,
} from './import-initialization.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { setupMongoHistoricalImports } from './historical-import.mongo.js';
let target: Awaited<ReturnType<typeof createTestReplica>>,
  reference: Awaited<ReturnType<typeof createTestReplica>>;
const actor = randomUUID(),
  role = randomUUID(),
  col = (name: string) => target.db.collection<MongoRow>(name);
beforeAll(async () => {
  target = await createTestReplica();
  reference = await createTestReplica();
  await setupMongoHistoricalImports(reference.db);
  await setupMongoImportClaims(reference.db);
  await setupMongoImportJobs(reference.db);
  await col('admin_bootstrap').insertOne({ _id: 'initial-super-admin', user_id: actor });
  await col('staff_users').insertOne({
    _id: actor,
    status: 'active',
    email: 'synthetic@example.invalid',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: actor,
    role_id: role,
  });
  await col('roles').insertOne({ _id: role, slug: 'super_admin', is_active: true });
}, 30000);
afterAll(async () => {
  await target?.stop();
  await reference?.stop();
});
it('plans five absent collections and twelve indexes without writing, then installs only that schema with an audit receipt', async () => {
  const plan = await inspectMongoImportInitialization(target.db, reference.db),
    saved = await col('staff_users').find().toArray();
  expect(plan.collections.filter((entry) => !entry.present)).toHaveLength(5);
  expect(plan.collections.reduce((n, entry) => n + entry.missingIndexes.length, 0)).toBe(12);
  expect(await target.db.listCollections({ name: 'customer_import_jobs' }).hasNext()).toBe(false);
  await expect(
    installMongoImportInitialization(
      target.db,
      target.client,
      reference.db,
      randomUUID(),
      plan.digest,
    ),
  ).rejects.toThrow('owner');
  await expect(
    installMongoImportInitialization(target.db, target.client, reference.db, actor, 'stale'),
  ).rejects.toThrow('changed');
  const applied = await installMongoImportInitialization(
    target.db,
    target.client,
    reference.db,
    actor,
    plan.digest,
  );
  expect(applied.initializedCollections).toHaveLength(5);
  expect(
    applied.current.collections.every(
      (entry) => entry.present && entry.count === 0 && !entry.missingIndexes.length,
    ),
  ).toBe(true);
  expect(await col('staff_users').find().toArray()).toEqual(saved);
  expect(
    await col('audit_events').countDocuments({ action: 'MONGO_IMPORT_SCHEMA_INITIALIZED' }),
  ).toBe(1);
  await installMongoImportInitialization(
    target.db,
    target.client,
    reference.db,
    actor,
    applied.current.digest,
  );
  expect(await col('audit_events').countDocuments({})).toBe(1);
});
it('refuses adding constraints over existing import data without a new reviewed plan', async () => {
  await col('customer_import_rows').insertOne({
    _id: randomUUID(),
    import_job_id: 'synthetic',
    row_number: 1,
  });
  await col('customer_import_rows').dropIndex('import_job_id_1_row_number_1');
  const plan = await inspectMongoImportInitialization(target.db, reference.db);
  await expect(
    installMongoImportInitialization(target.db, target.client, reference.db, actor, plan.digest),
  ).rejects.toThrow('Existing import records');
  expect(await col('customer_import_rows').countDocuments({})).toBe(1);
});

it('plans and applies historical schema separately without reusing the earlier core approval receipt', async () => {
  const plan = await inspectMongoImportInitialization(target.db, reference.db, 'historical');
  expect(plan.collections.filter((entry) => !entry.present)).toHaveLength(3);
  expect(plan.collections.reduce((sum, entry) => sum + entry.missingIndexes.length, 0)).toBe(6);
  const saved = await col('staff_users').find().toArray();
  await expect(installMongoImportInitialization(target.db, target.client, reference.db, actor, 'stale', 'historical')).rejects.toThrow('changed');
  const result = await installMongoImportInitialization(target.db, target.client, reference.db, actor, plan.digest, 'historical');
  expect(result.initializedCollections).toHaveLength(3);
  expect(result.current.collections.every((entry) => entry.present && entry.count === 0 && !entry.missingIndexes.length)).toBe(true);
  expect(await col('staff_users').find().toArray()).toEqual(saved);
  expect(await col('audit_events').countDocuments({ action: 'MONGO_HISTORICAL_IMPORT_SCHEMA_INITIALIZED' })).toBe(1);
  await installMongoImportInitialization(target.db, target.client, reference.db, actor, result.current.digest, 'historical');
  expect(await col('audit_events').countDocuments({ action: 'MONGO_HISTORICAL_IMPORT_SCHEMA_INITIALIZED' })).toBe(1);
});
