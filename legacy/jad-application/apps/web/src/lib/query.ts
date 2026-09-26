import { QueryClient } from '@tanstack/react-query';

/**
 * Shared server-state client (TanStack Query - PROPOSED, TECH-STACK §2).
 * Idempotent reads retry once; non-idempotent mutations are never auto-retried
 * (DEVELOPMENT-GUIDELINES §7). Public website reads are read-only.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});
