/**
 * AF Homes Phase 2 business API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@afhomes/contracts`. No ad-hoc `fetch`, and no `any`.
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
  createCustomerSchema,
  financeQueueItemSchema,
  financeCollectionQueueItemSchema,
  purchasePaymentSchema,
  purchaseReservationSchema,
  reservationFinanceSummarySchema,
  type PurchaseReservation,
  type ReservationCreate,
  type ReservationUpdate,
  type FinanceCollectionQueueItem,
  type PurchasePayment,
  type PurchaseDocumentKind,
  type RecordPurchasePaymentRequest,
  type VerifyPurchasePaymentRequest,
  type ReservationFinanceSummary,
  formImportPreviewSchema,
  customerApplicationSchema,
  customerApplicationListItemSchema,
  purchaseTermsProposalSchema,
  reservationAgreementListItemSchema,
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
  type CustomerApplicationListItem,
  type ReservationAgreementListItem,
  type CreateCustomerApplicationRequest,
  type CreateReservationAgreementRequest,
  type MarkCommissionPaidRequest,
  type Membership,
  type Payment,
  type PurchaseTermsProposal,
  type QualifyCommissionRequest,
  type RecordPaymentRequest,
  type ReferralRelationship,
  type ReviewPurchaseTermsRequest,
  type Sale,
  type SaleFinancialSummary,
  type SubmitPurchaseApplicationRequest,
  type UpdateCardCategoryRequest,
  type UpdateCardProductRequest,
  type VerifyPaymentRequest,
} from '@afhomes/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
  protectedRequestListEnvelope as requestListEnvelope,
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
  post('/customers', customerSchema, createCustomerSchema.parse(normalizeCustomerRequest(input)));

export const getCustomerById = (id: string): Promise<Customer> =>
  request(`/customers/${id}`, customerSchema);

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
  return requestListEnvelope(
    `/customers${suffix ? `?${suffix}` : ''}`,
    customerSchema,
  ).then(({ data, meta }) => ({
    data,
    total: typeof meta.total === 'number' ? meta.total : data.length,
  }));
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
    /** Omit to see every application, including progressed ones. */
    queue?: 'application_work';
  } = {},
): Promise<CustomerApplicationListItem[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
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

export const getReservationAgreements = (
  params: {
    status?: string;
    tier?: string;
    seller?: string;
    from?: string;
    to?: string;
    search?: string;
    /** Only reservations created from this customer application. */
    application?: string;
    /** Omit to see every agreement, including executed ones. */
    queue?: 'reservation_work';
  } = {},
): Promise<ReservationAgreementListItem[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.tier) query.set('tier', params.tier);
  if (params.seller) query.set('seller', params.seller);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.search) query.set('search', params.search);
  if (params.application) query.set('application', params.application);
  if (params.queue) query.set('queue', params.queue);
  const suffix = query.toString();
  return requestList(
    `/official-forms/reservations${suffix ? `?${suffix}` : ''}`,
    reservationAgreementListItemSchema,
  );
};
/**
 * The agreement is read as a discriminated union, because that is what it is: a
 * legacy sale-origin agreement has no purchase terms, and an application-origin
 * agreement has no sale until Finance finalizes it. One widened shape would let
 * the UI treat "no sale" as a missing value rather than as the designed state.
 */
export const getReservationAgreement = (id: string): Promise<PurchaseReservation> =>
  request(`/official-forms/reservations/${id}`, purchaseReservationSchema);
/**
 * Two shapes, one route.
 *
 * An application-origin reservation carries no sale id and names its frozen terms
 * reference; a legacy sale-origin reservation is the pre-existing form. Both go to
 * the same endpoint and the server picks the path from `origin`.
 */
export const createReservationAgreement = (
  input: ReservationCreate | CreateReservationAgreementRequest,
) =>
  post(
    '/official-forms/reservations',
    purchaseReservationSchema,
    'origin' in input ? input : normalizeReservationAgreementRequest(input),
  );
