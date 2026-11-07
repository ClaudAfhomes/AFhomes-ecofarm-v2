import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestReplica } from './testing/mongo-replica.js';
import { bootstrapMongoAdmin, inspectMongoAdminBootstrap } from './admin-bootstrap.mongo.js';
import { createAfHomesAuth } from './auth.js';
import { createMongoSessionVerifier } from './auth-verify.mongo.js';
import { createMongoStaffAccess } from './afhomes-access.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
import type { VercelRequest } from './http.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
const input = {
  email: 'owner@example.invalid',
  fullName: 'Synthetic Bootstrap Owner',
  temporaryPassword: 'TemporaryBootstrapOnly123!',
};
const col = (name: string) => test.db.collection<MongoRow>(name);
beforeAll(async () => {
  test = await createTestReplica({ timeoutMS: 15_000 });
}, 120_000);
afterAll(async () => {
  await test?.stop();
});

it('refuses to adopt an existing identity or staff account without changing it', async () => {
  const id = randomUUID();
  await col('auth_users').insertOne({
    _id: id,
    email: 'OWNER@EXAMPLE.INVALID',
    name: 'Existing Identity',
  });
  await expect(bootstrapMongoAdmin(test.db, test.client, input)).rejects.toThrow(
    'Existing staff or identity',
  );
  expect(await col('auth_users').findOne({ _id: id })).toHaveProperty('name', 'Existing Identity');
  expect(await col('staff_users').countDocuments()).toBe(0);
  await col('auth_users').deleteOne({ _id: id });
  await col('staff_users').insertOne({ _id: id, email: 'unrelated@example.invalid' });
  await expect(bootstrapMongoAdmin(test.db, test.client, input)).rejects.toThrow(
    'Existing staff or identity',
  );
  await col('staff_users').deleteOne({ _id: id });
});
it('rolls back identity, assignments, catalog and bootstrap marker when the audit fails', async () => {
  await test.db.createCollection('audit_events', {
    validator: { action: { $ne: 'SUPER_ADMIN_BOOTSTRAPPED' } },
  });
  await expect(bootstrapMongoAdmin(test.db, test.client, input)).rejects.toThrow();
  for (const name of [
    'auth_users',
    'auth_accounts',
    'staff_users',
    'staff_role_assignments',
    'admin_bootstrap',
    'modules',
    'roles',
    'mfa_policy',
  ])
    expect(await col(name).countDocuments()).toBe(0);
  await test.db.command({ collMod: 'audit_events', validator: {}, validationLevel: 'off' });
});
it('creates one real Better Auth owner under concurrent retries and never resets its password', async () => {
  const results = await Promise.all([
    bootstrapMongoAdmin(test.db, test.client, input),
    bootstrapMongoAdmin(test.db, test.client, input),
  ]);
  expect(results.map((row) => row.status).sort()).toEqual(['already_exists', 'created']);
  expect(new Set(results.map((row) => row.userId)).size).toBe(1);
  const account = await col('auth_accounts').findOne({ userId: results[0]!.userId });
  const same = await bootstrapMongoAdmin(test.db, test.client, {
    ...input,
    temporaryPassword: 'DifferentIgnoredPassword123!',
  });
  expect(same.status).toBe('already_exists');
  expect(await col('auth_accounts').findOne({ userId: same.userId })).toEqual(account);
  expect(await col('audit_events').countDocuments({ action: 'SUPER_ADMIN_BOOTSTRAPPED' })).toBe(1);
  expect(JSON.stringify(await col('audit_events').find().toArray())).not.toContain(
    input.temporaryPassword,
  );
  await expect(
    bootstrapMongoAdmin(test.db, test.client, { ...input, email: 'different@example.invalid' }),
  ).rejects.toThrow('Existing bootstrap differs');
});
it('authenticates the temporary password and enforces password change and privileged MFA', async () => {
  const env = {
    BETTER_AUTH_SECRET: 'bootstrap-synthetic-test-secret-'.repeat(3),
    BETTER_AUTH_URL: 'http://localhost:3000',
  };
  const auth = createAfHomesAuth(test.db, test.client, env);
  const response = await auth.api.signInEmail({
    body: { email: input.email, password: input.temporaryPassword },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const access = createMongoStaffAccess(test.db, createMongoSessionVerifier(test.db, auth), env);
  const request = { method: 'GET', query: {}, headers: { cookie } } as VercelRequest;
  const principal = await access.resolve(request);
  expect(principal).toMatchObject({
    roleSlug: 'super_admin',
    mustChangePassword: true,
    mfaRequired: false,
  });
  expect(await access.authorize(request, 'organization.staff', 'create')).toHaveProperty(
    'error.status',
    403,
  );
  expect(await inspectMongoAdminBootstrap(test.db, input.email)).toHaveProperty(
    'status',
    'already_exists',
  );
});
