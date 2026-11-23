import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { inspectMongoCoreSetup, installMongoCoreSetup } from './mongo-core-setup.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  actor = '';
const col = (name: string) => test.db.collection<MongoRow>(name);
beforeAll(async () => {
  test = await createTestReplica({ timeoutMS: 15000 });
  const fixture = await seedPhase5Fixture(test.db, test.client, {
    BETTER_AUTH_SECRET: 'synthetic-core-initialization-only-'.repeat(3),
    BETTER_AUTH_URL: 'http://localhost:3000',
  });
  actor = fixture.staff.id;
  const assignment = await col('staff_role_assignments').findOne({ staff_id: actor });
  await col('roles').updateOne(
    { _id: String(assignment!.role_id) },
    { $set: { slug: 'super_admin', name: 'Existing Owner', is_system: true } },
  );
  await col('departments').insertOne({
    _id: randomUUID(),
    code: 'SALES',
    name: 'Existing Sales Title',
    is_active: true,
  });
}, 30000);
afterAll(async () => {
  await test.stop();
});
it('plans read-only and requires an existing active Super Admin before any setup writes', async () => {
  const before = await col('roles').countDocuments();
  const plan = await inspectMongoCoreSetup(test.db);
  expect(plan.initialized).toBe(false);
  expect(plan.missingRoles).toContain('sales_manager');
  expect(await col('roles').countDocuments()).toBe(before);
  await expect(installMongoCoreSetup(test.db, test.client, randomUUID())).rejects.toThrow(
    'Super Admin',
  );
  expect(await col('mongo_conversion_setup').countDocuments()).toBe(0);
});
it('adds only missing reference configuration and indexes, preserving every existing administrator record', async () => {
  const tables = [
    'auth_users',
    'auth_accounts',
    'staff_users',
    'staff_role_assignments',
    'roles',
    'departments',
    'role_permissions',
  ];
  const before = new Map(
    await Promise.all(
      tables.map(async (name) => [name, await col(name).find({}).toArray()] as const),
    ),
  );
  await installMongoCoreSetup(test.db, test.client, actor);
  for (const [table, rows] of before)
    for (const row of rows) expect(await col(table).findOne({ _id: row._id })).toEqual(row);
  const after = await inspectMongoCoreSetup(test.db);
  expect(after).toMatchObject({ initialized: true, missingRoles: [], missingDepartments: [] });
  const lookup = await col('modules').findOne({ key: 'operations.customer_lookup' });
  for (const slug of ['employee', 'admin']) {
    const role = await col('roles').findOne({ slug });
    expect(await col('role_permissions').findOne({ role_id: role!._id, module_id: lookup!._id })).toMatchObject({ can_view: true, can_create: false, can_update: false, can_delete: false });
  }
  const identityCount = await col('auth_users').countDocuments(),
    roleCount = await col('roles').countDocuments(),
    assignmentCount = await col('staff_role_assignments').countDocuments();
  await installMongoCoreSetup(test.db, test.client, actor);
  expect(await col('auth_users').countDocuments()).toBe(identityCount);
  expect(await col('roles').countDocuments()).toBe(roleCount);
  expect(await col('staff_role_assignments').countDocuments()).toBe(assignmentCount);
  expect(await col('card_plans').countDocuments()).toBe(1);
  expect(await col('public_verification_settings').countDocuments()).toBe(0);
}, 30000);
