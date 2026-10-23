/**
 * Public OST registration API calls. Unauthenticated by necessity: the
 * applicant has no account yet. The referral CODE is the only sponsor input;
 * the sponsor identity is resolved server-side and frozen on submission.
 */
import {
  ostApplicationSubmittedSchema,
  ostMutationResultSchema,
  type SubmitOstAccreditation,
  type SubmitOstApplicationRequest,
  ostMeSchema,
  ostReferralResolutionSchema,
  type OstApplicationSubmitted,
  type OstMe,
  type OstReferralResolution,
  ostDashboardSchema,
  type OstDashboard,
  ostSalesListSchema,
  ostCommissionsListSchema,
  type OstSalesList,
  type OstCommissionsList,
} from '@afhomes/contracts';
import { request } from '../../lib/api/client';

export const resolveOstReferral = (code: string): Promise<OstReferralResolution> =>
  request(`/ost/referrals/${encodeURIComponent(code)}`, ostReferralResolutionSchema);

export const submitOstApplication = (
  body: SubmitOstApplicationRequest,
): Promise<OstApplicationSubmitted> =>
  request('/ost/applications', ostApplicationSubmittedSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * The signed-in OST member's own record. Authenticated: the bearer token
 * resolves the member server-side, so there is no id to pass or to spoof.
 */
export const getOstMe = (): Promise<OstMe> => request('/ost/me', ostMeSchema);

export const getOstDashboard = (): Promise<OstDashboard> =>
  request('/ost/me/dashboard', ostDashboardSchema);

/**
 * The signed-in OST member's personal sales list. Authenticated and self-only.
 */
export const getOstSales = (params?: { status?: string; search?: string; limit?: number; offset?: number }): Promise<OstSalesList> => {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const suffix = searchParams.size ? `?${searchParams.toString()}` : '';
  return request(`/ost/me/sales${suffix}`, ostSalesListSchema);
};

/**
 * The signed-in OST member's personal commissions list. Authenticated and self-only.
 */
export const getOstCommissions = (params?: { status?: string; search?: string; limit?: number; offset?: number }): Promise<OstCommissionsList> => {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const suffix = searchParams.size ? `?${searchParams.toString()}` : '';
  return request(`/ost/me/commissions${suffix}`, ostCommissionsListSchema);
};

export type { OstApplicationSubmitted, OstMe, OstReferralResolution, OstDashboard, OstSalesList, OstCommissionsList };
export const submitOfficialOstAccreditation = (body: SubmitOstAccreditation) =>
  request('/ost-accreditation/public', ostMutationResultSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });