import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { hostedMongoConfig, createHostedMongoHandler } from './hosted-runtime.js';
import { createHostedPrivateObjectStore } from './private-object-store.js';
import { hostedBuildEnvironment } from './hosted-build.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';

const env = {
  NODE_ENV: 'production',
  AFHOMES_HOSTED_RUNTIME_ENABLED: 'true',
  AFHOMES_PUBLIC_ORIGIN: 'https://staging.example.invalid',
  BETTER_AUTH_URL: 'https://staging.example.invalid',
  BETTER_AUTH_SECRET: 'synthetic-hosted-fixture-only'.repeat(3),
  AFHOMES_WEB_URL: 'https://staging.example.invalid',
  AFHOMES_ADMIN_URL: 'https://staging.example.invalid/admin',
  MONGODB_DB: 'afhomes_dev',
  AFHOMES_PRIVATE_STORAGE_PROVIDER: 'filesystem',
  AFHOMES_PRIVATE_STORAGE_ROOT: path.resolve('synthetic-private-files'),
};
it('isolates browser builds from credentials, existing VITE values and runtime Node injection flags', () => {
  const built = hostedBuildEnvironment(
    {
      PATH: 'fixture-path',
      MONGODB_URI: 'synthetic-private-value',
      BETTER_AUTH_SECRET: 'synthetic-private-secret',
      NODE_OPTIONS: '--import=untrusted',
      VITE_SUPABASE_URL: 'https://old.example.invalid',
      VITE_ADMIN_URL: 'http://localhost:5184',
      VITE_TURNSTILE_SITE_KEY: 'synthetic-public-key',
    },
    env.AFHOMES_PUBLIC_ORIGIN,
    '/synthetic/empty-env',
  );
  expect(built).toMatchObject({
    VITE_AUTH_PROVIDER: 'mongodb',
    VITE_API_BASE_URL: '/api/v1',
    VITE_WEB_URL: env.AFHOMES_PUBLIC_ORIGIN,
    PATH: 'fixture-path',
  });
  expect(
    ['MONGODB_URI', 'BETTER_AUTH_SECRET', 'NODE_OPTIONS', 'VITE_SUPABASE_URL'].every(
      (key) => !(key in built),
    ),
  ).toBe(true);
});
it('requires explicit production opt-in, canonical HTTPS URLs, a private storage path and the existing database scope', () => {
  expect(hostedMongoConfig(env)).toMatchObject({
    port: 3084,
    origin: env.AFHOMES_PUBLIC_ORIGIN,
    coreWritesEnabled: false,
  });
  for (const patch of [
    { NODE_ENV: 'development' },
    { AFHOMES_HOSTED_RUNTIME_ENABLED: '' },
    { AFHOMES_PUBLIC_ORIGIN: 'http://staging.example.invalid' },
    { AFHOMES_PUBLIC_ORIGIN: 'https://staging.example.invalid/other' },
    { AFHOMES_PUBLIC_ORIGIN: 'https://localhost' },
    { BETTER_AUTH_URL: 'https://other.example.invalid' },
    { AFHOMES_ADMIN_URL: 'http://localhost:5184/admin' },
    { MONGODB_DB: 'afhomes_prod' },
    { PORT: '80' },
    { AFHOMES_MONGODB_ENABLE_CORE_WRITES: 'yes' },
    { AFHOMES_PRIVATE_STORAGE_ROOT: 'relative-path' },
    { AFHOMES_PRIVATE_STORAGE_ROOT: path.resolve('vercel-static/private') },
    { HOST: '0.0.0.0' },
    { AFHOMES_AUTH_TRUSTED_ORIGINS: 'https://other.example.invalid' },
    { AFHOMES_HOSTED_SEARCH_MAINTENANCE: 'true' },
  ])
    expect(() => hostedMongoConfig({ ...env, ...patch })).toThrow();
});

