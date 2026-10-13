import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen: unknown[][] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    seen.push(args);
    return { __client: seen.length };
  },
}));

import { userClient, anonClient } from './rest.js';

const URL = 'https://preview.supabase.co';
const ANON = 'preview-anon-key';

function stubEnv(vars: Record<string, string>) {
  for (const key of [
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ]) {
    vi.stubEnv(key, vars[key] ?? '');
  }
}

beforeEach(() => {
  vi.unstubAllEnvs();
  seen.length = 0;
});

describe('userClient (bearer-scoped reads without a service role)', () => {
  it('returns null without a url, anon key or token', () => {
    stubEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: ANON });
    expect(userClient('')).toBeNull();
    stubEnv({ SUPABASE_URL: URL });
    expect(userClient('tok')).toBeNull();
    stubEnv({ SUPABASE_PUBLISHABLE_KEY: ANON });
    expect(userClient('tok')).toBeNull();
  });

  it('attaches the caller bearer token, never a cached identity', () => {
    stubEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: ANON });
    const first = userClient('tok-a');
    const second = userClient('tok-b');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(seen).toHaveLength(2);
    for (const [index, args] of seen.entries()) {
      const [url, key, options] = args as [
        string,
        string,
        { global?: { headers?: Record<string, string> } },
      ];
      expect(url).toBe(URL);
      expect(key).toBe(ANON);
      expect(options.global?.headers?.Authorization).toBe(`Bearer tok-${index === 0 ? 'a' : 'b'}`);
    }
  });
});

describe('server client configuration recovery', () => {
  it('uses an available public key when a higher-priority alias is blank', () => {
    stubEnv({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON });
    expect(userClient('caller-token')).not.toBeNull();
  });
  it('rebuilds the cached authentication client when the project URL changes', () => {
    stubEnv({ SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: ANON });
    const first = anonClient();
    vi.stubEnv('SUPABASE_URL', 'https://other-preview.supabase.co');
    const second = anonClient();
    expect(first).not.toBe(second);
    expect(seen.at(-1)?.[0]).toBe('https://other-preview.supabase.co');
  });
});
