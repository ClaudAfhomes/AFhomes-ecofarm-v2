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
  type CardProduct,
  type Commission,
  type CreateCustomerRequest,
  type CreateSaleRequest,
  type Customer,
  type FinanceQueueItem,
  type Membership,
  type Payment,
  type QualifyCommissionRequest,
  type RecordPaymentRequest,
  type ReferralRelationship,
  type Sale,
  type SaleFinancialSummary,
  type UpdateCardProductRequest,
  type VerifyPaymentRequest,
} from '@jad/contracts';
import { z } from 'zod';
import { request, requestList } from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Card products                                                       */
/* ------------------------------------------------------------------ */

export const getCardProducts = (): Promise<CardProduct[]> =>
  requestList('/card-products', cardProductSchema);

export const updateCardProduct = (id: string, input: UpdateCardProductRequest): Promise<CardProduct> =>
  patch(`/card-products/${id}`, cardProductSchema, input);

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export const getCustomers = (params: { search?: string; status?: string } = {}): Promise<Customer[]> => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  const suffix = query.toString();
  return requestList(`/customers${suffix ? `?${suffix}` : ''}`, customerSchema);
};

export const createCustomer = (input: CreateCustomerRequest): Promise<Customer> =>
  post('/customers', customerSchema, input);

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export const getSales = (params: { status?: string } = {}): Promise<Sale[]> => {
  const suffix = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return requestList(`/sales${suffix}`, saleSchema);
};

export const createSale = (input: CreateSaleRequest): Promise<Sale> => post('/sales', saleSchema, input);

/** Server-computed money state. The UI never totals a sale itself. */
export const getSaleSummary = (saleId: string): Promise<SaleFinancialSummary> =>
  request(`/sales/${saleId}/summary`, saleFinancialSummarySchema);

export const getSalePayments = (saleId: string): Promise<Payment[]> =>
  requestList(`/sales/${saleId}/payments`, paymentSchema);

export const recordPayment = (saleId: string, input: RecordPaymentRequest): Promise<{ id: string }> =>
  post(`/sales/${saleId}/payments`, z.object({ id: z.string() }), input);

export const verifyPayment = (
  paymentId: string,
  input: VerifyPaymentRequest,
): Promise<{ saleId: string; verifiedTotal: string; fullyPaid: boolean }> =>
  post(
    `/payments/${paymentId}/verify`,
    z.object({
      saleId: z.string(),
      verifiedTotal: z.string(),
      fullyPaid: z.boolean(),
    }),
    input,
  );

export const activateSale = (
  saleId: string,
  validityMonths = 12,
): Promise<ActivationResult> =>
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

export const getCommissions = (params: { status?: string } = {}): Promise<Commission[]> => {
  const suffix = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return requestList(`/commissions${suffix}`, commissionSchema);
};

export const qualifyCommission = (
  id: string,
  input: QualifyCommissionRequest,
): Promise<Commission> => post(`/commissions/${id}/qualify`, commissionSchema, input);
