import {
  genealogyNodeSchema,
  genealogySummarySchema,
  teamSalesAnalyticsSchema,
  teamSalesOverviewSchema,
  type AnalyticsPeriod,
  type GenealogyNode,
} from '@afhomes/contracts';
import { protectedRequest as request, protectedRequestList as requestList } from '../../lib/api/client';
export const getGenealogy = () => requestList('/genealogy', genealogyNodeSchema);
export const getGenealogyNode = (id: string) => request(`/genealogy/${id}`, genealogyNodeSchema);
export const getGenealogyUpline = (id: string) => requestList(`/genealogy/${id}/upline`, genealogyNodeSchema);
export const getGenealogyDownline = (id: string) => requestList(`/genealogy/${id}/downline`, genealogyNodeSchema);
export const getGenealogySummary = (id: string) => request(`/genealogy/${id}/summary`, genealogySummarySchema);

export const getTeamSalesAnalytics = (staffId: string, period: AnalyticsPeriod, from?: string, to?: string) => {
  const params = new URLSearchParams({ period: encodeURIComponent(period), staffId });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return request(`/analytics/team-sales?${params.toString()}`, teamSalesAnalyticsSchema);
};

export const getTeamSalesOverview = (period: AnalyticsPeriod, from?: string, to?: string) => {
  const params = new URLSearchParams({ period: encodeURIComponent(period) });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return request(`/analytics/team-sales/overview?${params.toString()}`, teamSalesOverviewSchema);
};

export { type GenealogyNode };
export { teamSalesKeys } from '../business/queryKeys';
