/**
 * Supabase client - Phase 3: Storage (marketing-tools) + Realtime (admin).
 * Mirrors `apps/web/src/lib/supabase.ts`. Uses ESM `createClient` with cross-port
 * cookie storage in DEV so `5173` login session is visible on `5174/admin`.
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
  const anonKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: import.meta.env.DEV ? (cookieStorage as never) : undefined,
    },
  });
  return cached;
}

export function resetSupabaseClientForTest(): void {
  cached = null;
  refreshInflight = null;
}

let refreshInflight: Promise<boolean> | null = null;

/**
 * Attempt one token rotation after a 401 (expired access token, or a
 * cross-port refresh race between :5173 and :5174 sharing one cookie -
 * navigator.locks don't span origins, so rotations can collide). Memoized so
 * concurrent 401s share a single rotation instead of stampeding. Returns
 * true when a usable session exists afterwards.
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

/**
 * Drop the local session after an unrecoverable 401 so route guards redirect
 * to login instead of stranding the user on a dead error page. Server-side
 * revocation of an already-dead token is harmless; local clearing is what
 * matters (fires onAuthStateChange → providers go unauthenticated).
 */
export async function clearSession(): Promise<void> {
  try {
    await getSupabaseClient()?.auth.signOut();
  } catch {
    // Session already dead - nothing left to clear.
  }
}

export function isSupabaseStorageConfigured(): boolean {
  return isSupabaseConfigured();
}

export async function listMarketingToolsFromStorage(): Promise<unknown[]> {
  return [];
}

export function subscribeNotificationsRealtime(
  _memberId: string,
  _onInsert: (payload: unknown) => void,
): (() => void) | null {
  void _memberId;
  void _onInsert;
  return null;
}
