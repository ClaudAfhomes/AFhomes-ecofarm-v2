import {
  approvePolicyInputSchema,
  engagementDraftInputSchema,
  engagementEndInputSchema,
  performanceRuleDraftInputSchema,
  performanceRuleEndInputSchema,
  payrollPeriodSchema,
  returnPolicyInputSchema,
  type IstPerformanceEvidenceItem,
  type IstPerformanceStaff,
} from '@afhomes/contracts';
import {
  addMoney,
  compareMoney,
  creditedTotals,
  qualifyingPeriodEnd,
} from '@afhomes/shared';
import type { ZodType } from 'zod';

import { authorizeAfHomes } from './afhomes-access.js';
import {
  UUID_GROUP as ID,
  strOrNull as str,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  mapRpcError,
  method,
  route,
  subPath,
  type Db,
} from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

/**
 * IST engagements, performance rules and the performance evidence (migration
 * 20270105000009), mounted under payroll/ by handlePayroll:
 *
 *   GET  payroll/engagements | payroll/performance-rules      list (staff names joined)
 *   POST payroll/<kind>                                         draft      finance.payroll_policy create
 *   PUT  payroll/<kind>/:id                                     edit draft finance.payroll_policy update
 *   POST payroll/<kind>/:id/submit                              finance.payroll_policy update
 *   POST payroll/<kind>/:id/(return|approve|end)                finance.payroll_policy_approval update
 *   GET  payroll/performance?period=                            finance.payroll view
 *   GET  payroll/performance/:staffId/evidence?period=          finance.payroll view
 *
 * The actor is always the session principal; no body field can name one. SQL re-checks the
 * module, the lifecycle, separation of duties and the Q1 gate.
 */

const dateOrNull = (v: unknown): string | null => (v == null ? null : String(v));

type Row = Record<string, unknown>;

async function readRows(db: Db, table: string): Promise<Row[]> {
  const { data, error } = await db.from(table).select('*');
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function staffNames(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await db
      .from('staff_users')
      .select('id, full_name')
      .in('id', unique.slice(i, i + 100));
    if (error) throw error;
    for (const s of (data ?? []) as Row[]) names.set(String(s.id), str(s.full_name));
  }
  return names;
}

function actorFields(r: Row, names: Map<string, string | null>) {
  return {
    createdBy: r.created_by,
    createdByName: names.get(String(r.created_by)) ?? null,
    createdAt: isoOrNull(r.created_at) ?? '',
    submittedBy: str(r.submitted_by),
    submittedAt: isoOrNull(r.submitted_at),
    returnedBy: str(r.returned_by),
    returnedAt: isoOrNull(r.returned_at),
    returnReason: str(r.return_reason),
    approvedBy: str(r.approved_by),
    approvedByName: r.approved_by ? (names.get(String(r.approved_by)) ?? null) : null,
    approvedAt: isoOrNull(r.approved_at),
    approvalEvidenceReference: str(r.approval_evidence_reference),
    approvalNote: str(r.approval_note),
    endedBy: str(r.ended_by),
    endedAt: isoOrNull(r.ended_at),
    endNote: str(r.end_note),
  };
}

const toEngagement = (r: Row, names: Map<string, string | null>) => ({
  id: r.id,
  staffId: r.staff_id,
  staffName: names.get(String(r.staff_id)) ?? null,
  rank: r.rank,
  contractStart: String(r.contract_start),
  contractEnd: dateOrNull(r.contract_end),
  suspendedFrom: dateOrNull(r.suspended_from),
  evidenceReference: String(r.evidence_reference ?? ''),
  qpBaApproved: typeof r.qp_ba_approved === 'boolean' ? r.qp_ba_approved : null,
  qpDecisionReference: str(r.qp_decision_reference),
  status: r.status,
  ...actorFields(r, names),
});

