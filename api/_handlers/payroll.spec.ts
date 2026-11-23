/**
 * IST payroll routes (queues family). SQL owns the lifecycle and the governing
 * gate; these tests pin who may call what, that the actor is always the session,
 * that the gate refusal is readable (never a 500), that simulation requests are
 * validated, and that live drafts never carry money without an approved policy.
 */
import {
  istEngagementSchema,
  istPerformanceRuleSchema,
  istPeriodPerformanceSchema,
  istStaffPerformanceEvidenceSchema,
  payrollBatchActionResultSchema,
  payrollBatchDetailSchema,
  payrollGateSchema,
  payrollLineReviewResultSchema,
  payrollPoliciesResponseSchema,
  payrollPolicySegmentsSchema,
  policyActionResultSchema,
  payrollRosterEntrySchema,
  pendingPayrollApprovalSchema,
} from '@afhomes/contracts';
import { calculateIstPayroll } from '@afhomes/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ROLE2,
  TOKEN,
  TOKEN2,
  STAFF2,
  UUID,
  moduleId,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const queues = (await import('./queues.js')).default;

const AA: Record<string, string> = {
  [STAFF2.salesManager]: 'AA-K7Q2M9T4B1R8',
  [STAFF2.viceDirector]: 'AAI26100001',
  [STAFF2.ost]: 'AAO26100002',
};
const BATCH = '40404040-0000-4000-8000-0000000000b1';
const LINE = '40404040-0000-4000-8000-0000000000c1';

const batchRow = (over: Record<string, unknown> = {}) => ({
  id: BATCH,
  period: '2026-10',
  mode: 'live',
  simulation_basis: null,
  simulation_total_net: null,
  status: 'draft',
  total_ba: '0.00',
  total_pa: '0.00',
  total_pb: '0.00',
  total_adjustments: '0.00',
  total_withheld: '0.00',
  total_net: '0.00',
  line_count: 1,
  computed_line_count: 0,
  blocked_line_count: 1,
  created_by: STAFF2.finance,
  created_at: '2026-11-01T00:00:00.000Z',
  submitted_by: null,
  submitted_at: null,
  decided_by: null,
  decided_at: null,
  return_reason: null,
  closed_by: null,
  closed_at: null,
  ...over,
});
const lineRow = {
  id: LINE,
  batch_id: BATCH,
  staff_id: STAFF2.salesManager,
  rank: 'SM',
  status: 'blocked',
  blocked_reason: 'CONFIGURATION_REQUIRED: none',
  policy_id: null,
  ba: null,
  pa: null,
  pb: null,
  adjustments: null,
  withheld: null,
  net: null,
  inputs: {},
  result: {},
};

function withPayrollModules(tables: ReturnType<typeof phase2World>) {
  const keys = [
    'finance.payroll',
    'finance.payroll_approval',
    'finance.payroll_close',
    'finance.payroll_policy',
    'finance.payroll_policy_approval',
  ];
  const modules = tables.modules as Record<string, unknown>[];
  keys.forEach((key, index) =>
    modules.push({
      id: moduleId(key),
      key,
      name: key,
      group_name: 'Finance',
      sort_order: 45 + index,
      is_active: true,
    }),
  );
  (tables.role_permissions as Record<string, unknown>[]).push({
    role_id: ROLE2.finance,
    module_id: moduleId('finance.payroll'),
    can_view: true,
    can_create: true,
    can_update: true,
    can_delete: false,
  });
  return tables;
}

const SIM = {
  mode: 'simulation',
  simulation_basis: 'Historical reference fixture, not approved',
  simulation_total_net: '9000.00',
};
const DISB_BODY = {
  amount: '1000.00',
  method: 'Bank transfer',
  bankReference: 'REF-123',
  paidOn: '2026-11-10',
};

const RPCS = [
  'create_payroll_batch',
  'replace_payroll_batch_lines',
  'submit_payroll_batch',
  'approve_payroll_batch',
  'return_payroll_batch',
  'record_payroll_disbursement',
  'pending_payroll_approvals',
  'record_payroll_simulation_disbursement',
  'close_payroll_batch',
  'ist_compensation_policy_states',
  'save_ist_compensation_policy_draft',
  'submit_ist_compensation_policy',
  'return_ist_compensation_policy',
  'approve_ist_compensation_policy',
  'end_ist_compensation_policy',
  'review_payroll_line',
  'payroll_policy_segments',
  'ist_period_performance',
  'ist_staff_performance_evidence',
  'save_ist_engagement_draft',
  'submit_ist_engagement',
  'return_ist_engagement',
  'approve_ist_engagement',
  'end_ist_engagement',
  'save_ist_performance_rule_draft',
  'submit_ist_performance_rule',
  'return_ist_performance_rule',
  'approve_ist_performance_rule',
  'end_ist_performance_rule',
];

const ENG_ID = '40404040-0000-4000-8000-0000000000f1';
const RULE_ID = '40404040-0000-4000-8000-0000000000f2';
const ROSTER: [string, 'SM' | 'SSM' | 'SVD'][] = [
  [STAFF2.salesManager, 'SM'],
  [STAFF2.seniorSalesManager, 'SSM'],
  [STAFF2.viceDirector, 'SVD'],
];
/** Default performance document: no rule approved, so every roster member is BLOCKED with zero money. */
const blockedPerfDoc = (period: string) => ({
  period,
  ruleId: null,
  ruleVersion: null,
  ruleBlocker: 'RULE_NOT_APPROVED',
  staff: ROSTER.map(([staffId, rank]) => ({
    staffId,
    rank,
    contractStart: null,
    contractEnd: null,
    suspendedFrom: null,
    kpi: '0.00',
    collection: '0.00',
    verifiedCash: '0.00',
    assumedCredit: '0.00',
    approvedAdjustmentsTotal: '0.00',
    proposedAdjustmentsTotal: '0.00',
    status: 'BLOCKED',
    blockers: ['RULE_NOT_APPROVED', 'MISSING_ENGAGEMENT'],
    evidenceHash: 'f'.repeat(64),
    evidenceCount: 0,
    ruleId: null,
    ruleVersion: null,
    engagementId: null,
  })),
});

const POLICY_ID = '40404040-0000-4000-8000-0000000000e9';
const STATES = [
  {
    policyId: POLICY_ID,
    rank: 'SM',
    policyVersion: 1,
    status: 'approved',
    lifecycle: 'active',
    lastFinalizedPeriod: null,
  },
];
const segmentsFor = (
  period: string,
  policies: Record<string, unknown>[],
  override?: Record<string, unknown>,
) =>
  override ?? {
    period,
    transitionRuleApproved: false,
    ranks: ['SM', 'SSM', 'SVD'].map((rank) => {
      const p = policies.find((x) => x.rank === rank && x.status === 'approved');
      return {
        rank,
        period,
        monthStart: `${period}-01`,
        monthEnd: `${period}-28`,
        singlePolicy: Boolean(p),
        transition: false,
        segments: [
          {
            from: `${period}-01`,
            to: `${period}-28`,
            days: 28,
            policyId: p ? String(p.id) : null,
            policyVersion: p ? 1 : null,
          },
        ],
      };
    }),
  };

async function call(opts: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  query?: Record<string, string>;
  gate?: 'pending' | 'approved';
  rpcError?: { fn: string; message: string; details?: string };
  headers?: Record<string, string>;
  grantFinance?: string[];
  gateRow?: Record<string, unknown>;
  segments?: Record<string, unknown>;
  policies?: Record<string, unknown>[];
  deactivate?: string[];
  batch?: Record<string, unknown>;
  savedLine?: Record<string, unknown>;
  simDisbursements?: Record<string, unknown>[];
  liveDisbursements?: Record<string, unknown>[];
  perf?: Record<string, unknown>;
  evidence?: Record<string, Record<string, unknown>>;
  engagements?: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
}) {
  const tables = withPayrollModules(
    phase2World({
      governing_policy_decisions: [
        {
          key: 'Q1_GOVERNING_COMPENSATION_MODEL',
          status: opts.gate ?? 'pending',
          note: null,
          ...opts.gateRow,
        },
      ],
      payroll_batches: [batchRow(opts.batch ?? {})],
      payroll_lines: [{ ...lineRow, ...opts.savedLine }],
      payroll_disbursements: opts.liveDisbursements ?? [],
      payroll_simulation_disbursements: opts.simDisbursements ?? [],
      ist_compensation_policies: opts.policies ?? [],
      ist_engagements: opts.engagements ?? [],
      ist_performance_rules: opts.rules ?? [],
    }),
  );
  for (const k of opts.grantFinance ?? [])
    (tables.role_permissions as Record<string, unknown>[]).push({
      role_id: ROLE2.finance,
      module_id: moduleId(k),
      can_view: true,
      can_create: true,
      can_update: true,
      can_delete: false,
    });
  for (const s of (tables.staff_users as Record<string, unknown>[]).filter((u) =>
    (opts.deactivate ?? []).includes(String(u.id)),
  ))
    s.status = 'inactive';
  holder.db = new FakeSupabase({
    tables,
    tokens: phase2WorldTokens(),
    rpcs: [
      {
        fn: 'get_sale_team_accreditation',
        result: (args: Record<string, unknown>) => {
          const aa = AA[String(args.p_staff_id)];
          return aa
            ? {
                aaNumber: aa,
                kind: 'IST',
                fullName: 'SYNTHETIC',
                status: 'accredited',
                startsOn: '2026-01-01',
                expiresOn: '2027-12-31',
              }
            : null;
        },
      },
      { fn: 'create_payroll_batch', result: BATCH },
      { fn: 'replace_payroll_batch_lines', result: {} },
      { fn: 'submit_payroll_batch', result: 'submitted' },
      { fn: 'approve_payroll_batch', result: 'approved' },
      { fn: 'return_payroll_batch', result: 'returned' },
      { fn: 'record_payroll_disbursement', result: '40404040-0000-4000-8000-0000000000d1' },
      {
        fn: 'record_payroll_simulation_disbursement',
        result: '40404040-0000-4000-8000-0000000000d2',
      },
      { fn: 'close_payroll_batch', result: 'closed' },
      { fn: 'ist_compensation_policy_states', result: STATES },
      { fn: 'save_ist_compensation_policy_draft', result: POLICY_ID },
      { fn: 'submit_ist_compensation_policy', result: 'pending_approval' },
      { fn: 'return_ist_compensation_policy', result: 'draft' },
      { fn: 'approve_ist_compensation_policy', result: 'approved' },
      { fn: 'end_ist_compensation_policy', result: 'ended' },
      { fn: 'review_payroll_line', result: 'reviewed' },
      { fn: 'reconcile_payroll_disbursement', result: LINE },
      {
        fn: 'ist_period_performance',
        result: (args: Record<string, unknown>) =>
          opts.perf ?? blockedPerfDoc(String(args.p_period)),
      },
      {
        fn: 'ist_staff_performance_evidence',
        result: (args: Record<string, unknown>) =>
          opts.evidence?.[String(args.p_staff_id)] ?? {
            period: args.p_period,
            staffId: args.p_staff_id,
            summary: null,
            items: [],
          },
      },
      { fn: 'save_ist_engagement_draft', result: ENG_ID },
      { fn: 'submit_ist_engagement', result: 'pending_approval' },
      { fn: 'return_ist_engagement', result: 'draft' },
      { fn: 'approve_ist_engagement', result: 'approved' },
      { fn: 'end_ist_engagement', result: 'ended' },
      { fn: 'save_ist_performance_rule_draft', result: RULE_ID },
      { fn: 'submit_ist_performance_rule', result: 'pending_approval' },
      { fn: 'return_ist_performance_rule', result: 'draft' },
      { fn: 'approve_ist_performance_rule', result: 'approved' },
      { fn: 'end_ist_performance_rule', result: 'ended' },
      {
        fn: 'payroll_policy_segments',
        result: (args: Record<string, unknown>) =>
          segmentsFor(String(args.p_period), opts.policies ?? [], opts.segments),
      },
      {
        fn: 'pending_payroll_approvals',
        result: [
          {
            pending_batch_id: BATCH,
            pending_period: '2026-10',
            pending_line_count: 2,
            pending_computed_count: 2,
            pending_total_net: '10000.00',
            pending_submitted_by: STAFF2.finance,
            pending_submitted_at: '2026-11-02T00:00:00.000Z',
          },
        ],
      },
    ],
    rpcErrors: opts.rpcError
      ? {
          [opts.rpcError.fn]: {
            message: opts.rpcError.message,
            ...(opts.rpcError.details ? { details: opts.rpcError.details } : {}),
          } as { message: string },
        }
      : {},
  });
  const { res, state } = makeRes();
  await queues(
    makeReq({
      method: opts.method,
      familyPath: opts.path,
      body: opts.body,
      token: opts.token,
      query: opts.query,
      headers: opts.headers,
    }) as never,
    res as never,
  );
  const db = holder.db as FakeSupabase;
  return {
    state,
    rpc: (fn: string) => db.calls.filter((c) => c.op === 'rpc' && c.table === fn),
    anyRpc: () => db.calls.filter((c) => c.op === 'rpc' && RPCS.includes(c.table)),
  };
}

