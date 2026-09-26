import { useQuery } from '@tanstack/react-query';

import { getAdminPrograms } from '../services/config';

/**
 * GET /admin/programs - all programs incl. inactive (super_admin). Disabled
 * for non-super-admin roles by default so the Config page can render the
 * read-only active list without a 403 request.
 */
export function useAdminPrograms(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'programs'],
    queryFn: getAdminPrograms,
    enabled: options?.enabled ?? true,
  });
}