const toRule = (r: Row, names: Map<string, string | null>) => ({
  id: r.id,
  ruleVersion: r.rule_version,
  effectiveFrom: String(r.effective_from),
  effectiveUntil: dateOrNull(r.effective_until),
  attributionBasis: str(r.attribution_basis),
  closedDealThresholdPct: str(r.closed_deal_threshold_pct),
  countDateBasis: str(r.count_date_basis),
  assumedCreditRate: str(r.assumed_credit_rate),
  adjustmentTreatment: str(r.adjustment_treatment),
  sourceReference: String(r.source_reference ?? ''),
  status: r.status,
  ...actorFields(r, names),
});

type Kind = {
  path: string;
  table: string;
  draftSchema: ZodType;
  idArg: string;
  fn: Record<'save' | 'submit' | 'return' | 'approve' | 'end', string>;
  endSchema: ZodType;
  endArgs: (data: never) => Record<string, unknown>;
  draftHint: string;
  endHint: string;
  sort: (a: Row, b: Row) => number;
  toRow: (r: Row, names: Map<string, string | null>) => unknown;
};

const KINDS: Kind[] = [
  {
    path: 'engagements',
    table: 'ist_engagements',
    draftSchema: engagementDraftInputSchema,
    idArg: 'p_engagement_id',
    fn: {
      save: 'save_ist_engagement_draft',
      submit: 'submit_ist_engagement',
      return: 'return_ist_engagement',
      approve: 'approve_ist_engagement',
      end: 'end_ist_engagement',
    },
    endSchema: engagementEndInputSchema,
    endArgs: (d: { contractEnd?: string | null; suspendedFrom?: string | null; note: string }) => ({
      p_contract_end: d.contractEnd ?? null,
      p_suspended_from: d.suspendedFrom ?? null,
      p_note: d.note,
    }),
    draftHint:
      'Check the engagement: choose the staff member and rank, give real dates and an evidence reference of at least 10 characters',
    endHint: 'Give a contract end date, a suspension date or both, and a note of at least 5 characters',
    sort: (a, b) =>
      String(a.staff_id).localeCompare(String(b.staff_id)) ||
      String(b.contract_start).localeCompare(String(a.contract_start)),
    toRow: toEngagement,
  },
  {
    path: 'performance-rules',
    table: 'ist_performance_rules',
    draftSchema: performanceRuleDraftInputSchema,
    idArg: 'p_rule_id',
    fn: {
      save: 'save_ist_performance_rule_draft',
      submit: 'submit_ist_performance_rule',
      return: 'return_ist_performance_rule',
      approve: 'approve_ist_performance_rule',
      end: 'end_ist_performance_rule',
    },
    endSchema: performanceRuleEndInputSchema,
    endArgs: (d: { effectiveUntil: string; note: string }) => ({
      p_effective_until: d.effectiveUntil,
      p_note: d.note,
    }),
    draftHint:
      'Check the rule: dates are real, the threshold is a percentage above 0 and at most 100, the credit rate is between 0 and 1, and the source reference needs at least 10 characters',
    endHint: 'Enter a real end date and a note of at least 5 characters',
    sort: (a, b) => Number(b.rule_version) - Number(a.rule_version),
    toRow: toRule,
  },
];

