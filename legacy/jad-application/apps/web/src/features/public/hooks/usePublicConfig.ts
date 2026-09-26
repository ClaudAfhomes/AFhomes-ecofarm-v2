import { useQuery } from '@tanstack/react-query';

import { getPublicConfig } from '../../../lib/api/endpoints';

/** `GET /config/public` server-state (API-SPECIFICATION #81, PUBLIC). */
export function usePublicConfig() {
  return useQuery({
    queryKey: ['config', 'public'],
    queryFn: getPublicConfig,
  });
}
