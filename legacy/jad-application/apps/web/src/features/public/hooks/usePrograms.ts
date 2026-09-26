import { useQuery } from '@tanstack/react-query';

import { getPrograms } from '../../../lib/api/endpoints';

/** `GET /programs` server-state (API-SPECIFICATION #78, PUBLIC, FEAT-068). */
export function usePrograms() {
  return useQuery({
    queryKey: ['programs'],
    queryFn: getPrograms,
  });
}
