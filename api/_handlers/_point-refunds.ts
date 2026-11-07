import { pointRefundInputSchema, pointPurchaseCancellationSchema } from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { deny, fail, jsonBody, list, mapRpcError, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
/** One point-refund row. Shared by the service fetch and the Preview bundle. */
const toPointRefundRow = (row: Record<string, unknown>) => ({
  id: row.id,
  serviceValue: row.service_value,
  pointsRestored: Number(row.points_restored),
  reference: row.refund_reference,
  reason: row.reason,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
});

export async function handlePointRefunds(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  purchaseId: string,
  operation: string,
  verb: string,
  keyless = false,
) {
  const auth = await authorizeAfHomes(
    req,
    'operations.payments',
    verb === 'GET' ? 'view' : 'update',
  );
  if ('error' in auth) return deny(res, auth);
  if (operation === 'point-refunds' && verb === 'GET') {
    if (keyless) {
      const wrapped = await db.rpc('preview_staff_point_refunds', {
        p_purchase_id: purchaseId,
      });
      if (wrapped.error) return mapRpcError(res, wrapped.error);
      return list(res, ((wrapped.data ?? []) as Record<string, unknown>[]).map(toPointRefundRow));
    }
    const { data, error } = await db
      .from('purchase_point_refunds')
      .select('id,service_value,points_restored,refund_reference,reason,reviewed_by,reviewed_at')
      .eq('purchase_id', purchaseId)
      .order('reviewed_at', { ascending: false });
    if (error) return mapRpcError(res, error);
    return list(
      res,
      (data ?? []).map(toPointRefundRow),
    );
  }
  if (verb !== 'POST') return fail(res, 'NOT_FOUND', 'Not found', 404);
  const body =
    operation === 'point-refunds'
      ? pointRefundInputSchema.safeParse(jsonBody(req))
      : pointPurchaseCancellationSchema.safeParse(jsonBody(req));
  if (!body.success)
    return fail(res, 'VALIDATION_ERROR', 'Complete the Finance review and reason.', 400);
  let result;
  if (operation === 'point-refunds') {
    const refund = pointRefundInputSchema.parse(body.data);
    // Keyless callers use the wrapper: same refund math, actor bound to the JWT.
    result = keyless
      ? await db.rpc('preview_staff_refund_points', {
          p_purchase_id: purchaseId,
          p_service_value: refund.serviceValue,
          p_reference: refund.reference,
          p_reason: refund.reason,
          p_service_review_confirmed: refund.serviceReviewConfirmed,
        })
      : await db.rpc('refund_purchase_redeemed_points', {
        p_purchase_id: purchaseId,
        p_service_value: refund.serviceValue,
        p_reference: refund.reference,
        p_reason: refund.reason,
        p_service_review_confirmed: refund.serviceReviewConfirmed,
        p_actor_id: auth.userId,
      });
  } else
    result = keyless
      ? await db.rpc('preview_staff_cancel_reserved', {
          p_purchase_id: purchaseId,
          p_reason: body.data.reason,
        })
      : await db.rpc('cancel_reserved_point_purchase', {
        p_purchase_id: purchaseId,
        p_reason: body.data.reason,
        p_actor_id: auth.userId,
      });
  if (result.error) {
    if (
      result.error.message.includes('REFUND_') ||
      result.error.message.includes('NO_REDEEMED_POINTS')
    )
      return fail(
        res,
        'CONFLICT',
        'That point refund cannot be recorded. Check the service value, previous refunds and Finance review.',
        409,
      );
    return mapRpcError(res, result.error);
  }
  if (operation !== 'point-refunds') return res.status(200).json({ status: 'reversed' });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row) return fail(res, 'INTERNAL', 'The refund result could not be confirmed.', 500);
  return res
    .status(200)
    .json({
      refundId: row.refund_id,
      pointsRestored: Number(row.points_restored),
      balanceAfter: Number(row.balance_after),
    });
}
