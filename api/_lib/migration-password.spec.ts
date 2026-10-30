import http from 'node:http';
import { BSON } from 'mongodb';
import { hash } from 'bcryptjs';
import { expect, it } from 'vitest';
import { getAuthOptions } from './auth.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';

const env = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'synthetic-password-bridge-only'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:52762',
};
const prefix = 'afhomes-supabase-bcrypt-v1:';
const password = 'SyntheticLegacy123!';

it('requires an explicit valid migration flag and retains native verification by default', async () => {
  expect(() => getAuthOptions({ ...env, AFHOMES_ENABLE_LEGACY_PASSWORDS: 'yes' })).toThrow();
  const native = getAuthOptions(env).emailAndPassword.password;
  const digest = await native.hash(password);
  expect(await native.verify({ hash: digest, password })).toBe(true);
  const legacy = prefix + (await hash(password, 4));
  expect(await native.verify({ hash: legacy, password })).toBe(false);
  const disabled = getAuthOptions({ ...env, AFHOMES_ENABLE_LEGACY_PASSWORDS: 'false' })
    .emailAndPassword.password;
  expect(await disabled.verify({ hash: legacy, password })).toBe(false);
});

it('accepts only tagged bounded bcrypt hashes with untruncated UTF-8 input when enabled', async () => {
  const verify = getAuthOptions({ ...env, AFHOMES_ENABLE_LEGACY_PASSWORDS: 'true' })
    .emailAndPassword.password.verify;
  const digest = await hash(password, 4);
  for (const revision of ['2a', '2b', '2y'])
    expect(await verify({ hash: prefix + digest.replace('$2b$', `$${revision}$`), password })).toBe(
      true,
    );
  expect(await verify({ hash: prefix + digest, password: 'WrongSynthetic123!' })).toBe(false);
  for (const invalid of [digest, prefix + digest.slice(1), prefix + digest.replace('$04$', '$31$')])
    expect(await verify({ hash: invalid, password })).toBe(false);
  const boundary = 'é'.repeat(36);
  const boundaryHash = prefix + (await hash(boundary, 4));
  expect(await verify({ hash: boundaryHash, password: boundary })).toBe(true);
  expect(await verify({ hash: boundaryHash, password: boundary + 'x' })).toBe(false);
  const native = getAuthOptions(env).emailAndPassword.password;
  expect(await verify({ hash: await native.hash(password), password })).toBe(true);
});

it('signs in with a source-format credential, enforces first change, upgrades natively and preserves the separate owner', async () => {
  const replica = await createTestReplica();
  const server = http.createServer();
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const settings = { ...env, BETTER_AUTH_URL: base, AFHOMES_ENABLE_LEGACY_PASSWORDS: 'true' };
    const fixture = await seedPhase7Fixture(replica.db, replica.client, settings, password);
    const ownerBefore = await replica.db
      .collection('auth_accounts')
      .findOne({ userId: fixture.admin.id });
    const legacy = prefix + (await hash(password, 4));
    await replica.db
      .collection('auth_accounts')
      .updateOne(
        { userId: fixture.staff.id, providerId: 'credential' },
        { $set: { password: legacy } },
      );
    await replica.db
      .collection('staff_users')
      .updateOne({ email: fixture.staff.email }, { $set: { must_change_password: true } });
    server.on('request', createMongoPhase5Runtime(replica.db, replica.client, settings));
    const request = (route: string, body?: unknown, cookie = '') =>
      fetch(base + '/api/v1/' + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const login = await request('auth/identity/sign-in/email', {
      email: fixture.staff.email,
      password,
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect((await request('customers', undefined, cookie)).status).toBe(403);
    const newPassword = 'SyntheticUpgraded456!';
    expect(
      (
        await request(
          'admin/afhomes/session/password',
          {
            currentPassword: password,
            newPassword,
            confirmPassword: newPassword,
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    const upgraded = await replica.db
      .collection('auth_accounts')
      .findOne({ userId: fixture.staff.id });
    const native = getAuthOptions(env).emailAndPassword.password;
    expect(typeof upgraded?.password === 'string' && !upgraded.password.startsWith(prefix)).toBe(
      true,
    );
    expect(await native.verify({ hash: String(upgraded?.password), password: newPassword })).toBe(
      true,
    );
    expect(await native.verify({ hash: String(upgraded?.password), password })).toBe(false);
    expect((await request('auth/identity/sign-out', {}, cookie)).status).toBe(200);
    expect((await request('admin/afhomes/session', undefined, cookie)).status).toBe(401);
    expect(
      (
        await request('auth/identity/sign-in/email', {
          email: fixture.staff.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request('auth/identity/sign-in/email', { email: fixture.admin.email, password }))
        .status,
    ).toBe(200);
    const ownerAfter = await replica.db
      .collection('auth_accounts')
      .findOne({ userId: fixture.admin.id });
    expect(
      Buffer.from(BSON.serialize(ownerBefore!)).equals(Buffer.from(BSON.serialize(ownerAfter!))),
    ).toBe(true);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await replica.stop();
  }
}, 30000);
