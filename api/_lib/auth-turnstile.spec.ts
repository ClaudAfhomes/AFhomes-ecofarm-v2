import { afterEach, expect, it, vi } from 'vitest';
import { hashPassword } from 'better-auth/crypto';
import { createMemoryAuthFixture } from './testing/auth-fixture.js';

afterEach(() => vi.restoreAllMocks());

it('verifies login challenges before credentials and rejects missing, expired, reused and foreign tokens', async () => {
  const test = createMemoryAuthFixture({
    AFHOMES_AUTH_TURNSTILE_SECRET: 'synthetic-login-captcha-secret',
    VITE_TURNSTILE_SITE_KEY: 'synthetic-login-site-key',
  });
  const now = new Date();
  test.store.auth_users.push({ id: 'synthetic-user', name: 'Synthetic User', email: 'captcha@example.invalid', emailVerified: true, createdAt: now, updatedAt: now });
  test.store.auth_accounts.push({ id: 'synthetic-account', userId: 'synthetic-user', accountId: 'synthetic-user', providerId: 'credential', password: await hashPassword('SyntheticCaptcha123!'), createdAt: now, updatedAt: now });
  let result: Record<string, unknown> = { success: true, hostname: 'localhost', action: 'login' };
  const verify = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    return Response.json(result);
  });
  let attempt = 0;
  const login = (token?: string) => test.auth.handler(new Request('http://localhost:3000/api/v1/auth/identity/sign-in/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'x-real-ip': `198.51.100.${++attempt}`, ...(token ? { 'x-captcha-response': token } : {}) },
    body: JSON.stringify({ email: 'captcha@example.invalid', password: 'SyntheticCaptcha123!' }),
  }));
  expect((await login()).status).toBe(400);
  expect(verify).not.toHaveBeenCalled();
  expect(test.store.auth_sessions).toHaveLength(0);
  for (const rejection of [
    { success: false, 'error-codes': ['invalid-input-response'] },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, hostname: 'foreign.example.invalid', action: 'login' },
    { success: true, hostname: 'localhost', action: 'public-search' },
  ]) {
    result = rejection;
    expect((await login('synthetic-rejected-token')).status).toBe(403);
    expect(test.store.auth_sessions).toHaveLength(0);
  }
  result = { success: true, hostname: 'localhost', action: 'login' };
  expect((await login('synthetic-valid-token')).status).toBe(200);
  expect(test.store.auth_sessions).toHaveLength(1);
  result = { success: false, 'error-codes': ['timeout-or-duplicate'] };
  expect((await login('synthetic-valid-token')).status).toBe(403);
  expect(test.store.auth_sessions).toHaveLength(1);
  verify.mockRejectedValueOnce(new Error('synthetic upstream outage'));
  expect((await login('synthetic-unavailable')).status).toBe(500);
  expect(test.store.auth_sessions).toHaveLength(1);
});
