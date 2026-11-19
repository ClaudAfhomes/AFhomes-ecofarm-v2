import {
  approvePolicyInputSchema,
  endPolicyInputSchema,
  istPeriodPerformanceSchema,
  istStaffPerformanceEvidenceSchema,
  generatePayrollDraftSchema,
  payrollDisbursementRequestSchema,
  reconcilePayrollDisbursementSchema,
  payrollPeriodSchema,
  payrollLineCalculationSchema,
  policyDraftInputSchema,
  returnPayrollBatchSchema,
  returnPolicyInputSchema,
  reviewPayrollLineInputSchema,
  simulatePayrollSchema,
  type PayrollRank,
} from '@afhomes/contracts';
import {
  calculateIstPayroll,
  type IstCompensationPolicy,
  type IstPayrollResult,
} from '@afhomes/shared';

import { authorizeAfHomes } from './afhomes-access.js';
import { storedAccreditationNumbers } from './accreditation-numbers.js';
import {
  describeBlockers,
  handleIstGoverned,
  splitStretches,
  type StretchOutcome,
} from './payroll-ist.js';
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
 * IST payroll, mounted under the queues family (migration 20270105000005):
 *
 *   GET  payroll/gate                    -> { q1Status, liveAuthorized, note, q1Source,
 *                                           q1DecisionOption, q1EvidenceStatus, q1EffectiveDate }
 *                                           (read-only; Q1 is owner-reported, never a signed approval)
 *   GET  payroll/roster?q=&limit=        -> IST staff picker (SM/SSM/SVD), read-only
 *   GET  payroll/policies                -> policy rows (+ derived lifecycle) + states + gate (read-only)
 *   POST payroll/policies                finance.payroll_policy create; draft, optional Idempotency-Key
 *   PUT  payroll/policies/:id            finance.payroll_policy update; draft edit (full document)
 *   POST payroll/policies/:id/submit     finance.payroll_policy update
 *   POST payroll/policies/:id/(return|approve|end)  finance.payroll_policy_approval update
 *   GET|POST payroll/engagements, PUT/POST payroll/engagements/:id[/submit|return|approve|end],
 *   same for payroll/performance-rules, GET payroll/performance?period=,
 *   GET payroll/performance/:staffId/evidence?period=   -> see payroll-ist.ts (migration 20270105000009)
 *   POST payroll/lines/:id/review        { note } finance.payroll update (flagged live line)
 *   GET  payroll/segments?period=        policy per date for each rank (finance.payroll view)
 *   GET  payroll/batches?period=         -> batches, newest first
 *   GET  payroll/batches/:id             -> batch with lines
 *   POST payroll/batches                 { period }  live draft (the DATABASE refuses until Q1 is approved)
 *   POST payroll/simulations             { period, simulationBasis, policySnapshot, lines }
 *   POST payroll/batches/:id/submit
 *   POST payroll/batches/:id/approve     finance.payroll_approval
 *   POST payroll/batches/:id/return      { reason }  finance.payroll_approval
 *   POST payroll/batches/:id/close       finance.payroll_close (never the submitter)
 *                                        submit/approve/return/close answer { id, status, mode }
 *   GET  payroll/approvals               submitted batches awaiting approval; simulations
 *                                        are included, labelled mode 'simulation'
 *   POST payroll/lines/:id/disbursements { amount, method, bankReference, paidOn }  live lines only
 *   POST payroll/simulations/lines/:id/disbursements  same body, simulation lines only
 *
 * The API never works around the governing gate: live drafts call the same RPCs and
 * the SQL refuses with IST_PAYROLL_NOT_AUTHORIZED. Figures come only from the pure
 * engine; the actor is always the session principal. No transfer, deduction,
 * clawback or termination exists here.
 */
const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const GATE_KEY = 'Q1_GOVERNING_COMPENSATION_MODEL';

/**
 * Role slug -> IST rank, taken from the existing seller hierarchy slugs. The Sales
 * Vice Director is the `vice_director` role (see the referral-name mirror migration).
 * Mapping a rank grants NO approval authority; RBAC is unchanged.
 */
const RANK_BY_ROLE: Record<string, PayrollRank> = {
  sales_manager: 'SM',
  senior_sales_manager: 'SSM',
  vice_director: 'SVD',
};
const RANK_ORDER: Record<PayrollRank, number> = { SM: 0, SSM: 1, SVD: 2 };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const row = (v: unknown) => v as Record<string, unknown>;

/**
 * Gate payload from the Q1 governing row. For an owner-reported decision the source is
 * `owner_reported` and evidence `awaiting_evidence` with no effective date: callers must
 * label it "Option C - owner-reported, evidence awaited, no effective date".
 */
function toGate(data: unknown) {
  const g = row(data ?? {});
  const approved = g.status === 'approved';
  const source = str(g.source);
  const evidence = str(g.evidence_status);
  return {
    q1Status: approved ? ('approved' as const) : ('pending' as const),
    liveAuthorized: approved,
    note: str(g.note),
    q1Source: source === 'owner_reported' || source === 'approval_document' ? source : null,
    q1DecisionOption: str(g.decision_option),
    q1EvidenceStatus:
      evidence === 'awaiting_evidence' || evidence === 'evidence_on_file' ? evidence : null,
    q1EffectiveDate: g.effective_date == null ? null : String(g.effective_date),
  };
}

type PolicySegments = {
  transitionRuleApproved: boolean;
  ranks: {
    rank: string;
    singlePolicy: boolean;
    transition: boolean;
    segments: { policyId: string | null; policyVersion: number | null }[];
  }[];
};

