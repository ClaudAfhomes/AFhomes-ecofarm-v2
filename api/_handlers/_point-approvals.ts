import { pointApprovalDecisionSchema } from '@afhomes/contracts';
import { subtractMoney } from '@afhomes/shared';
import { resolveCustomerPrincipal } from '../_lib/customer-access.js';
import { fail, jsonBody, list, mapRpcError, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
export async function handlePointApprovals(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  path: string,
  verb: string,
) {
  const customer = await resolveCustomerPrincipal(req);
  if ('error' in customer)
    return res.status(customer.error.status).json({ error: customer.error.error });
  if (customer.status !== 'active')
    return fail(res, 'FORBIDDEN', 'Your customer account is not active.', 403);
  if (path === 'approvals' && verb === 'GET') {
    const { data, error } = await db
      .from('redemption_quotes')
      .select(
        'id,quote_number,points_requested,peso_value,approval_snapshot,expires_at,approval_expires_at,approved_at,rejected_at,approval_consumed_at,status',
      )
      .eq('approval_customer_id', customer.customerId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return mapRpcError(res, error);
    return list(
      res,
      (data ?? []).map((row: Record<string, unknown>) => {
        const snapshot = row.approval_snapshot as Record<string, unknown>;
        const purchase = snapshot.purchase as Record<string, unknown>;
        const lines = snapshot.lines as Record<string, unknown>[];
        return {
          quoteId: row.id,
          quoteNumber: row.quote_number,
          purchaseNumber: purchase.purchase_number,
          serviceName: lines
            .map((line) => String(line.service_name_snapshot ?? 'Service'))
            .join(', '),
          lines: lines.map((line) => ({
            serviceName: String(line.service_name_snapshot ?? 'Service'),
            quantity: Number(line.quantity),
            tierDiscountRate:
              line.tier_discount_rate == null ? null : Number(line.tier_discount_rate),
          })),
          pesoValuePerPoint: String(snapshot.rate),
          pointsRequested: Number(row.points_requested),
          pesoValue: String(row.peso_value),
          grossAmount: String(purchase.gross_amount),
          tierDiscountAmount: String(purchase.tier_discount_amount),
          finalAmountPayable: subtractMoney(
            subtractMoney(String(purchase.gross_amount), String(purchase.tier_discount_amount)),
            String(row.peso_value),
          ),
          expiresAt: row.approved_at ? row.expires_at : row.approval_expires_at,
          status: row.approval_consumed_at
            ? 'completed'
            : row.rejected_at
              ? 'rejected'
              : row.status !== 'open' ||
                  new Date(
                    String(row.approved_at ? row.expires_at : row.approval_expires_at),
                  ).getTime() <= Date.now()
                ? 'expired'
                : row.approved_at
                  ? 'approved'
                  : 'pending',
        };
      }),
    );
  }
  const match = new RegExp('^approvals/([0-9a-f-]{36})/decision' + '$').exec(path);
  if (match && verb === 'POST') {
    const body = pointApprovalDecisionSchema.safeParse(jsonBody(req));
    if (!body.success) return fail(res, 'VALIDATION_ERROR', 'Choose approve or reject.', 400);
    const { data, error } = await db.rpc('decide_point_redemption_approval', {
      p_quote_id: match[1],
      p_customer_id: customer.customerId,
      p_auth_user_id: customer.userId,
      p_approve: body.data.approve,
    });
    if (error) {
      if (error.message.includes('APPROVAL_NOT_FOUND'))
        return fail(res, 'NOT_FOUND', 'No approval matches that reference.', 404);
      if (error.message.includes('INSUFFICIENT_POINTS'))
        return fail(
          res,
          'CONFLICT',
          'Your available points changed. Ask staff for a new quote.',
          409,
        );
      if (error.message.includes('APPROVAL_'))
        return fail(
          res,
          'CONFLICT',
          'This approval expired or changed. Ask staff for a new quote.',
          409,
        );
      return mapRpcError(res, error);
    }
    return res.status(200).json({ status: data });
  }
  return fail(res, 'NOT_FOUND', 'Not found', 404);
}