const SNAP = {
  version: 'ref-fixture',
  monthlyBa: '10000.00',
  baTarget: '100000.00',
  monthlyPa: '5000.00',
  paTarget: '200000.00',
  pbTarget: '300000.00',
  pbRate: '0.01',
  collectionGate: '0.40',
};
const simBody = (over: Record<string, unknown> = {}) => ({
  period: '2026-10',
  simulationBasis: 'Historical reference fixture, not approved',
  policySnapshot: { SM: SNAP },
  lines: [
    {
      staffId: STAFF2.salesManager,
      contractStart: '2026-01-01',
      qp: { kpi: '0.00', collection: '0.00' },
      ep: { kpi: '400000.00', collection: '400000.00' },
      qpBaApproved: false,
    },
  ],
  ...over,
});

describe('IST payroll gate and reads', () => {
  it('exposes the gate read-only and pending by default', async () => {
    const out = await call({ method: 'GET', path: 'payroll/gate', token: TOKEN2.finance });
    expect(out.state.status).toBe(200);
    const gate = payrollGateSchema.parse(out.state.body);
    expect(gate).toMatchObject({
      q1Status: 'pending',
      liveAuthorized: false,
      q1Source: null,
      q1DecisionOption: null,
      q1EvidenceStatus: null,
      q1EffectiveDate: null,
    });
    const approved = await call({
      method: 'GET',
      path: 'payroll/gate',
      token: TOKEN.superAdmin,
      gate: 'approved',
    });
    expect(payrollGateSchema.parse(approved.state.body).liveAuthorized).toBe(true);
    const post = await call({ method: 'POST', path: 'payroll/gate', token: TOKEN.superAdmin });
    expect(post.state.status).toBeGreaterThanOrEqual(400);
  });

  it('lists batches and returns a batch with lines in the contract shape', async () => {
    const l = await call({
      method: 'GET',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
    });
    expect(l.state.status).toBe(200);
    expect((l.state.body as { data: unknown[] }).data).toHaveLength(1);
    const d = await call({
      method: 'GET',
      path: `payroll/batches/${BATCH}`,
      token: TOKEN2.finance,
    });
    expect(d.state.status).toBe(200);
    const parsed = payrollBatchDetailSchema.parse(d.state.body);
    expect(parsed.lines[0]).toMatchObject({
      status: 'blocked',
      net: null,
      staffName: 'Sales Manager',
    });
  });

  it('lists pending approvals only for the approval authority', async () => {
    const ok = await call({ method: 'GET', path: 'payroll/approvals', token: TOKEN.superAdmin });
    expect(ok.state.status).toBe(200);
    pendingPayrollApprovalSchema.parse((ok.state.body as { data: unknown[] }).data[0]);
    expect(ok.rpc('pending_payroll_approvals')[0]!.arg).toEqual({
      p_actor_id: UUID.superAdminStaff,
    });
    const no = await call({ method: 'GET', path: 'payroll/approvals', token: TOKEN2.finance });
    expect(no.state.status).toBe(403);
    expect(no.anyRpc()).toHaveLength(0);
  });
});

