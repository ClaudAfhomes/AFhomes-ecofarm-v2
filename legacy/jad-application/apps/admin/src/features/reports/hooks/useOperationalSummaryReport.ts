import { useQuery } from '@tanstack/react-query';

import { getOperationalSummaryReport } from '../services/reports';

/** Manual-run operational summary query (`enabled` once the user requests it). */
export function useOperationalSummaryReport(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'reports', 'summary'] as const,
    queryFn: getOperationalSummaryReport,
    enabled,
  });
}
