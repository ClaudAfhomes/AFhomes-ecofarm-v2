import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';

/**
 * Admin messaging Realtime - subscribes to `Message` INSERTs across every
 * member thread and invalidates the inbox + summary queries.
 *
 * Mirrors the member `useMessagesRealtime`: the API stays the authoritative
 * read path; Realtime only invalidates. Staff delivery relies on the
 * SELECT-only `message_staff_select` RLS policy gated by `is_staff_user()`
 * (the first staff RLS read policy - ADR-013). Mounted once in `AdminLayout`.
 * In TEST/MODE and non-Supabase environments it is a no-op.
 */
export function useMessagesRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const stateRef = useRef<{ channel: unknown } | null>(null);

  useEffect(() => {
    if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') return;
    if (!enabled) return;
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (stateRef.current) return;

    try {
      const channel = supabase.channel('messages:staff', {
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
          table: 'Message',
        } as never,
        () => {
          queryClient.invalidateQueries({ queryKey: ['admin', 'conversations'] });
          queryClient.invalidateQueries({ queryKey: ['admin', 'messages', 'summary'] });
        },
      );
      (channel as { subscribe: (cb: (status: string, err?: Error) => void) => void }).subscribe(
        (status: string, err?: Error) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`[messages-realtime] subscription ${status}`, err?.message ?? '');
          }
        },
      );
      stateRef.current = { channel };
    } catch (e) {
      console.error('[messages-realtime] setup failed', (e as Error).message);
      return;
    }

    return () => {
      const current = stateRef.current;
      stateRef.current = null;
      if (current && supabase) {
        void supabase.removeChannel(current.channel as never);
      }
    };
  }, [enabled, queryClient]);
}
