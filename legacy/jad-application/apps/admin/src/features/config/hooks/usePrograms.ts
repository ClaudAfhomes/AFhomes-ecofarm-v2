import { useQuery } from '@tanstack/react-query';

import { getPrograms } from '../services/config';

export function usePrograms(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'config', 'programs'],
    queryFn: getPrograms,
    enabled: options?.enabled ?? true,
  });
}
