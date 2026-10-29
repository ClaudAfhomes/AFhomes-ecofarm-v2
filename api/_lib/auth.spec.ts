import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db, MongoClient } from 'mongodb';

const mocks = vi.hoisted(() => ({
  auth: vi.fn((options: unknown) => ({ options })),
  adapter: vi.fn(() => () => ({})),
}));
vi.mock('better-auth', () => ({ betterAuth: mocks.auth }));
vi.mock('@better-auth/mongo-adapter', () => ({ mongodbAdapter: mocks.adapter }));

import { createAfHomesAuth, getAuthOptions } from './auth.js';
const initializationAtImport = mocks.auth.mock.calls.length + mocks.adapter.mock.calls.length;
const env = {
  BETTER_AUTH_SECRET: 'phase2-unit-test-only-fixture-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

describe('unmounted Better Auth foundation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not initialize authentication or the database adapter at import', () => {
    expect(initializationAtImport).toBe(0);
  });

  it.each([undefined, '', 'too-short'])(
    'rejects missing or short secret without printing it',
    (secret) => {
      expect(() => getAuthOptions({ ...env, BETTER_AUTH_SECRET: secret })).toThrow(
        'BETTER_AUTH_SECRET',
      );
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.adapter).not.toHaveBeenCalled();
    },
  );

  it.each([
    '',
    'not-a-url',
    'http://example.invalid',
    'http://localhost.example.invalid',
    'https://user:password@example.invalid',
    'https://example.invalid/path',
    'https://example.invalid/?query=yes',
    'https://example.invalid/#fragment',
    'https://*.example.invalid',
  ])('rejects unsafe or ambiguous base origin %s', (url) => {
    expect(() => getAuthOptions({ ...env, BETTER_AUTH_URL: url })).toThrow('BETTER_AUTH_URL');
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'https://example.invalid',
  ])('sets host-scoped cookie protections for %s', (url) => {
    const options = getAuthOptions({ ...env, BETTER_AUTH_URL: url });
    expect(options.trustedOrigins).toEqual([new URL(url).origin]);
    expect(options.advanced.defaultCookieAttributes).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: url.startsWith('https:'),
    });
    expect(options.advanced.disableCSRFCheck).toBe(false);
    expect(options.advanced.disableOriginCheck).toBe(false);
  });

  it('allows only explicitly configured trusted origins', () => {
    const options = getAuthOptions({
      ...env,
      AFHOMES_AUTH_TRUSTED_ORIGINS: 'http://localhost:5173, http://localhost:5174',
    });
    expect(options.trustedOrigins).toEqual([
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
    ]);
    for (const origin of [
      '*',
      'https://*.example.invalid',
      'http://remote.invalid',
      'https://example.invalid/path',
    ])
      expect(() => getAuthOptions({ ...env, AFHOMES_AUTH_TRUSTED_ORIGINS: origin })).toThrow(
        'AFHOMES_AUTH_TRUSTED_ORIGINS',
      );
  });

  it('requires HTTPS even for loopback when running in production', () => {
    expect(() => getAuthOptions({ ...env, NODE_ENV: 'production' })).toThrow('BETTER_AUTH_URL');
  });

  it('closes signup and disables session caching, account linking and telemetry', () => {
    const options = getAuthOptions(env);
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
    });
    expect(options.session.cookieCache.enabled).toBe(false);
    expect(options.session.deferSessionRefresh).toBe(true);
    expect(options.account.accountLinking.enabled).toBe(false);
    expect(options.telemetry.enabled).toBe(false);
    expect(options.rateLimit).toMatchObject({ enabled: true, storage: 'database' });
    expect(options.plugins).toEqual([]);
  });

  it('generates distinct UUID strings for identities and references', () => {
    const generate = getAuthOptions(env).advanced.database.generateId;
    const first = generate();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(generate()).not.toBe(first);
  });

  it('preserves the existing password policy and uses the library hash/verification', async () => {
    const password = getAuthOptions(env).emailAndPassword.password;
    for (const value of ['short', 'longlowercasepassword', 'LongPasswordNoDigit'])
      await expect(password.hash(value)).rejects.toThrow();
    const value = 'UnitTestOnlyPassword123';
    const hash = await password.hash(value);
    expect(hash).not.toContain(value);
    await expect(password.verify({ hash, password: value })).resolves.toBe(true);
    await expect(password.verify({ hash, password: 'wrong' })).resolves.toBe(false);
  });

  it('requires a matching client/database before explicitly initializing', () => {
    const client = {} as MongoClient;
    const db = { databaseName: 'afhomes_dev', client } as unknown as Db;
    expect(() => createAfHomesAuth({ ...db, databaseName: 'other' } as Db, client, env)).toThrow(
      'afhomes_dev',
    );
    expect(() => createAfHomesAuth(db, {} as MongoClient, env)).toThrow('matching');
    expect(mocks.adapter).not.toHaveBeenCalled();
    createAfHomesAuth(db, client, env);
    expect(mocks.adapter).toHaveBeenCalledExactlyOnceWith(db, {
      client,
      transaction: true,
      debugLogs: false,
    });
    expect(mocks.auth).toHaveBeenCalledOnce();
  });
});