describe('IST payroll workflow permissions', () => {
  it('lets Finance submit and record a disbursement with the session actor', async () => {
    const submit = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/submit`,
      token: TOKEN2.finance,
      body: { actorId: UUID.superAdminStaff },
    });
    expect(submit.state.status).toBe(200);
    expect(submit.rpc('submit_payroll_batch')[0]!.arg).toEqual({
      p_batch_id: BATCH,
      p_actor_id: STAFF2.finance,
    });
    const pay = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: {
        amount: '1000.00',
        method: 'Bank transfer',
        bankReference: 'REF-123',
        paidOn: '2026-11-10',
        proofReference: 'TEST ONLY payment proof',
      },
    });
    expect(pay.state.status).toBe(201);
    expect(pay.rpc('record_payroll_disbursement')[0]!.arg).toMatchObject({
      p_line_id: LINE,
      p_amount: '1000.00',
      p_actor_id: STAFF2.finance,
      p_proof_reference: 'TEST ONLY payment proof',
    });
    const missingProof = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: {
        amount: '1000.00',
        method: 'Bank transfer',
        bankReference: 'REF-123',
        paidOn: '2026-11-10',
      },
    });
    expect(missingProof.state.status).toBe(400);
    expect(missingProof.anyRpc()).toHaveLength(0);
    const bad = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: { amount: '1000.00', method: 'Bank', bankReference: 'REF-123', paidOn: '2026-02-30' },
    });
    expect(bad.state.status).toBe(400);
    expect(bad.anyRpc()).toHaveLength(0);
  });

  it('refuses Finance approve and return', async () => {
    for (const action of ['approve', 'return']) {
      const out = await call({
        method: 'POST',
        path: `payroll/batches/${BATCH}/${action}`,
        token: TOKEN2.finance,
        body: { reason: 'Needs another look' },
      });
      expect(out.state.status, action).toBe(403);
      expect(out.anyRpc(), action).toHaveLength(0);
    }
  });

  it('lets the approval authority approve and return, validating the reason', async () => {
    const ok = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/approve`,
      token: TOKEN.superAdmin,
    });
    expect(ok.state.status).toBe(200);
    expect(ok.rpc('approve_payroll_batch')[0]!.arg).toEqual({
      p_batch_id: BATCH,
      p_actor_id: UUID.superAdminStaff,
    });
    const short = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/return`,
      token: TOKEN.superAdmin,
      body: { reason: 'no' },
    });
    expect(short.state.status).toBe(400);
    expect(short.anyRpc()).toHaveLength(0);
    const ret = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/return`,
      token: TOKEN.superAdmin,
      body: { reason: 'Totals look wrong' },
    });
    expect(ret.state.status).toBe(200);
    expect(ret.rpc('return_payroll_batch')[0]!.arg).toMatchObject({
      p_reason: 'Totals look wrong',
      p_actor_id: UUID.superAdminStaff,
    });
  });

  it('refuses submission and approval when the database detects changed evidence', async () => {
    for (const action of ['submit', 'approve']) {
      const out = await call({
        method: 'POST',
        path: `payroll/batches/${BATCH}/${action}`,
        token: action === 'submit' ? TOKEN2.finance : TOKEN.superAdmin,
        rpcError: { fn: `${action}_payroll_batch`, message: 'PAYROLL_EVIDENCE_CHANGED' },
      });
      expect(out.state.status, action).toBe(409);
      expect(out.state.body).toMatchObject({ error: { code: 'CONFLICT' } });
      expect(JSON.stringify(out.state.body)).toContain('Regenerate the draft');
    }
  });

  it('maps self-approval to 403 and the governing gate to a readable non-500', async () => {
    const self = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/approve`,
      token: TOKEN.superAdmin,
      rpcError: { fn: 'approve_payroll_batch', message: 'PAYROLL_SELF_APPROVAL' },
    });
    expect(self.state.status).toBe(403);
    const gated = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-10' },
      rpcError: { fn: 'create_payroll_batch', message: 'IST_PAYROLL_NOT_AUTHORIZED' },
    });
    expect(gated.state.status).toBe(409);
    expect(JSON.stringify(gated.state.body)).toContain('Presidential approval');
    expect(gated.rpc('replace_payroll_batch_lines')).toHaveLength(0);
  });

  it('gives a sales role nothing', async () => {
    for (const [method, path] of [
      ['GET', 'payroll/gate'],
      ['GET', 'payroll/batches'],
      ['GET', `payroll/batches/${BATCH}`],
      ['GET', 'payroll/approvals'],
      ['GET', 'payroll/roster'],
      ['GET', 'payroll/policies'],
      ['POST', 'payroll/batches'],
      ['POST', 'payroll/simulations'],
      ['POST', `payroll/batches/${BATCH}/submit`],
      ['POST', `payroll/batches/${BATCH}/approve`],
      ['POST', `payroll/lines/${LINE}/disbursements`],
      ['POST', `payroll/simulations/lines/${LINE}/disbursements`],
      ['POST', `payroll/batches/${BATCH}/close`],
      ['POST', 'payroll/policies'],
      ['PUT', `payroll/policies/${POLICY_ID}`],
      ['POST', `payroll/policies/${POLICY_ID}/submit`],
      ['POST', `payroll/policies/${POLICY_ID}/return`],
      ['POST', `payroll/policies/${POLICY_ID}/approve`],
      ['POST', `payroll/policies/${POLICY_ID}/end`],
      ['POST', `payroll/lines/${LINE}/review`],
      ['GET', 'payroll/segments'],
    ] as const) {
      const out = await call({ method, path, token: TOKEN2.salesManager, body: {} });
      expect(out.state.status, path).toBe(403);
      expect(out.anyRpc(), path).toHaveLength(0);
    }
  });
});

describe('IST payroll close and simulation workflow', () => {
  it('requires closing authority and evidence to reconcile a recorded payment', async () => {
    const body = {
      note: 'Reviewed actual payment against retained entitlement',
      evidenceReference: 'TEST ONLY reconciliation document',
    };
    const denied = await call({
      method: 'POST',
      path: `payroll/disbursements/${LINE}/reconcile`,
      token: TOKEN2.finance,
      body,
    });
    expect(denied.state.status).toBe(403);
    const ok = await call({
      method: 'POST',
      path: `payroll/disbursements/${LINE}/reconcile`,
      token: TOKEN.superAdmin,
      body,
    });
    expect(ok.state.status).toBe(200);
    expect(ok.rpc('reconcile_payroll_disbursement')[0]!.arg).toEqual({
      p_disbursement_id: LINE,
      p_note: body.note,
      p_evidence_reference: body.evidenceReference,
      p_actor_id: UUID.superAdminStaff,
    });
    const invalid = await call({
      method: 'POST',
      path: `payroll/disbursements/${LINE}/reconcile`,
      token: TOKEN.superAdmin,
      body: { ...body, evidenceReference: 'short' },
    });
    expect(invalid.state.status).toBe(400);
    expect(invalid.anyRpc()).toHaveLength(0);
  });
  it('labels submit, approve and return results with the batch mode', async () => {
    const live = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/submit`,
      token: TOKEN2.finance,
    });
    expect(payrollBatchActionResultSchema.parse(live.state.body)).toEqual({
      id: BATCH,
      status: 'submitted',
      mode: 'live',
    });
    const sim = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/submit`,
      token: TOKEN2.finance,
      batch: SIM,
    });
    expect(payrollBatchActionResultSchema.parse(sim.state.body)).toMatchObject({
      status: 'submitted',
      mode: 'simulation',
    });
    const appr = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/approve`,
      token: TOKEN.superAdmin,
      batch: SIM,
    });
    expect(payrollBatchActionResultSchema.parse(appr.state.body)).toMatchObject({
      status: 'approved',
      mode: 'simulation',
    });
    const ret = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/return`,
      token: TOKEN.superAdmin,
      body: { reason: 'Totals look wrong' },
      batch: SIM,
    });
    expect(payrollBatchActionResultSchema.parse(ret.state.body)).toMatchObject({
      status: 'returned',
      mode: 'simulation',
    });
  });

  it('closes a batch only for finance.payroll_close, with the session actor', async () => {
    const ok = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/close`,
      token: TOKEN.superAdmin,
      batch: SIM,
    });
    expect(ok.state.status).toBe(200);
    expect(payrollBatchActionResultSchema.parse(ok.state.body)).toEqual({
      id: BATCH,
      status: 'closed',
      mode: 'simulation',
    });
    expect(ok.rpc('close_payroll_batch')[0]!.arg).toEqual({
      p_batch_id: BATCH,
      p_actor_id: UUID.superAdminStaff,
    });
    const no = await call({
      method: 'POST',
      path: `payroll/batches/${BATCH}/close`,
      token: TOKEN2.finance,
    });
    expect(no.state.status).toBe(403);
    expect(no.anyRpc()).toHaveLength(0);
  });

  it('maps the new close and simulation codes without internals', async () => {
    const cases: [string, number, string][] = [
      ['PAYROLL_SELF_CLOSE', 403, 'The person who submitted this batch cannot close it.'],
      ['PAYROLL_BATCH_NOT_FULLY_DISBURSED', 409, 'Record every payout before closing this batch.'],
      ['PAYROLL_NOT_SIMULATION', 409, 'not a simulation'],
    ];
    for (const [code, status, text] of cases) {
      const out = await call({
        method: 'POST',
        path: `payroll/batches/${BATCH}/close`,
        token: TOKEN.superAdmin,
        rpcError: { fn: 'close_payroll_batch', message: code },
      });
      expect(out.state.status, code).toBe(status);
      const body = JSON.stringify(out.state.body);
      expect(body, code).toContain(text);
      expect(body, code).not.toContain(code);
    }
  });

  it('records a simulated payout only through the simulation RPC', async () => {
    const out = await call({
      method: 'POST',
      path: `payroll/simulations/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: DISB_BODY,
      batch: SIM,
    });
    expect(out.state.status).toBe(201);
    expect(out.state.body).toMatchObject({ mode: 'simulation' });
    expect(out.rpc('record_payroll_simulation_disbursement')[0]!.arg).toEqual({
      p_line_id: LINE,
      p_amount: '1000.00',
      p_method: 'Bank transfer',
      p_bank_reference: 'REF-123',
      p_paid_on: '2026-11-10',
      p_actor_id: STAFF2.finance,
    });
    expect(out.rpc('record_payroll_disbursement')).toHaveLength(0);
    const bad = await call({
      method: 'POST',
      path: `payroll/simulations/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: { ...DISB_BODY, paidOn: '2026-02-30' },
      batch: SIM,
    });
    expect(bad.state.status).toBe(400);
    expect(bad.anyRpc()).toHaveLength(0);
  });

  it('never sends a simulation line to the live RPC, nor a live line to the simulation RPC', async () => {
    const live = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: DISB_BODY,
      batch: SIM,
    });
    expect(live.state.status).toBe(409);
    expect(live.anyRpc()).toHaveLength(0);
    const sim = await call({
      method: 'POST',
      path: `payroll/simulations/lines/${LINE}/disbursements`,
      token: TOKEN2.finance,
      body: DISB_BODY,
    });
    expect(sim.state.status).toBe(409);
    expect(sim.anyRpc()).toHaveLength(0);
  });

  it('shows simulated payouts on simulation batch detail, labelled, and closed fields', async () => {
    const d = await call({
      method: 'GET',
      path: `payroll/batches/${BATCH}`,
      token: TOKEN2.finance,
      batch: {
        ...SIM,
        status: 'closed',
        closed_by: STAFF2.finance,
        closed_at: '2026-11-12T00:00:00.000Z',
      },
      simDisbursements: [
        {
          id: '40404040-0000-4000-8000-0000000000d2',
          line_id: LINE,
          amount: '1000.00',
          method: 'Bank transfer',
          bank_reference: 'REF-123',
          paid_on: '2026-11-10',
          recorded_by: STAFF2.finance,
          recorded_at: '2026-11-10T00:00:00.000Z',
        },
      ],
    });
    const parsed = payrollBatchDetailSchema.parse(d.state.body);
    expect(parsed).toMatchObject({
      mode: 'simulation',
      status: 'closed',
      closedBy: STAFF2.finance,
    });
    expect(parsed.closedAt).toBe('2026-11-12T00:00:00.000Z');
    expect(parsed.lines[0]!.disbursement).toMatchObject({ amount: '1000.00', simulation: true });
  });

  it('surfaces submitted simulations on approvals, labelled, alongside live ones', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/approvals',
      token: TOKEN.superAdmin,
      batch: {
        ...SIM,
        status: 'submitted',
        submitted_by: STAFF2.finance,
        submitted_at: '2026-11-03T00:00:00.000Z',
      },
    });
    const rows = (out.state.body as { data: unknown[] }).data.map((r) =>
      pendingPayrollApprovalSchema.parse(r),
    );
    expect(rows.map((r) => r.mode)).toEqual(['live', 'simulation']);
    expect(rows[1]).toMatchObject({
      batchId: BATCH,
      totalNet: '9000.00',
      simulationBasis: 'Historical reference fixture, not approved',
    });
    expect(rows[0]!.simulationBasis).toBeNull();
  });
});

describe('payroll reads are paged and chunked', () => {
  it('reads every page until a short one, so a response cap cannot hide rows', async () => {
    const { readAllPages } = await import('../_lib/payroll.js');
    const all = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
    const ranges: [number, number][] = [];
    const rows = await readAllPages(async (from, to) => {
      ranges.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(rows).toHaveLength(2500);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    // An exact multiple of the page size needs one more (empty) read to know it is done.
    const calls: number[] = [];
    const exact = await readAllPages(async (from) => {
      calls.push(from);
      return { data: from < 20 ? all.slice(from, from + 10) : [], error: null };
    }, 10);
    expect(exact).toHaveLength(20);
    expect(calls).toEqual([0, 10, 20]);
  });

  it('surfaces a page error instead of returning a partial list', async () => {
    const { readAllPages } = await import('../_lib/payroll.js');
    await expect(
      readAllPages(async () => ({ data: null, error: new Error('boom') })),
    ).rejects.toThrow('boom');
  });

  it('splits .in() lists into chunks of at most 100 ids', async () => {
    const { readInChunks } = await import('../_lib/payroll.js');
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const sizes: number[] = [];
    const rows = await readInChunks(ids, async (chunk) => {
      sizes.push(chunk.length);
      return { data: chunk.map((id) => ({ id })), error: null };
    });
    expect(sizes).toEqual([100, 100, 50]);
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(await readInChunks([], async () => ({ data: [], error: null }))).toEqual([]);
  });

  it('still serves the roster and a batch detail through the paged path', async () => {
    const out = await call({ method: 'GET', path: 'payroll/roster', token: TOKEN2.finance });
    expect(out.state.status).toBe(200);
    expect((out.state.body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    const d = await call({
      method: 'GET',
      path: `payroll/batches/${BATCH}`,
      token: TOKEN2.finance,
    });
    expect(payrollBatchDetailSchema.parse(d.state.body).lines).toHaveLength(1);
  });
});

type Rosterish = {
  id: string;
  rank: string;
  eligible: boolean;
  aaNumber: string | null;
  ineligibleReason?: string;
  name: string | null;
};
const rosterOf = (o: { state: { body: unknown } }) =>
  payrollRosterListSchema.parse((o.state.body as { data: unknown[] }).data) as Rosterish[];
const payrollRosterListSchema = z.array(payrollRosterEntrySchema);

describe('IST payroll roster picker', () => {
  it('is denied without payroll view permission and for sales roles', async () => {
    const out = await call({ method: 'GET', path: 'payroll/roster', token: TOKEN2.salesManager });
    expect(out.state.status).toBe(403);
  });

  it('lists SM, SSM and SVD (vice_director) but never OST or Finance', async () => {
    const out = await call({ method: 'GET', path: 'payroll/roster', token: TOKEN2.finance });
    expect(out.state.status).toBe(200);
    const rows = rosterOf(out);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.rank]))).toEqual({
      [STAFF2.salesManager]: 'SM',
      [STAFF2.seniorSalesManager]: 'SSM',
      [STAFF2.viceDirector]: 'SVD',
    });
    expect(rows.every((r) => r.eligible)).toBe(true);
    expect(rows.find((r) => r.id === STAFF2.salesManager)!.aaNumber).toBe('AA-K7Q2M9T4B1R8');
  });

  it('searches by name, staff id prefix and AA number', async () => {
    const byName = rosterOf(
      await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { q: 'vice dir' },
      }),
    );
    expect(byName.map((r) => r.id)).toEqual([STAFF2.viceDirector]);
    const byId = rosterOf(
      await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { q: '10101010-0000' },
      }),
    );
    expect(byId).toHaveLength(3);
    expect(byId.every((r) => r.id.startsWith('10101010-0000'))).toBe(true);
    const byFullId = rosterOf(
      await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { q: STAFF2.viceDirector },
      }),
    );
    expect(byFullId.map((r) => r.id)).toEqual([STAFF2.viceDirector]);
    const byAa = rosterOf(
      await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { q: 'aa-k7q2' },
      }),
    );
    expect(byAa.map((r) => r.id)).toEqual([STAFF2.salesManager]);
    const ost = rosterOf(
      await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { q: 'AAO26100002' },
      }),
    );
    expect(ost).toEqual([]);
  });

  it('treats LIKE wildcards literally and caps the limit', async () => {
    for (const q of ['%', '_', '*']) {
      const out = await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { q },
      });
      expect(rosterOf(out), q).toEqual([]);
    }
    const one = rosterOf(
      await call({
        method: 'GET',
        path: 'payroll/roster',
        token: TOKEN2.finance,
        query: { limit: '1' },
      }),
    );
    expect(one).toHaveLength(1);
    const big = await call({
      method: 'GET',
      path: 'payroll/roster',
      token: TOKEN2.finance,
      query: { limit: '9999' },
    });
    expect(big.state.status).toBe(200);
  });

  it('flags inactive IST staff as ineligible with a reason', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/roster',
      token: TOKEN2.finance,
      deactivate: [STAFF2.salesManager],
    });
    const sm = rosterOf(out).find((r) => r.id === STAFF2.salesManager)!;
    expect(sm).toMatchObject({ eligible: false });
    expect(sm.ineligibleReason).toMatch(/inactive/);
  });

  it('simulation POST still rejects inactive, non-IST and duplicate staff', async () => {
    const line = simBody().lines[0]!;
    const dup = await call({
      method: 'POST',
      path: 'payroll/simulations',
      token: TOKEN2.finance,
      body: simBody({ lines: [line, line] }),
    });
    expect(dup.state.status).toBe(400);
    const ost = await call({
      method: 'POST',
      path: 'payroll/simulations',
      token: TOKEN2.finance,
      body: simBody({ lines: [{ ...line, staffId: STAFF2.ost }] }),
    });
    expect(ost.state.status).toBe(400);
    const inactive = await call({
      method: 'POST',
      path: 'payroll/simulations',
      token: TOKEN2.finance,
      body: simBody(),
      deactivate: [STAFF2.salesManager],
    });
    expect(inactive.state.status).toBe(400);
    expect(inactive.anyRpc()).toHaveLength(0);
  });
});

