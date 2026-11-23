import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  refresh: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  AuthClient: class {
    constructor(options: Record<string, unknown>) {
      sdk.options = options;
    }
    refreshSession = sdk.refresh;
    signOut = sdk.signOut;
  },
  createClient: () => {
    throw new Error('Unused database, storage and realtime clients initialized');
  },
}));
import { getSupabaseClient, resetSupabaseClientForTest, tryRefreshSession } from './supabase';

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.example.invalid/');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-synthetic');
  sdk.options = null;
  vi.clearAllMocks();
});
afterEach(() => {
  resetSupabaseClientForTest();
  vi.unstubAllEnvs();
});

it('initializes only Auth and retains the existing session namespace and refresh policy', () => {
  const client = getSupabaseClient();
  expect(client?.auth).toBeDefined();
  expect(getSupabaseClient()).toBe(client);
  expect(sdk.options).toMatchObject({
    url: 'https://project.example.invalid/auth/v1',
    storageKey: 'sb-project-auth-token',
    headers: {
      apikey: 'sb_publishable_synthetic',
      Authorization: 'Bearer sb_publishable_synthetic',
    },
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  });
});

it('keeps development cookie storage compatible across portal ports', () => {
  vi.stubEnv('DEV', true);
  getSupabaseClient();
  const storage = sdk.options?.storage as Storage;
  storage.setItem('sb-project-auth-token', '{"synthetic":"value with spaces"}');
  expect(storage.getItem('sb-project-auth-token')).toBe('{"synthetic":"value with spaces"}');
  storage.removeItem('sb-project-auth-token');
  expect(storage.getItem('sb-project-auth-token')).toBeNull();
});

it('uses SDK local storage in production and supports the legacy public key', () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  getSupabaseClient();
  expect(sdk.options?.storage).toBeUndefined();
  expect(sdk.options?.headers).toMatchObject({ apikey: 'legacy-synthetic' });
});

it('returns no client without configuration and refuses non-HTTP Auth endpoints', () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  expect(getSupabaseClient()).toBeNull();
  expect(sdk.options).toBeNull();
  vi.stubEnv('VITE_SUPABASE_URL', 'ftp://project.example.invalid');
  expect(() => getSupabaseClient()).toThrow('Supabase URL must use HTTP or HTTPS');
  expect(sdk.options).toBeNull();
  vi.stubEnv('VITE_SUPABASE_URL', 'https:project.example.invalid');
  expect(() => getSupabaseClient()).toThrow('Supabase URL must use HTTP or HTTPS');
});

it('shares one refresh across concurrent requests and permits a subsequent retry', async () => {
  let release!: (value: unknown) => void;
  sdk.refresh.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const first = tryRefreshSession();
  const second = tryRefreshSession();
  expect(sdk.refresh).toHaveBeenCalledTimes(1);
  release({ data: { session: { user: { id: 'synthetic' } } }, error: null });
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  sdk.refresh.mockResolvedValueOnce({ data: { session: null }, error: { message: 'expired' } });
  expect(await tryRefreshSession()).toBe(false);
  expect(sdk.refresh).toHaveBeenCalledTimes(2);
});
