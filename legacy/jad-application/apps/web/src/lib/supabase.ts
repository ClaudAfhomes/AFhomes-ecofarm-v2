/**
 * Supabase client - Phase 3: Storage (marketing-tools) + Realtime (notifications).
 * When VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set (Supabase project created),
 * uses native ESM `createClient` with cross-port cookie storage in DEV (localhost:5173
 * vs :5174 are distinct origins for localStorage but share document.cookie on localhost).
 * In production, defaults to Supabase localStorage unless cookie Domain is needed.
 *
 * Buckets:
 * - `marketing-tools` (public read, SUPER_ADMIN write) - IMAGE/VIDEO/PDF for
 *   ContentLibraryPage. Replaces unsplash/gtv/w3 samples with `storage.objects`
 *   signed URLs (`admin/content` upload).
 * - `Realtime` channel `notifications:memberId=eq.<id>` - NotificationsPage
 *   `useBroadcasts` (pg `notifications` table) live updates.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function isSupabaseConfigured(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return Boolean(env.VITE_SUPABASE_URL?.trim() && env.VITE_SUPABASE_ANON_KEY?.trim());
}

let cached: SupabaseClient | null = null;

/**
 * Build the client from trimmed env values. A stray trailing newline/space in
 * `VITE_SUPABASE_ANON_KEY` (e.g. pasted into a Vercel env var) would otherwise
 * produce an invalid `apikey` in every request and in the Realtime WebSocket
 * URL (`...QmtOg%0A`), silently breaking auth/realtime.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cached) return cached;
  const env = import.meta.env as Record<string, string | undefined>;
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storage: import.meta.env.DEV ? (cookieStorage as never) : undefined,
    },
  });
  return cached;
}

/**
 * Cookie storage adapter for DEV cross-port sharing.
 * localhost cookies are port-agnostic (same host `localhost`), unlike localStorage
 * which is per-origin (scheme+host+port). This lets `5173/login` set the session
 * and `5174/admin` read it via `getSession()` without a hard hand-off.
 * Production either keeps default localStorage (single origin) or can switch to
 * cookie with `Domain=.jad.example` if admin/web split across subdomains.
 */
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

/** Test helper - reset singleton between vitest cases */
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

// Storage helpers (Phase 3) - marketing-tools bucket (public read, SUPER_ADMIN write DATABASE-DESIGN.md:139)
export function isSupabaseStorageConfigured(): boolean {
  return isSupabaseConfigured();
}

export type MarketingToolFromStorage = {
  id: string;
  title: string;
  kind: string;
  downloadUrl: string;
};

export async function listMarketingToolsFromStorage(): Promise<MarketingToolFromStorage[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.storage
    .from('marketing-tools')
    .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error || !data) return [];
  return data
    .filter((o) => !o.name.startsWith('.'))
    .map((o) => {
      const { data: urlData } = client.storage.from('marketing-tools').getPublicUrl(o.name);
      const ext = o.name.split('.').pop()?.toLowerCase();
      const kind = ext === 'mp4' || ext === 'mov' ? 'VIDEO' : ext === 'pdf' ? 'DOCUMENT' : 'IMAGE';
      return { id: o.id ?? o.name, title: o.name, kind, downloadUrl: urlData.publicUrl };
    });
}

// Realtime helpers (Phase 3) - notifications channel notifications:memberId=eq.* DATABASE-DESIGN.md:141
export function subscribeNotificationsRealtime(
  memberId: string,
  onInsert: (payload: unknown) => void,
): (() => void) | null {
  const client = getSupabaseClient();
  if (!client || !memberId) return null;
  const channel = client
    .channel(`notifications:${memberId}`)
    .on(
      'postgres_changes' as never,
      {
        event: 'INSERT',
        schema: 'public',
        table: 'Notification',
        filter: `memberId=eq.${memberId}`,
      } as never,
      (payload: unknown) => onInsert(payload),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
