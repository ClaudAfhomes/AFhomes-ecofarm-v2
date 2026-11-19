/**

 * Card-sale API client.

 * 

 * Sales, verified-money movement, activation, and the finance queues.

 */

import {
  activationResultSchema,
  financeCollectionQueueItemSchema,
  financeQueueItemSchema,
  paymentSchema,
  saleFinancialSummarySchema,
  saleSchema,
  type ActivationResult,
  type CreateSaleRequest,
  type FinanceCollectionQueueItem,
  type FinanceQueueItem,
  type Payment,
  type RecordPaymentRequest,
  type Sale,
  type SaleFinancialSummary,
  type VerifyPaymentRequest,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export const getSales = (
  params: { status?: string; customerId?: string; productId?: string } = {},
): Promise<Sale[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.productId) query.set('productId', params.productId);
  const suffix = query.toString();
  return requestList(`/sales${suffix ? `?${suffix}` : ''}`, saleSchema);
};

export const createSale = (input: CreateSaleRequest): Promise<Sale> =>
  post('/sales', saleSchema, input);

/** Cancel a draft sale. Never destroys: the record moves to `cancelled`. */
export const cancelSale = (id: string): Promise<Sale> =>
  post(`/sales/${id}/cancel`, saleSchema, {});

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
