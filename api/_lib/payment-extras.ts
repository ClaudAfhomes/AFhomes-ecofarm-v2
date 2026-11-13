import { paymentDuplicateReviewSchema, proposePaymentAdjustmentSchema } from '@afhomes/contracts';

import { authorizeAfHomes } from './afhomes-access.js';
import {
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  mapRpcError,
  route,
  type Db,
} from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { UUID_PATTERN } from './payment-receipts.js';

/**
 * Payment-scoped Finance routes, mounted under the sales family. They address a
 * payment by id, so they serve sale and reservation payments alike:
 *
 *   GET  payments/:id/reference-matches  -> live payments on OTHER contracts sharing the reference / OR
 *   POST payments/:id/duplicate-review   -> record why that allocation is legitimate (lifts the hold)
 *   GET  payments/:id/adjustments        -> reversal / returned-check / refund proposals
 *   POST payments/:id/adjustments        -> PROPOSE one (never approves; no balance changes)
 *
 * Every rule is enforced in SQL (20270105000002); this module shapes requests.
 * Returns true when it handled the request.
 */

/** Optional receipt details sent with a record request, in the SQL function's shape. */
export function receiptDetailsOf(input: {
  orNumber?: string;
  paidOn?: string;
  paidByName?: string;
}): Record<string, string> | null {
  const details: Record<string, string> = {};
  if (input.orNumber) details.orNumber = input.orNumber;
  if (input.paidOn) details.paidOn = input.paidOn;
  if (input.paidByName) details.paidByName = input.paidByName;
  return Object.keys(details).length ? details : null;
}

/**
 * Store the details on the payment just recorded. Returns the RPC error, if any;
 * the payment itself stays recorded (pending) either way, so nothing is lost.
 */
export async function saveReceiptDetails(
  db: Db,
  paymentId: unknown,
  actorId: string,
  details: Record<string, string> | null,
): Promise<unknown> {
  if (!details || typeof paymentId !== 'string') return null;
  const { error } = await db.rpc('set_payment_receipt_details', {
    p_payment_id: paymentId,
    p_actor_id: actorId,
    p_details: details,
  });
  return error ?? null;
}

export async function handlePaymentExtras(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  const at = (verb: string, tail: string) =>
    route(req, verb, new RegExp(`^payments/([0-9a-f-]+)/${tail}$`));
  const matches = at('GET', 'reference-matches');
  const review = at('POST', 'duplicate-review');
  const listAdjustments = at('GET', 'adjustments');
  const propose = at('POST', 'adjustments');
  const hit = matches ?? review ?? listAdjustments ?? propose;
  if (!hit) return false;

  const write = Boolean(review ?? propose);
  const auth = await authorizeAfHomes(
    req,
    'finance.payment_verification',
    ...(write ? (['update'] as const) : []),
  );
  if ('error' in auth) return (deny(res, auth), true);
  const paymentId = hit[1]!;
  if (!UUID_PATTERN.test(paymentId))
    return (fail(res, 'NOT_FOUND', 'Payment not found', 404), true);

  if (matches) {
    const { data, error } = await db.rpc('payment_reference_matches', {
      p_payment_id: paymentId,
      p_actor_id: auth.userId,
    });
    if (error) return (mapRpcError(res, error), true);
    return (list(res, (data ?? []) as unknown[]), true);
  }

  if (review) {
    const parsed = paymentDuplicateReviewSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return (
        fail(res, 'VALIDATION_ERROR', 'Explain the allocation in at least 5 characters', 400),
        true
      );
    const { error } = await db.rpc('set_payment_receipt_details', {
      p_payment_id: paymentId,
      p_actor_id: auth.userId,
      p_details: { duplicateReviewNote: parsed.data.duplicateReviewNote },
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(200).json({ id: paymentId });
    return true;
  }

  if (propose) {
    const parsed = proposePaymentAdjustmentSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return (fail(res, 'VALIDATION_ERROR', 'Invalid adjustment proposal', 400), true);
    const { data, error } = await db.rpc('propose_payment_adjustment', {
      p_payment_id: paymentId,
      p_actor_id: auth.userId,
      p_kind: parsed.data.kind,
      p_amount: parsed.data.amount,
      p_reason: parsed.data.reason,
      p_effective_date: parsed.data.effectiveDate,
      p_evidence_path: null,
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(201).json({ id: data });
    return true;
  }

  const { data, error } = await db
    .from('payment_adjustments')
    .select('*')
    .eq('payment_id', paymentId)
    .order('requested_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((r) => String(r.requested_by)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const staff = await db.from('staff_users').select('id, full_name').in('id', ids);
    if (staff.error) throw staff.error;
    for (const s of (staff.data ?? []) as Record<string, unknown>[])
      names.set(String(s.id), String(s.full_name ?? ''));
  }
  list(
    res,
    rows.map((r) => ({
      id: r.id,
      paymentId: r.payment_id,
      kind: r.kind,
      amount: r.amount,
      reason: r.reason,
      effectiveDate: String(r.effective_date ?? '').slice(0, 10),
      status: r.status,
      requestedBy: r.requested_by,
      requestedByName: names.get(String(r.requested_by)) ?? null,
      requestedAt: isoOrNull(r.requested_at) ?? '',
    })),
  );
  return true;
}
