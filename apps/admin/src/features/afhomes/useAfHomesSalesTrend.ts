import { useQuery } from '@tanstack/react-query';
import type { SalesTrendGranularity } from '@afhomes/contracts';

import { getAfHomesSalesTrend } from './services';

/** Sales Overview trend query (12 months or all years). JAD `useSalesTrend` parity. */
export function useAfHomesSalesTrend(granularity: SalesTrendGranularity) {
  return useQuery({
    queryKey: ['analytics', 'sales-trend', granularity] as const,
    queryFn: () => getAfHomesSalesTrend(granularity),
  });
}
