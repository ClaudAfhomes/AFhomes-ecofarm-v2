import { QueryClient } from '@tanstack/react-query';

/**
 * Shared server-state client for the public site. Idempotent reads retry once;
 * non-idempotent mutations are never auto-retried.
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
