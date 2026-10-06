/**
 * AF Homes Phase 8 OST onboarding API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@afhomes/contracts`. The browser never names a sponsor: submission
 * carries the referral code and review carries no sponsor field at all.
 */
import {
  ostApplicationSchema,
  ostMutationResultSchema,
  ostAccreditationRecordsSchema,
  ostImportPreviewSchema,
  ostFileSchema,
  type ManualOstAccreditation,
  type SubmitOstRenewal,
  ostMemberSchema,
  ostReferralCodeIssuedSchema,
  ostReferralCodeRecordSchema,
  type CreateOstReferralCodeRequest,
  type OstApplication,
  type OstMember,
  type OstReferralCodeIssued,
  type OstReferralCodeRecord,
} from '@afhomes/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });
export const registerOfficialOst = (body: ManualOstAccreditation) =>
  post('/ost-accreditation/manual', ostMutationResultSchema, body);
export const getOstSponsors = () =>
  requestList('/ost-accreditation/sponsors', z.object({ id: z.string().uuid(), name: z.string() }));
export const getAccreditation = (kind: 'members' | 'applications', id: string) =>
  request(`/ost-accreditation/${kind}/${id}`, ostAccreditationRecordsSchema);
export const endorseAccreditation = (id: string, signedOn?: string) =>
  post(`/ost-accreditation/applications/${id}/endorse`, ostMutationResultSchema, {
    signedOn: signedOn || null,
  });
export const confirmAccreditationSignatures = (
  id: string,
  applicantSignedOn: string,
  referrerSignedOn: string,
) =>
  post(`/ost-accreditation/applications/${id}/signatures`, ostMutationResultSchema, {
    applicantSignedOn,
    referrerSignedOn,
  });
export const reviewAccreditation = (
  id: string,
  action: 'reject' | 'request-changes',
  notes: string,
) =>
  post(`/ost-accreditation/applications/${id}/decision`, ostMutationResultSchema, {
    action,
    notes,
  });
export const approveAccreditation = (id: string, startsOn: string, expiresOn: string) =>
  post(`/ost-accreditation/applications/${id}/approve`, ostMutationResultSchema, {
    startsOn,
    expiresOn,
  });
export const submitRenewal = (id: string, body: SubmitOstRenewal) =>
  post(`/ost-accreditation/members/${id}/renew`, ostMutationResultSchema, body);
export const reviseRenewal = (id: string, body: SubmitOstRenewal) =>
  post(`/ost-accreditation/renewals/${id}/revise`, ostMutationResultSchema, body);
export const decideRenewal = (
  id: string,
  action: 'endorse' | 'approve' | 'reject' | 'request-changes',
  notes = '',
) => post(`/ost-accreditation/renewals/${id}/decision`, ostMutationResultSchema, { action, notes });
export const parseOstImport = (body: unknown) =>
  post('/ost-accreditation/imports/parse', ostImportPreviewSchema, body);
export const confirmOstImport = (id: string) =>
  post(`/ost-accreditation/imports/${id}/confirm`, ostImportPreviewSchema, {});
export const downloadOstFile = (
  kind: 'template' | 'official-template' | 'export',
  format: 'csv' | 'xlsx' = 'csv',
) => request(`/ost-accreditation/${kind}?format=${format}`, ostFileSchema);

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

export const getMyReferralCodes = (sponsorStaffId?: string): Promise<OstReferralCodeRecord[]> =>
  requestList('/ost/referral-codes/me' + (sponsorStaffId ? '?sponsorStaffId=' + encodeURIComponent(sponsorStaffId) : ''), ostReferralCodeRecordSchema);

export const createReferralCode = (
  input: CreateOstReferralCodeRequest,
): Promise<OstReferralCodeIssued> =>
  post('/ost/referral-codes', ostReferralCodeIssuedSchema, input);
