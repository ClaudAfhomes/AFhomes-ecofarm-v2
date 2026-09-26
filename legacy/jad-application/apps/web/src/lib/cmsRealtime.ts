import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getSupabaseClient, isSupabaseConfigured } from './supabase';

const CMS_KEYS = [
  'homepage',
  'about',
  'properties',
  'faqs',
  'contact',
  'global',
  'login',
  'register',
] as const;
type CmsKey = (typeof CMS_KEYS)[number];

function isCmsKey(key: unknown): key is CmsKey {
  return typeof key === 'string' && (CMS_KEYS as readonly string[]).includes(key);
}

/**
 * Public CMS Realtime - subscribes to Supabase Realtime for cms_contents changes
 * and invalidates the matching TanStack Query cache `['cms', key]`.
 *
 * Architecture: Supabase PostgreSQL (cms_contents) → Supabase Realtime (broadcast + postgres_changes)
 * → public React subscription → TanStack Query invalidation → existing CMS API refetch → UI updates.
 *
 * - Uses anon key + public channel `cms:public` (no service_role, no admin creds).
 * - Listens for broadcast `cms_update` (from Vercel PUT handler) and postgres_changes INSERT/UPDATE as fallback.
 * - API remains authoritative read path (invalidates, does not replace state).
 * - Handles reconnect, errors, unmount cleanup, avoids duplicate subscriptions.
 */
export function useCmsRealtime() {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<
    NonNullable<ReturnType<typeof getSupabaseClient>>['channel']
  > | null>(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') return;
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    // eslint-disable-next-line no-useless-assignment
    let channel: ReturnType<NonNullable<ReturnType<typeof getSupabaseClient>>['channel']> | null =
      null;
    try {
      channel = supabase.channel('cms:public', {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
        },
      } as never);

      // Broadcast: Vercel PUT handler sends {key, version} after successful cms_contents upsert (service_role)
      channel.on(
        'broadcast' as never,
        { event: 'cms_update' } as never,
        (payload: { payload?: { key?: unknown; version?: unknown } }) => {
          const key = payload?.payload?.key;
          if (isCmsKey(key)) {
            queryClient.invalidateQueries({ queryKey: ['cms', key] });
          }
        },
      );

      // Fallback: postgres_changes for INSERT/UPDATE on cms_contents (if table is in supabase_realtime publication)
      // This covers local dev where we added the migration, and also covers direct DB writes
      channel.on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'cms_contents' } as never,
        (payload: { eventType?: string; new?: { key?: unknown }; old?: { key?: unknown } }) => {
          const key =
            (payload.new as { key?: unknown } | undefined)?.key ??
            (payload.old as { key?: unknown } | undefined)?.key;
          if (isCmsKey(key)) {
            queryClient.invalidateQueries({ queryKey: ['cms', key] });
          } else if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            // If key not in payload (e.g., RLS or publication filter), invalidate all cms queries as safe fallback
            // But prefer targeted invalidation; this is rare
            for (const k of CMS_KEYS) {
              queryClient.invalidateQueries({ queryKey: ['cms', k] });
            }
          }
        },
      );

      // Policies live in their own table (not cms_contents); admin CRUD
      // invalidates the public `['policies']` query on any change.
      channel.on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'Policy' } as never,
        () => {
          queryClient.invalidateQueries({ queryKey: ['policies'] });
        },
      );

      channel.subscribe((status: string, err?: Error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Supabase Realtime will auto-reconnect; we just log for debugging
          console.error(`[cms-realtime] subscription ${status}`, err?.message ?? '');
        }
      });
      channelRef.current = channel as never;
    } catch (e) {
      console.error('[cms-realtime] setup failed', (e as Error).message);
      subscribedRef.current = false;
      return;
    }

    return () => {
      subscribedRef.current = false;
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch && supabase) {
        void supabase.removeChannel(ch as never);
      }
    };
  }, [queryClient]);
}
