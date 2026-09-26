import {
  operationalSummaryReportSchema,
  salesCommissionsReportSchema,
  salesTrendReportSchema,
  type OperationalSummaryReport,
  type SalesCommissionsReport,
  type SalesTrendReport,
} from '@jad/contracts';

import { request } from '../../../lib/api/client';

/** Date range passed as `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both optional). */
export interface ReportRange {
  from?: string;
  to?: string;
}

/** `GET /admin/reports/sales-commissions` - sales + commissions + breakdowns. */
export function getSalesCommissionsReport(
  range: ReportRange = {},
): Promise<SalesCommissionsReport> {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return request(`/admin/reports/sales-commissions${suffix}`, salesCommissionsReportSchema);
}

/** `GET /admin/reports/summary` - whole-org operational snapshot. */
export function getOperationalSummaryReport(): Promise<OperationalSummaryReport> {
  return request('/admin/reports/summary', operationalSummaryReportSchema);
}

/**
 * `GET /admin/reports/sales-trend` - continuous monthly (last 12 months) or
 * yearly series for the dashboard overview chart.
 */
export function getSalesTrend(granularity: 'month' | 'year'): Promise<SalesTrendReport> {
  return request(`/admin/reports/sales-trend?granularity=${granularity}`, salesTrendReportSchema);
}
