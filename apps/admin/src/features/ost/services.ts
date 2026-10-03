/**
 * AF Homes Phase 8 OST onboarding API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@jad/contracts`. The browser never names a sponsor: submission
 * carries the referral code and review carries no sponsor field at all.
 */
import {
  ostApplicationSchema,
  ostMemberSchema,
  ostReferralCodeIssuedSchema,
  ostReferralCodeRecordSchema,
  type CreateOstReferralCodeRequest,
  type OstApplication,
  type OstMember,
  type OstReferralCodeIssued,
  type OstReferralCodeRecord,
} from '@jad/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

export const getOstApplications = (status = '', search = ''): Promise<OstApplication[]> => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const suffix = params.size ? '?' + params.toString() : '';
  return requestList(`/ost/applications${suffix}`, ostApplicationSchema);
};

export const getOstApplication = (id: string): Promise<OstApplication> =>
  request(`/ost/applications/${id}`, ostApplicationSchema);

export const approveOstApplication = (id: string): Promise<OstMember> =>
  post(`/ost/applications/${id}/approve`, ostMemberSchema, {});

export const rejectOstApplication = (id: string, reason: string): Promise<OstApplication> =>
  post(`/ost/applications/${id}/reject`, ostApplicationSchema, { reason });

export const requestOstApplicationChanges = (id: string, notes: string): Promise<OstApplication> =>
  post(`/ost/applications/${id}/request-changes`, ostApplicationSchema, { notes });

export const getOstMembers = (search = ''): Promise<OstMember[]> =>
  requestList(
    '/ost/members' + (search ? '?search=' + encodeURIComponent(search) : ''),
    ostMemberSchema,
  );

export const getMyReferralCodes = (): Promise<OstReferralCodeRecord[]> =>
  requestList('/ost/referral-codes/me', ostReferralCodeRecordSchema);

export const createReferralCode = (
  input: CreateOstReferralCodeRequest,
): Promise<OstReferralCodeIssued> =>
  post('/ost/referral-codes', ostReferralCodeIssuedSchema, input);