const toBatch = (r: Record<string, unknown>) => ({
  id: r.id,
  period: r.period,
  mode: r.mode,
  simulationBasis: str(r.simulation_basis),
  simulationTotalNet: str(r.simulation_total_net),
  status: r.status,
  totalBa: r.total_ba,
  totalPa: r.total_pa,
  totalPb: r.total_pb,
  totalAdjustments: r.total_adjustments,
  totalWithheld: r.total_withheld,
  totalNet: r.total_net,
  lineCount: r.line_count,
  computedLineCount: r.computed_line_count,
  blockedLineCount: r.blocked_line_count,
  createdBy: r.created_by,
  createdAt: isoOrNull(r.created_at) ?? '',
  submittedBy: str(r.submitted_by),
  submittedAt: isoOrNull(r.submitted_at),
  decidedBy: str(r.decided_by),
  decidedAt: isoOrNull(r.decided_at),
  returnReason: str(r.return_reason),
  closedBy: str(r.closed_by),
  closedAt: isoOrNull(r.closed_at),
});

const toDisbursement = (d: Record<string, unknown>, simulation: boolean) => ({
  id: d.id,
  lineId: d.line_id,
  amount: d.amount,
  method: d.method,
  bankReference: d.bank_reference,
  paidOn: str(d.paid_on) ?? '',
  recordedBy: d.recorded_by,
  recordedAt: isoOrNull(d.recorded_at) ?? '',
  proofReference: str(d.proof_reference),
  evidenceChanged: d.evidence_changed === true,
  reconciled: d.reconciled === true,
  reconciliationNote: str(d.reconciliation_note),
  simulation,
});

/** Mode of a batch, read after the RPC succeeded so responses can be labelled. */
async function batchMode(db: Db, batchId: string): Promise<'live' | 'simulation'> {
  const { data, error } = await db
    .from('payroll_batches')
    .select('mode')
    .eq('id', batchId)
    .maybeSingle();
  if (error) throw error;
  return row(data ?? {}).mode === 'simulation' ? 'simulation' : 'live';
}

/** Mode of the batch a line belongs to; null when the line is unknown. */
async function lineMode(db: Db, lineId: string): Promise<'live' | 'simulation' | null> {
  const l = await db.from('payroll_lines').select('batch_id').eq('id', lineId).maybeSingle();
  if (l.error) throw l.error;
  if (!l.data) return null;
  return batchMode(db, String(row(l.data).batch_id));
}

/** Who may see payroll: Finance payroll, or the approval authority. */
async function viewer(req: VercelRequest) {
  let last: Awaited<ReturnType<typeof authorizeAfHomes>> | null = null;
  for (const module of ['finance.payroll', 'finance.payroll_approval'] as const) {
    last = await authorizeAfHomes(req, module, 'view');
    if (!('error' in last)) return last;
  }
  return last!;
}

type PageResult = PromiseLike<{ data: unknown[] | null; error: unknown }>;

