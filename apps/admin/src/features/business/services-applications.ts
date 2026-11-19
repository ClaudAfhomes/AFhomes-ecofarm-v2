/**

 * Customer-application API client.

 * 

 * Official-form files, application headers, and server-priced purchase terms.

 */

import {
  customerApplicationListItemSchema,
  customerApplicationSchema,
  formImportPreviewSchema,
  purchaseTermsProposalSchema,
  type CreateCustomerApplicationRequest,
  type CustomerApplication,
  type CustomerApplicationListItem,
  type FormImportPreview,
  type PurchaseTermsProposal,
  type ReviewPurchaseTermsRequest,
  type SubmitPurchaseApplicationRequest,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
  protectedRequestListEnvelope as requestListEnvelope,
} from '../../lib/api/client';
import { normalizeCustomerApplicationRequest } from '../../lib/normalize';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

export const generatedFormFileSchema = z.object({
  filename: z.string(),
  mime: z.string(),
  content: z.string(),
});
export type GeneratedFormFile = z.infer<typeof generatedFormFileSchema>;
export const getOfficialFormTemplate = (kind: 'customer' | 'ist'): Promise<GeneratedFormFile> =>
  request(`/official-forms/${kind}/template`, generatedFormFileSchema);
export const previewOfficialFormImport = (
  kind: 'customer_application' | 'reservation_agreement',
  contentBase64: string,
): Promise<FormImportPreview> =>
  post('/official-forms/import', formImportPreviewSchema, { kind, contentBase64 });
export const generateOfficialFormPdf = (
  title: string,
  fields: Record<string, string>,
  kind?: 'customer_application' | 'reservation_agreement',
): Promise<GeneratedFormFile> =>
  post('/official-forms/pdf', generatedFormFileSchema, { title, fields, kind });

export const getCustomerApplications = (
  params: {
    status?: string;
    tier?: string;
    seller?: string;
    saleId?: string;
    from?: string;
    to?: string;
    search?: string;
    /** Omit to see every application, including progressed ones. */
    queue?: 'application_work';
  } = {},
): Promise<CustomerApplicationListItem[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.saleId) query.set('saleId', params.saleId);
  if (params.tier) query.set('tier', params.tier);
  if (params.seller) query.set('seller', params.seller);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.search) query.set('search', params.search);
  if (params.queue) query.set('queue', params.queue);
  const suffix = query.toString();
  return requestList(
    `/official-forms/customer-applications${suffix ? `?${suffix}` : ''}`,
    customerApplicationListItemSchema,
  );
};

/**
 * One server-paginated application page. The list endpoint already accepts
 * `limit`/`offset` and returns `meta.total`; this helper keeps the envelope
 * (plain `getCustomerApplications` drops it) so the queue can page at 10 rows.
 */
export const getCustomerApplicationsPage = (
  params: {
    status?: string;
    tier?: string;
    from?: string;
    to?: string;
    search?: string;
    /** Omit to see every application, including progressed ones. */
    queue?: 'application_work';
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ data: CustomerApplicationListItem[]; total: number }> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.tier) query.set('tier', params.tier);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.search) query.set('search', params.search);
  if (params.queue) query.set('queue', params.queue);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  const suffix = query.toString();
  return requestListEnvelope(
    `/official-forms/customer-applications${suffix ? `?${suffix}` : ''}`,
    customerApplicationListItemSchema,
  ).then(({ data, meta }) => ({
    data,
    total: typeof meta.total === 'number' ? meta.total : data.length,
  }));
};
export const getCustomerApplication = (id: string): Promise<CustomerApplication> =>
  request(`/official-forms/customer-applications/${id}`, customerApplicationSchema);
export const registerCustomerApplication = (
  input: import('@afhomes/contracts').RegisterCustomerApplicationRequest,
) =>
  request('/official-forms/customer-applications', customerApplicationSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const createCustomerApplication = (input: CreateCustomerApplicationRequest) =>
  post(
    '/official-forms/customer-applications',
    customerApplicationSchema,
    normalizeCustomerApplicationRequest(input),
  );
export const updateCustomerApplication = (id: string, input: CreateCustomerApplicationRequest) =>
  patch(
    `/official-forms/customer-applications/${id}`,
    customerApplicationSchema,
    normalizeCustomerApplicationRequest(input),
  );
/**
 * The server-authoritative purchase offer for an application.
 *
 * The hash returned here is the ONLY thing the browser may echo back: prices,
 * scheme economics and commission always come from this response, never from a
 * form field.
 */
export const getPurchaseTermsProposal = (
  id: string,
  sellerCandidateId?: string,
): Promise<PurchaseTermsProposal> =>
  request(
    `/official-forms/customer-applications/${id}/purchase-terms/proposal${
      sellerCandidateId ? `?sellerCandidateId=${encodeURIComponent(sellerCandidateId)}` : ''
    }`,
    purchaseTermsProposalSchema,
  );
export const reviewApplicationPurchaseTerms = (id: string, input: ReviewPurchaseTermsRequest) =>
  post(
    `/official-forms/customer-applications/${id}/purchase-terms/review`,
    customerApplicationSchema,
    {
      requestId: input.requestId,
      expectedProposalHash: input.expectedProposalHash,
      reason: input.reason,
      ...(input.sellerCandidateId ? { sellerCandidateId: input.sellerCandidateId } : {}),
    },
  );
export const submitCustomerApplication = (id: string, input: SubmitPurchaseApplicationRequest) =>
  post(`/official-forms/customer-applications/${id}/submit`, customerApplicationSchema, {
    requestId: input.requestId,
    expectedProposalHash: input.expectedProposalHash,
    ...(input.sellerCandidateId ? { sellerCandidateId: input.sellerCandidateId } : {}),
  });
export const decideCustomerApplication = (
  id: string,
  decision: 'approved' | 'rejected' | 'cancelled',
  requestId: string,
  notes?: string,
) =>
  post(`/official-forms/customer-applications/${id}/decision`, customerApplicationSchema, {
    requestId,
    decision,
    ...(notes ? { notes } : {}),
  });
export const reopenCustomerApplication = (id: string, requestId: string) =>
  post(`/official-forms/customer-applications/${id}/reopen`, customerApplicationSchema, {
    requestId,
  });
export const exportCustomerApplication = (id: string, format: 'xlsx' | 'pdf') =>
  request(`/official-forms/customer-applications/${id}/export/${format}`, generatedFormFileSchema);