describe('IST payroll policies view', () => {
  const POLICY = {
    id: '40404040-0000-4000-8000-0000000000e2',
    rank: 'SM',
    monthly_ba: '10000.00',
    ba_target: '100000.00',
    monthly_pa: '5000.00',
    pa_target: '200000.00',
    pb_target: '300000.00',
    pb_rate: '0.01',
    collection_gate: '0.40',
    effective_from: '2026-01-01',
    effective_until: null,
    status: 'draft',
    basis_note: 'Fixture draft only',
    created_by: STAFF2.finance,
    created_at: '2026-01-01T00:00:00.000Z',
    approved_by: null,
    approved_at: null,
  };

  it('lists policies in camelCase with money as text plus the Q1 gate', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/policies',
      token: TOKEN2.finance,
      policies: [POLICY],
    });
    expect(out.state.status).toBe(200);
    const parsed = payrollPoliciesResponseSchema.parse(out.state.body);
    expect(parsed.data[0]).toMatchObject({
      rank: 'SM',
      monthlyBa: '10000.00',
      status: 'draft',
      approvedBy: null,
    });
    expect(parsed.gate).toMatchObject({ q1Status: 'pending', liveAuthorized: false });
    expect(out.anyRpc().map((c) => c.table)).toEqual(['ist_compensation_policy_states']);
    expect(out.rpc('ist_compensation_policy_states')[0]!.arg).toEqual({
      p_actor_id: STAFF2.finance,
    });
  });

  it('is readable by the approval authority and empty by default', async () => {
    const out = await call({ method: 'GET', path: 'payroll/policies', token: TOKEN.superAdmin });
    expect(payrollPoliciesResponseSchema.parse(out.state.body).data).toEqual([]);
  });

  it('reports the current viewer approval conflict without exposing actor history', async () => {
    for (const prior of [
      { updated_by: UUID.superAdminStaff },
      { submitted_by: UUID.superAdminStaff },
      { prior_actor_ids: [UUID.superAdminStaff] },
      {},
    ]) {
      const out = await call({
        method: 'GET',
        path: 'payroll/policies',
        token: TOKEN.superAdmin,
        policies: [{ ...POLICY, ...prior }],
      });
      const data = payrollPoliciesResponseSchema.parse(out.state.body).data[0]!;
      expect(data.approvalConflict).toBe(Object.keys(prior).length > 0);
      expect(data).not.toHaveProperty('priorActorIds');
    }
  });

  it('merges the derived lifecycle into policy rows and returns the states', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/policies',
      token: TOKEN.superAdmin,
      policies: [{ ...POLICY, id: POLICY_ID, status: 'approved' }],
    });
    const parsed = payrollPoliciesResponseSchema.parse(out.state.body);
    expect(parsed.data[0]).toMatchObject({ lifecycle: 'active', lastFinalizedPeriod: null });
    expect(parsed.states).toEqual(STATES);
  });
});

describe('IST payroll generation', () => {
  it('blocks every live line with null money when no approved policy exists', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-10' },
      gate: 'approved',
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('create_payroll_batch')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
      p_mode: 'live',
      p_simulation_basis: null,
    });
    const lines = out.rpc('replace_payroll_batch_lines')[0]!.arg as {
      p_lines: Record<string, unknown>[];
    };
    expect(lines.p_lines.length).toBeGreaterThan(0);
    for (const l of lines.p_lines) {
      expect(l.status).toBe('blocked');
      expect(l.net).toBeUndefined();
      expect(l.ba).toBeUndefined();
      expect(String(l.blockedReason)).toMatch(/^CONFIGURATION_REQUIRED/);
      expect(String(l.blockedReason)).toContain('no approved compensation policy');
    }
    expect(lines.p_lines.map((l) => l.rank).sort()).toEqual(['SM', 'SSM', 'SVD']);
  });

  it('still blocks live lines when a policy exists, because performance inputs are not derivable', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-10' },
      gate: 'approved',
      policies: [
        {
          id: '40404040-0000-4000-8000-0000000000e1',
          rank: 'SM',
          status: 'approved',
          monthly_ba: '10000.00',
          ba_target: '1.00',
          monthly_pa: '1.00',
          pa_target: '1.00',
          pb_target: '1.00',
          pb_rate: '0.01',
          collection_gate: '0.40',
          effective_from: '2026-01-01',
          effective_until: null,
        },
      ],
    });
    const lines = out.rpc('replace_payroll_batch_lines')[0]!.arg as {
      p_lines: Record<string, unknown>[];
    };
    const sm = lines.p_lines.find((l) => l.rank === 'SM')!;
    expect(sm.status).toBe('blocked');
    expect(sm.net).toBeUndefined();
    expect(String(sm.blockedReason)).toContain('RULE_NOT_APPROVED');
    expect(String(sm.blockedReason)).toContain('MISSING_ENGAGEMENT');
    expect((sm.inputs as Record<string, unknown>).evidenceHash).toBe('f'.repeat(64));
  });

  it('creates a labelled simulation with engine figures and the policy snapshot in inputs', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/simulations',
      token: TOKEN2.finance,
      body: simBody(),
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('create_payroll_batch')[0]!.arg).toMatchObject({
      p_mode: 'simulation',
      p_simulation_basis: 'Historical reference fixture, not approved',
    });
    const lines = (
      out.rpc('replace_payroll_batch_lines')[0]!.arg as { p_lines: Record<string, unknown>[] }
    ).p_lines;
    const sm = lines.find((l) => l.rank === 'SM')!;
    expect(sm.status).toBe('computed');
    expect(sm.policyId).toBeNull();
    expect((sm.inputs as Record<string, unknown>).policySnapshot).toEqual(SNAP);
    expect(sm.net).toMatch(/^\d+\.\d{2}$/);
    expect(lines.find((l) => l.rank === 'SSM')!.status).toBe('blocked');
  });

  it('validates the simulation request before any rpc runs', async () => {
    const cases: Record<string, unknown>[] = [
      simBody({ simulationBasis: 'short' }),
      simBody({ policySnapshot: {} }),
      simBody({ period: '2026-13' }),
      simBody({ policySnapshot: { SM: { ...SNAP, monthlyBa: '12.345' } } }),
      simBody({ policySnapshot: { SM: { ...SNAP, collectionGate: '0' } } }),
      simBody({ lines: [{ ...simBody().lines[0], staffId: UUID.superAdminStaff }] }),
    ];
    for (const body of cases) {
      const out = await call({
        method: 'POST',
        path: 'payroll/simulations',
        token: TOKEN2.finance,
        body,
      });
      expect(out.state.status).toBe(400);
      expect(out.anyRpc()).toHaveLength(0);
    }
  });
});

describe('IST payroll Q1 gate (owner-reported)', () => {
  it('exposes source, option, evidence status and a null effective date without a signed approval', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/gate',
      token: TOKEN2.finance,
      gate: 'approved',
      gateRow: {
        source: 'owner_reported',
        decision_option: 'C_BOTH_MODELS',
        evidence_status: 'awaiting_evidence',
        effective_date: null,
      },
    });
    expect(payrollGateSchema.parse(out.state.body)).toMatchObject({
      q1Status: 'approved',
      liveAuthorized: true,
      q1Source: 'owner_reported',
      q1DecisionOption: 'C_BOTH_MODELS',
      q1EvidenceStatus: 'awaiting_evidence',
      q1EffectiveDate: null,
    });
  });
});

describe('IST payroll policy segments in live drafts', () => {
  const TRANSITION = {
    period: '2026-10',
    transitionRuleApproved: false,
    ranks: ['SM', 'SSM', 'SVD'].map((rank) => ({
      rank,
      period: '2026-10',
      monthStart: '2026-10-01',
      monthEnd: '2026-10-31',
      singlePolicy: false,
      transition: rank === 'SM',
      segments:
        rank === 'SM'
          ? [
              { from: '2026-10-01', to: '2026-10-14', days: 14, policyId: 'a', policyVersion: 1 },
              { from: '2026-10-15', to: '2026-10-31', days: 17, policyId: 'b', policyVersion: 2 },
            ]
          : [
              {
                from: '2026-10-01',
                to: '2026-10-31',
                days: 31,
                policyId: null,
                policyVersion: null,
              },
            ],
    })),
  };

  it('blocks a transition month with POLICY_TRANSITION_RULE_NOT_APPROVED and no figures', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-10' },
      gate: 'approved',
      segments: TRANSITION,
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('payroll_policy_segments')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
    });
    const lines = (
      out.rpc('replace_payroll_batch_lines')[0]!.arg as { p_lines: Record<string, unknown>[] }
    ).p_lines;
    const sm = lines.find((l) => l.rank === 'SM')!;
    expect(sm.status).toBe('blocked');
    expect(sm.net).toBeUndefined();
    expect(sm.policyId).toBeNull();
    expect(String(sm.blockedReason)).toMatch(/^POLICY_TRANSITION_RULE_NOT_APPROVED:/);
    expect(String(sm.blockedReason)).toContain('not approved');
    expect(String(lines.find((l) => l.rank === 'SSM')!.blockedReason)).toMatch(
      /^CONFIGURATION_REQUIRED/,
    );
  });

  it('stays blocked, saying segment payout is not implemented, even once the rule is approved', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-10' },
      gate: 'approved',
      segments: { ...TRANSITION, transitionRuleApproved: true },
    });
    const sm = (
      out.rpc('replace_payroll_batch_lines')[0]!.arg as { p_lines: Record<string, unknown>[] }
    ).p_lines.find((l) => l.rank === 'SM')!;
    expect(sm.status).toBe('blocked');
    expect(String(sm.blockedReason)).toMatch(/^POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED:/);
    expect(String(sm.blockedReason)).toContain('segment payout not implemented');
    expect(sm.ba).toBeUndefined();
  });
});

