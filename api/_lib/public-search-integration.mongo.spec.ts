import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoSearchMaintenance } from './search-maintenance.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  worker: ReturnType<typeof createMongoSearchMaintenance>;
let base = '',
  cookie = '',
  aa = '';
const originalFetch = globalThis.fetch;
const col = (name: string) => test.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown, authenticated = false, method?: string) {
  return fetch(base + '/api/v1' + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(authenticated ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(status);
  return data;
}
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'synthetic-native-public-readiness-'.repeat(3),
    BETTER_AUTH_URL: base,
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1',
    AFHOMES_SEARCH_LOCAL_PREVIEW: 'false',
    AFHOMES_SEARCH_SECRET: 'synthetic-search-secret-at-least-32-characters',
    AFHOMES_SEARCH_TURNSTILE_SECRET: 'synthetic-non-test-key-shape',
    VITE_TURNSTILE_SITE_KEY: 'synthetic-non-test-site-key-shape',
    AFHOMES_SEARCH_TURNSTILE_HOSTNAMES: 'localhost',
  };
  const fixture = await seedPhase7Fixture(test.db, test.client, env, 'SyntheticPublicOnly123!');
  await col('staff_users').updateOne(
    { _id: fixture.admin.id },
    { $set: { must_change_password: false } },
  );
  worker = createMongoSearchMaintenance(test.db, test.client);
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  vi.stubGlobal('fetch', (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
    String(url).startsWith('https://challenges.cloudflare.com/')
      ? Promise.resolve(Response.json({ success: true, hostname: 'localhost' }))
      : originalFetch(url, init),
  );
  const login = await request('/auth/identity/sign-in/email', {
    email: fixture.admin.email,
    password: fixture.admin.password,
  });
  await json(login);
  cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  aa = (
    await json(
      await request(`/sale-team/${fixture.staff.id}`, { kind: 'IST', action: 'approve' }, true),
    )
  ).aaNumber;
}, 30000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await worker.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await test.stop();
});
it('requires real server cleanup health and administrator approval, without a preview bypass', async () => {
  expect((await json(await request('/sale-team/search/config'))).available).toBe(false);
  const initial = await json(
    await request('/admin/afhomes/public-verification-settings', undefined, true),
  );
  const {
    cleanupReady: _health,
    noticeVersion: _notice,
    updatedAt: _time,
    revision,
    ...fields
  } = initial;
  const input = {
    ...fields,
    enabled: true,
    privacyApproved: true,
    verificationPhone: '+639170000000',
    retentionDays: 1,
    privacyNotice:
      'Synthetic approved notice for disposable workflow tests only. Contacts are used solely for verification and retained according to the selected test retention period. This is not an approval for any hosted service.',
  };
  const saved = await json(
    await request(
      '/admin/afhomes/public-verification-settings',
      { ...input, expectedRevision: revision },
      true,
      'PUT',
    ),
  );
  expect(saved.cleanupReady).toBe(false);
  await json(
    await request('/sale-team/search/start', {
      aaNumber: aa,
      sessionId: randomUUID(),
      captchaToken: 'synthetic',
    }),
    503,
  );
  await worker.start();
  const config = await json(await request('/sale-team/search/config'));
  expect(config.available).toBe(true);
  expect(config.localPreview).toBe(false);
  const sessionId = randomUUID(),
    start = await json(
      await request('/sale-team/search/start', {
        aaNumber: aa,
        sessionId,
        captchaToken: 'synthetic',
      }),
    );
  const reveal = {
    sessionId,
    searchToken: start.searchToken,
    noticeVersion: config.noticeVersion,
    acknowledged: true,
    contact: {
      name: 'Synthetic Public Viewer',
      email: 'native-viewer@example.invalid',
      mobile: '+639170000099',
    },
  };
  const result = await json(await request('/sale-team/search/reveal', reveal));
  expect(result.result).toMatchObject({ aaNumber: aa, kind: 'IST', status: 'accredited' });
  expect(result.result.maskedName).not.toBe('SYNTHETIC SALES MANAGER');
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(1);
  const changed = await json(
    await request(
      '/admin/afhomes/public-verification-settings',
      {
        ...input,
        privacyNotice: input.privacyNotice + ' Updated synthetic notice.',
        expectedRevision: saved.revision,
      },
      true,
      'PUT',
    ),
  );
  expect(changed.noticeVersion).not.toBe(config.noticeVersion);
  await json(await request('/sale-team/search/reveal', reveal), 400);
  await worker.stop();
  expect((await json(await request('/sale-team/search/config'))).available).toBe(false);
  expect(
    (await json(await request('/admin/afhomes/public-verification-settings', undefined, true)))
      .cleanupReady,
  ).toBe(false);
}, 30000);
