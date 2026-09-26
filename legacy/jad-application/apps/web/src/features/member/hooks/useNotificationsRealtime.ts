import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';

/**
 * Member notification Realtime - subscribes to `Notification` INSERTs visible
 * to the member (own rows + broadcasts with member_id NULL) and invalidates
 * the matching TanStack Query cache `['member', 'broadcasts', userId]`.
 *
 * Architecture mirrors `useCmsRealtime`: the API stays the authoritative read
 * path - Realtime only invalidates, never replaces state. The `or` filter is
 * required because a plain `memberId=eq.<id>` postgres_changes filter excludes
 * broadcast rows (member_id IS NULL), and broadcasts are the primary live
 * traffic. RLS (`notification_member_read`) scopes server-side in addition.
 *
 * Mounted once in `MemberLayout` (single subscription for both
 * `NotificationBell` and `NotificationsPage`). In TEST/MODE and
 * non-Supabase environments it is a no-op (mock server flows cover those).
 */
export function useNotificationsRealtime(userId: string | undefined) {
  const queryClient = useQueryClient();
  const stateRef = useRef<{ channel: unknown; userId: string } | null>(null);

  useEffect(() => {
    if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') return;
    if (!isSupabaseConfigured() || !userId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    // One subscription per member identity; re-subscribe when it changes.
    if (stateRef.current?.userId === userId) return;
    if (stateRef.current && supabase) {
      void supabase.removeChannel(stateRef.current.channel as never);
      stateRef.current = null;
    }

    try {
      const channel = supabase.channel(`notifications:${userId}`, {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
        },
      } as never);
      (channel as { on: (...args: unknown[]) => { on: (...args: unknown[]) => unknown } }).on(
        'postgres_changes' as never,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'Notification',
          filter: `or=(member_id.is.null,member_id.eq.${userId})`,
        } as never,
        () => {
          queryClient.invalidateQueries({ queryKey: ['member', 'broadcasts', userId] });
        },
      );
      (channel as { subscribe: (cb: (status: string, err?: Error) => void) => void }).subscribe(
        (status: string, err?: Error) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`[notifications-realtime] subscription ${status}`, err?.message ?? '');
          }
        },
      );
      stateRef.current = { channel, userId };
    } catch (e) {
      console.error('[notifications-realtime] setup failed', (e as Error).message);
      return;
    }

    return () => {
      const current = stateRef.current;
      stateRef.current = null;
      if (current && supabase) {
        void supabase.removeChannel(current.channel as never);
      }
    };
  }, [queryClient, userId]);
}