describe('IST payroll segments route', () => {
  it('returns the RPC segments for finance.payroll viewers with the session actor', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/segments',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
    });
    expect(out.state.status).toBe(200);
    expect(payrollPolicySegmentsSchema.parse(out.state.body).ranks).toHaveLength(3);
    expect(out.rpc('payroll_policy_segments')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
    });
  });

  it('validates the period before calling the database', async () => {
    for (const query of [{}, { period: '2026-13' }, { period: 'x' }] as Record<string, string>[]) {
      const out = await call({
        method: 'GET',
        path: 'payroll/segments',
        token: TOKEN2.finance,
        query,
      });
      expect(out.state.status).toBe(400);
      expect(out.anyRpc()).toHaveLength(0);
    }
  });

  it('maps PERIOD_INVALID from the database to a non-500', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/segments',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
      rpcError: { fn: 'payroll_policy_segments', message: 'PERIOD_INVALID' },
    });
    expect(out.state.status).not.toBe(500);
  });
});

describe('IST payroll line review route', () => {
  it('records a review through the RPC with the session actor only', async () => {
    const out = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/review`,
      token: TOKEN2.finance,
      body: { note: 'Checked against the contract', actorId: UUID.superAdminStaff },
    });
    // The contract is strict: a client-supplied actor is rejected, never trusted.
    expect(out.state.status).toBe(400);
    expect(out.anyRpc()).toHaveLength(0);
    const ok = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/review`,
      token: TOKEN2.finance,
      body: { note: 'Checked against the contract' },
    });
    expect(ok.state.status).toBe(200);
    expect(payrollLineReviewResultSchema.parse(ok.state.body)).toEqual({
      lineId: LINE,
      status: 'reviewed',
    });
    expect(ok.rpc('review_payroll_line')[0]!.arg).toEqual({
      p_line_id: LINE,
      p_note: 'Checked against the contract',
      p_actor_id: STAFF2.finance,
    });
  });

  it('rejects a short note before any rpc', async () => {
    const out = await call({
      method: 'POST',
      path: `payroll/lines/${LINE}/review`,
      token: TOKEN2.finance,
      body: { note: 'ok' },
    });
    expect(out.state.status).toBe(400);
    expect(out.anyRpc()).toHaveLength(0);
  });

  it('maps the review error codes without internals', async () => {
    const cases: [string, number][] = [
      ['PAYROLL_LINE_REVIEW_NOT_REQUIRED', 409],
      ['PAYROLL_LINE_ALREADY_REVIEWED', 409],
      ['PAYROLL_REVIEW_NOTE_REQUIRED', 400],
      ['PAYROLL_LINE_NOT_FOUND', 404],
    ];
    for (const [code, status] of cases) {
      const out = await call({
        method: 'POST',
        path: `payroll/lines/${LINE}/review`,
        token: TOKEN2.finance,
        body: { note: 'Checked against the contract' },
        rpcError: { fn: 'review_payroll_line', message: code },
      });
      expect(out.state.status, code).toBe(status);
      expect(JSON.stringify(out.state.body), code).not.toContain(code);
    }
  });

  it('exposes review fields on batch lines', async () => {
    const out = await call({
      method: 'GET',
      path: `payroll/batches/${BATCH}`,
      token: TOKEN2.finance,
    });
    expect(payrollBatchDetailSchema.parse(out.state.body).lines[0]).toMatchObject({
      reviewRequired: false,
      reviewFlags: [],
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    });
  });
});

describe('IST compensation policy lifecycle routes', () => {
  const DRAFT = {
    rank: 'SM',
    monthlyBa: '10000.00',
    baTarget: '100000.00',
    monthlyPa: '5000.00',
    paTarget: '200000.00',
    pbTarget: '300000.00',
    pbRate: '0.01',
    collectionGate: '0.40',
    effectiveFrom: '2026-11-01',
    basisNote: 'Fixture draft only',
  };

  it('creates a draft for finance.payroll_policy with the session actor and Idempotency-Key', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/policies',
      token: TOKEN2.finance,
      body: DRAFT,
      grantFinance: ['finance.payroll_policy'],
      headers: { 'idempotency-key': 'key-123' },
    });
    expect(out.state.status).toBe(201);
    expect(policyActionResultSchema.parse(out.state.body)).toEqual({
      policyId: POLICY_ID,
      status: 'draft',
    });
    expect(out.rpc('save_ist_compensation_policy_draft')[0]!.arg).toEqual({
      p_policy_id: null,
      p_fields: DRAFT,
      p_actor_id: STAFF2.finance,
      p_idempotency_key: 'key-123',
    });
  });

  it('refuses Finance without the policy module and never calls the database', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/policies',
      token: TOKEN2.finance,
      body: DRAFT,
    });
    expect(out.state.status).toBe(403);
    expect(out.anyRpc()).toHaveLength(0);
  });

  it('refuses a client-supplied actor and unknown fields on a draft', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/policies',
      token: TOKEN.superAdmin,
      body: { ...DRAFT, createdBy: UUID.superAdminStaff },
    });
    expect(out.state.status).toBe(400);
    expect(out.anyRpc()).toHaveLength(0);
  });

  it('validates draft figures before any rpc', async () => {
    const bad: Record<string, unknown>[] = [
      { ...DRAFT, monthlyBa: '12.345' },
      { ...DRAFT, monthlyBa: 10000 },
      { ...DRAFT, rank: 'OST' },
      { ...DRAFT, effectiveFrom: '2026-02-30' },
      { ...DRAFT, basisNote: 'no' },
      { ...DRAFT, baReviewLimit: '-1' },
      { ...DRAFT, pbRate: '1.01' },
      { ...DRAFT, collectionGate: '0' },
      { ...DRAFT, collectionGate: '40' },
      { ...DRAFT, effectiveUntil: '2026-10-31' },
    ];
    for (const body of bad) {
      const out = await call({
        method: 'POST',
        path: 'payroll/policies',
        token: TOKEN.superAdmin,
        body,
      });
      expect(out.state.status, JSON.stringify(body)).toBe(400);
      expect(out.anyRpc()).toHaveLength(0);
    }
  });

  it('updates a draft by id through PUT, without an idempotency key', async () => {
    const out = await call({
      method: 'PUT',
      path: `payroll/policies/${POLICY_ID}`,
      token: TOKEN.superAdmin,
      body: DRAFT,
      headers: { 'idempotency-key': 'ignored' },
    });
    expect(out.state.status).toBe(200);
    expect(out.rpc('save_ist_compensation_policy_draft')[0]!.arg).toEqual({
      p_policy_id: POLICY_ID,
      p_fields: DRAFT,
      p_actor_id: UUID.superAdminStaff,
      p_idempotency_key: null,
    });
  });

  it('submits with finance.payroll_policy and answers the new status', async () => {
    const out = await call({
      method: 'POST',
      path: `payroll/policies/${POLICY_ID}/submit`,
      token: TOKEN2.finance,
      grantFinance: ['finance.payroll_policy'],
    });
    expect(out.state.status).toBe(200);
    expect(policyActionResultSchema.parse(out.state.body)).toEqual({
      policyId: POLICY_ID,
      status: 'pending_approval',
    });
    expect(out.rpc('submit_ist_compensation_policy')[0]!.arg).toEqual({
      p_policy_id: POLICY_ID,
      p_actor_id: STAFF2.finance,
    });
  });

  it('keeps return, approve and end behind finance.payroll_policy_approval only', async () => {
    for (const act of ['return', 'approve', 'end']) {
      const out = await call({
        method: 'POST',
        path: `payroll/policies/${POLICY_ID}/${act}`,
        token: TOKEN2.finance,
        grantFinance: ['finance.payroll_policy', 'finance.payroll'],
        body: {
          reason: 'Needs another look',
          evidenceReference: 'DOC-1',
          note: 'Reviewed',
          effectiveUntil: '2026-12-31',
        },
      });
      expect(out.state.status, act).toBe(403);
      expect(out.anyRpc(), act).toHaveLength(0);
    }
  });

  it('approves with evidence and note, actor from the session', async () => {
    const out = await call({
      method: 'POST',
      path: `payroll/policies/${POLICY_ID}/approve`,
      token: TOKEN.superAdmin,
      body: { evidenceReference: 'Board resolution 2026-11', note: 'Approved after review' },
    });
    expect(out.state.status).toBe(200);
    expect(policyActionResultSchema.parse(out.state.body).status).toBe('approved');
    expect(out.rpc('approve_ist_compensation_policy')[0]!.arg).toEqual({
      p_policy_id: POLICY_ID,
      p_evidence_reference: 'Board resolution 2026-11',
      p_note: 'Approved after review',
      p_actor_id: UUID.superAdminStaff,
    });
    for (const body of [
      {},
      { evidenceReference: 'no', note: 'Approved after review' },
      { evidenceReference: 'Board resolution', note: 'ok' },
      { evidenceReference: 'Board resolution', note: 'Approved after review', approvedBy: 'x' },
    ]) {
      const bad = await call({
        method: 'POST',
        path: `payroll/policies/${POLICY_ID}/approve`,
        token: TOKEN.superAdmin,
        body,
      });
      expect(bad.state.status, JSON.stringify(body)).toBe(400);
      expect(bad.anyRpc()).toHaveLength(0);
    }
  });

  it('returns and ends with validated input and the session actor', async () => {
    const ret = await call({
      method: 'POST',
      path: `payroll/policies/${POLICY_ID}/return`,
      token: TOKEN.superAdmin,
      body: { reason: 'Targets look wrong' },
    });
    expect(ret.state.status).toBe(200);
    expect(ret.rpc('return_ist_compensation_policy')[0]!.arg).toEqual({
      p_policy_id: POLICY_ID,
      p_reason: 'Targets look wrong',
      p_actor_id: UUID.superAdminStaff,
    });
    const shortReason = await call({
      method: 'POST',
      path: `payroll/policies/${POLICY_ID}/return`,
      token: TOKEN.superAdmin,
      body: { reason: 'no' },
    });
    expect(shortReason.state.status).toBe(400);
    const end = await call({
      method: 'POST',
      path: `payroll/policies/${POLICY_ID}/end`,
      token: TOKEN.superAdmin,
      body: { effectiveUntil: '2026-12-31', note: 'Replaced by a new policy' },
    });
    expect(end.state.status).toBe(200);
    expect(end.state.body).toEqual({ policyId: POLICY_ID, status: 'ended' });
    expect(end.rpc('end_ist_compensation_policy')[0]!.arg).toEqual({
      p_policy_id: POLICY_ID,
      p_effective_until: '2026-12-31',
      p_note: 'Replaced by a new policy',
      p_actor_id: UUID.superAdminStaff,
    });
    for (const body of [
      { effectiveUntil: '2026-02-30', note: 'Replaced by a new policy' },
      { effectiveUntil: '2026-12-31', note: 'x' },
    ]) {
      const bad = await call({
        method: 'POST',
        path: `payroll/policies/${POLICY_ID}/end`,
        token: TOKEN.superAdmin,
        body,
      });
      expect(bad.state.status).toBe(400);
      expect(bad.rpc('end_ist_compensation_policy')).toHaveLength(0);
    }
  });

  it('maps every policy error code to a readable status without leaking the code', async () => {
    const cases: [string, number, string][] = [
      ['COMPENSATION_POLICY_NOT_FOUND', 404, 'not found'],
      ['COMPENSATION_POLICY_INVALID', 400, 'invalid'],
      ['COMPENSATION_POLICY_NOT_EDITABLE', 409, 'draft'],
      ['COMPENSATION_POLICY_NOT_PENDING', 409, 'waiting'],
      ['COMPENSATION_POLICY_NOT_APPROVED', 409, 'approved'],
      ['COMPENSATION_POLICY_TRANSITION_INVALID', 409, 'status'],
      ['COMPENSATION_POLICY_IN_USE_BY_FINALIZED_PAYROLL', 409, 'payroll'],
      ['COMPENSATION_POLICY_SELF_APPROVAL', 403, 'cannot approve'],
      ['COMPENSATION_POLICY_EVIDENCE_REQUIRED', 400, 'reference'],
      ['COMPENSATION_POLICY_APPROVAL_NOTE_REQUIRED', 400, 'note'],
      ['COMPENSATION_POLICY_RETURN_REASON_REQUIRED', 400, 'reason'],
      ['COMPENSATION_POLICY_END_NOTE_REQUIRED', 400, 'note'],
      ['COMPENSATION_POLICY_END_DATE_INVALID', 400, 'end date'],
      ['COMPENSATION_POLICY_DIRECT_WRITE_REFUSED', 403, 'workflow'],
      ['POLICY_TRANSITION_RULE_NOT_APPROVED', 409, 'not yet approved'],
    ];
    for (const [code, status, text] of cases) {
      const out = await call({
        method: 'POST',
        path: `payroll/policies/${POLICY_ID}/submit`,
        token: TOKEN.superAdmin,
        rpcError: { fn: 'submit_ist_compensation_policy', message: code },
      });
      expect(out.state.status, code).toBe(status);
      const body = JSON.stringify(out.state.body);
      expect(body.toLowerCase(), code).toContain(text);
      expect(body, code).not.toContain(code);
    }
  });

  it('surfaces the invalid field name from a draft refusal, never raw SQL', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/policies',
      token: TOKEN.superAdmin,
      body: DRAFT,
      rpcError: {
        fn: 'save_ist_compensation_policy_draft',
        message: 'COMPENSATION_POLICY_INVALID',
        details: 'effectiveUntil is before effectiveFrom',
      },
    });
    expect(out.state.status).toBe(400);
    expect(JSON.stringify(out.state.body)).toContain('effectiveUntil is before effectiveFrom');
  });
});

