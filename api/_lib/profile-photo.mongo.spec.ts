import { createAfHomesAdminAuth } from './auth.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { PROFILE_PHOTO_MAX_BYTES, profilePhotoSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  cookie = '';
let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;
let objectRoot = '',
  storage: import('./private-object-store.js').LocalPrivateObjectStore;
let firstURL = '';
let clock = Date.now();
const col = (name: string) =>
  test.db.collection<import('./customer-activation.mongo.js').MongoRow>(name);
let env: NodeJS.ProcessEnv = {};
const staffPassword = 'SyntheticTemp123';
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  env = {
    BETTER_AUTH_SECRET: 'organization-local-fixture-only-'.repeat(3),
    BETTER_AUTH_URL: base,
  };
  fixture = await seedPhase5Fixture(test.db, test.client, env);
  const assignment = await test.db
    .collection('staff_role_assignments')
    .findOne({ staff_id: fixture.staff.id });
  await test.db
    .collection('roles')
    .updateOne({ _id: assignment!.role_id }, { $set: { slug: 'super_admin', is_system: true } });
  await test.db
    .collection('staff_users')
    .updateOne({ email: fixture.staff.email }, { $set: { must_change_password: false } });
  await test.db
    .collection('mfa_policy')
    .updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  for (const key of [
    'organization.staff',
    'organization.roles',
    'organization.departments',
    'governance.audit',
  ])
    await test.db
      .collection<{ _id: string; key: string; is_active: boolean }>('modules')
      .insertOne({ _id: randomUUID(), key, is_active: true });
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  cookie = jar(login);
}, 120_000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await test?.stop();
  if (objectRoot) {
    if (!path.resolve(objectRoot).startsWith(path.resolve(tmpdir()) + path.sep))
      throw new Error('Invalid synthetic object directory');
    await rm(objectRoot, { recursive: true, force: true });
  }
});
const jar = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
async function request(path: string, body?: unknown, session = cookie, verb?: string) {
  return fetch(`${base}/api/v1${path}`, {
    method: verb ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const jpeg = (size = 39, width = 1) => {
  const header = Buffer.from([
    255,
    216,
    255,
    192,
    0,
    17,
    8,
    0,
    1,
    width >> 8,
    width & 255,
    3,
    1,
    17,
    0,
    2,
    17,
    1,
    3,
    17,
    1,
    255,
    218,
    0,
    12,
    3,
    1,
    0,
    2,
    17,
    3,
    17,
    0,
    63,
    0,
  ]);
  return Buffer.concat([header, Buffer.alloc(size - header.length - 2), Buffer.from([255, 217])]);
};

it('authenticates profile requests and refuses unconfigured private storage', async () => {
  expect((await request('/profile-photo/staff', undefined, '')).status).toBe(401);
  expect((await request('/profile-photo/staff')).status).toBe(503);
  expect((await request('/profile-photo/customer')).status).toBe(403);
});
it('stores validated JPEG bytes outside MongoDB and returns only a short-lived private download', async () => {
  const { LocalPrivateObjectStore } = await import('./private-object-store.js');
  objectRoot = await mkdtemp(path.join(tmpdir(), 'afhomes-private-photo-'));
  storage = new LocalPrivateObjectStore({
    root: objectRoot,
    baseURL: base,
    secret: 'synthetic-local-file-signing-only-'.repeat(2),
    now: () => clock,
  });
  server.removeAllListeners('request');
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env, {}, storage));
  const empty = profilePhotoSchema.parse(await (await request('/profile-photo/staff')).json());
  expect(empty).toMatchObject({ url: null, canUpload: true, notice: null });
  const body = { expectedUserId: fixture.staff.id, dataBase64: jpeg().toString('base64') };
  expect(
    (
      await request(
        '/profile-photo/staff',
        { ...body, expectedUserId: randomUUID() },
        cookie,
        'PUT',
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        '/profile-photo/staff',
        { ...body, dataBase64: Buffer.from('not a photo').toString('base64') },
        cookie,
        'PUT',
      )
    ).status,
  ).toBe(400);
  const saved = await request('/profile-photo/staff', body, cookie, 'PUT');
  expect(saved.status).toBe(200);
  const view = profilePhotoSchema.parse(await saved.json());
  firstURL = view.url!;
  const downloaded = await fetch(firstURL);
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get('cache-control')).toContain('no-store');
  expect(downloaded.headers.get('content-type')).toBe('image/jpeg');
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(jpeg());
  await col('sale_team_accreditations').insertOne({
    _id: randomUUID(),
    staff_id: fixture.staff.id,
    aa_number: 'AAI26100003',
    kind: 'IST',
    public_name: 'SYNTHETIC PHOTO OWNER',
    status: 'active',
  });
  const accreditation = await request('/sale-team/me');
  expect(accreditation.status).toBe(200);
  expect((await accreditation.json()).photoUrl).toBeTruthy();
  const metadata = await col('profile_photos').findOne({ owner_id: fixture.staff.id });
  expect(metadata).toBeTruthy();
  expect(metadata!.bytes).toBeUndefined();
  expect(metadata!.dataBase64).toBeUndefined();
  expect(JSON.stringify(view)).not.toContain(objectRoot);
  const altered = new URL(firstURL);
  altered.searchParams.set('signature', 'changed');
  expect((await fetch(altered)).status).toBe(403);
  const anonymous = new URL('/api/v1/private-files', base);
  expect((await fetch(anonymous)).status).toBe(403);
  expect(
    (await storage.read(String(metadata!.object_key), PROFILE_PHOTO_MAX_BYTES))!.bytes,
  ).toEqual(jpeg());
});
it('keeps the last good photo on metadata failure and supports the existing full compressed-photo limit', async () => {
  const before = await col('profile_photos').findOne({ owner_id: fixture.staff.id });
  await test.db.command({
    collMod: 'profile_photos',
    validator: { $expr: { $eq: ['$object_key', before!.object_key] } },
    validationLevel: 'strict',
  });
  try {
    expect(
      (
        await request(
          '/profile-photo/staff',
          { expectedUserId: fixture.staff.id, dataBase64: jpeg(50).toString('base64') },
          cookie,
          'PUT',
        )
      ).status,
    ).toBe(503);
    expect((await col('profile_photos').findOne({ owner_id: fixture.staff.id }))!.object_key).toBe(
      before!.object_key,
    );
    expect((await fetch(firstURL)).status).toBe(200);
  } finally {
    await test.db.command({ collMod: 'profile_photos', validator: {} });
  }
  const saved = await request(
    '/profile-photo/staff',
    {
      expectedUserId: fixture.staff.id,
      dataBase64: jpeg(PROFILE_PHOTO_MAX_BYTES).toString('base64'),
    },
    cookie,
    'PUT',
  );
  expect(saved.status).toBe(200);
  const current = profilePhotoSchema.parse(await saved.json());
  expect(current.url).not.toBe(firstURL);
  expect((await fetch(firstURL)).status).toBe(404);
  const persisted = profilePhotoSchema.parse(await (await request('/profile-photo/staff')).json());
  expect(Buffer.from(await (await fetch(persisted.url!)).arrayBuffer())).toHaveLength(
    PROFILE_PHOTO_MAX_BYTES,
  );
  clock += 301000;
  expect((await fetch(persisted.url!)).status).toBe(403);
});
it('requires completion of staff security before upload while allowing its identity-only read', async () => {
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { must_change_password: true } },
  );
  const read = await request('/profile-photo/staff');
  expect(read.status).toBe(200);
  expect((await read.json()).canUpload).toBe(false);
  expect(
    (
      await request(
        '/profile-photo/staff',
        { expectedUserId: fixture.staff.id, dataBase64: jpeg().toString('base64') },
        cookie,
        'PUT',
      )
    ).status,
  ).toBe(403);
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { must_change_password: false } },
  );
});

