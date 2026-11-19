/**
 * Supabase client for the CUSTOMER portal (apps/web).
 *
 * Publishable/anon key only. The service-role key is a server-only secret and
 * is never imported by, bundled into, or referenced from browser code - it is
 * not even present in this app's dependency graph.
 *
 * The session is the ordinary Supabase Auth session. The customer signs in with
 * `signInWithPassword` after activating, exactly as staff do in apps/admin; no
 * custom JWT, no server-minted token, and no token returned from the activation
 * endpoint.
 *
 * In DEV the session is mirrored into a cookie so the `:5173` and `:5174` dev
 * servers on different ports share one sign-in, matching apps/admin.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function isSupabaseConfigured(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return Boolean(
    env.VITE_SUPABASE_URL?.trim() &&
      (env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim()),
  );
}

let cached: SupabaseClient | null = null;

const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === 'undefined') return null;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match?.[1] ? decodeURIComponent(match[1]!) : null;
  },
  setItem(key: string, value: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; SameSite=Lax; max-age=31536000`;
  },
  removeItem(key: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${key}=; path=/; max-age=0`;
  },
};

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cached) return cached;
  const env = import.meta.env as Record<string, string | undefined>;
  const url = env.VITE_SUPABASE_URL?.trim();
  const publishableKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !publishableKey) return null;
  cached = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: import.meta.env.DEV ? (cookieStorage as never) : undefined,
    },
  });
  return cached;
}

let refreshInflight: Promise<boolean> | null = null;

/**
 * One memoized token rotation after a 401. Returns true when a usable session
 * exists afterwards.
 */
export async function tryRefreshSession(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  if (!refreshInflight) {
    refreshInflight = client.auth.refreshSession().then(
      ({ data, error }) => {
        refreshInflight = null;
        return !error && data.session !== null;
      },
      () => {
        refreshInflight = null;
        return false;
      },
    );
  }
  return refreshInflight;
}

/** Drop the local session after an unrecoverable 401. */
export async function clearSession(): Promise<void> {
  try {
    await getSupabaseClient()?.auth.signOut();
  } catch {
    // Already signed out; nothing left to clear.
  }
}

export function resetSupabaseClientForTest(): void {
  cached = null;
  refreshInflight = null;
}
