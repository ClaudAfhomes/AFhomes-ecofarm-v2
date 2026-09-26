import { useQuery } from '@tanstack/react-query';

import { getAdminQueues } from '../services/queues';

export function useAdminQueues(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'queues'],
    queryFn: getAdminQueues,
    enabled: options?.enabled ?? true,
  });
}
