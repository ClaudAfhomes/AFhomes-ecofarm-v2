import { describe, expect, it } from 'vitest';
import { describeProductionConfig, loadProductionConfig } from './production-config.js';

const secret = `Synthetic-${'s'.repeat(40)}`;
const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: '3084',
  MONGODB_URI: 'mongodb+srv://cluster.example.invalid/afhomes',
  MONGODB_DB: 'afhomes_dev',
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://portal.afhomes.com.ph',
  AFHOMES_AUTH_TRUSTED_ORIGINS: 'https://portal.afhomes.com.ph',
  AFHOMES_WEB_URL: 'https://portal.afhomes.com.ph',
};

describe('production configuration', () => {
  it('accepts the approved deployment shape without exposing the connection string', () => {
    const config = loadProductionConfig(base);
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 3084,
      mongoDb: 'afhomes_dev',
      authUrl: 'https://portal.afhomes.com.ph',
      webUrl: 'https://portal.afhomes.com.ph',
      storageProvider: undefined,
      enableSearchMaintenance: false,
      trustProxy: false,
    });
    const summary = describeProductionConfig(config);
    expect(JSON.stringify(summary)).not.toContain(base.MONGODB_URI!);
    expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it('normalizes origins and removes duplicate trusted origins', () => {
    const config = loadProductionConfig({
      ...base,
      BETTER_AUTH_URL: 'https://portal.afhomes.com.ph/',
      AFHOMES_AUTH_TRUSTED_ORIGINS:
        'https://portal.afhomes.com.ph/, https://portal.afhomes.com.ph',
      AFHOMES_ADMIN_URL: 'https://portal.afhomes.com.ph/admin',
    });
    expect(config.authUrl).toBe('https://portal.afhomes.com.ph');
    expect(config.trustedOrigins).toEqual(['https://portal.afhomes.com.ph']);
    expect(config.adminUrl).toBe('https://portal.afhomes.com.ph/admin');
  });

  it('rejects a non-production runtime, a different database, and a public host', () => {
    expect(() => loadProductionConfig({ ...base, NODE_ENV: 'development' })).toThrow('NODE_ENV');
    expect(() => loadProductionConfig({ ...base, MONGODB_DB: 'afhomes_prod' })).toThrow(
      'afhomes_dev',
    );
    expect(() => loadProductionConfig({ ...base, HOST: '0.0.0.0' })).toThrow('HOST');
  });

  it('rejects missing or unsafe required values by name only', () => {
    for (const [key, expected] of [
      ['MONGODB_URI', 'MONGODB_URI'],
      ['BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET'],
      ['BETTER_AUTH_URL', 'BETTER_AUTH_URL'],
      ['AFHOMES_WEB_URL', 'AFHOMES_WEB_URL'],
    ] as const) {
      const env = { ...base };
      delete env[key];
      expect(() => loadProductionConfig(env)).toThrow(expected);
    }
    expect(() =>
      loadProductionConfig({ ...base, BETTER_AUTH_URL: 'http://portal.afhomes.com.ph' }),
    ).toThrow('HTTPS');
    expect(() =>
      loadProductionConfig({ ...base, AFHOMES_AUTH_TRUSTED_ORIGINS: 'https://other.example' }),
    ).toThrow('AFHOMES_AUTH_TRUSTED_ORIGINS');
  });

  it('does not leak a rejected secret value in the error message', () => {
    const rejected = 'short-secret';
    let message = '';
    try {
      loadProductionConfig({ ...base, BETTER_AUTH_SECRET: rejected });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain(rejected);
  });

  it('rejects privileged, invalid, or publicly reachable listener values', () => {
    expect(() => loadProductionConfig({ ...base, PORT: '80' })).toThrow('PORT');
    expect(() => loadProductionConfig({ ...base, PORT: 'not-a-port' })).toThrow('PORT');
    expect(() => loadProductionConfig({ ...base, PORT: '0' })).toThrow('PORT');
    expect(loadProductionConfig({ ...base, PORT: '0' }, { allowEphemeralPort: true }).port).toBe(0);
  });

  it('forbids development storage and the test-purge switch in production', () => {
    expect(() =>
      loadProductionConfig({ ...base, AFHOMES_PRIVATE_STORAGE_PROVIDER: 'local' }),
    ).toThrow('s3');
    expect(() =>
      loadProductionConfig({ ...base, AFHOMES_ENABLE_TEST_PURGE: 'true' }),
    ).toThrow('AFHOMES_ENABLE_TEST_PURGE');
  });

  it('accepts only explicit booleans and bounded timeouts', () => {
    expect(() =>
      loadProductionConfig({ ...base, AFHOMES_ENABLE_SEARCH_MAINTENANCE: 'yes' }),
    ).toThrow('AFHOMES_ENABLE_SEARCH_MAINTENANCE');
    expect(() =>
      loadProductionConfig({ ...base, AFHOMES_REQUEST_TIMEOUT_MS: '999' }),
    ).toThrow('AFHOMES_REQUEST_TIMEOUT_MS');
    expect(
      loadProductionConfig({
        ...base,
        AFHOMES_ENABLE_SEARCH_MAINTENANCE: 'true',
        AFHOMES_TRUST_PROXY: 'true',
        AFHOMES_PRIVATE_STORAGE_PROVIDER: 's3',
      }),
    ).toMatchObject({
      enableSearchMaintenance: true,
      trustProxy: true,
      storageProvider: 's3',
    });
  });
});
