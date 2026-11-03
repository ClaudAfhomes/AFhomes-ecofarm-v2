import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { installMongoCoreSetup } from './mongo-core-setup.js';
import {
  inspectMongoGsdLookupGrant,
  installMongoGsdLookupGrant,
} from './customer-lookup-grant.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>,
  server: http.Server,
  base = '',
  cookie = '';
const col = (name: string) => test.db.collection<MongoRow>(name);
const request = (path: string, body?: unknown) =>
  fetch(base + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'synthetic-gsd-lookup-grant-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(test.db, test.client, env, 'SyntheticGsd123!');
  await col('admin_bootstrap').insertOne({ _id: 'initial-super-admin', user_id: fixture.admin.id });
  await installMongoCoreSetup(test.db, test.client, fixture.admin.id);
  const plan = await inspectMongoGsdLookupGrant(test.db);
  await col('role_permissions').deleteMany({ role_id: plan.role._id, module_id: plan.module._id });
  await col('staff_role_assignments').updateOne(
    { staff_id: fixture.staff.id },
    { $set: { role_id: plan.role._id } },
  );
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request('/auth/identity/sign-in/email', {
    email: fixture.staff.email,
    password: 'SyntheticGsd123!',
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  expect(
    (
      await request('/admin/afhomes/session/password', {
        currentPassword: 'SyntheticGsd123!',
        newPassword: 'SyntheticGsdReady123!',
        confirmPassword: 'SyntheticGsdReady123!',
      })
    ).status,
  ).toBe(200);
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await test?.stop();
});
it('restores the omitted role grant in effective sessions and native lookup, without granting writes', async () => {
  expect((await request('/memberships/customer-lookup?search=SYNTHETIC')).status).toBe(403);
  const staffBefore = await col('staff_users').find().toArray();
  await expect(installMongoGsdLookupGrant(test.db, test.client, fixture.staff.id)).rejects.toThrow(
    'Super Admin',
  );
  expect((await installMongoGsdLookupGrant(test.db, test.client, fixture.admin.id))?.added).toBe(
    true,
  );
  const session = await request('/admin/afhomes/session');
  expect(session.status).toBe(200);
  expect((await session.json()).permissions).toContainEqual({
    moduleKey: 'operations.customer_lookup',
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  });
  const lookup = await request('/memberships/customer-lookup?search=SYNTHETIC');
  expect(lookup.status).toBe(200);
  expect((await lookup.json()).data.length).toBe(1);
  expect(
    (
      await request('/earning/adjust', {
        membershipId: fixture.customer.membership,
        amount: 1,
        reason: 'Synthetic denial',
      })
    ).status,
  ).toBe(403);
  expect((await request('/sales')).status).toBe(403);
  expect(await col('staff_users').find().toArray()).toEqual(staffBefore);
  expect((await installMongoGsdLookupGrant(test.db, test.client, fixture.admin.id))?.added).toBe(
    false,
  );
  expect(await col('audit_events').countDocuments({ action: 'GSD_CUSTOMER_LOOKUP_GRANTED' })).toBe(
    1,
  );
});
it('honors staff restrictions and saved role denials instead of bypassing RBAC', async () => {
  const plan = await inspectMongoGsdLookupGrant(test.db);
  await col('staff_permission_restrictions').insertOne({
    _id: randomUUID(),
    staff_id: fixture.staff.id,
    module_id: plan.module._id,
    deny_view: true,
  });
  expect((await request('/memberships/customer-lookup?search=SYNTHETIC')).status).toBe(403);
  await col('staff_permission_restrictions').deleteMany({ staff_id: fixture.staff.id });
  await col('role_permissions').updateOne({ _id: plan.grant!._id }, { $set: { can_view: false } });
  await installMongoGsdLookupGrant(test.db, test.client, fixture.admin.id);
  expect((await request('/memberships/customer-lookup?search=SYNTHETIC')).status).toBe(403);
});
it('rolls back the grant if its audit cannot be written', async () => {
  const plan = await inspectMongoGsdLookupGrant(test.db);
  await col('role_permissions').deleteMany({ role_id: plan.role._id, module_id: plan.module._id });
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'GSD_CUSTOMER_LOOKUP_GRANTED' } },
  });
  try {
    await expect(
      installMongoGsdLookupGrant(test.db, test.client, fixture.admin.id),
    ).rejects.toThrow();
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect((await inspectMongoGsdLookupGrant(test.db)).grant).toBeNull();
});