it('serves hosted health behind the canonical proxy without initializing schema or accepting unknown hosts', async () => {
  const replica = await createTestReplica();
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-hosted-test-'));
  const settings = { ...env, AFHOMES_PRIVATE_STORAGE_ROOT: root };
  const server = http.createServer(createHostedMongoHandler(replica.db, replica.client, settings));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { Host: 'staging.example.invalid', 'X-Forwarded-Proto': 'https' };
  const request = (route: string, requestHeaders: Record<string, string> = {}, method = 'GET') =>
    new Promise<number>((resolve, reject) => {
      const req = http.request(base + route, { method, headers: requestHeaders }, (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode!));
      });
      req.once('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });
  try {
    const before = await replica.db.listCollections().toArray();
    expect(await request('/api/v1/health', headers)).toBe(200);
    expect(await replica.db.listCollections().toArray()).toEqual(before);
    expect(await request('/api/v1/health')).toBe(400);
    expect(await request('//other.example.invalid/api/v1/health', headers)).toBe(400);
    expect(await request('/api/v1/health', { ...headers, Host: 'other.example.invalid' })).toBe(
      400,
    );
    expect(await request('/api/v1/members', headers, 'POST')).toBe(403);
    expect(await request('/api/v1/cms', headers)).toBe(403);
    const objects = createHostedPrivateObjectStore(settings);
    await objects.put('private/synthetic.txt', Buffer.from('Private fixture'), 'text/plain');
    const grant = new URL((await objects.downloadURL('private/synthetic.txt', 60)).url);
    expect(await request(grant.pathname + grant.search, headers)).toBe(200);
    expect(await request('/api/v1/private-files', headers)).toBe(403);
    grant.searchParams.set('signature', '0'.repeat(64));
    expect(await request(grant.pathname + grant.search, headers)).toBe(403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await replica.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('keeps hosted filesystem objects private, persistent and behind bounded HTTPS download grants', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-hosted-files-'));
  const settings = { ...env, AFHOMES_PRIVATE_STORAGE_ROOT: root };
  try {
    const first = createHostedPrivateObjectStore(settings)!;
    await first.put('photos/synthetic.jpeg', Buffer.from('Synthetic private photo'), 'image/jpeg');
    const second = createHostedPrivateObjectStore(settings)!;
    expect(await second.read('photos/synthetic.jpeg', 100)).toMatchObject({
      bytes: Buffer.from('Synthetic private photo'),
      contentType: 'image/jpeg',
    });
    const grant = await second.downloadURL('photos/synthetic.jpeg', 60);
    expect(new URL(grant.url).origin).toBe(env.AFHOMES_PUBLIC_ORIGIN);
    expect(new URL(grant.url).pathname).toBe('/api/v1/private-files');
    await expect(second.downloadURL('photos/synthetic.jpeg', 601)).rejects.toThrow();
    await expect(second.read('../escape', 100)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('preserves secure staff cookies, forced password change and session revocation behind the hosted proxy', async () => {
  const replica = await createTestReplica();
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-hosted-auth-'));
  const settings = { ...env, AFHOMES_PRIVATE_STORAGE_ROOT: root };
  const fixture = await seedPhase7Fixture(
    replica.db,
    replica.client,
    settings,
    'SyntheticHosted123!',
  );
  const server = http.createServer(createHostedMongoHandler(replica.db, replica.client, settings));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (
    route: string,
    body?: unknown,
    cookie = '',
    origin = env.AFHOMES_PUBLIC_ORIGIN,
  ) =>
    new Promise<{ status: number; cookies: string[] }>((resolve, reject) => {
      const req = http.request(
        base + '/api/v1/' + route,
        {
          method: body ? 'POST' : 'GET',
          headers: {
            Host: 'staging.example.invalid',
            'X-Forwarded-Proto': 'https',
            Origin: origin,
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          res.resume();
          res.once('end', () =>
            resolve({ status: res.statusCode!, cookies: res.headers['set-cookie'] ?? [] }),
          );
        },
      );
      req.once('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  try {
    const loginBody = { email: fixture.admin.email, password: 'SyntheticHosted123!' };
    expect(
      (await request('auth/identity/sign-in/email', loginBody, '', 'https://other.example.invalid'))
        .status,
    ).toBe(403);
    const signedIn = await request('auth/identity/sign-in/email', loginBody);
    expect(signedIn.status).toBe(200);
    expect(
      signedIn.cookies.length > 0 &&
        signedIn.cookies.every((value) => /; secure/i.test(value) && /; httponly/i.test(value)),
    ).toBe(true);
    const cookie = signedIn.cookies.map((value) => value.split(';')[0]).join('; ');
    expect((await request('admin/afhomes/session', undefined, cookie)).status).toBe(200);
    const changed = await request(
      'admin/afhomes/session/password',
      {
        currentPassword: 'SyntheticHosted123!',
        newPassword: 'SyntheticHostedReady123!',
        confirmPassword: 'SyntheticHostedReady123!',
      },
      cookie,
    );
    expect(changed.status).toBe(200);
    // MyAccountPage awaits logout after the password endpoint succeeds.
    expect((await request('auth/identity/sign-out', {}, cookie)).status).toBe(200);
    expect((await request('admin/afhomes/session', undefined, cookie)).status).toBe(401);
    expect(
      (
        await request('auth/identity/sign-in/email', {
          ...loginBody,
          password: 'SyntheticHostedReady123!',
        })
      ).status,
    ).toBe(200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await replica.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