export const updateReservationAgreement = (id: string, input: CreateReservationAgreementRequest) =>
  patch(
    `/official-forms/reservations/${id}`,
    purchaseReservationSchema,
    normalizeReservationAgreementRequest(input),
  );
export const submitReservationAgreement = (id: string) =>
  post(`/official-forms/reservations/${id}/submit`, purchaseReservationSchema, {});
export const decideReservationAgreement = (
  id: string,
  decision: 'executed' | 'cancelled',
  notes?: string,
) =>
  post(`/official-forms/reservations/${id}/decision`, purchaseReservationSchema, {
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

/**
 * The Finance queue is a discriminated union: a legacy sale-origin row, or an
 * EXECUTED application-origin reservation that has no card sale yet. The union
 * is what makes the UI honest - a reservation row has no sale id to act on, and
 * acting on one anyway would be a second, invisible sale.
 */
export const getFinanceQueue = (search = ''): Promise<FinanceCollectionQueueItem[]> =>
  requestList(
    '/queues/finance' + (search ? '?search=' + encodeURIComponent(search) : ''),
    financeCollectionQueueItemSchema,
  );

export const getActivationQueue = (): Promise<FinanceQueueItem[]> =>
  requestList('/queues/activation', financeQueueItemSchema);

/* ------------------------------------------------------------------ */
/* Application-origin collection and finalization                      */
/* ------------------------------------------------------------------ */

/** The one ledger, read by reservation until finalization links it to a sale. */
export const getReservationPayments = (id: string): Promise<PurchasePayment[]> =>
  requestList(`/official-forms/reservations/${id}/payments`, purchasePaymentSchema);

/** Server-authoritative money state for an application-origin purchase. */
export const getReservationFinance = (id: string): Promise<ReservationFinanceSummary> =>
  request(`/official-forms/reservations/${id}/finance`, reservationFinanceSummarySchema);

/**
 * Record one AF-PAY against an executed reservation.
 *
 * The body carries an amount and a method and nothing else. No total, no
 * balance, no status: every figure is recomputed server-side from the frozen
 * terms and the payment rows.
 */
export const recordReservationPayment = (
  id: string,
  input: RecordPurchasePaymentRequest,
): Promise<ReservationFinanceSummary> =>
  post(`/official-forms/reservations/${id}/payments`, reservationFinanceSummarySchema, input);

/**
 * Finalize the purchase into exactly one AF-CSALE.
 *
 * The response is the sale id the SERVER created. Nothing here constructs a
 * sale locally, and activation remains a separate action.
 */
export const finalizeReservationPurchase = (
  id: string,
  requestId: string,
): Promise<{ saleId: string; reservationId: string; activationRequired: true }> =>
  post(
    `/official-forms/reservations/${id}/finalize`,
    z.strictObject({
      saleId: z.string().uuid(),
      reservationId: z.string().uuid(),
      activationRequired: z.literal(true),
    }),
    { requestId },
  );

/**
 * Reprint a historical record from its captured evidence.
 *
 * The bytes come from the immutable revision, never from today's price, seller,
 * commission or balance, so the same source always renders the same document.
 */
export const exportPurchaseDocument = (
  sourceId: string,
  kind: PurchaseDocumentKind,
  revision: number | 'latest' = 'latest',
): Promise<GeneratedFormFile> =>
  request(
    `/official-forms/reservations/${sourceId}/documents/${kind}/${revision}`,
    generatedFormFileSchema,
  );

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

export const verifyReservationPayment = (
  reservationId: string,
  paymentId: string,
  input: VerifyPurchasePaymentRequest,
): Promise<ReservationFinanceSummary> =>
  post(
    `/official-forms/reservations/${reservationId}/payments/${paymentId}/verify`,
    reservationFinanceSummarySchema,
    input,
  );
export const updateApplicationReservation = (id: string, input: ReservationUpdate) =>
  patch(`/official-forms/reservations/${id}`, purchaseReservationSchema, input);