/* ------------------------------------------------------------------ */
/* 0009: engagements, performance rules, performance evidence, live lines */
/* ------------------------------------------------------------------ */
describe('IST engagement and performance rule routes', () => {
  const ENG = {
    staffId: STAFF2.salesManager,
    rank: 'SM',
    contractStart: '2026-01-01',
    evidenceReference: 'Signed contract 2026-01',
  };
  const RULE = {
    effectiveFrom: '2026-01-01',
    attributionBasis: 'seller_only',
    closedDealThresholdPct: '40',
    countDateBasis: 'verified_posting_period',
    adjustmentTreatment: 'report_only',
    sourceReference: 'Board memo 2026-11',
  };
  const kinds = [
    {
      path: 'engagements',
      body: ENG,
      save: 'save_ist_engagement_draft',
      idArg: 'p_engagement_id',
      fn: 'ist_engagement',
    },
    {
      path: 'performance-rules',
      body: RULE,
      save: 'save_ist_performance_rule_draft',
      idArg: 'p_rule_id',
      fn: 'ist_performance_rule',
    },
  ] as const;

  for (const k of kinds) {
    const id = k.path === 'engagements' ? ENG_ID : RULE_ID;
    const names =
      k.path === 'engagements'
        ? {
            submit: 'submit_ist_engagement',
            ret: 'return_ist_engagement',
            approve: 'approve_ist_engagement',
            end: 'end_ist_engagement',
          }
        : {
            submit: 'submit_ist_performance_rule',
            ret: 'return_ist_performance_rule',
            approve: 'approve_ist_performance_rule',
            end: 'end_ist_performance_rule',
          };
    const endBody =
      k.path === 'engagements'
        ? { contractEnd: '2026-12-31', note: 'Contract ended' }
        : { effectiveUntil: '2026-12-31', note: 'Rule superseded' };

    describe(k.path, () => {
      it('creates a draft for finance.payroll_policy with the session actor', async () => {
        const out = await call({
          method: 'POST',
          path: `payroll/${k.path}`,
          token: TOKEN2.finance,
          body: k.body,
          grantFinance: ['finance.payroll_policy'],
          headers: { 'idempotency-key': 'k-1' },
        });
        expect(out.state.status).toBe(201);
        expect(out.state.body).toEqual({ id, status: 'draft' });
        expect(out.rpc(k.save)[0]!.arg).toEqual({
          [k.idArg]: null,
          p_fields: k.body,
          p_actor_id: STAFF2.finance,
          p_idempotency_key: 'k-1',
        });
      });
      it('is 403 without the module and never reaches the database', async () => {
        const out = await call({
          method: 'POST',
          path: `payroll/${k.path}`,
          token: TOKEN2.finance,
          body: k.body,
        });
        expect(out.state.status).toBe(403);
        expect(out.anyRpc()).toHaveLength(0);
      });
      it('rejects a client-supplied actor, unknown fields and bad values with 400', async () => {
        const bad: Record<string, unknown>[] = [
          { ...k.body, createdBy: UUID.superAdminStaff },
          { ...k.body, actor: 'x' },
          { ...k.body, sourceReference: 'short', evidenceReference: 'short' },
          { ...k.body, effectiveFrom: '2026-02-30', contractStart: '2026-02-30' },
        ];
        for (const body of bad) {
          const out = await call({
            method: 'POST',
            path: `payroll/${k.path}`,
            token: TOKEN.superAdmin,
            body,
          });
          expect(out.state.status, JSON.stringify(body)).toBe(400);
          expect(out.anyRpc()).toHaveLength(0);
        }
      });
      it('edits a draft through PUT with no idempotency key', async () => {
        const out = await call({
          method: 'PUT',
          path: `payroll/${k.path}/${id}`,
          token: TOKEN.superAdmin,
          body: k.body,
          headers: { 'idempotency-key': 'ignored' },
        });
        expect(out.state.status).toBe(200);
        expect(out.rpc(k.save)[0]!.arg).toMatchObject({
          [k.idArg]: id,
          p_actor_id: UUID.superAdminStaff,
          p_idempotency_key: null,
        });
      });
      it('submits with finance.payroll_policy; return/approve/end need the approval module', async () => {
        const sub = await call({
          method: 'POST',
          path: `payroll/${k.path}/${id}/submit`,
          token: TOKEN2.finance,
          grantFinance: ['finance.payroll_policy'],
        });
        expect(sub.state.status).toBe(200);
        expect(sub.state.body).toEqual({ id, status: 'pending_approval' });
        expect(sub.rpc(names.submit)[0]!.arg).toEqual({
          [k.idArg]: id,
          p_actor_id: STAFF2.finance,
        });
        for (const act of ['return', 'approve', 'end']) {
          const out = await call({
            method: 'POST',
            path: `payroll/${k.path}/${id}/${act}`,
            token: TOKEN2.finance,
            grantFinance: ['finance.payroll_policy', 'finance.payroll'],
            body: {
              reason: 'Needs another look',
              evidenceReference: 'Board resolution 2026',
              ...endBody,
            },
          });
          expect(out.state.status, act).toBe(403);
          expect(out.anyRpc(), act).toHaveLength(0);
        }
      });
      it('returns, approves and ends with the session actor and validated input', async () => {
        const ret = await call({
          method: 'POST',
          path: `payroll/${k.path}/${id}/return`,
          token: TOKEN.superAdmin,
          body: { reason: 'Needs evidence' },
        });
        expect(ret.state.status).toBe(200);
        expect(ret.rpc(names.ret)[0]!.arg).toEqual({
          [k.idArg]: id,
          p_reason: 'Needs evidence',
          p_actor_id: UUID.superAdminStaff,
        });
        const app = await call({
          method: 'POST',
          path: `payroll/${k.path}/${id}/approve`,
          token: TOKEN.superAdmin,
          body: { evidenceReference: 'Board resolution 2026-11', note: 'Approved after review' },
        });
        expect(app.state.body).toEqual({ id, status: 'approved' });
        expect(app.rpc(names.approve)[0]!.arg).toEqual({
          [k.idArg]: id,
          p_evidence_reference: 'Board resolution 2026-11',
          p_note: 'Approved after review',
          p_actor_id: UUID.superAdminStaff,
        });
        const end = await call({
          method: 'POST',
          path: `payroll/${k.path}/${id}/end`,
          token: TOKEN.superAdmin,
          body: endBody,
        });
        expect(end.state.body).toEqual({ id, status: 'ended' });
        const badCases: [string, Record<string, unknown>][] = [
          ['return', {}],
          ['approve', { evidenceReference: 'short', note: 'Approved after review' }],
          [
            'approve',
            {
              evidenceReference: 'Board resolution 2026',
              note: 'Approved after review',
              approvedBy: 'x',
            },
          ],
          ['end', { note: 'Rule superseded' }],
          ['end', { ...endBody, actor: 'x' }],
        ];
        for (const [act, body] of badCases) {
          const bad = await call({
            method: 'POST',
            path: `payroll/${k.path}/${id}/${act}`,
            token: TOKEN.superAdmin,
            body,
          });
          expect(bad.state.status, `${act} ${JSON.stringify(body)}`).toBe(400);
          expect(bad.anyRpc()).toHaveLength(0);
        }
      });
      it('maps every governed error code without leaking it', async () => {
        const cases: [string, number][] = [
          ['NOT_FOUND', 404],
          ['INVALID', 400],
          ['NOT_EDITABLE', 409],
          ['NOT_PENDING', 409],
          ['NOT_APPROVED', 409],
          ['TRANSITION_INVALID', 409],
          ['IMMUTABLE', 409],
          ['OVERLAP', 409],
          ['IDEMPOTENCY_CONFLICT', 409],
          ['SELF_APPROVAL', 403],
          ['DIRECT_WRITE_REFUSED', 403],
          ['EVIDENCE_REQUIRED', 400],
          ['APPROVAL_NOTE_REQUIRED', 400],
          ['RETURN_REASON_REQUIRED', 400],
          ['END_NOTE_REQUIRED', 400],
          ['END_DATE_INVALID', 400],
          ['IN_USE_BY_FINALIZED_PAYROLL', 409],
        ];
        const prefix = k.fn.toUpperCase();
        for (const [suffix, status] of cases) {
          const code = `${prefix}_${suffix}`;
          const out = await call({
            method: 'POST',
            path: `payroll/${k.path}/${id}/approve`,
            token: TOKEN.superAdmin,
            body: { evidenceReference: 'Board resolution 2026-11', note: 'Approved after review' },
            rpcError: { fn: names.approve, message: code },
          });
          expect(out.state.status, code).toBe(status);
          expect(JSON.stringify(out.state.body), code).not.toContain(code);
        }
      });
      it('surfaces the invalid detail and keeps a 23505 idempotency conflict a 409', async () => {
        const out = await call({
          method: 'POST',
          path: `payroll/${k.path}`,
          token: TOKEN.superAdmin,
          body: k.body,
          rpcError: {
            fn: k.save,
            message: `${k.fn.toUpperCase()}_INVALID`,
            details: 'dates must be YYYY-MM-DD',
          },
        });
        expect(out.state.status).toBe(400);
        expect(JSON.stringify(out.state.body)).toContain('dates must be YYYY-MM-DD');
        const dup = await call({
          method: 'POST',
          path: `payroll/${k.path}`,
          token: TOKEN.superAdmin,
          body: k.body,
          rpcError: { fn: k.save, message: `${k.fn.toUpperCase()}_IDEMPOTENCY_CONFLICT` },
        });
        expect(dup.state.status).toBe(409);
        expect(JSON.stringify(dup.state.body)).toContain('different data');
      });
    });
  }

  it('lists engagements and rules with staff names, for payroll viewers only', async () => {
    const eng = {
      id: ENG_ID,
      staff_id: STAFF2.salesManager,
      rank: 'SM',
      contract_start: '2026-01-01',
      contract_end: null,
      suspended_from: null,
      evidence_reference: 'Signed contract 2026-01',
      status: 'approved',
      created_by: STAFF2.finance,
      created_at: '2026-11-01T00:00:00.000Z',
      approved_by: UUID.superAdminStaff,
      approved_at: '2026-11-02T00:00:00.000Z',
    };
    const out = await call({
      method: 'GET',
      path: 'payroll/engagements',
      token: TOKEN2.finance,
      engagements: [eng],
    });
    expect(out.state.status).toBe(200);
    const parsed = z.array(istEngagementSchema).parse((out.state.body as { data: unknown[] }).data);
    expect(parsed[0]).toMatchObject({ id: ENG_ID, status: 'approved', contractEnd: null });
    expect(parsed[0]!.staffName).not.toBeNull();
    const rule = {
      id: RULE_ID,
      rule_version: 1,
      effective_from: '2026-01-01',
      effective_until: null,
      attribution_basis: 'seller_only',
      closed_deal_threshold_pct: '40',
      count_date_basis: 'paid_on',
      assumed_credit_rate: null,
      adjustment_treatment: 'report_only',
      source_reference: 'Board memo 2026-11',
      status: 'draft',
      created_by: STAFF2.finance,
      created_at: '2026-11-01T00:00:00.000Z',
    };
    const r = await call({
      method: 'GET',
      path: 'payroll/performance-rules',
      token: TOKEN2.finance,
      rules: [rule],
    });
    expect(
      z.array(istPerformanceRuleSchema).parse((r.state.body as { data: unknown[] }).data)[0],
    ).toMatchObject({
      ruleVersion: 1,
      countDateBasis: 'paid_on',
      assumedCreditRate: null,
    });
    const denied = await call({
      method: 'GET',
      path: 'payroll/engagements',
      token: TOKEN2.salesManager,
    });
    expect(denied.state.status).toBe(403);
  });
});

