import { useQuery } from '@tanstack/react-query';

import { getPolicies } from '../lib/api/endpoints';

/**
 * `GET /policies` - policies, guidelines, T&C (API-SPECIFICATION #69, PUBLIC,
 * FEAT-062 / SCR-MEM-023). Shared by the public Policies pages and the member
 * panel. Titles/types come from the API - never invented in the UI.
 */
export function usePolicies() {
  return useQuery({
    queryKey: ['policies'],
    queryFn: getPolicies,
  });
}