export async function handleIstGoverned(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  const path = subPath(req);
  const invalid = (message: string) => (fail(res, 'VALIDATION_ERROR', message, 400), true);

  for (const kind of KINDS) {
    const base = `payroll/${kind.path}`;

    if (path === base && method(req) === 'GET') {
      let found: Awaited<ReturnType<typeof authorizeAfHomes>> | null = null;
      for (const module of [
        'finance.payroll',
        'finance.payroll_approval',
        'finance.payroll_policy',
        'finance.payroll_policy_approval',
      ] as const) {
        found = await authorizeAfHomes(req, module, 'view');
        if (!('error' in found)) break;
      }
      if ('error' in found!) return (deny(res, found), true);
      const rows = (await readRows(db, kind.table)).sort(kind.sort);
      const ids = rows.flatMap((r) =>
        [r.staff_id, r.created_by, r.approved_by].filter((x): x is string => typeof x === 'string'),
      );
      const names = await staffNames(db, ids);
      list(
        res,
        rows.map((r) => kind.toRow(r, names)),
      );
      return true;
    }

    const create = method(req) === 'POST' && path === base;
    const update = route(req, 'PUT', new RegExp(`^${base}/${ID}$`));
    if (create || update) {
      const auth = await authorizeAfHomes(req, 'finance.payroll_policy', create ? 'create' : 'update');
      if ('error' in auth) return (deny(res, auth), true);
      const p = kind.draftSchema.safeParse(jsonBody(req));
      if (!p.success) return invalid(kind.draftHint);
      const header = req.headers?.['idempotency-key'];
      const key = (Array.isArray(header) ? header[0] : header)?.trim() || null;
      if (key && key.length > 100)
        return invalid('The Idempotency-Key header must be at most 100 characters');
      const r = await db.rpc(kind.fn.save, {
        [kind.idArg]: update ? update[1]! : null,
        p_fields: p.data,
        p_actor_id: auth.userId,
        p_idempotency_key: create ? key : null,
      });
      if (r.error) return (mapRpcError(res, r.error), true);
      res.status(create ? 201 : 200).json({ id: String(r.data), status: 'draft' });
      return true;
    }

    const action = route(req, 'POST', new RegExp(`^${base}/${ID}/(submit|return|approve|end)$`));
    if (action) {
      const id = action[1]!;
      const act = action[2] as 'submit' | 'return' | 'approve' | 'end';
      const auth = await authorizeAfHomes(
        req,
        act === 'submit' ? 'finance.payroll_policy' : 'finance.payroll_policy_approval',
        'update',
      );
      if ('error' in auth) return (deny(res, auth), true);
      let args: Record<string, unknown> = {};
      if (act === 'return') {
        const p = returnPolicyInputSchema.safeParse(jsonBody(req));
        if (!p.success) return invalid('Give a reason of at least 5 characters');
        args = { p_reason: p.data.reason };
      } else if (act === 'approve') {
        const p = approvePolicyInputSchema.safeParse(jsonBody(req));
        if (!p.success)
          return invalid(
            'Enter the approval document reference (10 to 500 characters) and a note of at least 5 characters',
          );
        args = { p_evidence_reference: p.data.evidenceReference, p_note: p.data.note };
      } else if (act === 'end') {
        const p = kind.endSchema.safeParse(jsonBody(req));
        if (!p.success) return invalid(kind.endHint);
        args = kind.endArgs(p.data as never);
      }
      const r = await db.rpc(kind.fn[act], { [kind.idArg]: id, ...args, p_actor_id: auth.userId });
      if (r.error) return (mapRpcError(res, r.error), true);
      res.status(200).json({ id, status: String(r.data) });
      return true;
    }
  }

  if (path === 'payroll/performance' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'view');
    if ('error' in auth) return (deny(res, auth), true);
    const period = payrollPeriodSchema.safeParse(req.query.period);
    if (!period.success) return invalid('Choose a payroll month (YYYY-MM)');
    const r = await db.rpc('ist_period_performance', { p_period: period.data, p_actor_id: auth.userId });
    if (r.error) return (mapRpcError(res, r.error), true);
    const out = (r.data ?? { period: period.data, staff: [] }) as {
      staff?: { staffId: string }[];
    } & Record<string, unknown>;
    const names = await staffNames(db, (out.staff ?? []).map((s) => s.staffId));
    res.status(200).json({ ...out, staffNames: Object.fromEntries(names) });
    return true;
  }

  const evidence = route(req, 'GET', new RegExp(`^payroll/performance/${ID}/evidence$`));
  if (evidence) {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'view');
    if ('error' in auth) return (deny(res, auth), true);
    const period = payrollPeriodSchema.safeParse(req.query.period);
    if (!period.success) return invalid('Choose a payroll month (YYYY-MM)');
    const r = await db.rpc('ist_staff_performance_evidence', {
      p_period: period.data,
      p_staff_id: evidence[1]!,
      p_actor_id: auth.userId,
    });
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(200).json(r.data);
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Live payroll inputs derived from the approved performance evidence   */
/* ------------------------------------------------------------------ */

