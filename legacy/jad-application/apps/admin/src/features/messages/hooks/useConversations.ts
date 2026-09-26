import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getAdminConversations,
  getAdminMessagesSummary,
  getConversationThread,
  markConversationRead,
  sendStaffMessage,
} from '../services/messages';

/** `GET /admin/conversations` - inbox (FEAT-072). */
export function useAdminConversations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'conversations'],
    queryFn: getAdminConversations,
    enabled: options?.enabled ?? true,
  });
}

/** `GET /admin/conversations/:memberId` - one thread, cursor-paginated. */
export function useConversationThread(memberId: string) {
  return useInfiniteQuery({
    queryKey: ['admin', 'conversations', memberId],
    queryFn: ({ pageParam }) => getConversationThread(memberId, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: memberId.length > 0,
  });
}

/** `GET /admin/messages/summary` - inbox badge. */
export function useAdminMessagesSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'messages', 'summary'],
    queryFn: getAdminMessagesSummary,
    enabled: options?.enabled ?? true,
  });
}

/** `POST /admin/conversations/:memberId/messages` - staff reply. */
export function useSendStaffMessage(memberId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendStaffMessage(memberId, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'messages', 'summary'] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'conversations', memberId] });
    },
  });
}

/** `POST /admin/conversations/:memberId/read` - staff read watermark. */
export function useMarkConversationRead(memberId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markConversationRead(memberId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'messages', 'summary'] });
    },
  });
}