/** PostgREST silently caps a response (max-rows); read every page until a short one. */
export async function readAllPages(
  page: (from: number, to: number) => PageResult,
  size = 1000,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/** `.in()` lists travel in the URL: read them in chunks of 100 ids. */
export async function readInChunks(
  ids: string[],
  read: (chunk: string[]) => PageResult,
  size = 100,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await read(ids.slice(i, i + size));
    if (error) throw error;
    out.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return out;
}

/** Every assignment of the given roles, paged in a stable order. */
const roleAssignments = (db: Db, roleIds: string[]) =>
  readAllPages((from, to) =>
    db
      .from('staff_role_assignments')
      .select('staff_id, role_id')
      .in('role_id', roleIds)
      .order('staff_id')
      .order('role_id')
      .range(from, to),
  );

type RosterEntry = { staffId: string; name: string | null; rank: PayrollRank };

/** Active staff whose role maps to an IST rank. */
async function roster(db: Db): Promise<RosterEntry[]> {
  const roles = await db.from('roles').select('id, slug').in('slug', Object.keys(RANK_BY_ROLE));
  if (roles.error) throw roles.error;
  const roleRank = new Map<string, PayrollRank>(
    ((roles.data ?? []) as Record<string, unknown>[]).map((r) => [
      String(r.id),
      RANK_BY_ROLE[String(r.slug)]!,
    ]),
  );
  if (!roleRank.size) return [];
  const rows = await roleAssignments(db, [...roleRank.keys()]);
  if (!rows.length) return [];
  const staff = await readInChunks([...new Set(rows.map((r) => String(r.staff_id)))], (chunk) =>
    db.from('staff_users').select('id, full_name, status').in('id', chunk),
  );
  const active = new Map(
    staff.filter((s) => s.status === 'active').map((s) => [String(s.id), str(s.full_name)]),
  );
  return rows
    .filter((r) => active.has(String(r.staff_id)))
    .map((r) => ({
      staffId: String(r.staff_id),
      name: active.get(String(r.staff_id)) ?? null,
      rank: roleRank.get(String(r.role_id))!,
    }))
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
}

type PickerRow = {
  id: string;
  name: string | null;
  rank: PayrollRank;
  roleName: string;
  status: string;
};

/** IST-role staff of any status (one row per person, highest rank wins). */
async function rosterCandidates(db: Db): Promise<PickerRow[]> {
  const roles = await db
    .from('roles')
    .select('id, slug, name')
    .in('slug', Object.keys(RANK_BY_ROLE));
  if (roles.error) throw roles.error;
  const roleInfo = new Map(
    ((roles.data ?? []) as Record<string, unknown>[]).map((r) => [
      String(r.id),
      { rank: RANK_BY_ROLE[String(r.slug)]!, name: String(r.name ?? r.slug) },
    ]),
  );
  if (!roleInfo.size) return [];
  const rows = await roleAssignments(db, [...roleInfo.keys()]);
  if (!rows.length) return [];
  const staff = await readInChunks([...new Set(rows.map((r) => String(r.staff_id)))], (chunk) =>
    db.from('staff_users').select('id, full_name, status').in('id', chunk),
  );
  const users = new Map(staff.map((s) => [String(s.id), s]));
  const best = new Map<string, PickerRow>();
  for (const a of rows) {
    const u = users.get(String(a.staff_id));
    const info = roleInfo.get(String(a.role_id));
    if (!u || !info) continue;
    const id = String(a.staff_id);
    const cur = best.get(id);
    if (cur && RANK_ORDER[cur.rank] >= RANK_ORDER[info.rank]) continue;
    best.set(id, {
      id,
      name: str(u.full_name),
      rank: info.rank,
      roleName: info.name,
      status: String(u.status ?? ''),
    });
  }
  return [...best.values()];
}

type LineDraft = Record<string, unknown>;

function lineFromResult(
  staff: RosterEntry,
  result: IstPayrollResult,
  policyId: string | null,
  inputs: Record<string, unknown>,
  blockedPrefix: string,
): LineDraft {
  const base = { staffId: staff.staffId, rank: staff.rank, policyId, inputs, result };
  if (result.status !== 'CALCULATED') {
    return {
      ...base,
      policyId: null,
      status: 'blocked',
      blockedReason: `${blockedPrefix}: ${result.exceptions.join(', ') || 'not calculable'}`,
    };
  }
  return {
    ...base,
    status: 'computed',
    ba: result.ba,
    pa: result.pa,
    pb: result.pb,
    adjustments: result.authorizedAdjustments,
    withheld: result.baWithheldAmount,
    net: result.net,
  };
}

const blockedLine = (staff: RosterEntry, reason: string, inputs: Record<string, unknown> = {}) => ({
  staffId: staff.staffId,
  rank: staff.rank,
  status: 'blocked',
  blockedReason: reason,
  policyId: null,
  inputs,
  result: {},
});

/** A failed read RPC inside liveLines, so the caller can answer with the mapped status. */
class RpcFailure extends Error {
  constructor(readonly error: { message?: string; code?: string; details?: string }) {
    super(String(error.message ?? 'rpc failed'));
  }
}

/**
 * Live draft lines. Every input comes from an APPROVED source and nothing is defaulted:
 *
 *  - policy: the approved compensation policy for the rank, resolved per DATE by
 *    payroll_policy_segments. A month whose policy changes inside it stays blocked
 *    (POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED once the rule is approved: segment payout is not built).
 *  - contract dates, KPI and collection: public.ist_period_performance (approved engagement +
 *    approved performance rule + VERIFIED payments only). A BLOCKED staff entry keeps a blocked
 *    line with zero money, its blocker codes and the evidence hash.
 *  - QP / EP split: the staff member's ELIGIBLE evidence items are bucketed by countDate against
 *    the engine's own qualifyingPeriodEnd (see splitStretches).
 *  - qpBaApproved comes from the approved engagement's documented QP decision. A QP month
 *    remains blocked while that decision is absent. Approved engagement dates use calendar days.
 *  - assumed-account collections have no approved base: the rule blocker keeps a rate above zero blocked.
 */
async function liveLines(
  db: Db,
  period: string,
  staffList: RosterEntry[],
  actorId: string,
): Promise<LineDraft[]> {
  const segs = await db.rpc('payroll_policy_segments', { p_period: period, p_actor_id: actorId });
  if (segs.error) throw segs.error;
  const seg = (segs.data ?? { transitionRuleApproved: false, ranks: [] }) as PolicySegments;
  const pol = await db.from('ist_compensation_policies').select('*').eq('status', 'approved');
  if (pol.error) throw pol.error;
  const approved = (pol.data ?? []) as Record<string, unknown>[];

  const perfRes = await db.rpc('ist_period_performance', { p_period: period, p_actor_id: actorId });
  if (perfRes.error) throw new RpcFailure(perfRes.error);
  const perfParsed = istPeriodPerformanceSchema.safeParse(perfRes.data);
  if (!perfParsed.success) throw new Error('ist_period_performance returned an unexpected shape');
  const perfByStaff = new Map(perfParsed.data.staff.map((s) => [s.staffId, s]));

  const lines: LineDraft[] = [];
  for (const staff of staffList) {
    const rankSegs = seg.ranks.find((r) => r.rank === staff.rank);
    if (rankSegs?.transition) {
      const versions = rankSegs.segments
        .filter((x) => x.policyId)
        .map((x) => `v${x.policyVersion}`)
        .join(', ');
      lines.push(
        blockedLine(
          staff,
          seg.transitionRuleApproved
            ? `POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED: segment payout not implemented; ${period} spans a compensation policy change (${versions}) and no split payout is built, so no figure is computed`
            : `POLICY_TRANSITION_RULE_NOT_APPROVED: ${period} spans a compensation policy change (${versions}) and the rule for paying such a month is not approved`,
          { month: period },
        ),
      );
      continue;
    }
    const policyId = rankSegs?.singlePolicy
      ? (rankSegs.segments.find((x) => x.policyId)?.policyId ?? null)
      : null;
    const p = policyId ? approved.find((x) => String(x.id) === policyId) : undefined;
    const policy: IstCompensationPolicy | null = p
      ? {
          version: String(p.id),
          rank: staff.rank,
          monthlyBa: String(p.monthly_ba),
          baTarget: String(p.ba_target),
          monthlyPa: String(p.monthly_pa),
          paTarget: String(p.pa_target),
          pbTarget: String(p.pb_target),
          pbRate: String(p.pb_rate),
          collectionGate: String(p.collection_gate),
        }
      : null;

    const reasons: string[] = [];
    if (!policy) reasons.push(`no approved compensation policy for ${staff.rank} in ${period}`);
    const perf = perfByStaff.get(staff.staffId);
    let outcome: StretchOutcome | null = null;
    if (!perf) {
      outcome = {
        blocked: true,
        blockers: ['PERFORMANCE_EVIDENCE_MISSING'],
        inputs: { month: period, blockers: ['PERFORMANCE_EVIDENCE_MISSING'] },
      };
    } else if (perf.status === 'BLOCKED') {
      outcome = splitStretches(period, perf, [], null);
    } else if (policy) {
      const ev = await db.rpc('ist_staff_performance_evidence', {
        p_period: period,
        p_staff_id: staff.staffId,
        p_actor_id: actorId,
      });
      if (ev.error) throw new RpcFailure(ev.error);
      const evParsed = istStaffPerformanceEvidenceSchema.safeParse(ev.data);
      if (!evParsed.success)
        throw new Error('ist_staff_performance_evidence returned an unexpected shape');
      outcome = splitStretches(
        period,
        perf,
        evParsed.data.items,
        evParsed.data.summary?.evidenceHash ?? null,
      );
    }
    const traceInputs = perf
      ? {
          month: period,
          ruleId: perf.ruleId,
          ruleVersion: perf.ruleVersion,
          engagementId: perf.engagementId,
          evidenceHash: perf.evidenceHash,
          evidenceCount: perf.evidenceCount,
          blockers: perf.blockers,
        }
      : { month: period };

    if (!outcome || outcome.blocked) {
      if (outcome) reasons.push(describeBlockers(outcome.blockers));
      lines.push(
        blockedLine(
          staff,
          `CONFIGURATION_REQUIRED: ${reasons.join('; ')}`,
          outcome?.inputs ?? traceInputs,
        ),
      );
      continue;
    }

    let result: IstPayrollResult;
    try {
      result = calculateIstPayroll({
        month: period,
        rank: staff.rank,
        contractStart: outcome.contractStart,
        contractEnd: outcome.contractEnd,
        suspendedFrom: outcome.suspendedFrom,
        policy,
        qp: outcome.qp,
        ep: outcome.ep,
        qpBaApproved: perf?.qpBaApproved ?? null,
      });
    } catch {
      lines.push(
        blockedLine(
          staff,
          'CONFIGURATION_REQUIRED: the engagement or policy values are not valid dates or amounts',
          outcome.inputs,
        ),
      );
      continue;
    }
    const blockers = result.exceptions.filter((code) => code !== 'NON_STANDARD_START_DAY');
    if (result.status !== 'CALCULATED' || blockers.length) {
      lines.push(
        blockedLine(staff, `CONFIGURATION_REQUIRED: ${describeBlockers(blockers)}`, outcome.inputs),
      );
      continue;
    }
    lines.push(
      lineFromResult(
        staff,
        result,
        p ? String(p.id) : null,
        { ...outcome.inputs, policySnapshot: policy },
        'CONFIGURATION_REQUIRED',
      ),
    );
  }
  return lines;
}

async function loadDetail(db: Db, id: string) {
  const b = await db.from('payroll_batches').select('*').eq('id', id).maybeSingle();
  if (b.error) throw b.error;
  if (!b.data) return null;
  const simulation = row(b.data).mode === 'simulation';
  const allLines = await readAllPages((from, to) =>
    db.from('payroll_lines').select('*').eq('batch_id', id).order('id').range(from, to),
  );
  const lines = allLines.sort((a, c) => String(a.staff_id).localeCompare(String(c.staff_id)));
  const names = new Map<string, string | null>();
  const disb = new Map<string, Record<string, unknown>>();
  if (lines.length) {
    const s = await readInChunks(
      [
        ...new Set(
          lines.flatMap((x) => [
            String(x.staff_id),
            ...(x.reviewed_by ? [String(x.reviewed_by)] : []),
          ]),
        ),
      ],
      (chunk) => db.from('staff_users').select('id, full_name').in('id', chunk),
    );
    for (const x of s) names.set(String(x.id), str(x.full_name));
    // Simulated payouts live in their own table and never mix with live ones.
    const d = await readInChunks(
      lines.map((x) => String(x.id)),
      (chunk) =>
        db
          .from(simulation ? 'payroll_simulation_disbursements' : 'payroll_disbursements')
          .select('*')
          .in('line_id', chunk),
    );
    for (const x of d) disb.set(String(x.line_id), x);
    if (!simulation && d.length) {
      const ids = d.map((x) => String(x.id));
      const reads = await Promise.all([
        db
          .from('audit_events')
          .select('entity_id')
          .eq('action', 'PAYROLL_DISBURSEMENT_EVIDENCE_CHANGED')
          .in('entity_id', ids),
        db.from('payroll_disbursement_reviews').select('*').in('disbursement_id', ids),
        db.from('payroll_disbursement_proofs').select('*').in('disbursement_id', ids),
      ]);
      for (const result of reads) if (result.error) throw result.error;
      const changed = new Set(
        (reads[0]!.data ?? []).map((r: Record<string, unknown>) => String(r.entity_id)),
      );
      const reviews = new Map<string, Record<string, unknown>>(
        (reads[1]!.data ?? []).map((r: Record<string, unknown>) => [String(r.disbursement_id), r]),
      );
      const proofs = new Map<string, Record<string, unknown>>(
        (reads[2]!.data ?? []).map((r: Record<string, unknown>) => [String(r.disbursement_id), r]),
      );
      for (const payment of d) {
        payment.evidence_changed = changed.has(String(payment.id));
        payment.reconciled = reviews.has(String(payment.id));
        payment.reconciliation_note = reviews.get(String(payment.id))?.note ?? null;
        payment.proof_reference = proofs.get(String(payment.id))?.evidence_reference ?? null;
      }
    }
  }
  return {
    ...toBatch(row(b.data)),
    lines: lines.map((x) => {
      const d = disb.get(String(x.id));
      return {
        id: x.id,
        batchId: x.batch_id,
        staffId: x.staff_id,
        staffName: names.get(String(x.staff_id)) ?? null,
        rank: x.rank,
        status: x.status,
        blockedReason: str(x.blocked_reason),
        policyId: str(x.policy_id),
        ba: str(x.ba),
        pa: str(x.pa),
        pb: str(x.pb),
        adjustments: str(x.adjustments),
        withheld: str(x.withheld),
        net: str(x.net),
        reviewRequired: x.review_required === true,
        reviewFlags: Array.isArray(x.review_flags) ? x.review_flags.map(String) : [],
        reviewedBy: str(x.reviewed_by),
        reviewedAt: isoOrNull(x.reviewed_at),
        reviewNote: str(x.review_note),
        reviewedByName: x.reviewed_by ? (names.get(String(x.reviewed_by)) ?? null) : null,
        disbursement: d ? toDisbursement(d, simulation) : null,
      };
    }),
  };
}

export async function handlePayroll(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  const path = subPath(req);
  if (!path.startsWith('payroll/')) return false;
  if (await handleIstGoverned(req, res, db)) return true;
  const invalid = (message: string) => (fail(res, 'VALIDATION_ERROR', message, 400), true);
  const reconcile = route(req, 'POST', new RegExp(`^payroll/disbursements/${ID}/reconcile$`));
  if (reconcile) {
    const auth = await authorizeAfHomes(req, 'finance.payroll_close', 'update');
    if ('error' in auth) return (deny(res, auth), true);
    const parsed = reconcilePayrollDisbursementSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return invalid('Enter a review note and the authorization or proof reference');
    const result = await db.rpc('reconcile_payroll_disbursement', {
      p_disbursement_id: reconcile[1]!,
      p_note: parsed.data.note,
      p_evidence_reference: parsed.data.evidenceReference,
      p_actor_id: auth.userId,
    });
    if (result.error) return (mapRpcError(res, result.error), true);
    res.status(200).json({ id: String(result.data), reconciled: true });
    return true;
  }

  if (path === 'payroll/gate' && method(req) === 'GET') {
    const auth = await viewer(req);
    if ('error' in auth) return (deny(res, auth), true);
    const { data, error } = await db
      .from('governing_policy_decisions')
      .select('*')
      .eq('key', GATE_KEY)
      .maybeSingle();
    if (error) throw error;
    res.status(200).json(toGate(data));
    return true;
  }

  if (path === 'payroll/roster' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'view');
    if ('error' in auth) return (deny(res, auth), true);
    const q = (typeof req.query.q === 'string' ? req.query.q : '')
      .trim()
      .toLowerCase()
      .slice(0, 80);
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
    // Filtering happens in memory over the (small) IST set, so no LIKE wildcard can leak.
    let pool = (await rosterCandidates(db)).sort(
      (a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')) || a.id.localeCompare(b.id),
    );
    let numbers = new Map<string, string | null>();
    if (q) {
      // AA numbers live only behind an RPC; look them up so they are searchable too.
      numbers = await storedAccreditationNumbers(
        db,
        pool.map((p) => p.id),
      );
      pool = pool.filter(
        (p) =>
          (p.name ?? '').toLowerCase().includes(q) ||
          p.id.toLowerCase().startsWith(q) ||
          (numbers.get(p.id) ?? '').toLowerCase().includes(q),
      );
    }
    pool = pool.slice(0, limit);
    if (!q)
      numbers = await storedAccreditationNumbers(
        db,
        pool.map((p) => p.id),
      );
    list(
      res,
      pool.map((p) => {
        const eligible = p.status === 'active';
        return {
          id: p.id,
          name: p.name,
          aaNumber: numbers.get(p.id) ?? null,
          rank: p.rank,
          roleName: p.roleName,
          status: p.status,
          eligible,
          ...(eligible ? {} : { ineligibleReason: `Staff account is ${p.status || 'not active'}` }),
        };
      }),
    );
    return true;
  }

  if (path === 'payroll/policies' && method(req) === 'GET') {
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
    const auth = found!;
    if ('error' in auth) return (deny(res, auth), true);
    const [pol, gate, st] = await Promise.all([
      db.from('ist_compensation_policies').select('*'),
      db.from('governing_policy_decisions').select('*').eq('key', GATE_KEY).maybeSingle(),
      db.rpc('ist_compensation_policy_states', { p_actor_id: auth.userId }),
    ]);
    if (pol.error) throw pol.error;
    if (gate.error) throw gate.error;
    if (st.error) return (mapRpcError(res, st.error), true);
    const states = ((st.data ?? []) as Record<string, unknown>[]).map((x) => ({
      policyId: x.policyId,
      rank: x.rank,
      policyVersion: x.policyVersion,
      status: x.status,
      lifecycle: x.lifecycle,
      lastFinalizedPeriod: str(x.lastFinalizedPeriod),
    }));
    const stateById = new Map(states.map((x) => [String(x.policyId), x]));
    const rows = ((pol.data ?? []) as Record<string, unknown>[]).sort(
      (a, b) =>
        String(a.rank).localeCompare(String(b.rank)) ||
        String(b.effective_from).localeCompare(String(a.effective_from)),
    );
    const orNull = (v: unknown) => (v == null ? null : v);
    const data = rows.map((p) => ({
      id: p.id,
      rank: p.rank,
      policyVersion: typeof p.policy_version === 'number' ? p.policy_version : undefined,
      monthlyBa: p.monthly_ba,
      baTarget: p.ba_target,
      monthlyPa: p.monthly_pa,
      paTarget: p.pa_target,
      pbTarget: p.pb_target,
      pbRate: p.pb_rate,
      collectionGate: p.collection_gate,
      effectiveFrom: String(p.effective_from),
      effectiveUntil: p.effective_until == null ? null : String(p.effective_until),
      status: p.status,
      lifecycle: stateById.get(String(p.id))?.lifecycle,
      lastFinalizedPeriod: stateById.get(String(p.id))?.lastFinalizedPeriod ?? null,
      basisNote: p.basis_note,
      qpEpRuleReference: orNull(p.qp_ep_rule_reference),
      kpiCollectionPolicyReference: orNull(p.kpi_collection_policy_reference),
      limitExceptionRule: orNull(p.limit_exception_rule),
      baReviewLimit: orNull(p.ba_review_limit),
      paReviewLimit: orNull(p.pa_review_limit),
      pbReviewLimit: orNull(p.pb_review_limit),
      netReviewLimit: orNull(p.net_review_limit),
      createdBy: p.created_by,
      createdAt: isoOrNull(p.created_at) ?? '',
      approvedBy: str(p.approved_by),
      approvedAt: isoOrNull(p.approved_at),
      approvalConflict: [
        p.created_by,
        p.updated_by,
        p.submitted_by,
        ...(Array.isArray(p.prior_actor_ids) ? p.prior_actor_ids : []),
      ].includes(auth.userId),
    }));
    res.status(200).json({ data, meta: { total: data.length }, states, gate: toGate(gate.data) });
    return true;
  }

  // Policy drafts: finance.payroll_policy. The SQL re-checks the module for the actor.
  const idemHeader = req.headers?.['idempotency-key'];
  const idempotencyKey = (Array.isArray(idemHeader) ? idemHeader[0] : idemHeader)?.trim() || null;
  const draftCreate = method(req) === 'POST' && path === 'payroll/policies';
  const draftUpdate = route(req, 'PUT', new RegExp(`^payroll/policies/${ID}$`));
  if (draftCreate || draftUpdate) {
    const auth = await authorizeAfHomes(
      req,
      'finance.payroll_policy',
      draftCreate ? 'create' : 'update',
    );
    if ('error' in auth) return (deny(res, auth), true);
    const p = policyDraftInputSchema.safeParse(jsonBody(req));
    if (!p.success)
      return invalid(
        'Check the policy figures: amounts are exact decimals, rates are between 0 and 1, dates are real, and the basis note needs at least 5 characters',
      );
    if (idempotencyKey && idempotencyKey.length > 100)
      return invalid('The Idempotency-Key header must be at most 100 characters');
    const r = await db.rpc('save_ist_compensation_policy_draft', {
      p_policy_id: draftUpdate ? draftUpdate[1]! : null,
      p_fields: p.data,
      p_actor_id: auth.userId,
      p_idempotency_key: draftCreate ? idempotencyKey : null,
    });
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(draftCreate ? 201 : 200).json({ policyId: String(r.data), status: 'draft' });
    return true;
  }

  const policyAction = route(
    req,
    'POST',
    new RegExp(`^payroll/policies/${ID}/(submit|return|approve|end)$`),
  );
  if (policyAction) {
    const policyId = policyAction[1]!;
    const act = policyAction[2]!;
    const auth = await authorizeAfHomes(
      req,
      act === 'submit' ? 'finance.payroll_policy' : 'finance.payroll_policy_approval',
      'update',
    );
    if ('error' in auth) return (deny(res, auth), true);
    let rpc: { fn: string; args: Record<string, unknown> };
    if (act === 'submit') {
      rpc = { fn: 'submit_ist_compensation_policy', args: { p_policy_id: policyId } };
    } else if (act === 'return') {
      const p = returnPolicyInputSchema.safeParse(jsonBody(req));
      if (!p.success) return invalid('Give a reason of at least 5 characters');
      rpc = {
        fn: 'return_ist_compensation_policy',
        args: { p_policy_id: policyId, p_reason: p.data.reason },
      };
    } else if (act === 'approve') {
      const p = approvePolicyInputSchema.safeParse(jsonBody(req));
      if (!p.success)
        return invalid(
          'Enter the approval document reference (3 to 500 characters) and a note of at least 5 characters',
        );
      rpc = {
        fn: 'approve_ist_compensation_policy',
        args: {
          p_policy_id: policyId,
          p_evidence_reference: p.data.evidenceReference,
          p_note: p.data.note,
        },
      };
    } else {
      const p = endPolicyInputSchema.safeParse(jsonBody(req));
      if (!p.success) return invalid('Enter a real end date and a note of at least 5 characters');
      rpc = {
        fn: 'end_ist_compensation_policy',
        args: {
          p_policy_id: policyId,
          p_effective_until: p.data.effectiveUntil,
          p_note: p.data.note,
        },
      };
    }
    const r = await db.rpc(rpc.fn, { ...rpc.args, p_actor_id: auth.userId });
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(200).json({ policyId, status: String(r.data) });
    return true;
  }

  const review = route(req, 'POST', new RegExp(`^payroll/lines/${ID}/review$`));
  if (review) {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'update');
    if ('error' in auth) return (deny(res, auth), true);
    const p = reviewPayrollLineInputSchema.safeParse(jsonBody(req));
    if (!p.success) return invalid('Give a review note of at least 5 characters');
    const r = await db.rpc('review_payroll_line', {
      p_line_id: review[1]!,
      p_note: p.data.note,
      p_actor_id: auth.userId,
    });
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(200).json({ lineId: review[1]!, status: String(r.data) });
    return true;
  }

  if (path === 'payroll/segments' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'view');
    if ('error' in auth) return (deny(res, auth), true);
    const period = payrollPeriodSchema.safeParse(req.query.period);
    if (!period.success) return invalid('Choose a payroll month (YYYY-MM)');
    const r = await db.rpc('payroll_policy_segments', {
      p_period: period.data,
      p_actor_id: auth.userId,
    });
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(200).json(r.data);
    return true;
  }

  if (path === 'payroll/batches' && method(req) === 'GET') {
    const auth = await viewer(req);
    if ('error' in auth) return (deny(res, auth), true);
    const period = req.query.period;
    let q = db.from('payroll_batches').select('*');
    if (typeof period === 'string' && period) {
      if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)) return invalid('Invalid period');
      q = q.eq('period', period);
    }
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    list(res, ((data ?? []) as Record<string, unknown>[]).map(toBatch));
    return true;
  }

  if (path === 'payroll/approvals' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'finance.payroll_approval', 'view');
    if ('error' in auth) return (deny(res, auth), true);
    const { data, error } = await db.rpc('pending_payroll_approvals', { p_actor_id: auth.userId });
    if (error) return (mapRpcError(res, error), true);
    // The RPC lists live batches only (permission already checked above). Submitted
    // simulations are appended, labelled, so demo batches can be approved too.
    const sims = await db
      .from('payroll_batches')
      .select('*')
      .eq('status', 'submitted')
      .eq('mode', 'simulation');
    if (sims.error) throw sims.error;
    const live = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      batchId: r.pending_batch_id,
      period: r.pending_period,
      lineCount: r.pending_line_count,
      computedLineCount: r.pending_computed_count,
      totalNet: r.pending_total_net,
      submittedBy: str(r.pending_submitted_by),
      submittedAt: isoOrNull(r.pending_submitted_at),
      mode: 'live' as const,
      simulationBasis: null,
    }));
    const simulated = ((sims.data ?? []) as Record<string, unknown>[])
      .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))
      .map((r) => ({
        batchId: r.id,
        period: r.period,
        lineCount: r.line_count,
        computedLineCount: r.computed_line_count,
        // A simulation figure, never a payable total.
        totalNet: r.simulation_total_net ?? '0.00',
        submittedBy: str(r.submitted_by),
        submittedAt: isoOrNull(r.submitted_at),
        mode: 'simulation' as const,
        simulationBasis: str(r.simulation_basis),
      }));
    list(res, [...live, ...simulated]);
    return true;
  }

  const calculation = route(req, 'GET', new RegExp(`^payroll/lines/${ID}/calculation$`));
  if (calculation) {
    const auth = await viewer(req);
    if ('error' in auth) return (deny(res, auth), true);
    const saved = await db
      .from('payroll_lines')
      .select('id,batch_id,inputs,result')
      .eq('id', calculation[1]!)
      .maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) return (fail(res, 'NOT_FOUND', 'Payroll line not found.', 404), true);
    const batch = await db
      .from('payroll_batches')
      .select('id,period,mode')
      .eq('id', saved.data.batch_id)
      .maybeSingle();
    if (batch.error) throw batch.error;
    if (!batch.data) return (fail(res, 'NOT_FOUND', 'Payroll batch not found.', 404), true);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(
      payrollLineCalculationSchema.parse({
        lineId: saved.data.id,
        batchId: saved.data.batch_id,
        period: batch.data.period,
        mode: batch.data.mode,
        inputs: saved.data.inputs ?? {},
        result: saved.data.result ?? {},
      }),
    );
    return true;
  }

  const detail = route(req, 'GET', new RegExp(`^payroll/batches/${ID}$`));
  if (detail) {
    const auth = await viewer(req);
    if ('error' in auth) return (deny(res, auth), true);
    const out = await loadDetail(db, detail[1]!);
    if (!out) return (fail(res, 'NOT_FOUND', 'Payroll batch not found.', 404), true);
    res.status(200).json(out);
    return true;
  }

  // Generate the live draft / a labelled simulation: create, compute with the engine, store lines.
  const generate = method(req) === 'POST' && path === 'payroll/batches';
  const simulate = method(req) === 'POST' && path === 'payroll/simulations';
  if (generate || simulate) {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'create');
    if ('error' in auth) return (deny(res, auth), true);
    const body = jsonBody(req);
    const parsedLive = generate ? generatePayrollDraftSchema.safeParse(body) : null;
    const parsedSim = simulate ? simulatePayrollSchema.safeParse(body) : null;
    if (parsedLive && !parsedLive.success) return invalid('Choose a payroll month (YYYY-MM)');
    if (parsedSim && !parsedSim.success)
      return invalid(
        'A simulation needs a month, a source description of at least 10 characters, and valid reference policy figures',
      );
    const period = (parsedLive?.data ?? parsedSim!.data!).period;
    const staffList = await roster(db);

    let lines: LineDraft[];
    if (parsedSim) {
      const sim = parsedSim.data!;
      const supplied = new Map(sim.lines.map((l) => [l.staffId, l]));
      if (supplied.size !== sim.lines.length) return invalid('A staff member is listed twice');
      for (const id of supplied.keys())
        if (!staffList.some((s) => s.staffId === id))
          return invalid('A simulation line names someone who is not an active IST');
      try {
        lines = staffList.map((staff) => {
          const input = supplied.get(staff.staffId);
          const snap = sim.policySnapshot[staff.rank];
          if (!input || !snap)
            return blockedLine(
              staff,
              'CONFIGURATION_REQUIRED: no simulation inputs or reference policy supplied for this IST',
            );
          const policy: IstCompensationPolicy = { ...snap, rank: staff.rank };
          const result = calculateIstPayroll({
            month: period,
            rank: staff.rank,
            contractStart: input.contractStart,
            contractEnd: input.contractEnd ?? null,
            suspendedFrom: input.suspendedFrom ?? null,
            policy,
            qp: input.qp,
            ep: input.ep,
            qpBaApproved: input.qpBaApproved,
            baWithheld: input.baWithheld,
            authorizedAdjustments: input.authorizedAdjustments,
          });
          return lineFromResult(
            staff,
            result,
            null,
            { month: period, policySnapshot: snap, ...input },
            'SIMULATION_INPUT_BLOCKED',
          );
        });
      } catch {
        return invalid('Simulation inputs are not valid dates or amounts');
      }
    } else {
      lines = [];
    }

    const created = await db.rpc('create_payroll_batch', {
      p_period: period,
      p_actor_id: auth.userId,
      p_mode: simulate ? 'simulation' : 'live',
      p_simulation_basis: parsedSim ? parsedSim.data!.simulationBasis : null,
    });
    if (created.error) return (mapRpcError(res, created.error), true);
    const batchId = String(created.data);
    if (!parsedSim) {
      try {
        lines = await liveLines(db, period, staffList, auth.userId);
      } catch (e) {
        if (e instanceof RpcFailure) return (mapRpcError(res, e.error), true);
        throw e;
      }
    }
    const replaced = await db.rpc('replace_payroll_batch_lines', {
      p_batch_id: batchId,
      p_lines: lines,
      p_actor_id: auth.userId,
    });
    if (replaced.error) return (mapRpcError(res, replaced.error), true);
    const out = await loadDetail(db, batchId);
    res.status(201).json(out ?? { id: batchId });
    return true;
  }

  const action = route(
    req,
    'POST',
    new RegExp(`^payroll/batches/${ID}/(submit|approve|return|close)$`),
  );
  if (action) {
    const batchId = action[1]!;
    const auth =
      action[2] === 'close'
        ? await authorizeAfHomes(req, 'finance.payroll_close', 'update')
        : action[2] === 'submit'
          ? await authorizeAfHomes(req, 'finance.payroll', 'update')
          : await authorizeAfHomes(req, 'finance.payroll_approval', 'update');
    if ('error' in auth) return (deny(res, auth), true);
    if (action[2] === 'return') {
      const p = returnPayrollBatchSchema.safeParse(jsonBody(req));
      if (!p.success) return invalid('Give a reason of at least 5 characters');
      const r = await db.rpc('return_payroll_batch', {
        p_batch_id: batchId,
        p_reason: p.data.reason,
        p_actor_id: auth.userId,
      });
      if (r.error) return (mapRpcError(res, r.error), true);
      res.status(200).json({ id: batchId, status: r.data, mode: await batchMode(db, batchId) });
      return true;
    }
    const fn = {
      submit: 'submit_payroll_batch',
      approve: 'approve_payroll_batch',
      close: 'close_payroll_batch',
    }[action[2] as 'submit' | 'approve' | 'close'];
    const r = await db.rpc(fn, { p_batch_id: batchId, p_actor_id: auth.userId });
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(200).json({ id: batchId, status: r.data, mode: await batchMode(db, batchId) });
    return true;
  }

  // Live and simulated payouts have separate routes; a line is never sent to the wrong RPC.
  const disburseSim = route(
    req,
    'POST',
    new RegExp(`^payroll/simulations/lines/${ID}/disbursements$`),
  );
  const disburse =
    disburseSim ?? route(req, 'POST', new RegExp(`^payroll/lines/${ID}/disbursements$`));
  if (disburse) {
    const auth = await authorizeAfHomes(req, 'finance.payroll', 'update');
    if ('error' in auth) return (deny(res, auth), true);
    const p = payrollDisbursementRequestSchema.safeParse(jsonBody(req));
    if (!p.success)
      return invalid('Enter the amount, method, bank reference and a real payment date');
    const mode = await lineMode(db, disburse[1]!);
    if (!mode) return (fail(res, 'NOT_FOUND', 'Payroll line not found.', 404), true);
    if (disburseSim && mode !== 'simulation')
      return (
        fail(res, 'CONFLICT', 'This payroll line belongs to a live batch, not a simulation.', 409),
        true
      );
    if (!disburseSim && mode === 'simulation')
      return (
        fail(
          res,
          'CONFLICT',
          'This line belongs to a simulation. Use the simulation payout action.',
          409,
        ),
        true
      );
    if (!disburseSim && !p.data.proofReference)
      return invalid('A live external payment requires a supporting proof reference');
    const r = await db.rpc(
      disburseSim ? 'record_payroll_simulation_disbursement' : 'record_payroll_disbursement',
      {
        p_line_id: disburse[1]!,
        p_amount: p.data.amount,
        p_method: p.data.method,
        p_bank_reference: p.data.bankReference,
        p_paid_on: p.data.paidOn,
        p_actor_id: auth.userId,
        ...(!disburseSim && p.data.proofReference
          ? { p_proof_reference: p.data.proofReference }
          : {}),
      },
    );
    if (r.error) return (mapRpcError(res, r.error), true);
    res.status(201).json({ id: r.data, mode });
    return true;
  }

  return false;
}
