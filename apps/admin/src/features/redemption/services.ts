/**
 * AF Homes redemption API client (staff side).
 *
 * Every call goes through `lib/api/client`, which validates the response against
 * `@jad/contracts`. No ad-hoc `fetch`, and no `any`.
 *
 * Nothing here decides authorization: a screen may show a control, and the server
 * is the only thing that decides whether the action is allowed. Nothing here
 * computes a price or a balance either - both come from the server, because a
 * figure the browser produced could disagree with the ledger.
 */
import {
  customerPointsEntrySchema,
  redemptionItemSchema,
  redemptionPreviewSchema,
  redemptionReceiptSchema,
  redemptionSchema,
  type CreateRedemptionItemRequest,
  type CreateRedemptionRequest,
  type CustomerPointsEntry,
  type Redemption,
  type RedemptionItem,
  type RedemptionPreview,
  type RedemptionReceipt,
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
/* Membership identifier -> preview                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve a scanned QR token or a typed fallback code to a redemption preview.
 *
 * This NEVER deducts points. It exists so scanning is safe: a member can be
 * looked up, shown their balance and priced for an item long before anything is
 * committed. The identifier is sent to the server and nowhere else.
 */
export const resolveMember = (identifier: string): Promise<RedemptionPreview> =>
  request(
    `/redemptions/resolve?identifier=${encodeURIComponent(identifier.trim())}`,
    redemptionPreviewSchema,
  );

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export type RedemptionItemVisibility = 'active' | 'inactive' | 'all';

export const getRedemptionItems = (
  includeInactive: boolean | RedemptionItemVisibility = false,
  search = '',
): Promise<RedemptionItem[]> => {
  const query = new URLSearchParams();
  if (includeInactive === true || includeInactive === 'all') query.set('active', 'all');
  else if (includeInactive === 'inactive') query.set('active', 'false');
  if (search.trim()) query.set('search', search.trim());
  const suffix = query.toString();
  return requestList(`/redemptions/items${suffix ? `?${suffix}` : ''}`, redemptionItemSchema);
};

export const getRedemptionItem = (id: string): Promise<RedemptionItem> =>
  request(`/redemptions/items/${id}`, redemptionItemSchema);

export const createRedemptionItem = (
  input: CreateRedemptionItemRequest,
): Promise<RedemptionItem> => post('/redemptions/items', redemptionItemSchema, input);

export const updateRedemptionItem = (
  id: string,
  input: Partial<CreateRedemptionItemRequest> & { isActive?: boolean },
): Promise<RedemptionItem> =>
  patch(`/redemptions/items/${id}`, redemptionItemSchema, input);

/* ------------------------------------------------------------------ */
/* The redemption itself                                               */
/* ------------------------------------------------------------------ */

/**
 * Redeem points. The request carries only the membership, the item, the quantity
 * and the de-duplication reference - the price and the balance are resolved
 * server-side, and the acting staff member comes from the session.
 *
 * `clientTransactionId` must be generated ONCE per intended transaction and
 * reused on any retry, which is what makes a double click or a flaky connection
 * safe. This helper does not retry.
 */
export const redeemPoints = (input: CreateRedemptionRequest): Promise<RedemptionReceipt> =>
  post('/redemptions', redemptionReceiptSchema, input);

/**
 * A de-duplication reference for one intended redemption.
 *
 * `crypto.randomUUID()` where available, with a timestamp-and-counter fallback
 * for older browsers. It is opaque and carries no membership data - it is a
 * de-duplication token, not a secret, and it authorizes nothing.
 */
export function newTransactionReference(prefix = 'pos'): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export type HistoryQuery = {
  status?: 'completed' | 'voided';
  itemId?: string;
  membershipNumber?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export const getRedemptions = async (query: HistoryQuery = {}): Promise<Redemption[]> => {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.itemId) params.set('itemId', query.itemId);
  if (query.membershipNumber) params.set('membershipNumber', query.membershipNumber);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  params.set('limit', String(query.limit ?? 50));
  params.set('offset', String(query.offset ?? 0));
  const suffix = params.toString();
  return requestList(`/redemptions${suffix ? `?${suffix}` : ''}`, redemptionSchema);
};

/* ------------------------------------------------------------------ */
/* The customer's own view (used by the customer portal, re-exported)  */
/* ------------------------------------------------------------------ */

export type { CustomerPointsEntry };
export { customerPointsEntrySchema };
