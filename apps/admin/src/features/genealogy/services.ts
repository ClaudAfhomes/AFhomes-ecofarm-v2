import {
  genealogyNodeSchema,
  genealogySummarySchema,
  genealogyResolveResultSchema,
  accreditationNumberMapSchema,
  teamSalesAnalyticsSchema,
  teamSalesOverviewSchema,
  type AnalyticsPeriod,
  type GenealogyNode,
  type GenealogyResolvedMember,
} from '@afhomes/contracts';
import { protectedRequest as request, protectedRequestList as requestList } from '../../lib/api/client';
import { z } from 'zod';

const ostContactsSchema = z.record(z.string(), z.object({ phone: z.string().nullable(), email: z.string() }));

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

export const getOstMemberContacts = (staffIds: string[]) =>
  request(`/genealogy/ost-contacts?staffIds=${encodeURIComponent(staffIds.join(','))}`, ostContactsSchema);

/** AA number -> accredited seller, scoped to the caller's own genealogy view. */
export const resolveAaNumber = (aaNumber: string) =>
  request(`/genealogy/resolve?aaNumber=${encodeURIComponent(aaNumber)}`, genealogyResolveResultSchema);

/** Batch staffId -> AA number, for read-only upline display. */
export const getAccreditationNumbers = (staffIds: string[]) =>
  request(
    `/genealogy/aa-numbers?staffIds=${encodeURIComponent(staffIds.join(','))}`,
    accreditationNumberMapSchema,
  );

export { type GenealogyNode };
export { type GenealogyResolvedMember as ResolvedAaMember };
export { teamSalesKeys } from '../business/queryKeys';
