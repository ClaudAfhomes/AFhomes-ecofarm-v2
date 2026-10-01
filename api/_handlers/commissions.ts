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
 *
 * `earned -> paid` is likewise an explicit, permission-gated, audited decision
 * with an optional payout reference. No batching, schedule, method, tax, or
 * clawback rule exists in this codebase and none is invented here.
 */
import { z } from 'zod';
import {
  createCommissionRuleSchema,
  markCommissionPaidSchema,
  qualifyCommissionSchema,
  updateCommissionRuleSchema,
} from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
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

/**
 * Commission read scope (Phase 26).
 *
 * Finance and Admin see every commission. A seller (VD/SSM/SM/OST) sees only
 * commissions where they are the beneficiary of record. Anything else is
 * denied by the resolver, so an unrelated seller can never leak through a
 * direct URL - frontend filtering is not the control.
 */
async function resolveCommissionScope(req: VercelRequest) {
  const view = await authorizeAfHomes(req, 'network.commissions');
  if ('error' in view) return { view, canSeeAll: false } as const;
  const finance = await authorizeAfHomes(req, 'finance.payment_verification');
  if (!('error' in finance)) return { view, canSeeAll: true } as const;
  const activation = await authorizeAfHomes(req, 'finance.card_activation');
  if (!('error' in activation)) return { view, canSeeAll: true } as const;
  const updater = await authorizeAfHomes(req, 'network.commissions', 'update');
  if (!('error' in updater)) return { view, canSeeAll: true } as const;
  return { view, canSeeAll: false } as const;
}

function commissionInScope(
  scope: { canSeeAll: boolean; view: Awaited<ReturnType<typeof authorizeAfHomes>> },
  row: Record<string, unknown>,
): boolean {
  if (scope.canSeeAll) return true;
  if ('error' in scope.view) return false;
  const userId = scope.view.userId;
  return row.beneficiary_staff_id === userId || row.beneficiary_ost_id === userId;
}

const listQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  seller: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const toRule = (row: Record<string, unknown>) => ({
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  targetName: null,
  rate: row.rate,
  effectiveFrom: row.effective_from,
  effectiveUntil: row.effective_until ?? null,
  accreditedOnOrAfter: row.accredited_on_or_after ?? null,
  isActive: row.is_active === true,
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});

