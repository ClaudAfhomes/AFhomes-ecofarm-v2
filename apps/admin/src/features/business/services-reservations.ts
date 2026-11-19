/**

 * Reservation-agreement API client.

 * 

 * IST contracts, their money views, collection, finalization, and reprints.

 */

import {
  purchasePaymentSchema,
  purchaseReservationSchema,
  reservationAgreementListItemSchema,
  reservationAgreementSchema,
  reservationFinanceSummarySchema,
  type CreateReservationAgreementRequest,
  type PurchaseDocumentKind,
  type PurchasePayment,
  type PurchaseReservation,
  type RecordPurchasePaymentRequest,
  type ReservationAgreementListItem,
  type ReservationCreate,
  type ReservationFinanceSummary,
  type ReservationUpdate,
  type VerifyPurchasePaymentRequest,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
  protectedRequestListEnvelope as requestListEnvelope,
} from '../../lib/api/client';
import { normalizeReservationAgreementRequest } from '../../lib/normalize';

import { generatedFormFileSchema, type GeneratedFormFile } from './services-applications';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

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
 * One server-paginated reservation page. The list endpoint already accepts
 * `limit`/`offset` and returns `meta.total`; this helper keeps the envelope
 * (plain `getReservationAgreements` drops it) so the queue can page at 10 rows.
 */
export const getReservationAgreementsPage = (
  params: {
    status?: string;
    tier?: string;
    from?: string;
    to?: string;
    search?: string;
    /** Omit to see every agreement, including executed ones. */
    queue?: 'reservation_work';
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ data: ReservationAgreementListItem[]; total: number }> => {
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
    `/official-forms/reservations${suffix ? `?${suffix}` : ''}`,
    reservationAgreementListItemSchema,
  ).then(({ data, meta }) => ({
    data,
    total: typeof meta.total === 'number' ? meta.total : data.length,
  }));
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
