import { describe, expect, it } from 'vitest';

import { loadPublicEnv } from '../src/index';

describe('loadPublicEnv', () => {
  it('defaults VITE_API_BASE_URL when absent', () => {
    const env = loadPublicEnv({});
    expect(env.VITE_API_BASE_URL).toBe('/api/v1');
  });

  it('reads an explicit VITE_API_BASE_URL', () => {
    const env = loadPublicEnv({ VITE_API_BASE_URL: 'https://api.example.test/api/v1' });
    expect(env.VITE_API_BASE_URL).toBe('https://api.example.test/api/v1');
  });

  it('ignores unknown keys', () => {
    const env = loadPublicEnv({ SOMETHING_ELSE: 'x', VITE_API_BASE_URL: '/api/v1' });
    expect(env.VITE_API_BASE_URL).toBe('/api/v1');
  });

  it('rejects a non-string VITE_API_BASE_URL', () => {
    expect(() => loadPublicEnv({ VITE_API_BASE_URL: 42 })).toThrow();
  });

  it('rejects an empty VITE_API_BASE_URL', () => {
    expect(() => loadPublicEnv({ VITE_API_BASE_URL: '' })).toThrow();
  });

  it('strips every server-only variable from the parsed result', () => {
    // The apps pass the whole `import.meta.env` object to this loader, so this
    // is the guarantee that keeps a server secret from reaching a browser
    // bundle. The schema is a VITE_-only allowlist; unknown keys are dropped.
    const env = loadPublicEnv({
      VITE_API_BASE_URL: '/api/v1',
      VITE_WEB_URL: 'https://afhomes.example',
      SUPABASE_URL: 'https://secret-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
      SUPABASE_PUBLISHABLE_KEY: 'server-only-key',
      SUPABASE_ANON_KEY: 'server-only-key',
      DATABASE_URL: 'postgresql://user:pass@pooler:6543/postgres',
      AFHOMES_TARGET_PROJECT_REF: 'projectref',
      AFHOMES_SUPERADMIN_EMAIL: 'owner@example.com',
      AFHOMES_ADMIN_URL: 'https://afhomes.example/admin',
      RESEND_API_KEY: 'server-only-key',
      DOCUMENT_HASH_PEPPER: 'server-only-key',
      EMAIL_FROM: 'no-reply@example.com',
    });

    // Every surviving key must be VITE_-prefixed. Optional vars that were not
    // supplied are omitted entirely rather than set to undefined.
    for (const key of Object.keys(env)) {
      expect(key, key).toMatch(/^VITE_/);
    }
    expect(Object.keys(env).sort()).toEqual([
      'VITE_ADMIN_URL',
      'VITE_API_BASE_URL',
      'VITE_WEB_URL',
    ]);
    const serialised = JSON.stringify(env);
    for (const secret of [
      'server-only-key',
      'secret-project',
      'pooler',
      'projectref',
      'owner@example.com',
      'no-reply@example.com',
    ]) {
      expect(serialised, secret).not.toContain(secret);
    }
  });
});
