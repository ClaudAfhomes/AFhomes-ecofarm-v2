import http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createMemoryAuthFixture } from './testing/auth-fixture.js';
import { createInvitedIdentityProvisioner } from './auth-provisioning.js';
import { createAuthNodeHandler } from './auth-transport.js';

let server: http.Server | undefined;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

it('completes owner setup and cookie login/logout over real loopback HTTP with memory storage', async () => {
  const test = createMemoryAuthFixture();
  const provision = createInvitedIdentityProvisioner(test.options);
  const user = await provision({ email: 'owner@example.invalid', fullName: 'Synthetic Owner' });
  server = http.createServer(createAuthNodeHandler(test.auth.handler, test.options.baseURL));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const base = origin + test.options.basePath;
  const post = (
    path: string,
    body: unknown,
    cookie?: string,
    requestOrigin = test.options.baseURL,
  ) =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: requestOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  expect(
    (
      await post('/sign-up/email', {
        email: 'other@example.invalid',
        name: 'Other',
        password: 'TestPassword123',
      })
    ).status,
  ).toBe(404);
  expect(
    (await post('/admin/create-user', { email: 'other@example.invalid', name: 'Other' })).status,
  ).toBe(404);
  expect((await post('/send-verification-email', { email: user.email })).status).toBe(200);
  const verification = test.mailbox.verification[0]!.token;
  expect(
    (await fetch(base + '/verify-email?token=' + encodeURIComponent(verification))).status,
  ).toBe(200);
  expect(test.store.auth_sessions).toHaveLength(0);
  expect((await post('/request-password-reset', { email: user.email })).status).toBe(200);
  const token = test.mailbox.reset[0]!.token;
  const password = 'OwnerChoosesHttpPassword123';
  expect((await post('/reset-password', { token, newPassword: password })).status).toBe(200);
  expect((await post('/reset-password', { token, newPassword: password })).status).toBe(400);
  const login = await post('/sign-in/email', { email: user.email, password });
  expect(login.status).toBe(200);
  expect((await login.json()).user).not.toHaveProperty('role');
  const cookies = login.headers.getSetCookie();
  expect(
    cookies.some((cookie) => cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')),
  ).toBe(true);
  const cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');
  expect(login.headers.get('Cache-Control')).toBe('no-store');
  const session = await fetch(base + '/get-session', { headers: { Cookie: cookie } });
  expect((await session.json()).user.id).toBe(user.id);
  expect((await post('/sign-out', {}, cookie, 'https://untrusted.example.invalid')).status).toBe(
    403,
  );
  expect((await post('/sign-out', {}, cookie)).status).toBe(200);
  expect(
    await (await fetch(base + '/get-session', { headers: { Cookie: cookie } })).json(),
  ).toBeNull();
  expect(test.store.auth_users).toHaveLength(1);
});
