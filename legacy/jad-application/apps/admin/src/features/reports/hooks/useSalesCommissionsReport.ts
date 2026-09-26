import { useQuery } from '@tanstack/react-query';

import type { SalesCommissionsReport } from '@jad/contracts';

import { getSalesCommissionsReport, type ReportRange } from '../services/reports';

/**
 * Manual-run report query: `enabled` flips true when the user presses
 * Generate; the date range is part of the cache key so re-generating with a
 * new range refetches.
 */
export function useSalesCommissionsReport(range: ReportRange, enabled: boolean) {
  return useQuery({
    queryKey: [
      'admin',
      'reports',
      'sales-commissions',
      range.from ?? null,
      range.to ?? null,
    ] as const,
    queryFn: () => getSalesCommissionsReport(range),
    enabled,
  });
}

export type SalesCommissionsReportResult = SalesCommissionsReport;