it('keeps customer photos scoped to their own verified identity and denies writes after suspension', async () => {
  const internal = createAfHomesAdminAuth(test.db, test.client, env);
  const identity = await internal.api.createUser({
    body: {
      email: 'photo-customer@example.invalid',
      password: 'SyntheticCustomerPhoto123!',
      name: 'Synthetic Photo Customer',
      data: { emailVerified: true },
    },
  });
  await col('customers').updateOne(
    { _id: fixture.customer.id },
    { $set: { auth_user_id: identity.user.id, status: 'active' } },
  );
  const signed = await request(
    '/auth/identity/sign-in/email',
    { email: identity.user.email, password: 'SyntheticCustomerPhoto123!' },
    '',
  );
  expect(signed.status).toBe(200);
  const customerCookie = jar(signed);
  const empty = await request('/profile-photo/customer', undefined, customerCookie);
  expect(empty.status).toBe(200);
  expect((await empty.json()).url).toBeNull();
  expect((await request('/profile-photo/staff', undefined, customerCookie)).status).toBe(403);
  expect(
    (
      await request(
        '/profile-photo/customer',
        { expectedUserId: fixture.staff.id, dataBase64: jpeg().toString('base64') },
        customerCookie,
        'PUT',
      )
    ).status,
  ).toBe(409);
  const uploaded = await request(
    '/profile-photo/customer',
    { expectedUserId: identity.user.id, dataBase64: jpeg(45).toString('base64') },
    customerCookie,
    'PUT',
  );
  expect(uploaded.status).toBe(200);
  expect(await col('profile_photos').countDocuments()).toBe(2);
  await col('customers').updateOne({ _id: fixture.customer.id }, { $set: { status: 'suspended' } });
  expect(
    (await (await request('/profile-photo/customer', undefined, customerCookie)).json()).canUpload,
  ).toBe(false);
  expect(
    (
      await request(
        '/profile-photo/customer',
        { expectedUserId: identity.user.id, dataBase64: jpeg().toString('base64') },
        customerCookie,
        'PUT',
      )
    ).status,
  ).toBe(403);
});
