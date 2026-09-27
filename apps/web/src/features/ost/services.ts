/**
 * Public OST registration API calls. Unauthenticated by necessity: the
 * applicant has no account yet. The referral CODE is the only sponsor input;
 * the sponsor identity is resolved server-side and frozen on submission.
 */
import {
  ostApplicationSubmittedSchema,
  ostReferralResolutionSchema,
  type OstApplicationSubmitted,
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

export type { OstApplicationSubmitted, OstReferralResolution };