describe('IST performance reads', () => {
  it('preserves off-roster evidence totals through the API and response contract', async () => {
    const offRoster = { count: 2, total: '1234.50' };
    const out = await call({
      method: 'GET',
      path: 'payroll/performance',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
      perf: { ...blockedPerfDoc('2026-10'), offRoster },
    });
    expect(out.state.status).toBe(200);
    expect(istPeriodPerformanceSchema.parse(out.state.body).offRoster).toEqual(offRoster);
  });

  it('returns the period performance with names; 403 without finance.payroll; validates the period', async () => {
    const out = await call({
      method: 'GET',
      path: 'payroll/performance',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
    });
    expect(out.state.status).toBe(200);
    const body = istPeriodPerformanceSchema.parse(out.state.body);
    expect(body.ruleBlocker).toBe('RULE_NOT_APPROVED');
    expect(body.staff.every((s) => s.status === 'BLOCKED' && s.kpi === '0.00')).toBe(true);
    expect(body.staffNames?.[STAFF2.salesManager]).toBeTruthy();
    expect(out.rpc('ist_period_performance')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
    });
    const denied = await call({
      method: 'GET',
      path: 'payroll/performance',
      token: TOKEN2.salesManager,
      query: { period: '2026-10' },
    });
    expect(denied.state.status).toBe(403);
    expect(denied.anyRpc()).toHaveLength(0);
    const bad = await call({
      method: 'GET',
      path: 'payroll/performance',
      token: TOKEN2.finance,
      query: { period: '2026-13' },
    });
    expect(bad.state.status).toBe(400);
    expect(bad.anyRpc()).toHaveLength(0);
    const err = await call({
      method: 'GET',
      path: 'payroll/performance',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
      rpcError: { fn: 'ist_period_performance', message: 'PERIOD_INVALID' },
    });
    expect(err.state.status).not.toBe(500);
  });

  it('returns staff evidence with the session actor, validating the period', async () => {
    const out = await call({
      method: 'GET',
      path: `payroll/performance/${STAFF2.salesManager}/evidence`,
      token: TOKEN2.finance,
      query: { period: '2026-10' },
    });
    expect(out.state.status).toBe(200);
    expect(istStaffPerformanceEvidenceSchema.parse(out.state.body).items).toEqual([]);
    expect(out.rpc('ist_staff_performance_evidence')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_staff_id: STAFF2.salesManager,
      p_actor_id: STAFF2.finance,
    });
    const bad = await call({
      method: 'GET',
      path: `payroll/performance/${STAFF2.salesManager}/evidence`,
      token: TOKEN2.finance,
    });
    expect(bad.state.status).toBe(400);
    const err = await call({
      method: 'GET',
      path: `payroll/performance/${STAFF2.salesManager}/evidence`,
      token: TOKEN2.finance,
      query: { period: '2026-10' },
      rpcError: { fn: 'ist_staff_performance_evidence', message: 'STAFF_REQUIRED' },
    });
    expect(err.state.status).toBe(400);
  });
});

