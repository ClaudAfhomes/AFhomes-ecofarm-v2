import { returnAccountingPeriodSchema } from '@afhomes/contracts';

import { authorizeAfHomes } from './afhomes-access.js';
import {
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  mapRpcError,
  route,
  subPath,
  method,
  type Db,
} from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

/**
 * Accounting periods and the Finance summary, mounted under the queues family:
 *
 *   GET  finance-summary?period=YYYY-MM   -> figures for the dashboard cards / pre-close checklist
 *   GET  periods                          -> periods on file, newest first
 *   POST periods/:period/submit           -> Finance submits the month for closing
 *   POST periods/:period/return           -> the closing authority returns it (reason required)
 *   POST periods/:period/close            -> the closing authority closes it
 *
 * Who may do what, the order of closing and the separation between submitter
 * and closer are all enforced in SQL (20270105000003). Returns true when handled.
 */
const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** Current accounting month in Asia/Manila. */
export function currentManilaPeriod(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}

/** A caller who may see period figures: Finance verification, payroll, or the closing authority. */
async function viewer(req: VercelRequest) {
  let last: Awaited<ReturnType<typeof authorizeAfHomes>> | null = null;
  for (const module of [
    'finance.payment_verification',
    'finance.payroll',
    'finance.payroll_close',
  ] as const) {
    last = await authorizeAfHomes(req, module);
    if (!('error' in last)) return last;
  }
  return last!;
}

export async function handleAccountingPeriods(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  const path = subPath(req);

  if (path === 'finance-summary' && method(req) === 'GET') {
    const auth = await viewer(req);
    if ('error' in auth) return (deny(res, auth), true);
    const raw = req.query.period;
    const period = typeof raw === 'string' && raw ? raw : currentManilaPeriod();
    if (!PERIOD.test(period)) return (fail(res, 'VALIDATION_ERROR', 'Invalid period', 400), true);
    const { data, error } = await db.rpc('finance_period_summary', {
      p_period: period,
      p_actor_id: auth.userId,
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(200).json(data);
    return true;
  }

  if (path === 'periods' && method(req) === 'GET') {
    const auth = await viewer(req);
    if ('error' in auth) return (deny(res, auth), true);
    const { data, error } = await db
      .from('accounting_periods')
      .select('*')
      .order('period', { ascending: false });
    if (error) throw error;
    list(
      res,
      ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        period: r.period,
        status: r.status,
        submittedBy: isoOrNull(r.submitted_by),
        submittedAt: isoOrNull(r.submitted_at),
        closedBy: isoOrNull(r.closed_by),
        closedAt: isoOrNull(r.closed_at),
        returnedReason: isoOrNull(r.returned_reason),
        snapshot: r.snapshot ?? null,
      })),
    );
    return true;
  }

  const action = route(req, 'POST', /^periods\/([0-9]{4}-[0-9]{2})\/(submit|return|close)$/);
  if (!action) return false;
  const period = action[1]!;
  if (!PERIOD.test(period)) return (fail(res, 'VALIDATION_ERROR', 'Invalid period', 400), true);

  if (action[2] === 'submit') {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'create');
    if ('error' in auth) return (deny(res, auth), true);
    const { data, error } = await db.rpc('submit_accounting_period', {
      p_period: period,
      p_actor_id: auth.userId,
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(200).json({ period, status: data });
    return true;
  }

  const auth = await authorizeAfHomes(req, 'finance.payroll_close', 'update');
  if ('error' in auth) return (deny(res, auth), true);
  if (action[2] === 'return') {
    const parsed = returnAccountingPeriodSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return (fail(res, 'VALIDATION_ERROR', 'Give a reason of at least 5 characters', 400), true);
    const { data, error } = await db.rpc('return_accounting_period', {
      p_period: period,
      p_actor_id: auth.userId,
      p_reason: parsed.data.reason,
    });
    if (error) return (mapRpcError(res, error), true);
    res.status(200).json({ period, status: data });
    return true;
  }
  const { data, error } = await db.rpc('close_accounting_period', {
    p_period: period,
    p_actor_id: auth.userId,
  });
  if (error) return (mapRpcError(res, error), true);
  res.status(200).json({ period, status: 'closed', snapshot: data });
  return true;
}
