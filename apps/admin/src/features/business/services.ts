/**
 * AF Homes Phase 2 business API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@jad/contracts`. No ad-hoc `fetch`, and no `any`.
 *
 * Nothing here decides authorization: every screen may show a control, and the
 * server is the only thing that decides whether the action is allowed.
 */
import {
  activationResultSchema,
  cardCategorySchema,
  cardProductSchema,
  commissionSchema,
  commissionRuleSchema,
  customerImportCommitResponseSchema,
  customerImportJobSchema,
  customerImportParseResponseSchema,
  customerImportRowSchema,
  customerOnboardingRecoverySchema,
  customerSchema,
  financeQueueItemSchema,
  formImportPreviewSchema,
  customerApplicationSchema,
  reservationAgreementSchema,
  membershipSchema,
  paymentSchema,
  referralRelationshipSchema,
  saleFinancialSummarySchema,
  saleSchema,
  type ActivationResult,
  type CardCategory,
  type CardProduct,
  type Commission,
  type CommissionRule,
  type CreateCommissionRuleRequest,
  type UpdateCommissionRuleRequest,
  type CustomerImportCommitResponse,
  type CustomerImportJob,
  type CustomerImportParseResponse,
  type CustomerImportRow,
  type CustomerOnboardingRecovery,
  type CreateCardCategoryRequest,
  type CreateCardProductRequest,
  type CreateCustomerRequest,
  type CreateSaleRequest,
  type Customer,
  type FinanceQueueItem,
  type FormImportPreview,
  type CustomerApplication,
  type CreateCustomerApplicationRequest,
  type ReservationAgreement,
  type CreateReservationAgreementRequest,
  type MarkCommissionPaidRequest,
  type Membership,
  type Payment,
  type QualifyCommissionRequest,
  type RecordPaymentRequest,
  type ReferralRelationship,
  type Sale,
  type SaleFinancialSummary,
  type UpdateCardCategoryRequest,
  type UpdateCardProductRequest,
  type VerifyPaymentRequest,
} from '@jad/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';
import {
  normalizeCustomerApplicationRequest,
  normalizeCustomerRequest,
  normalizeReservationAgreementRequest,
} from '../../lib/normalize';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Card plans (served as `card-products`; the route is stable)              */
/* ------------------------------------------------------------------ */

export type CardPlanVisibility = 'active' | 'inactive' | 'all';

export const getCardProducts = (
  params: { active?: CardPlanVisibility; search?: string } = {},
): Promise<CardProduct[]> => {
  const query = new URLSearchParams();
  if (params.active && params.active !== 'active') query.set('active', params.active);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString();
  return requestList(`/card-products${suffix ? `?${suffix}` : ''}`, cardProductSchema);
};

export const getCardProduct = (id: string): Promise<CardProduct> =>
  request(`/card-products/${id}`, cardProductSchema);

export const createCardProduct = (input: CreateCardProductRequest): Promise<CardProduct> =>
  post('/card-products', cardProductSchema, input);

export const updateCardProduct = (
  id: string,
  input: UpdateCardProductRequest,
): Promise<CardProduct> => patch(`/card-products/${id}`, cardProductSchema, input);

/* ------------------------------------------------------------------ */
/* Card categories (the plan vocabulary; same permission family)        */
/* ------------------------------------------------------------------ */

export const getCardCategories = (
  params: { active?: CardPlanVisibility; search?: string } = {},
): Promise<CardCategory[]> => {
  const query = new URLSearchParams();
  if (params.active && params.active !== 'active') query.set('active', params.active);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString();
  return requestList(`/card-categories${suffix ? `?${suffix}` : ''}`, cardCategorySchema);
};

export const createCardCategory = (input: CreateCardCategoryRequest): Promise<CardCategory> =>
  post('/card-categories', cardCategorySchema, input);

export const updateCardCategory = (
  id: string,
  input: UpdateCardCategoryRequest,
): Promise<CardCategory> => patch(`/card-categories/${id}`, cardCategorySchema, input);

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
  post('/customers', customerSchema, normalizeCustomerRequest(input));

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

const generatedFormFileSchema = z.object({
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
    from?: string;
    to?: string;
    search?: string;
  } = {},
): Promise<CustomerApplication[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.tier) query.set('tier', params.tier);
  if (params.seller) query.set('seller', params.seller);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString();
  return requestList(
    `/official-forms/customer-applications${suffix ? `?${suffix}` : ''}`,
    customerApplicationSchema,
  );
};
export const getCustomerApplication = (id: string): Promise<CustomerApplication> =>
  request(`/official-forms/customer-applications/${id}`, customerApplicationSchema);
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
export const submitCustomerApplication = (id: string) =>
  post(`/official-forms/customer-applications/${id}/submit`, customerApplicationSchema, {});
export const decideCustomerApplication = (
  id: string,
  decision: 'approved' | 'rejected' | 'cancelled',
  notes?: string,
) =>
  post(`/official-forms/customer-applications/${id}/decision`, customerApplicationSchema, {
    decision,
    ...(notes ? { notes } : {}),
  });
export const reopenCustomerApplication = (id: string) =>
  post(`/official-forms/customer-applications/${id}/reopen`, customerApplicationSchema, {});
export const exportCustomerApplication = (id: string, format: 'xlsx' | 'pdf') =>
  request(`/official-forms/customer-applications/${id}/export/${format}`, generatedFormFileSchema);