describe('IST live payroll lines from performance evidence', () => {
  // TEST FIXTURES ONLY: these policy and rule figures are not approved amounts.
  const POLICY = {
    id: '40404040-0000-4000-8000-0000000000e1',
    rank: 'SM',
    status: 'approved',
    monthly_ba: '10000.00',
    ba_target: '100000.00',
    monthly_pa: '5000.00',
    pa_target: '200000.00',
    pb_target: '300000.00',
    pb_rate: '0.01',
    collection_gate: '0.40',
    effective_from: '2026-01-01',
    effective_until: null,
  };
  const EVHASH = 'a'.repeat(64);
  const perfStaff = (over: Record<string, unknown> = {}) => ({
    staffId: STAFF2.salesManager,
    rank: 'SM',
    contractStart: '2025-01-01',
    contractEnd: null,
    suspendedFrom: '2026-08-17',
    kpi: '400000.00',
    collection: '200000.00',
    verifiedCash: '200000.00',
    assumedCredit: '0.00',
    approvedAdjustmentsTotal: '0.00',
    proposedAdjustmentsTotal: '0.00',
    status: 'CALCULABLE',
    blockers: [],
    evidenceHash: EVHASH,
    evidenceCount: 2,
    ruleId: RULE_ID,
    ruleVersion: 1,
    engagementId: ENG_ID,
    ...over,
  });
  const doc = (period: string, sm: Record<string, unknown>) => {
    const others = blockedPerfDoc(period).staff.filter((s) => s.rank !== 'SM');
    return { period, ruleId: RULE_ID, ruleVersion: 1, ruleBlocker: null, staff: [sm, ...others] };
  };
  const item = (over: Record<string, unknown>) => ({
    staffId: STAFF2.salesManager,
    period: '2026-08',
    saleId: null,
    reservationId: null,
    paymentId: '50505050-0000-4000-8000-000000000001',
    amount: '1.00',
    postingPeriod: '2026-08',
    paidOn: '2026-08-05',
    verifiedAt: null,
    paymentPurpose: 'installment',
    sellerStaffId: STAFF2.salesManager,
    contractPriceSnapshot: '400000.00',
    cumulativeVerifiedAtPeriodEnd: '1.00',
    evidenceClass: 'VERIFIED_CASH',
    eligibility: 'ELIGIBLE',
    reasonCode: null,
    countPeriod: '2026-08',
    countDate: '2026-08-05',
    isClosingPayment: false,
    closedDealThresholdAmount: '160000.00',
    approvedAdjustmentsTotal: '0.00',
    proposedAdjustmentsTotal: '0.00',
    assumedCredit: '0.00',
    ruleId: RULE_ID,
    engagementId: ENG_ID,
    ...over,
  });
  const evidenceDoc = (period: string, sm: Record<string, unknown>, items: unknown[]) => ({
    period,
    staffId: STAFF2.salesManager,
    summary: sm,
    items,
  });
  const smLine = async (opts: {
    perf: Record<string, unknown>;
    evidence?: Record<string, Record<string, unknown>>;
    period?: string;
    segments?: Record<string, unknown>;
    policies?: Record<string, unknown>[];
  }) => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: opts.period ?? '2026-08' },
      gate: 'approved',
      policies: opts.policies ?? [POLICY],
      perf: opts.perf,
      evidence: opts.evidence,
      segments: opts.segments,
    });
    expect(out.state.status).toBe(201);
    const lines = (
      out.rpc('replace_payroll_batch_lines')[0]!.arg as { p_lines: Record<string, unknown>[] }
    ).p_lines;
    return { sm: lines.find((l) => l.rank === 'SM')!, lines, out };
  };
  const noMoney = (l: Record<string, unknown>) => {
    for (const f of ['ba', 'pa', 'pb', 'net', 'adjustments', 'withheld'])
      expect(l[f]).toBeUndefined();
  };

  it('blocks every roster line by default (no rule, no engagement)', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-08' },
      gate: 'approved',
      policies: [POLICY],
    });
    const lines = (
      out.rpc('replace_payroll_batch_lines')[0]!.arg as { p_lines: Record<string, unknown>[] }
    ).p_lines;
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(l.status).toBe('blocked');
      noMoney(l);
    }
    expect(out.rpc('ist_staff_performance_evidence')).toHaveLength(0);
  });

  it('uses an approved QP decision and actual start day with separate calendar proration', async () => {
    const sm = perfStaff({
      contractStart: '2026-08-03',
      suspendedFrom: null,
      qpBaApproved: true,
      qpDecisionReference: 'TEST ONLY approved qualification rule and attendance decision',
    });
    const items = [item({ amount: '200000.00', isClosingPayment: true })];
    const { sm: line } = await smLine({
      perf: doc('2026-08', sm),
      evidence: { [STAFF2.salesManager]: evidenceDoc('2026-08', sm, items) },
    });
    expect([line.status, line.ba, line.pa, line.pb, line.net]).toEqual([
      'computed',
      '9354.84',
      '4677.42',
      '4000.00',
      '18032.26',
    ]);
    expect(line.inputs).toMatchObject({
      qpBaApproved: true,
      qualifyingPeriodEnd: '2026-09-02',
      policySnapshot: { version: POLICY.id, rank: 'SM', monthlyBa: '10000.00', pbRate: '0.01' },
      performanceEvidence: { items },
    });
  });

  it('computes the 16/31 proration case exactly as the engine does (TEST FIXTURE figures)', async () => {
    // EP only (QP ended 2025-01-31); suspended from 17 Aug => 16 eligible days of 31.
    const items = [
      item({
        paymentId: '50505050-0000-4000-8000-000000000001',
        amount: '150000.00',
        isClosingPayment: true,
        countDate: '2026-08-05',
      }),
      item({
        paymentId: '50505050-0000-4000-8000-000000000002',
        amount: '50000.00',
        isClosingPayment: false,
        countDate: '2026-08-10',
      }),
    ];
    const sm = perfStaff();
    const { sm: line } = await smLine({
      perf: doc('2026-08', sm),
      evidence: { [STAFF2.salesManager]: evidenceDoc('2026-08', sm, items) },
    });
    const expected = calculateIstPayroll({
      month: '2026-08',
      rank: 'SM',
      contractStart: '2025-01-01',
      contractEnd: null,
      suspendedFrom: '2026-08-17',
      policy: {
        version: POLICY.id,
        rank: 'SM',
        monthlyBa: '10000.00',
        baTarget: '100000.00',
        monthlyPa: '5000.00',
        paTarget: '200000.00',
        pbTarget: '300000.00',
        pbRate: '0.01',
        collectionGate: '0.40',
      },
      qp: { kpi: '0.00', collection: '0.00' },
      ep: { kpi: '400000.00', collection: '200000.00' },
      qpBaApproved: null,
    });
    expect(expected.exceptions).toEqual([]);
    // Hand check: BA 10000*16/31 = 5161.29, PA 5000*16/31 = 2580.65, PB 1% of min(400000, 200000/0.40) = 4000.00.
    expect([line.ba, line.pa, line.pb, line.net]).toEqual([
      '5161.29',
      '2580.65',
      '4000.00',
      '11741.94',
    ]);
    expect([line.ba, line.pa, line.pb, line.net]).toEqual([
      expected.ba,
      expected.pa,
      expected.pb,
      expected.net,
    ]);
    expect(line.status).toBe('computed');
    expect(line.policyId).toBe(POLICY.id);
    expect(line.inputs).toMatchObject({
      ruleId: RULE_ID,
      ruleVersion: 1,
      engagementId: ENG_ID,
      evidenceHash: EVHASH,
      evidenceCount: 2,
      qp: { kpi: '0.00', collection: '0.00' },
      ep: { kpi: '400000.00', collection: '200000.00' },
      performanceEvidence: { summary: sm, items },
    });
  });

  it('splits a mid-month QP/EP case by the engine boundary and stays blocked on the QP decision', async () => {
    // Start 2026-07-16 => QP ends 2026-08-15 (engine boundary). 10 Aug is QP, 20 Aug is EP.
    const items = [
      item({
        paymentId: '50505050-0000-4000-8000-000000000003',
        amount: '100000.00',
        contractPriceSnapshot: '500000.00',
        isClosingPayment: true,
        countDate: '2026-08-10',
      }),
      item({
        paymentId: '50505050-0000-4000-8000-000000000004',
        amount: '30000.00',
        isClosingPayment: false,
        countDate: '2026-08-20',
      }),
      item({
        paymentId: '50505050-0000-4000-8000-000000000005',
        amount: '9999.00',
        eligibility: 'INELIGIBLE',
        reasonCode: 'OUTSIDE_COUNT_PERIOD',
        countDate: '2026-09-02',
      }),
    ];
    const sm = perfStaff({
      contractStart: '2026-07-16',
      suspendedFrom: null,
      kpi: '500000.00',
      collection: '130000.00',
      verifiedCash: '130000.00',
      evidenceCount: 3,
    });
    const { sm: line } = await smLine({
      perf: doc('2026-08', sm),
      evidence: { [STAFF2.salesManager]: evidenceDoc('2026-08', sm, items) },
    });
    expect(line.status).toBe('blocked');
    noMoney(line);
    expect(String(line.blockedReason)).toContain('QP_BA_DECISION_PENDING');
    expect(line.inputs).toMatchObject({
      qualifyingPeriodEnd: '2026-08-15',
      qp: { kpi: '500000.00', collection: '100000.00' },
      ep: { kpi: '0.00', collection: '30000.00' },
      evidenceHash: EVHASH,
    });
  });

  it('keeps a staff member blocked when the engagement is missing, with zero money and the hash stored', async () => {
    const sm = perfStaff({
      status: 'BLOCKED',
      blockers: ['MISSING_ENGAGEMENT'],
      engagementId: null,
      contractStart: null,
      kpi: '0.00',
      collection: '0.00',
      verifiedCash: '0.00',
    });
    const { sm: line, out } = await smLine({ perf: doc('2026-08', sm) });
    expect(line.status).toBe('blocked');
    noMoney(line);
    expect(String(line.blockedReason)).toContain('MISSING_ENGAGEMENT');
    expect(String(line.blockedReason)).toContain('no approved IST engagement');
    expect((line.inputs as Record<string, unknown>).evidenceHash).toBe(EVHASH);
    expect((line.inputs as Record<string, unknown>).blockers).toEqual(['MISSING_ENGAGEMENT']);
    expect(out.rpc('ist_staff_performance_evidence')).toHaveLength(0);
  });

  it('keeps every line blocked when no rule is approved for the month', async () => {
    const sm = perfStaff({
      status: 'BLOCKED',
      blockers: ['RULE_NOT_APPROVED'],
      ruleId: null,
      ruleVersion: null,
    });
    const { lines } = await smLine({
      perf: {
        ...doc('2026-08', sm),
        ruleId: null,
        ruleVersion: null,
        ruleBlocker: 'RULE_NOT_APPROVED',
      },
    });
    for (const l of lines) {
      expect(l.status).toBe('blocked');
      noMoney(l);
    }
    expect(String(lines.find((l) => l.rank === 'SM')!.blockedReason)).toContain(
      'RULE_NOT_APPROVED',
    );
  });

  it('blocks a transition month even when the transition rule is approved and the evidence is calculable', async () => {
    const sm = perfStaff();
    const segments = {
      period: '2026-08',
      transitionRuleApproved: true,
      ranks: ['SM', 'SSM', 'SVD'].map((rank) => ({
        rank,
        period: '2026-08',
        monthStart: '2026-08-01',
        monthEnd: '2026-08-31',
        singlePolicy: false,
        transition: rank === 'SM',
        segments: [
          { from: '2026-08-01', to: '2026-08-14', days: 14, policyId: 'a', policyVersion: 1 },
          { from: '2026-08-15', to: '2026-08-31', days: 17, policyId: 'b', policyVersion: 2 },
        ],
      })),
    };
    const { sm: line } = await smLine({ perf: doc('2026-08', sm), segments });
    expect(line.status).toBe('blocked');
    noMoney(line);
    expect(String(line.blockedReason)).toMatch(/^POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED:/);
  });

  it('blocks when the evidence changed or does not add up, never guessing', async () => {
    const closing = item({ amount: '150000.00', isClosingPayment: true });
    const sm = perfStaff({
      collection: '150000.00',
      verifiedCash: '150000.00',
      kpi: '400000.00',
      evidenceCount: 1,
    });
    const stale = await smLine({
      perf: doc('2026-08', sm),
      evidence: {
        [STAFF2.salesManager]: evidenceDoc('2026-08', { ...sm, evidenceHash: 'b'.repeat(64) }, [
          closing,
        ]),
      },
    });
    expect(stale.sm.status).toBe('blocked');
    expect(String(stale.sm.blockedReason)).toContain('EVIDENCE_CHANGED');
    const bad = { ...sm, verifiedCash: '999.00' };
    const mismatch = await smLine({
      perf: doc('2026-08', bad),
      evidence: { [STAFF2.salesManager]: evidenceDoc('2026-08', bad, [closing]) },
    });
    expect(mismatch.sm.status).toBe('blocked');
    expect(String(mismatch.sm.blockedReason)).toContain('EVIDENCE_TOTAL_MISMATCH');
    noMoney(mismatch.sm);
    const multi = await smLine({
      perf: doc('2026-08', sm),
      evidence: {
        [STAFF2.salesManager]: evidenceDoc('2026-08', sm, [
          { ...closing, engagementId: '40404040-0000-4000-8000-0000000000f9' },
        ]),
      },
    });
    expect(String(multi.sm.blockedReason)).toContain('ENGAGEMENT_CHANGES_WITHIN_PERIOD');
  });

  it('keeps the line blocked when no approved compensation policy covers the rank', async () => {
    const sm = perfStaff();
    const { sm: line } = await smLine({ perf: doc('2026-08', sm), policies: [] });
    expect(line.status).toBe('blocked');
    noMoney(line);
    expect(String(line.blockedReason)).toContain('no approved compensation policy');
  });

  it('answers a failed performance read with a mapped status, not a 500', async () => {
    const out = await call({
      method: 'POST',
      path: 'payroll/batches',
      token: TOKEN2.finance,
      body: { period: '2026-08' },
      gate: 'approved',
      rpcError: { fn: 'ist_period_performance', message: 'MUTATION_FORBIDDEN' },
    });
    expect(out.state.status).toBe(403);
  });
});

describe('saved payroll calculation read', () => {
  it('returns the saved snapshot, strips unknown fields and performs no writes', async () => {
    const out = await call({
      method: 'GET',
      path: `payroll/lines/${LINE}/calculation`,
      token: TOKEN2.finance,
      savedLine: {
        inputs: { month: '2026-10', policySnapshot: SNAP, secret: 'never expose' },
        result: { status: 'CALCULATED', net: '1234.56', secret: 'never expose' },
      },
    });
    expect(out.state.status).toBe(200);
    expect(out.state.body).toMatchObject({
      lineId: LINE,
      batchId: BATCH,
      inputs: { policySnapshot: SNAP },
      result: { net: '1234.56' },
    });
    expect(JSON.stringify(out.state.body)).not.toContain('never expose');
    expect(out.anyRpc()).toHaveLength(0);
    expect(
      (holder.db as FakeSupabase).calls.filter((c) =>
        ['insert', 'update', 'delete', 'upsert'].includes(c.op),
      ),
    ).toHaveLength(0);
  });
  it('rejects a seller and an unauthenticated caller', async () => {
    for (const token of [TOKEN2.salesManager, 'invalid']) {
      const out = await call({ method: 'GET', path: `payroll/lines/${LINE}/calculation`, token });
      expect([401, 403]).toContain(out.state.status);
    }
  });
  it('allows the separate approver and returns 404 for a missing line', async () => {
    const allowed = await call({
      method: 'GET',
      path: `payroll/lines/${LINE}/calculation`,
      token: TOKEN.superAdmin,
    });
    expect(allowed.state.status).toBe(200);
    const missing = await call({
      method: 'GET',
      path: `payroll/lines/${POLICY_ID}/calculation`,
      token: TOKEN2.finance,
    });
    expect(missing.state.status).toBe(404);
  });
});
