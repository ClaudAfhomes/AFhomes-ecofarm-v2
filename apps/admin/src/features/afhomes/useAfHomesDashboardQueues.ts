import { useQuery } from '@tanstack/react-query';

import { getAfHomesDashboardQueues } from './services';

/** Operational dashboard queue counts (AFHomes pattern (predecessor `useAdminQueues`)). */
export function useAfHomesDashboardQueues() {
  return useQuery({
    queryKey: ['queues', 'dashboard'] as const,
    queryFn: getAfHomesDashboardQueues,
  });
}
