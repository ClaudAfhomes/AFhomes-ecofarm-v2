/**
 * Accounting period routes (queues family). The SQL enforces order, the
 * month-ended rule and submitter != closer; these tests pin who may call what
 * and that the actor always comes from the session.
 */
import { accountingPeriodReadinessSchema, financePeriodSummarySchema } from '@afhomes/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ROLE2,
  TOKEN,
  moduleId,
  TOKEN2,
  STAFF2,
  UUID,
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

const SUMMARY = {
  period: '2026-10',
  status: 'open',
  verifiedCount: 3,
  verifiedTotal: '150000.00',
  latePostings: 1,
  pendingVerification: 2,
  heldForDuplicateReview: 0,
  proposedAdjustments: 1,
  earlierOpenPeriods: [],
};

const READINESS = {
  period: '2026-10',
  ready: false,
  blockers: [
    { code: 'PAYMENTS_PENDING_VERIFICATION', count: 2, message: 'Payments are recorded but not verified.' },
  ],
  warnings: [{ code: 'LIVE_PAYROLL_NOT_CLOSED', count: 1, message: 'A live payroll batch is not closed.' }],
};

/** The fixture world predates the payroll modules (migration 20270105000001): add them. */
function withPayrollModules(tables: ReturnType<typeof phase2World>) {
  const keys = [
    'finance.payroll',
    'finance.payroll_approval',
    'finance.payroll_close',
    'finance.payroll_policy',
    'finance.payroll_policy_approval',
  ];
  const modules = tables.modules as Record<string, unknown>[];
  const grants = tables.role_permissions as Record<string, unknown>[];
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
  // Finance: view, submit, record disbursements. Nothing on approval / close / policy.
  grants.push({
    role_id: ROLE2.finance,
    module_id: moduleId('finance.payroll'),
    can_view: true,
    can_create: true,
    can_update: true,
    can_delete: false,
  });
  return tables;
}

async function call(opts: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  query?: Record<string, string>;
  rpcError?: { fn: string; message: string };
}) {
  holder.db = new FakeSupabase({
    tables: withPayrollModules(phase2World({ accounting_periods: [] })),
    tokens: phase2WorldTokens(),
    rpcs: [
      { fn: 'finance_period_summary', result: SUMMARY },
      { fn: 'submit_accounting_period', result: 'ready_for_approval' },
      { fn: 'return_accounting_period', result: 'open' },
      { fn: 'close_accounting_period', result: { ...SUMMARY, status: 'closed' } },
      { fn: 'accounting_period_readiness', result: READINESS },
    ],
    rpcErrors: opts.rpcError ? { [opts.rpcError.fn]: { message: opts.rpcError.message } } : {},
  });
  const { res, state } = makeRes();
  await queues(
    makeReq({
      method: opts.method,
      familyPath: opts.path,
      body: opts.body,
      token: opts.token,
      query: opts.query,
    }) as never,
    res as never,
  );
  const db = holder.db as FakeSupabase;
  return { state, rpc: (fn: string) => db.calls.filter((c) => c.table === fn) };
}

describe('accounting periods', () => {
  it('returns the period summary to Finance in the contract shape', async () => {
    const out = await call({
      method: 'GET',
      path: 'finance-summary',
      token: TOKEN2.finance,
      query: { period: '2026-10' },
    });
    expect(out.state.status).toBe(200);
    financePeriodSummarySchema.parse(out.state.body);
    expect(out.rpc('finance_period_summary')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
    });
  });

  it('refuses the summary to a user with no Finance permission, and a malformed period', async () => {
    const denied = await call({ method: 'GET', path: 'finance-summary', token: TOKEN2.hr });
    expect(denied.state.status).toBe(403);
    const bad = await call({
      method: 'GET',
      path: 'finance-summary',
      token: TOKEN2.finance,
      query: { period: '2026-13' },
    });
    expect(bad.state.status).toBe(400);
    expect(bad.rpc('finance_period_summary')).toHaveLength(0);
  });

  it('lets Finance submit a period but not close or return it', async () => {
    const submit = await call({
      method: 'POST',
      path: 'periods/2026-10/submit',
      token: TOKEN2.finance,
    });
    expect(submit.state.status).toBe(200);
    expect(submit.rpc('submit_accounting_period')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
    });
    for (const action of ['close', 'return']) {
      const out = await call({
        method: 'POST',
        path: `periods/2026-10/${action}`,
        token: TOKEN2.finance,
        body: { reason: 'A valid reason' },
      });
      expect(out.state.status, action).toBe(403);
      expect(out.rpc(`${action}_accounting_period`)).toHaveLength(0);
    }
  });

  it('lets the closing authority close or return, with the session actor', async () => {
    const close = await call({
      method: 'POST',
      path: 'periods/2026-10/close',
      token: TOKEN.superAdmin,
    });
    expect(close.state.status).toBe(200);
    expect(close.rpc('close_accounting_period')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: UUID.superAdminStaff,
    });
    const short = await call({
      method: 'POST',
      path: 'periods/2026-10/return',
      token: TOKEN.superAdmin,
      body: { reason: 'no' },
    });
    expect(short.state.status).toBe(400);
    const ok = await call({
      method: 'POST',
      path: 'periods/2026-10/return',
      token: TOKEN.superAdmin,
      body: { reason: 'Totals need another look' },
    });
    expect(ok.state.status).toBe(200);
  });

  it('passes the readiness report through to Finance and refuses others', async () => {
    const ok = await call({ method: 'GET', path: 'periods/2026-10/readiness', token: TOKEN2.finance });
    expect(ok.state.status).toBe(200);
    expect(accountingPeriodReadinessSchema.parse(ok.state.body)).toEqual(READINESS);
    expect(ok.rpc('accounting_period_readiness')[0]!.arg).toEqual({
      p_period: '2026-10',
      p_actor_id: STAFF2.finance,
    });
    const denied = await call({ method: 'GET', path: 'periods/2026-10/readiness', token: TOKEN2.hr });
    expect(denied.state.status).toBe(403);
    expect(denied.rpc('accounting_period_readiness')).toHaveLength(0);
    const bad = await call({ method: 'GET', path: 'periods/2026-13/readiness', token: TOKEN2.finance });
    expect(bad.state.status).toBe(400);
  });

  it('maps PERIOD_HAS_BLOCKERS on submit to a readable 409', async () => {
    const out = await call({
      method: 'POST',
      path: 'periods/2026-10/submit',
      token: TOKEN2.finance,
      rpcError: { fn: 'submit_accounting_period', message: 'PERIOD_HAS_BLOCKERS' },
    });
    expect(out.state.status).toBe(409);
    expect(JSON.stringify(out.state.body)).toContain(
      'Resolve the blockers listed in Readiness before submitting this period.',
    );
  });

  it('gives a sales role nothing', async () => {
    for (const [method, path] of [
      ['GET', 'periods'],
      ['GET', 'periods/2026-10/readiness'],
      ['POST', 'periods/2026-10/submit'],
      ['POST', 'periods/2026-10/close'],
    ] as const) {
      const out = await call({ method, path, token: TOKEN2.salesManager });
      expect(out.state.status, path).toBe(403);
    }
  });
});
