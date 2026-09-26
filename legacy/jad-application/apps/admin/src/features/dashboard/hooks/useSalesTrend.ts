import { useQuery } from '@tanstack/react-query';

import { getSalesTrend } from '../../reports/services/reports';

/** Dashboard Sales Overview trend query (12 months or all years). */
export function useSalesTrend(granularity: 'month' | 'year') {
  return useQuery({
    queryKey: ['admin', 'reports', 'sales-trend', granularity] as const,
    queryFn: () => getSalesTrend(granularity),
  });
}