async function commissionRuleTargetExists(
  db: Db,
  targetType: 'role' | 'staff' | 'ost',
  targetId: string,
): Promise<boolean> {
  const table =
    targetType === 'role' ? 'roles' : targetType === 'staff' ? 'staff_users' : 'ost_members';
  const { data, error } = await db.from(table).select('id').eq('id', targetId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === 'rules' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.commissions', 'update');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('commission_rules')
        .select('*')
        .order('effective_from', { ascending: false });
      if (error) throw error;
      return res
        .status(200)
        .json({
          data: (data ?? []).map((row: Record<string, unknown>) => toRule(row)),
          meta: { total: (data ?? []).length },
        });
    }

    if (subPath(req) === 'rules' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'network.commissions', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = createCommissionRuleSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid commission rule', 400);
      const input = parsed.data;
      if (!(await commissionRuleTargetExists(db, input.targetType, input.targetId)))
        return fail(res, 'VALIDATION_ERROR', 'Commission rule target does not exist', 400);
      const { data, error } = await db
        .from('commission_rules')
        .insert({
          target_type: input.targetType,
          target_id: input.targetId,
          rate: input.rate,
          effective_from: input.effectiveFrom,
          effective_until: input.effectiveUntil ?? null,
          accredited_on_or_after: input.accreditedOnOrAfter ?? null,
          created_by: auth.userId,
          updated_by: auth.userId,
        })
        .select('*')
        .single();
      if (error) {
        if (
          String((error as { message?: string }).message ?? '').includes('COMMISSION_RULE_OVERLAP')
        )
          return fail(
            res,
            'CONFLICT',
            'An active rule already overlaps this target and date range',
            409,
          );
        throw error;
      }
      await audit(
        db,
        auth.userId,
        'COMMISSION_RULE_CREATED',
        'commission_rule',
        String((data as { id: string }).id),
        null,
        toRule(data as Record<string, unknown>),
      );
      return res.status(201).json(toRule(data as Record<string, unknown>));
    }

    const ruleHistory = route(req, 'GET', /^rules\/([0-9a-f-]+)\/history$/);
    if (ruleHistory) {
      const auth = await authorizeAfHomes(req, 'network.commissions', 'update');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('audit_events')
        .select('id, action, actor_id, before_data, after_data, reason, created_at')
        .eq('entity_type', 'commission_rule')
        .eq('entity_id', ruleHistory[1]!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id,
          action: row.action,
          actorId: row.actor_id,
          before: row.before_data ?? null,
          after: row.after_data ?? null,
          reason: row.reason ?? null,
          createdAt: isoOrNull(row.created_at) ?? '',
        })),
        meta: { total: (data ?? []).length },
      });
    }

    const updateRule = route(req, 'PATCH', /^rules\/([0-9a-f-]+)$/);
    if (updateRule) {
      const auth = await authorizeAfHomes(req, 'network.commissions', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = updateCommissionRuleSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid commission rule update', 400);
      const id = updateRule[1]!;
      const { data: before, error: readError } = await db
        .from('commission_rules')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Commission rule not found', 404);
      const patch: Record<string, unknown> = {
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      };
      const input = parsed.data;
      if (input.rate !== undefined) patch.rate = input.rate;
      if (input.effectiveFrom !== undefined) patch.effective_from = input.effectiveFrom;
      if (input.effectiveUntil !== undefined) patch.effective_until = input.effectiveUntil;
      if (input.accreditedOnOrAfter !== undefined)
        patch.accredited_on_or_after = input.accreditedOnOrAfter;
      if (input.isActive !== undefined) patch.is_active = input.isActive;
      const effectiveFrom = String(patch.effective_from ?? before.effective_from);
      const effectiveUntil = (patch.effective_until ?? before.effective_until) as string | null;
      if (effectiveUntil && effectiveUntil < effectiveFrom)
        return fail(res, 'VALIDATION_ERROR', 'Effective until cannot precede effective from', 400);
      const { error } = await db.from('commission_rules').update(patch).eq('id', id);
      if (error) {
        if (
          String((error as { message?: string }).message ?? '').includes('COMMISSION_RULE_OVERLAP')
        )
          return fail(
            res,
            'CONFLICT',
            'An active rule already overlaps this target and date range',
            409,
          );
        throw error;
      }
      const disabled = input.isActive === false && before.is_active === true;
      await audit(
        db,
        auth.userId,
        disabled ? 'COMMISSION_RULE_DISABLED' : 'COMMISSION_RULE_UPDATED',
        'commission_rule',
        id,
        toRule(before as Record<string, unknown>),
        { ...toRule(before as Record<string, unknown>), ...input },
      );
      const { data: after, error: afterError } = await db
        .from('commission_rules')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (afterError) throw afterError;
      return res.status(200).json(toRule(after as Record<string, unknown>));
    }

    if (subPath(req) === '' && method(req) === 'GET') {
      const scope = await resolveCommissionScope(req);
      if ('error' in scope.view) return deny(res, scope.view);
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, search, seller, limit, offset } = parsed.data;

      // A scoped seller asking for someone else's commissions gets an empty
      // list (not a forbidden that confirms the id exists).
      if (!scope.canSeeAll && seller && seller !== scope.view.userId) {
        return res.status(200).json({ data: [], meta: { total: 0, limit, offset } });
      }

      let query = db.from('commissions').select(SELECT_COMMISSION, { count: 'exact' });
      if (status) query = query.eq('status', status);
      if (!scope.canSeeAll) {
        query = query.or(
          `beneficiary_staff_id.eq.${scope.view.userId},beneficiary_ost_id.eq.${scope.view.userId}`,
        );
      } else if (seller) {
        query = query.or(`beneficiary_staff_id.eq.${seller},beneficiary_ost_id.eq.${seller}`);
      }

      // Search spans the joined sale number and beneficiary name. Those live
      // on other tables, so the search runs as an in-memory substring filter
      // over the scoped set (fetched without pagination), then paginates.
      // With the 200-row cap this stays proportional; it never invents a row.
      if (search) {
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        const needle = search.toLowerCase();
        const shaped = ((data ?? []) as Record<string, unknown>[]).map((row) => toCommission(row));
        const filtered = shaped.filter(
          (c) =>
            String(c.saleNumber ?? '')
              .toLowerCase()
              .includes(needle) ||
            String(c.beneficiaryName ?? '')
              .toLowerCase()
              .includes(needle),
        );
        return res.status(200).json({
          data: filtered.slice(offset, offset + limit),
          meta: { total: filtered.length, limit, offset },
        });
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map((row: Record<string, unknown>) => toCommission(row)),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    /* ---------------- detail (scoped: unrelated sellers read 404) ---------------- */
    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const scope = await resolveCommissionScope(req);
      if ('error' in scope.view) return deny(res, scope.view);
      const { data, error } = await db
        .from('commissions')
        .select(SELECT_COMMISSION)
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Commission not found', 404);
      const row = data as unknown as Record<string, unknown>;
      // Raw beneficiary ids live on the base row; the shaped view carries the
      // display fields. Scope is checked against the ids, never the names.
      const { data: raw, error: rawError } = await db
        .from('commissions')
        .select('id, beneficiary_staff_id, beneficiary_ost_id')
        .eq('id', detail[1]!)
        .maybeSingle();
      if (rawError) throw rawError;
      if (!raw || !commissionInScope(scope, raw as unknown as Record<string, unknown>))
        return fail(res, 'NOT_FOUND', 'Commission not found', 404);
      return res.status(200).json(toCommission(row));
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

    /* ---------------- explicit paid decision (earned -> paid only) ---------------- */
    const pay = route(req, 'POST', /^([0-9a-f-]+)\/pay$/);
    if (pay) {
      const auth = await authorizeAfHomes(req, 'network.commissions', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = markCommissionPaidSchema.safeParse(jsonBody(req) ?? {});
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid paid request', 400);

      const id = pay[1]!;
      const { data: before, error: readError } = await db
        .from('commissions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Commission not found', 404);

      // Idempotent: a retry of an already-paid commission returns the current
      // row without a second payout mutation or a second audit event.
      if (before.status === 'paid') {
        const { data: current, error: currentError } = await db
          .from('commissions')
          .select(SELECT_COMMISSION)
          .eq('id', id)
          .maybeSingle();
        if (currentError) throw currentError;
        return res.status(200).json(toCommission(current as Record<string, unknown>));
      }

      // Every other non-earned state is rejected. In particular pending,
      // payment_verified, final_qualification_pending, and cancelled can never
      // be marked paid directly, and paid can never move backwards.
      if (before.status !== 'earned')
        return fail(
          res,
          'CONFLICT',
          `Only an earned commission can be marked paid (current: ${before.status})`,
          409,
        );

      const now = new Date().toISOString();
      const reference = parsed.data.reference?.trim() ? parsed.data.reference.trim() : null;
      // Amount, rate snapshot, basis snapshot, and beneficiary are untouched:
      // payout records WHEN and BY WHOM, never HOW MUCH or TO WHOM.
      const { error: writeError } = await db
        .from('commissions')
        .update({ status: 'paid', paid_at: now, paid_by: auth.userId, paid_reference: reference })
        .eq('id', id);
      if (writeError) throw writeError;

      await audit(
        db,
        auth.userId,
        'COMMISSION_PAID',
        'commission',
        id,
        { status: before.status, amount: before.amount },
        { status: 'paid', amount: before.amount, reference },
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