const SENTENCES: Record<string, string> = {
  RULE_NOT_APPROVED: 'no performance rule is approved for this month',
  RULE_CHANGES_WITHIN_PERIOD: 'the approved performance rule changes inside this month and no split rule exists',
  RULE_INCOMPLETE: 'the approved performance rule leaves a required choice undecided',
  GENEALOGY_NOT_EFFECTIVE_DATED: 'team attribution cannot be reconstructed because genealogy has no effective dates',
  ASSUMED_CREDIT_BASE_NOT_DEFINED: 'an assumed-credit rate is set but no approved base exists to apply it to',
  NO_STAFF_SELLER: 'a verified payment has no staff seller of record',
  IMPORTED_SALE_TREATMENT_NOT_APPROVED: 'imported sales have no approved treatment for credit',
  COUNT_DATE_MISSING: 'a verified payment has no count date',
  COUNT_DATE_OUTSIDE_MONTH:
    'a payment counted in this month carries a count date in another month, so its stretch cannot be determined',
  MISSING_ENGAGEMENT: 'no approved IST engagement (contract start) exists for this staff member',
  OUTSIDE_ENGAGEMENT_WINDOW: 'a payment falls outside the approved engagement window',
  ENGAGEMENT_SUSPENDED: 'a payment is dated on or after the suspension and no rule covers it',
  ENGAGEMENT_RANK_MISMATCH: 'the engagement rank differs from the staff member role',
  ENGAGEMENT_CHANGES_WITHIN_PERIOD: 'more than one engagement covers this month and no split rule exists',
  CONTRACT_SNAPSHOT_MISMATCH: 'the sale and its reservation disagree on seller or contract price',
  CONTRACT_PRICE_SNAPSHOT_MISSING: 'the contract has no frozen price snapshot, so the closed-deal threshold cannot be applied',
  EVIDENCE_UNDETERMINED: 'a payment on the evidence list could not be classified',
  EVIDENCE_TOTAL_MISMATCH: 'the evidence items do not add up to the month figures',
  EVIDENCE_CHANGED: 'the evidence changed while the draft was being prepared; generate again',
  PERFORMANCE_EVIDENCE_MISSING: 'no performance figures exist for this staff member',
  QP_BA_DECISION_PENDING: 'the Qualifying Period allowance needs an authorized attendance or compliance decision that is not recorded',
  NON_STANDARD_START_DAY: 'the contract does not start on the 1st or 16th and no approved rule covers it',
  NO_ELIGIBLE_DAYS: 'the staff member has no eligible days in this month',
  MISSING_CONTRACT_START: 'no contract start is recorded',
};

/** Codes plus a plain-language sentence, e.g. "MISSING_ENGAGEMENT (no approved ...)". */
export function describeBlockers(codes: string[]): string {
  return codes.map((c) => `${c} (${SENTENCES[c] ?? 'blocked by the performance evidence'})`).join('; ');
}

type Stretch = { kpi: string; collection: string };

export type StretchOutcome =
  | { blocked: true; blockers: string[]; inputs: Record<string, unknown> }
  | {
      blocked: false;
      contractStart: string;
      contractEnd: string | null;
      suspendedFrom: string | null;
      qp: Stretch;
      ep: Stretch;
      inputs: Record<string, unknown>;
    };

/**
 * Splits a CALCULABLE staff member's ELIGIBLE evidence into the engine's qualifying period
 * (QP) and extended period (EP). The boundary is the engine's own qualifyingPeriodEnd of the
 * engagement's contract start: a count date on or before it is QP, after it EP. Nothing here
 * invents a rule; any inconsistency blocks the line rather than guessing.
 */
