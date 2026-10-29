import { beforeEach, describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { getAuthOptions } from './auth.js';

// Real library handlers, disposable JavaScript storage only; no MongoDB connection.
function fixture() {
  const store = {
    auth_users: [],
    auth_sessions: [],
    auth_accounts: [],
    auth_verifications: [],
    auth_rate_limits: [],
    auth_two_factors: [],
  };
  const auth = betterAuth({
    ...getAuthOptions({
      BETTER_AUTH_SECRET: 'phase2-runtime-test-only-fixture-'.repeat(3),
      BETTER_AUTH_URL: 'http://localhost:3000',
    }),
    database: memoryAdapter(store),
  });
  return { auth, store };
}

describe('Better Auth real-handler boundary with memory storage', () => {
  let test: ReturnType<typeof fixture>;
  beforeEach(() => {
    test = fixture();
  });

  it('returns no authenticated session for an anonymous request', async () => {
    const response = await test.auth.handler(
      new Request('http://localhost:3000/api/v1/auth/identity/get-session'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(test.store.auth_users).toHaveLength(0);
    expect(test.store.auth_sessions).toHaveLength(0);
  });

  it('rejects public signup without creating an identity or session', async () => {
    const response = await test.auth.handler(
      new Request('http://localhost:3000/api/v1/auth/identity/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          name: 'Synthetic User',
          email: 'synthetic@example.invalid',
          password: 'UnitTestOnlyPassword123',
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
    expect(test.store.auth_users).toHaveLength(0);
    expect(test.store.auth_accounts).toHaveLength(0);
    expect(test.store.auth_sessions).toHaveLength(0);
  });

  it('rejects an untrusted browser origin before signing in', async () => {
    const response = await test.auth.handler(
      new Request('http://localhost:3000/api/v1/auth/identity/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://untrusted.example.invalid',
        },
        body: JSON.stringify({
          email: 'synthetic@example.invalid',
          password: 'UnitTestOnlyPassword123',
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(test.store.auth_sessions).toHaveLength(0);
  });
});
