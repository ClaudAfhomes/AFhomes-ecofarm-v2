import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  customerSchema,
  customerProfileSchema,
  pointsBalanceSummarySchema,
} from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>,
  server: http.Server;
let base = '',
  staffCookie = '',
  customerCookie = '';
let recoveryUrl = '';
const newPassword = `Npw${randomUUID().slice(0, 8)}9`,
  customerPassword = `Customer${randomUUID()}9`;
beforeAll(async () => {
  test = await createTestReplica({ timeoutMS: 15_000 });
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'phase5-runtime-fixture-only-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_WEB_URL: 'http://localhost:5173',
  };
  fixture = await seedPhase5Fixture(test.db, test.client, env);
  server.on(
    'request',
    createMongoPhase5Runtime(test.db, test.client, env, {
      sendResetPassword: async (message) => {
        recoveryUrl = message.url;
      },
    }),
  );
}, 120000);
afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await test?.stop();
});
const cookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
async function request(path: string, body?: unknown, session = staffCookie, verb?: string) {
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
it('enforces temporary-password change through actual HTTP before business access', async () => {
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  staffCookie = cookie(login);
  expect((await request('/customers')).status).toBe(403);
  expect((await request('/admin/afhomes/session')).status).toBe(200);
  const wrong = await request('/admin/afhomes/session/password', {
    currentPassword: 'incorrect',
    newPassword,
  });
  expect(wrong.status).toBe(401);
  expect(await wrong.json()).toMatchObject({
    error: { details: { reason: 'CURRENT_PASSWORD_INVALID' } },
  });
  expect((await request('/admin/afhomes/session')).status).toBe(200);
  expect(
    (
      await request('/admin/afhomes/session/password', {
        currentPassword: fixture.staff.password,
        newPassword,
      })
    ).status,
  ).toBe(200);
  const list = await request('/customers');
  expect(list.status).toBe(200);
  expect((await list.json()).data.map((row: unknown) => customerSchema.parse(row).id)).toContain(
    fixture.customer.id,
  );
});
it('issues a code/link, activates anonymously, signs in and reads persistent profile/points over HTTP', async () => {
  const issued = await request(`/customers/${fixture.customer.id}/onboarding-token`, {});
  expect(issued.status).toBe(201);
  const token = new URL((await issued.json()).activationUrl).hash.slice(7);
  expect(
    (
      await request(
        '/auth/customer/activate',
        {
          onboardingToken: token,
          password: customerPassword,
          passwordConfirmation: customerPassword,
        },
        '',
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await request(
        '/auth/customer/activate',
        {
          onboardingToken: token,
          password: customerPassword,
          passwordConfirmation: customerPassword,
        },
        '',
      )
    ).status,
  ).toBe(409);
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.customer.email, password: customerPassword },
    '',
  );
  expect(login.status).toBe(200);
  customerCookie = cookie(login);
  expect(
    customerProfileSchema.parse(
      await (
        await request(`/customer?customerId=${randomUUID()}`, undefined, customerCookie)
      ).json(),
    ).id,
  ).toBe(fixture.customer.id);
  expect(
    pointsBalanceSummarySchema.parse(
      await (await request('/customer/points/position', undefined, customerCookie)).json(),
    ).annualCap,
  ).toBe(25000);
  expect((await request('/customer/membership/credentials', {}, customerCookie)).status).toBe(201);
  expect((await request('/customers', undefined, customerCookie)).status).toBe(403);
  expect((await request('/sales', undefined, staffCookie)).status).toBe(403);
  expect((await request('/reports', undefined, staffCookie)).status).toBe(404);
});
it('persists company edits and applies revocation without touching other identities', async () => {
  const update = await request(
    `/customers/${fixture.customer.id}`,
    { companyStatus: 'Verified' },
    staffCookie,
    'PATCH',
  );
  expect(update.status).toBe(200);
  expect(
    customerSchema.parse(await (await request(`/customers/${fixture.customer.id}`)).json())
      .companyStatus,
  ).toBe('Verified');
  await test.db
    .collection('staff_users')
    .updateOne({ email: fixture.staff.email }, { $set: { status: 'suspended' } });
  expect((await request('/customers')).status).toBe(403);
  expect((await request('/customer', undefined, customerCookie)).status).toBe(200);
});
it('follows the real recovery callback and consumes the token once while revoking existing sessions', async () => {
  const reset = await request(
    '/auth/identity/request-password-reset',
    { email: fixture.customer.email, redirectTo: `${base}/customer/reset-password` },
    '',
  );
  expect(reset.status).toBe(200);
  expect(new URL(recoveryUrl).origin).toBe(base);
  const callback = await fetch(recoveryUrl, { redirect: 'manual' });
  expect(callback.status).toBe(302);
  const destination = new URL(callback.headers.get('location')!);
  expect(destination.pathname).toBe('/customer/reset-password');
  const token = destination.searchParams.get('token');
  expect(token).toBeTruthy();
  const password = `Recovery${randomUUID()}9`;
  expect(
    (await request('/auth/identity/reset-password', { token, newPassword: password }, '')).status,
  ).toBe(200);
  expect(
    (await request('/auth/identity/reset-password', { token, newPassword: password }, '')).status,
  ).not.toBe(200);
  expect((await request('/customer', undefined, customerCookie)).status).toBe(401);
  expect(
    (await request('/auth/identity/sign-in/email', { email: fixture.customer.email, password }, ''))
      .status,
  ).toBe(200);
});
