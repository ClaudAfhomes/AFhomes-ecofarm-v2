import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_ROLE_BASELINE, MIGRATION_SEEDED_GRANTS } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { installMongoCoreSetup } from './mongo-core-setup.js';
import { LATER_MONGO_ROLE_GRANTS, mongoRoleReferenceGrants } from './role-reference.mongo.js';
import {
  inspectMongoRoleGrantParity,
  installMongoRoleGrantParity,
} from './role-grant-parity.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  owner = '';
const col = (name: string) => test.db.collection<MongoRow>(name);
const checksum = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
beforeAll(async () => {
  test = await createTestReplica();
  const fixture = await seedPhase5Fixture(test.db, test.client, {
    BETTER_AUTH_SECRET: 'synthetic-reference-parity-'.repeat(3),
    BETTER_AUTH_URL: 'http://localhost:3000',
  });
  owner = fixture.staff.id;
  const assignment = await col('staff_role_assignments').findOne({ staff_id: owner });
  await col('roles').updateOne(
    { _id: String(assignment!.role_id) },
    { $set: { slug: 'super_admin', name: 'Existing Synthetic Owner', is_active: true, is_system: true } },
  );
  await col('admin_bootstrap').insertOne({ _id: 'initial-super-admin', user_id: owner });
  await installMongoCoreSetup(test.db, test.client, owner);
}, 30000);
afterAll(async () => test?.stop());
it('matches the later source role/module audience and exact read/create/update separation', () => {
  const actual = Object.entries(LATER_MONGO_ROLE_GRANTS)
    .flatMap(([role, grants]) => grants!.map((grant) => `${role}/${grant.moduleKey}`))
    .sort();
  const expected = MIGRATION_SEEDED_GRANTS.flatMap((row) =>
    row.roles.map((role) => `${role}/${row.moduleKey}`),
  ).sort();
  expect(actual).toEqual(expected);
  for (const role of Object.keys(DEFAULT_ROLE_BASELINE)) {
    const grants = mongoRoleReferenceGrants(role);
    expect(new Set(grants.map((g) => g.moduleKey)).size).toBe(grants.length);
    expect(grants.every((g) => !g.canDelete)).toBe(true);
  }
  expect(LATER_MONGO_ROLE_GRANTS.finance).toContainEqual({
    moduleKey: 'operations.sales',
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  });
  expect(LATER_MONGO_ROLE_GRANTS.admin).toContainEqual({
    moduleKey: 'governance.customer_import',
    canView: true,
    canCreate: true,
    canUpdate: true,
    canDelete: false,
  });
  expect(LATER_MONGO_ROLE_GRANTS.ost).toEqual([
    {
      moduleKey: 'network.members',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ]);
});
it('new-role setup includes every grant and a plan never writes', async () => {
  const before = checksum(await col('role_permissions').find().sort({ _id: 1 }).toArray());
  expect((await inspectMongoRoleGrantParity(test.db)).missing).toEqual([]);
  expect(checksum(await col('role_permissions').find().sort({ _id: 1 }).toArray())).toBe(before);
});
it('adds only reviewed missing rows, retaining saved denials, restrictions, administrator and authentication', async () => {
  const role = await col('roles').findOne({ slug: 'senior_sales_manager' }),
    module = await col('modules').findOne({ key: 'network.members' });
  await col('role_permissions').deleteOne({ role_id: role!._id, module_id: module!._id });
  const admin = await col('roles').findOne({ slug: 'admin' }),
    lookup = await col('modules').findOne({ key: 'operations.customer_lookup' });
  await col('role_permissions').updateOne(
    { role_id: admin!._id, module_id: lookup!._id },
    { $set: { can_view: false } },
  );
  await col('staff_permission_restrictions').insertOne({
    _id: randomUUID(),
    staff_id: owner,
    module_id: module!._id,
    deny_view: true,
  });
  const saved = await col('role_permissions').find().sort({ _id: 1 }).toArray();
  const identities = checksum(await col('auth_accounts').find().sort({ _id: 1 }).toArray()),
    staff = await col('staff_users').find().toArray(),
    restrictions = await col('staff_permission_restrictions').find().toArray();
  const plan = await inspectMongoRoleGrantParity(test.db);
  expect(plan.missing).toHaveLength(1);
  expect(plan.preserved).toContainEqual(
    expect.objectContaining({ role: 'admin', reason: 'saved-grant-differs' }),
  );
  await expect(
    installMongoRoleGrantParity(test.db, test.client, randomUUID(), plan.digest),
  ).rejects.toThrow('Super Admin');
  await expect(installMongoRoleGrantParity(test.db, test.client, owner, 'wrong')).rejects.toThrow(
    'plan changed',
  );
  expect((await installMongoRoleGrantParity(test.db, test.client, owner, plan.digest))?.added).toBe(
    1,
  );
  for (const row of saved)
    expect(await col('role_permissions').findOne({ _id: row._id })).toEqual(row);
  expect(checksum(await col('auth_accounts').find().sort({ _id: 1 }).toArray())).toBe(identities);
  expect(await col('staff_users').find().toArray()).toEqual(staff);
  expect(await col('staff_permission_restrictions').find().toArray()).toEqual(restrictions);
  const fresh = await inspectMongoRoleGrantParity(test.db);
  expect(
    (await installMongoRoleGrantParity(test.db, test.client, owner, fresh.digest))?.added,
  ).toBe(0);
  expect(await col('audit_events').countDocuments({ action: 'ROLE_REFERENCE_GRANTS_ADDED' })).toBe(
    1,
  );
});
it('rolls back missing grants on audit failure and detects a changed saved denial', async () => {
  const role = await col('roles').findOne({ slug: 'sales_manager' }),
    module = await col('modules').findOne({ key: 'network.members' });
  await col('role_permissions').deleteOne({ role_id: role!._id, module_id: module!._id });
  let plan = await inspectMongoRoleGrantParity(test.db);
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'ROLE_REFERENCE_GRANTS_ADDED' } },
  });
  try {
    await expect(
      installMongoRoleGrantParity(test.db, test.client, owner, plan.digest),
    ).rejects.toThrow();
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(
    await col('role_permissions').findOne({ role_id: role!._id, module_id: module!._id }),
  ).toBeNull();
  const admin = await col('roles').findOne({ slug: 'admin' }),
    lookup = await col('modules').findOne({ key: 'operations.customer_lookup' });
  await col('role_permissions').updateOne(
    { role_id: admin!._id, module_id: lookup!._id },
    { $set: { can_create: true } },
  );
  await expect(
    installMongoRoleGrantParity(test.db, test.client, owner, plan.digest),
  ).rejects.toThrow('plan changed');
  plan = await inspectMongoRoleGrantParity(test.db);
  await installMongoRoleGrantParity(test.db, test.client, owner, plan.digest);
});
