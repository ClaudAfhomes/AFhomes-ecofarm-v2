import {
  dismissCommissionRecoverySchema,
  proposeCommissionRecoverySchema,
  recordCommissionPayoutFailureSchema,
  reconcileCommissionPayoutSchema,
  setCommissionHoldSchema,
} from '@afhomes/contracts';

import { authorizeAfHomes } from './afhomes-access.js';
import { evidenceStatusFor, handleExternalEvidence } from './external-evidence.js';
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

/**
 * Commission operations, mounted under the commissions family. Every rule
 * (status, reasons, amounts, duplicates, replays) lives in SQL
 * (20270105000004); the actor is always the session principal.
 *
 *   POST :id/hold                       { withheld, reason }
 *   GET  :id/payouts
 *   POST :id/payouts/fail               { reason, bankReference? }  (SQL takes the commission)
 *   POST payouts/:payoutId/reconcile    { bankReference?, paidOn, dateCorrectionReason? }
 *   payouts/:payoutId/evidence...       see external-evidence.ts
 *   GET  :id/recoveries
 *   POST :id/recoveries                 { trigger, amount, reason }  (proposal only)
 *   POST recoveries/:caseId/dismiss     { reason }
 *
 * Reads and writes both need network.commissions update (finance), never the
 * seller view scope. Returns true when handled.
 */
const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toPayout(r: Record<string, unknown>) {
  return {
    id: r.id,
    commissionId: r.commission_id,
    amount: r.amount,
    status: r.status,
    bankReference: str(r.bank_reference),
    method: str(r.method),
    paidOn: str(r.paid_on),
    failureReason: str(r.failure_reason),
    recordedBy: str(r.recorded_by),
    recordedAt: isoOrNull(r.recorded_at) ?? '',
    reconciledBy: str(r.reconciled_by),
    reconciledAt: isoOrNull(r.reconciled_at),
    postingPeriod: str(r.posting_period) ?? manilaMonth(r.recorded_at),
  };
}

/** Older rows have no posting_period; their month is derived from recorded_at in Asia/Manila. */
export function manilaMonth(v: unknown): string | null {
  const iso = isoOrNull(v);
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 7);
}

function toRecovery(r: Record<string, unknown>) {
  return {
    id: r.id,
    commissionId: r.commission_id,
    trigger: r.trigger_kind,
    paymentAdjustmentId: str(r.payment_adjustment_id),
    proposedAmount: r.proposed_amount,
    recoveredAmount: r.recovered_amount,
    reason: r.reason,
    status: r.status,
    requestedBy: r.requested_by,
    requestedAt: isoOrNull(r.requested_at) ?? '',
    dismissedBy: str(r.dismissed_by),
    dismissedAt: isoOrNull(r.dismissed_at),
    dismissalNote: str(r.dismissal_note),
  };
}

export async function handleCommissionOps(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  if (await handleExternalEvidence(req, res, db, 'commission_payout')) return true;
  const hold = route(req, 'POST', new RegExp(`^${ID}/hold$`));
  const payouts = route(req, 'GET', new RegExp(`^${ID}/payouts$`));
  const payoutFail = route(req, 'POST', new RegExp(`^${ID}/payouts/fail$`));
  const reconcile = route(req, 'POST', new RegExp(`^payouts/${ID}/reconcile$`));
  const recoveries = route(req, 'GET', new RegExp(`^${ID}/recoveries$`));
  const propose = route(req, 'POST', new RegExp(`^${ID}/recoveries$`));
  const dismiss = route(req, 'POST', new RegExp(`^recoveries/${ID}/dismiss$`));
  if (!(hold || payouts || payoutFail || reconcile || recoveries || propose || dismiss))
    return false;

  const auth = await authorizeAfHomes(
    req,
    payouts || payoutFail || reconcile ? 'finance.commission_payouts' : 'network.commissions',
    'update',
  );
  if ('error' in auth) return (deny(res, auth), true);
  const invalid = (message: string) => (fail(res, 'VALIDATION_ERROR', message, 400), true);

  if (payouts || recoveries) {
    const table = payouts ? 'commission_payouts' : 'commission_recovery_cases';
    const id = (payouts ?? recoveries)![1]!;
    const { data, error } = await db
      .from(table)
      .select('*')
      .eq('commission_id', id)
      .order(payouts ? 'recorded_at' : 'requested_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!payouts) return (list(res, rows.map(toRecovery)), true);
    const ids = rows.map((r) => String(r.id));
    const supported = await evidenceStatusFor(db, 'commission_payout', ids);
    const reviewed = new Set<string>();
    if (ids.length) {
      const r = await db.from('commission_payout_evidence_reviews').select('payout_id').in('payout_id', ids);
      if (r.error) throw r.error;
      for (const x of (r.data ?? []) as Record<string, unknown>[]) reviewed.add(String(x.payout_id));
    }
    list(
      res,
      rows.map((r) => ({
        ...toPayout(r),
        evidenceStatus: supported.has(String(r.id)) ? 'SUPPORTED' : 'EVIDENCE_EXCEPTION',
        evidenceExceptionReviewed: reviewed.has(String(r.id)),
      })),
    );
    return true;
  }

  const send = (
    result: { data: unknown; error: { message?: string } | null },
    status = 200,
  ): true => {
    if (result.error) return (mapRpcError(res, result.error), true);
    res.status(status).json({ id: result.data });
    return true;
  };

  if (hold) {
    const p = setCommissionHoldSchema.safeParse(jsonBody(req));
    if (!p.success) return invalid('Give a reason of at least 5 characters');
    return send(
      await db.rpc('set_commission_hold', {
        p_commission_id: hold[1]!,
        p_actor_id: auth.userId,
        p_hold: p.data.withheld,
        p_reason: p.data.reason,
      }),
    );
  }

  if (payoutFail) {
    const p = recordCommissionPayoutFailureSchema.safeParse(jsonBody(req));
    if (!p.success) return invalid('Give a reason of at least 5 characters');
    return send(
      await db.rpc('record_commission_payout_failure', {
        p_commission_id: payoutFail[1]!,
        p_actor_id: auth.userId,
        p_reason: p.data.reason,
        p_bank_reference: p.data.bankReference ?? null,
      }),
      201,
    );
  }

  if (reconcile) {
    const p = reconcileCommissionPayoutSchema.safeParse(jsonBody(req));
    if (!p.success) return invalid('Enter the payment date and a valid bank reference');
    return send(
      await db.rpc('reconcile_commission_payout', {
        p_payout_id: reconcile[1]!,
        p_actor_id: auth.userId,
        p_bank_reference: p.data.bankReference ?? null,
        p_paid_on: p.data.paidOn,
        p_date_correction_reason: p.data.dateCorrectionReason ?? null,
      }),
    );
  }

  if (propose) {
    const p = proposeCommissionRecoverySchema.safeParse(jsonBody(req));
    if (!p.success) return invalid('Invalid recovery proposal');
    return send(
      await db.rpc('propose_commission_recovery', {
        p_commission_id: propose[1]!,
        p_actor_id: auth.userId,
        p_trigger: p.data.trigger,
        p_amount: p.data.amount,
        p_reason: p.data.reason,
      }),
      201,
    );
  }

  const p = dismissCommissionRecoverySchema.safeParse(jsonBody(req));
  if (!p.success) return invalid('Give a reason of at least 5 characters');
  return send(
    await db.rpc('dismiss_commission_recovery', {
      p_case_id: dismiss![1]!,
      p_actor_id: auth.userId,
      p_note: p.data.reason,
    }),
  );
}
