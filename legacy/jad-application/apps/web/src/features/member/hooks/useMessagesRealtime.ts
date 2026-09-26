import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';

/**
 * Member messaging Realtime - subscribes to `Message` INSERTs for the
 * member's own thread and invalidates the thread + summary queries.
 *
 * Mirrors `useNotificationsRealtime`: the API stays the authoritative read
 * path; Realtime only invalidates. RLS (`message_member_select_own`) scopes
 * the subscription server-side; the `memberId=eq.<uid>` filter is redundant
 * defense. The first private member-scoped realtime channel (ADR-013).
 *
 * Mounted once in `MemberLayout` alongside the notification subscription. In
 * TEST/MODE and non-Supabase environments it is a no-op (mock server flows
 * cover those).
 */
export function useMessagesRealtime(userId: string | undefined) {
  const queryClient = useQueryClient();
  const stateRef = useRef<{ channel: unknown; userId: string } | null>(null);

  useEffect(() => {
    if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') return;
    if (!isSupabaseConfigured() || !userId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (stateRef.current?.userId === userId) return;
    if (stateRef.current && supabase) {
      void supabase.removeChannel(stateRef.current.channel as never);
      stateRef.current = null;
    }

    try {
      const channel = supabase.channel(`messages:${userId}`, {
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
          filter: `memberId=eq.${userId}`,
        } as never,
        () => {
          queryClient.invalidateQueries({ queryKey: ['member', 'messages', userId] });
          queryClient.invalidateQueries({
            queryKey: ['member', 'messages', 'summary', userId],
          });
        },
      );
      (channel as { subscribe: (cb: (status: string, err?: Error) => void) => void }).subscribe(
        (status: string, err?: Error) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`[messages-realtime] subscription ${status}`, err?.message ?? '');
          }
        },
      );
      stateRef.current = { channel, userId };
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
  }, [queryClient, userId]);
}
