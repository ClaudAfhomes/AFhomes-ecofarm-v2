/**
 * Public OST registration API calls. Unauthenticated by necessity: the
 * applicant has no account yet. The referral CODE is the only sponsor input;
 * the sponsor identity is resolved server-side and frozen on submission.
 */
import {
  ostApplicationSubmittedSchema,
  ostMutationResultSchema,
  type SubmitOstAccreditation,
  ostMeSchema,
  ostReferralResolutionSchema,
  type OstApplicationSubmitted,
  type OstMe,
  type OstReferralResolution,
  type SubmitOstApplicationRequest,
} from '@jad/contracts';

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

export type { OstApplicationSubmitted, OstMe, OstReferralResolution };
export const submitOfficialOstAccreditation = (body: SubmitOstAccreditation) =>
  request('/ost-accreditation/public', ostMutationResultSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
