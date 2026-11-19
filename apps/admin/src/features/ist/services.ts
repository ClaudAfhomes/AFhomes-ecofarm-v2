import {
  istPortalReportSchema,
  importedSalesListSchema,
  type IstPortalView,
  type IstTeamCommissionFilters,
} from '@afhomes/contracts';
import { protectedRequest } from '../../lib/api/client';

export const getImportedSales = (
  params: { view: 'my-sales' | 'team-sales'; from?: string; to?: string; page: number },
  signal?: AbortSignal,
) =>
  protectedRequest(
    `/ist-portal/imported-sales?${new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    )}`,
    importedSalesListSchema,
    { signal },
  );

export function istDateRange(preset: string, now = new Date()) {
  const from = new Date(now);
  if (preset === '6months') {
    const day = from.getUTCDate();
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() - 6);
    const last = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
    from.setUTCDate(Math.min(day, last));
  } else from.setUTCDate(from.getUTCDate() - (preset === '7' ? 6 : preset === '28' ? 27 : 0));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

export const getIstReport = (
  params: {
    view: IstPortalView;
    from: string;
    to: string;
    page: number;
  } & IstTeamCommissionFilters,
  signal?: AbortSignal,
) =>
  protectedRequest(
    `/ist-portal?${new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    )}`,
    istPortalReportSchema,
    { signal },
  );
