/**
 * AF Homes commissions - the 4% single-level sale commission.
 *
 * Lifecycle: pending -> payment_verified -> final_qualification_pending ->
 * earned -> paid.
 *
 * `pending` and `payment_verified` move automatically with payment state.
 * `final_qualification_pending -> earned` does NOT: the rule that permits a
 * sale to be qualified is not defined in this codebase, so the transition is a
 * separate, permission-gated, audited decision with mandatory notes, and no
 * automated path can trigger it. Inventing the rule here would fabricate policy.
 */
import { z } from 'zod';
import { qualifyCommissionSchema } from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
  list,
  mapRpcError,
  method,
  route,
  subPath,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const toCommission = (row: Record<string, unknown>) => {
  const staff = (row.beneficiary_staff ?? {}) as Record<string, unknown>;
  const ost = (row.beneficiary_ost ?? {}) as Record<string, unknown>;
  const sale = (row.card_sales ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    saleId: row.sale_id,
    saleNumber: String(sale.sale_number ?? ''),
    beneficiaryType: row.beneficiary_type,
    beneficiaryName: String(staff.full_name ?? ost.full_name ?? 'Unknown'),
    rate: row.rate_snapshot ?? '0.0400',
    basisAmount: row.basis_amount_snapshot ?? '0.00',
    amount: row.amount,
    status: row.status,
    qualificationNotes: isoOrNull(row.qualification_notes),
    qualifiedAt: isoOrNull(row.qualified_at),
    earnedAt: isoOrNull(row.earned_at),
    paidAt: isoOrNull(row.paid_at),
    createdAt: isoOrNull(row.created_at) ?? '',
  };
};

const SELECT_COMMISSION =
  '*, card_sales!inner(sale_number), beneficiary_staff:staff_users!commissions_beneficiary_staff_id_fkey(full_name), beneficiary_ost:ost_members!commissions_beneficiary_ost_id_fkey(full_name)';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.commissions');
      if ('error' in auth) return deny(res, auth);
      const parsed = z
        .object({
          status: z.string().trim().max(40).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, limit, offset } = parsed.data;

      let query = db.from('commissions').select(SELECT_COMMISSION, { count: 'exact' });
      if (status) query = query.eq('status', status);
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => toCommission(row)),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    /* ---------------- explicit qualification decision ---------------- */
    const qualify = route(req, 'POST', /^([0-9a-f-]+)\/qualify$/);
    if (qualify) {
      const auth = await authorizeAfHomes(req, 'network.commissions', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = qualifyCommissionSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'A qualification decision needs notes', 400);

      const id = qualify[1]!;
      const { data: before, error: readError } = await db
        .from('commissions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Commission not found', 404);

      // Only a commission awaiting qualification can be qualified. Nothing else
      // can be promoted straight to `earned`.
      if (before.status !== 'final_qualification_pending')
        return fail(
          res,
          'CONFLICT',
          `Only a commission awaiting final qualification can be decided (current: ${before.status})`,
          409,
        );

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: parsed.data.decision,
        qualification_notes: parsed.data.notes,
        qualified_by: auth.userId,
        qualified_at: now,
      };
      if (parsed.data.decision === 'earned') patch.earned_at = now;
      if (parsed.data.decision === 'cancelled') {
        patch.cancelled_at = now;
        patch.cancellation_reason = parsed.data.notes;
      }

      const { error: writeError } = await db.from('commissions').update(patch).eq('id', id);
      if (writeError) throw writeError;

      await audit(
        db,
        auth.userId,
        'COMMISSION_QUALIFIED',
        'commission',
        id,
        { status: before.status },
        { status: parsed.data.decision, amount: before.amount },
        { reason: parsed.data.notes },
      );

      const { data: after, error: afterError } = await db
        .from('commissions')
        .select(SELECT_COMMISSION)
        .eq('id', id)
        .maybeSingle();
      if (afterError) throw afterError;
      return res.status(200).json(toCommission(after as Record<string, unknown>));
    }

    return fail(res, 'NOT_FOUND', 'Commission endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] commissions:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