export const getReservationAgreements = (
  params: {
    status?: string;
    tier?: string;
    seller?: string;
    from?: string;
    to?: string;
    search?: string;
  } = {},
): Promise<ReservationAgreement[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.tier) query.set('tier', params.tier);
  if (params.seller) query.set('seller', params.seller);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString();
  return requestList(
    `/official-forms/reservations${suffix ? `?${suffix}` : ''}`,
    reservationAgreementSchema,
  );
};
export const getReservationAgreement = (id: string): Promise<ReservationAgreement> =>
  request(`/official-forms/reservations/${id}`, reservationAgreementSchema);
export const createReservationAgreement = (input: CreateReservationAgreementRequest) =>
  post(
    '/official-forms/reservations',
    reservationAgreementSchema,
    normalizeReservationAgreementRequest(input),
  );
export const updateReservationAgreement = (id: string, input: CreateReservationAgreementRequest) =>
  patch(
    `/official-forms/reservations/${id}`,
    reservationAgreementSchema,
    normalizeReservationAgreementRequest(input),
  );
export const submitReservationAgreement = (id: string) =>
  post(`/official-forms/reservations/${id}/submit`, reservationAgreementSchema, {});
export const decideReservationAgreement = (
  id: string,
  decision: 'executed' | 'cancelled',
  notes?: string,
) =>
  post(`/official-forms/reservations/${id}/decision`, reservationAgreementSchema, {
    decision,
    ...(notes ? { notes } : {}),
  });
export const reopenReservationAgreement = (id: string) =>
  post(`/official-forms/reservations/${id}/reopen`, reservationAgreementSchema, {});
export const exportReservationAgreement = (id: string, format: 'xlsx' | 'pdf') =>
  request(`/official-forms/reservations/${id}/export/${format}`, generatedFormFileSchema);

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export const getSales = (params: { status?: string } = {}): Promise<Sale[]> => {
  const suffix = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return requestList(`/sales${suffix}`, saleSchema);
};

export const createSale = (input: CreateSaleRequest): Promise<Sale> =>
  post('/sales', saleSchema, input);

/** Server-computed money state. The UI never totals a sale itself. */
export const getSaleSummary = (saleId: string): Promise<SaleFinancialSummary> =>
  request(`/sales/${saleId}/summary`, saleFinancialSummarySchema);

export const getSalePayments = (saleId: string): Promise<Payment[]> =>
  requestList(`/sales/${saleId}/payments`, paymentSchema);

export const recordPayment = (
  saleId: string,
  input: RecordPaymentRequest,
): Promise<{ id: string }> =>
  post(`/sales/${saleId}/payments`, z.object({ id: z.string() }), input);

export const verifyPayment = (
  paymentId: string,
  input: VerifyPaymentRequest,
): Promise<{
  saleId: string;
  status: string;
  verifiedTotal: string;
  remainingBalance: string;
  fullyPaid: boolean;
  spotCashDeadline: string | null;
}> =>
  post(
    `/payments/${paymentId}/verify`,
    z.object({
      saleId: z.string(),
      status: z.string(),
      verifiedTotal: z.string(),
      remainingBalance: z.string(),
      fullyPaid: z.boolean(),
      spotCashDeadline: z.string().nullable(),
    }),
    input,
  );

export const activateSale = (saleId: string, validityMonths = 12): Promise<ActivationResult> =>
  post(`/sales/${saleId}/activate`, activationResultSchema, { validityMonths });

/* ------------------------------------------------------------------ */
/* Queues                                                              */
/* ------------------------------------------------------------------ */

export const getFinanceQueue = (): Promise<FinanceQueueItem[]> =>
  requestList('/queues/finance', financeQueueItemSchema);

export const getActivationQueue = (): Promise<FinanceQueueItem[]> =>
  requestList('/queues/activation', financeQueueItemSchema);

/* ------------------------------------------------------------------ */
/* Memberships and referrals                                           */
/* ------------------------------------------------------------------ */

export const getMemberships = (): Promise<Membership[]> =>
  requestList('/memberships', membershipSchema);

export const getReferrals = (): Promise<ReferralRelationship[]> =>
  requestList('/referrals', referralRelationshipSchema);

/* ------------------------------------------------------------------ */
/* Commissions                                                         */
/* ------------------------------------------------------------------ */

export const getCommissions = (
  params: { status?: string; search?: string; seller?: string } = {},
): Promise<Commission[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.seller) query.set('seller', params.seller);
  const suffix = query.toString();
  return requestList(`/commissions${suffix ? `?${suffix}` : ''}`, commissionSchema);
};

export const qualifyCommission = (
  id: string,
  input: QualifyCommissionRequest,
): Promise<Commission> => post(`/commissions/${id}/qualify`, commissionSchema, input);

export const markCommissionPaid = (
  id: string,
  input: MarkCommissionPaidRequest = {},
): Promise<Commission> => post(`/commissions/${id}/pay`, commissionSchema, input);

export const getCommissionRules = (): Promise<CommissionRule[]> =>
  requestList('/commissions/rules', commissionRuleSchema);
export const createCommissionRule = (input: CreateCommissionRuleRequest): Promise<CommissionRule> =>
  post('/commissions/rules', commissionRuleSchema, input);
export const updateCommissionRule = (
  id: string,
  input: UpdateCommissionRuleRequest,
): Promise<CommissionRule> => patch(`/commissions/rules/${id}`, commissionRuleSchema, input);
const commissionRuleHistorySchema = z.object({
  id: z.union([z.string(), z.number()]),
  action: z.string(),
  actorId: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type CommissionRuleHistory = z.infer<typeof commissionRuleHistorySchema>;
export const getCommissionRuleHistory = (id: string): Promise<CommissionRuleHistory[]> =>
  requestList(`/commissions/rules/${id}/history`, commissionRuleHistorySchema);

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
