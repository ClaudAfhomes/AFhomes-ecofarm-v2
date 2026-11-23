import { useQuery } from '@tanstack/react-query';
import type { SalesTrendGranularity } from '@afhomes/contracts';

import { getAfHomesSalesTrend } from './services';

/** One key and read for both chart rendering and its code-loading prefetch. */
export function afHomesSalesTrendQuery(granularity: SalesTrendGranularity) {
  return {
    queryKey: ['analytics', 'sales-trend', granularity] as const,
    queryFn: () => getAfHomesSalesTrend(granularity),
  };
}

/** Sales Overview trend query (12 months or all years). AFHomes pattern (predecessor `useSalesTrend`). */
export function useAfHomesSalesTrend(granularity: SalesTrendGranularity) {
  return useQuery(afHomesSalesTrendQuery(granularity));
}
