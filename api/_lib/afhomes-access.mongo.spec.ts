import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestReplica } from './testing/mongo-replica.js';
import { createAfHomesAuth, createAfHomesAdminAuth } from './auth.js';
import { createMongoSessionVerifier } from './auth-verify.mongo.js';
import { createMongoStaffAccess } from './afhomes-access.mongo.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>;
let auth: ReturnType<typeof createAfHomesAuth>, access: ReturnType<typeof createMongoStaffAccess>;
let cookie = '',
  userId = '';
const roleId = randomUUID(),
  moduleId = randomUUID();
const password = 'Temp1234';
const env = {
  BETTER_AUTH_SECRET: 'phase5-real-auth-fixture-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
};
function jar(response: Response, previous = cookie) {
  const values = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map((value) => {
        const at = value.indexOf('=');
        return [value.slice(0, at), value.slice(at + 1)];
      }),
  );
  for (const value of response.headers.getSetCookie()) {
    const first = value.split(';')[0]!,
      at = first.indexOf('=');
    values.set(first.slice(0, at), first.slice(at + 1));
  }
  return [...values].map(([key, value]) => `${key}=${value}`).join('; ');
}
const request = () => ({ headers: { cookie }, query: {} }) as VercelRequest;
async function post(path: string, body: object) {
  const response = await auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/v1/auth/identity${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: env.BETTER_AUTH_URL },
      body: JSON.stringify(body),
    }),
  );
  cookie = jar(response);
  return response;
}
beforeAll(async () => {
  test = await createTestReplica();
  auth = createAfHomesAuth(test.db, test.client, env);
  const internal = createAfHomesAdminAuth(test.db, test.client, env);
  const created = await internal.api.createUser({
    body: {
      name: 'Synthetic Administrator',
      email: 'phase5-admin@example.invalid',
      password,
      data: { emailVerified: true },
    },
  });
  userId = created.user.id;
  const col = (name: string) => test.db.collection<MongoRow>(name);
  await col('mfa_policy').insertOne({ _id: randomUUID(), key: 'admin_mfa_required', value: true });
  await col('staff_users').insertOne({
    _id: userId,
    email: created.user.email,
    full_name: 'Synthetic Administrator',
    status: 'active',
    must_change_password: true,
  });
  await col('roles').insertOne({
    _id: roleId,
    slug: 'super_admin',
    name: 'Super Admin',
    is_active: true,
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: userId,
    role_id: roleId,
  });
  await col('modules').insertOne({ _id: moduleId, key: 'sales.customers', is_active: true });
  access = createMongoStaffAccess(test.db, createMongoSessionVerifier(test.db, auth), env);
}, 120000);
afterAll(async () => {
  await test?.stop();
});
it('validates real cookie sessions and UUID staff associations without bootstrap or guessed APIs', async () => {
  expect(
    (await post('/sign-in/email', { email: 'phase5-admin@example.invalid', password })).status,
  ).toBe(200);
  expect(await access.resolve(request())).toMatchObject({
    userId,
    mustChangePassword: true,
    mfaRequired: false,
  });
  expect(await access.authorize(request(), 'sales.customers', 'update')).toHaveProperty(
    'error.status',
    403,
  );
  expect(
    await access.resolve({
      headers: { authorization: 'Bearer forged-token' },
      query: {},
    } as VercelRequest),
  ).toHaveProperty('error.status', 401);
});
it('does not expose MFA enrollment or verification; temporary-password restrictions remain enforced', async () => {
  expect((await post('/two-factor/enable', { password })).status).toBe(404);
  expect((await post('/two-factor/verify-totp', { code: '123456' })).status).toBe(404);
  expect(await access.resolve(request())).toMatchObject({
    mfaRequired: false,
    mustChangePassword: true,
  });
  expect(await access.authorize(request(), 'sales.customers')).toHaveProperty('error.status', 403);
});
it('allows normal sign-in even when legacy enrollment and MFA policy records remain', async () => {
  await test.db
    .collection<MongoRow>('auth_users')
    .updateOne({ _id: userId }, { $set: { twoFactorEnabled: true } });
  expect((await post('/sign-out', {})).status).toBe(200);
  const login = await post('/sign-in/email', { email: 'phase5-admin@example.invalid', password });
  expect(login.status).toBe(200);
  expect(await login.json()).not.toHaveProperty('twoFactorRedirect', true);
  expect(await access.resolve(request())).toMatchObject({ userId, mfaRequired: false });
  await test.db.collection('mfa_policy').deleteMany({});
  expect(await access.resolve(request())).toMatchObject({ userId, mfaRequired: false });
});
it('enforces deny-view even for Super Admin and changes standing on the next request', async () => {
  await test.db
    .collection<MongoRow>('staff_users')
    .updateOne({ _id: userId }, { $set: { must_change_password: false } });
  expect(await access.authorize(request(), 'sales.customers', 'create')).toHaveProperty(
    'userId',
    userId,
  );
  await test.db
    .collection<MongoRow>('staff_permission_restrictions')
    .insertOne({ _id: randomUUID(), staff_id: userId, module_id: moduleId, deny_view: true });
  expect(await access.authorize(request(), 'sales.customers', 'create')).toHaveProperty(
    'error.status',
    403,
  );
  await test.db
    .collection<MongoRow>('staff_users')
    .updateOne({ _id: userId }, { $set: { status: 'suspended' } });
  expect(await access.resolve(request())).toHaveProperty('error.status', 403);
});
