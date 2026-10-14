/**

 * Customer directory API client.

 * 

 * Records, lifecycle actions, onboarding tokens, and bulk import/export.

 */

import {
  createCustomerSchema,
  customerImportCommitResponseSchema,
  customerImportJobSchema,
  customerImportParseResponseSchema,
  customerImportRowSchema,
  customerOnboardingRecoverySchema,
  customerSchema,
  updateCustomerSchema,
  type CreateCustomerRequest,
  type Customer,
  type CustomerImportCommitResponse,
  type CustomerImportJob,
  type CustomerImportParseResponse,
  type CustomerImportRow,
  type CustomerOnboardingRecovery,
  type UpdateCustomerRequest,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
  protectedRequestListEnvelope as requestListEnvelope,
} from '../../lib/api/client';

import { normalizeCustomerRequest } from '../../lib/normalize';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export const getCustomers = (
  params: {
    search?: string;
    status?: string;
    category?: string;
    tier?: string;
    seller?: string;
    from?: string;
    to?: string;
    sort?: string;
  } = {},
): Promise<Customer[]> => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  for (const key of ['category', 'tier', 'seller', 'from', 'to', 'sort'] as const)
    if (params[key]) query.set(key, params[key]);
  const suffix = query.toString();
  return requestList(`/customers${suffix ? `?${suffix}` : ''}`, customerSchema);
};

export const createCustomer = (input: CreateCustomerRequest): Promise<Customer> =>
  post('/customers', customerSchema, createCustomerSchema.parse(normalizeCustomerRequest(input)));

export const getCustomerById = (id: string): Promise<Customer> =>
  request(`/customers/${id}`, customerSchema);

/** Full customer update (company-stated fields included). Audited as CUSTOMER_EDITED. */
export const updateCustomer = (id: string, input: UpdateCustomerRequest): Promise<Customer> =>
  patch(`/customers/${id}`, customerSchema, updateCustomerSchema.parse(input));

/** Change a customer's lifecycle status. Audited server-side as CUSTOMER_EDITED. */
export const updateCustomerStatus = (
  id: string,
  status: 'prospect' | 'active' | 'suspended',
): Promise<Customer> => patch(`/customers/${id}`, customerSchema, { status });

/**
 * One server-paginated customer page. The list endpoint already accepts
 * `limit`/`offset` and returns `meta.total`; this helper keeps the envelope
 * (plain `getCustomers` drops it) so the directory can page at 10 rows.
 */
export const getCustomersPage = (
  params: {
    search?: string;
    status?: string;
    payment?: string;
    category?: string;
    tier?: string;
    seller?: string;
    from?: string;
    to?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ data: Customer[]; total: number }> => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.payment) query.set('payment', params.payment);
  for (const key of ['category', 'tier', 'seller', 'from', 'to', 'sort'] as const)
    if (params[key]) query.set(key, params[key]);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  const suffix = query.toString();
  return requestListEnvelope(`/customers${suffix ? `?${suffix}` : ''}`, customerSchema).then(
    ({ data, meta }) => ({
      data,
      total: typeof meta.total === 'number' ? meta.total : data.length,
    }),
  );
};

export const issueCustomerAccountActivation = (id: string): Promise<CustomerOnboardingRecovery> =>
  post(`/customers/${id}/onboarding-token`, customerOnboardingRecoverySchema, {});

const customerDeactivationSchema = z.object({ deactivated: z.literal(true) });
const customerAnonymizationSchema = z.object({ anonymized: z.literal(true) });
const customerDeletionSchema = z.object({ deleted: z.literal(true) });
export const deactivateCustomer = (id: string) =>
  post(`/customers/${id}/deactivate`, customerDeactivationSchema, {});
export const anonymizeCustomer = (id: string) =>
  post(`/customers/${id}/anonymize`, customerAnonymizationSchema, {});
export const deleteCustomer = (id: string) =>
  request(`/customers/${id}`, customerDeletionSchema, { method: 'DELETE' });

/* ------------------------------------------------------------------ */
/* Bulk customer import/export (Admin-gated; server is authoritative)   */
/* ------------------------------------------------------------------ */

const generatedImportFileSchema = z.object({
  filename: z.string(),
  mime: z.string(),
  content: z.string(),
});
export type GeneratedImportFile = z.infer<typeof generatedImportFileSchema>;

export const getCustomerImportTemplate = (format: 'xlsx' | 'csv'): Promise<GeneratedImportFile> =>
  request(`/customer-imports/template/${format}`, generatedImportFileSchema);

export const parseCustomerImport = (input: {
  source: 'excel' | 'csv' | 'google_sheets';
  contentBase64?: string;
  sheetUrl?: string;
  sourceName?: string;
}): Promise<CustomerImportParseResponse> =>
  post('/customer-imports/parse', customerImportParseResponseSchema, input);

export const getCustomerImportJobs = (): Promise<CustomerImportJob[]> =>
  requestList('/customer-imports/jobs', customerImportJobSchema);

export const getCustomerImportJob = (
  id: string,
): Promise<{ job: CustomerImportJob; rows: CustomerImportRow[] }> =>
  request(
    `/customer-imports/jobs/${id}`,
    z.object({ job: customerImportJobSchema, rows: z.array(customerImportRowSchema) }),
  );

export const confirmCustomerImport = (id: string): Promise<CustomerImportCommitResponse> =>
  post(`/customer-imports/jobs/${id}/confirm`, customerImportCommitResponseSchema, {});

export const cancelCustomerImport = (id: string): Promise<{ cancelled: boolean }> =>
  post(`/customer-imports/jobs/${id}/cancel`, z.object({ cancelled: z.boolean() }), {});

export const exportCustomers = (
  format: 'xlsx' | 'csv',
  params: {
    category?: string;
    tier?: string;
    seller?: string;
    from?: string;
    to?: string;
    search?: string;
  } = {},
): Promise<GeneratedImportFile> => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const suffix = query.toString();
  return request(
    `/customer-imports/export/${format}${suffix ? `?${suffix}` : ''}`,
    generatedImportFileSchema,
  );
};
