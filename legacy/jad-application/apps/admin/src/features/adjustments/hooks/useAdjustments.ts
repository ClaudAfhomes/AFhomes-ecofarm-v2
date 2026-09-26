import { useQuery } from '@tanstack/react-query';

import { emptyOnForbidden } from '../../../lib/api/errors';
import { getAdjustments } from '../services/adjustments';

export function useAdjustments() {
  return useQuery({
    queryKey: ['admin', 'adjustments'],
    // Super_admin-only feed merged into the role-shared Audit page:
    // role-denied callers see no adjustments instead of mock data.
    queryFn: () => emptyOnForbidden(() => getAdjustments()),
  });
}