export function splitStretches(
  month: string,
  perf: IstPerformanceStaff,
  items: IstPerformanceEvidenceItem[],
  summaryHash: string | null,
): StretchOutcome {
  const base: Record<string, unknown> = {
    month,
    ruleId: perf.ruleId,
    ruleVersion: perf.ruleVersion,
    engagementId: perf.engagementId,
    evidenceHash: perf.evidenceHash,
    evidenceCount: perf.evidenceCount,
    blockers: perf.blockers,
    performanceEvidence: { summary: perf, items },
  };
  const block = (...codes: string[]): StretchOutcome => ({
    blocked: true,
    blockers: codes,
    inputs: { ...base, blockers: codes },
  });
  if (perf.status !== 'CALCULABLE') return block(...perf.blockers);
  if (!perf.contractStart || !perf.engagementId) return block('MISSING_ENGAGEMENT');
  if (summaryHash !== perf.evidenceHash) return block('EVIDENCE_CHANGED');
  if (compareMoney(perf.assumedCredit, '0.00') !== 0) return block('ASSUMED_CREDIT_BASE_NOT_DEFINED');
  if (items.some((i) => i.eligibility === 'UNDETERMINED')) return block('EVIDENCE_UNDETERMINED');

  const qpEnd = qualifyingPeriodEnd(perf.contractStart);
  const qp = { collections: '0.00', tcp: '0.00' };
  const ep = { collections: '0.00', tcp: '0.00' };
  for (const item of items.filter((i) => i.eligibility === 'ELIGIBLE')) {
    if (item.engagementId !== perf.engagementId) return block('ENGAGEMENT_CHANGES_WITHIN_PERIOD');
    if (!item.countDate) return block('COUNT_DATE_MISSING');
    // A count date outside the payroll month would land in a stretch the engine ignores
    // (silent loss); block instead of guessing which month it belongs to.
    if (item.countDate.slice(0, 7) !== month) return block('COUNT_DATE_OUTSIDE_MONTH');
    const bucket = item.countDate <= qpEnd ? qp : ep;
    bucket.collections = addMoney(bucket.collections, item.amount);
    if (item.isClosingPayment) {
      if (!item.contractPriceSnapshot) return block('EVIDENCE_TOTAL_MISMATCH');
      bucket.tcp = addMoney(bucket.tcp, item.contractPriceSnapshot);
    }
  }
  const credited = (b: { collections: string; tcp: string }) =>
    creditedTotals({
      closedDealTcp: b.tcp,
      verifiedCollections: b.collections,
      assumedAccountCollections: '0.00',
      assumedCreditRate: '0',
    });
  const qpFigures = credited(qp);
  const epFigures = credited(ep);
  if (
    compareMoney(addMoney(qp.collections, ep.collections), perf.verifiedCash) !== 0 ||
    compareMoney(addMoney(qp.tcp, ep.tcp), perf.kpi) !== 0
  )
    return block('EVIDENCE_TOTAL_MISMATCH');

  const stretch = (f: ReturnType<typeof credited>): Stretch => ({
    kpi: f.kpi,
    collection: f.collection,
  });
  return {
    blocked: false,
    contractStart: perf.contractStart,
    contractEnd: perf.contractEnd,
    suspendedFrom: perf.suspendedFrom,
    qp: stretch(qpFigures),
    ep: stretch(epFigures),
    inputs: {
      ...base,
      blockers: [],
      contractStart: perf.contractStart,
      contractEnd: perf.contractEnd,
      suspendedFrom: perf.suspendedFrom,
      qualifyingPeriodEnd: qpEnd,
      qp: stretch(qpFigures),
      ep: stretch(epFigures),
      qpBaApproved: perf.qpBaApproved ?? null,
    },
  };
}
