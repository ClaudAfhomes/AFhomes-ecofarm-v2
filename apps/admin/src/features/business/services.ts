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
  customerSchema,
  financeQueueItemSchema,
  membershipSchema,
  paymentSchema,
  referralRelationshipSchema,
  saleFinancialSummarySchema,
  saleSchema,
  type ActivationResult,
  type CardCategory,
  type CardProduct,
  type Commission,
  type CreateCardCategoryRequest,
  type CreateCardProductRequest,
  type CreateCustomerRequest,
  type CreateSaleRequest,
  type Customer,
  type FinanceQueueItem,
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
  params: { search?: string; status?: string } = {},
): Promise<Customer[]> => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  const suffix = query.toString();
  return requestList(`/customers${suffix ? `?${suffix}` : ''}`, customerSchema);
};

export const createCustomer = (input: CreateCustomerRequest): Promise<Customer> =>
  post('/customers', customerSchema, input);

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
