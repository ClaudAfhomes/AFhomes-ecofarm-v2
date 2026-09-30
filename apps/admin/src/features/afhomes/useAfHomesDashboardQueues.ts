import { useQuery } from '@tanstack/react-query';

import { getAfHomesDashboardQueues } from './services';

/** Operational dashboard queue counts (JAD `useAdminQueues` parity). */
export function useAfHomesDashboardQueues() {
  return useQuery({
    queryKey: ['queues', 'dashboard'] as const,
    queryFn: getAfHomesDashboardQueues,
  });
}
