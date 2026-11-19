/**
 * Commission operations routes (commissions family). SQL owns every rule; these
 * tests pin who may call what, that the actor is always the session, and that
 * bodies are validated before any rpc runs.
 */
import {
  commissionPayoutSchema,
  commissionRecoveryCaseSchema,
  externalEvidenceListSchema,
} from '@afhomes/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  TOKEN,
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

const commissions = (await import('./commissions.js')).default;

const C = '30303030-0000-4000-8000-0000000000c1';
const P = '30303030-0000-4000-8000-0000000000d1';
const R = '30303030-0000-4000-8000-0000000000e1';
const RESULT = '30303030-0000-4000-8000-0000000000f1';

const payoutRow = {
  id: P,
  commission_id: C,
  amount: '2400.00',
  status: 'paid',
  bank_reference: 'BNK-1',
  method: null,
  paid_on: '2026-11-10',
  failure_reason: null,
  recorded_by: STAFF2.finance,
  recorded_at: '2026-11-10T01:00:00.000Z',
  reconciled_by: null,
  reconciled_at: null,
};
const recoveryRow = {
  id: R,
  commission_id: C,
  trigger_kind: 'rescission',
  payment_adjustment_id: null,
  proposed_amount: '1000.00',
  recovered_amount: '0.00',
  reason: 'Sale rescinded',
  status: 'proposed',
  requested_by: STAFF2.finance,
  requested_at: '2026-11-11T01:00:00.000Z',
  dismissed_by: null,
  dismissed_at: null,
  dismissal_note: null,
};

const RPCS = [
  'bulk_set_commission_rate',
  'set_commission_hold',
  'record_commission_payout_failure',
  'reconcile_commission_payout',
  'propose_commission_recovery',
  'dismiss_commission_recovery',
  'record_external_payment_evidence',
  'review_commission_payout_evidence_exception',
];

async function call(opts: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  rpcError?: { fn: string; message: string };
  payouts?: Record<string, unknown>[];
  evidence?: Record<string, unknown>[];
}) {
  holder.db = new FakeSupabase({
    tables: phase2World({
      commission_payouts: opts.payouts ?? [payoutRow],
      commission_recovery_cases: [recoveryRow],
      external_payment_evidence: opts.evidence ?? [],
      commission_payout_evidence_reviews: [],
    }),
    tokens: phase2WorldTokens(),
    rpcs: RPCS.map((fn) => ({
      fn,
      result: fn === 'bulk_set_commission_rate' ? { created: 1, replaced: 0 } : RESULT,
    })),
    rpcErrors: opts.rpcError ? { [opts.rpcError.fn]: { message: opts.rpcError.message } } : {},
  });
  const { res, state } = makeRes();
  await commissions(
    makeReq({
      method: opts.method,
      familyPath: opts.path,
      body: opts.body,
      token: opts.token,
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

describe('commission operations', () => {
  it('holds a commission with the session actor and ignores a body actor', async () => {
    const out = await call({
      method: 'POST',
      path: `${C}/hold`,
      token: TOKEN.admin,
      body: { withheld: true, reason: 'Dispute under review', actorId: UUID.superAdminStaff },
    });
    expect(out.state.status).toBe(200);
    expect(out.state.body).toEqual({ id: RESULT });
    expect(out.rpc('set_commission_hold')[0]!.arg).toEqual({
      p_commission_id: C,
      p_actor_id: UUID.adminStaff,
      p_hold: true,
      p_reason: 'Dispute under review',
    });
  });

  it('lists payouts and recoveries in the contract shape', async () => {
    const payouts = await call({ method: 'GET', path: `${C}/payouts`, token: TOKEN2.finance });
    expect(payouts.state.status).toBe(200);
    const pBody = payouts.state.body as { data: unknown[] };
    expect(pBody.data).toHaveLength(1);
    commissionPayoutSchema.parse(pBody.data[0]);
    const rec = await call({ method: 'GET', path: `${C}/recoveries`, token: TOKEN.admin });
    expect(rec.state.status).toBe(200);
    const rBody = rec.state.body as { data: unknown[] };
    expect(rBody.data).toHaveLength(1);
    commissionRecoveryCaseSchema.parse(rBody.data[0]);
  });

  it('records a payout failure for the commission', async () => {
    const out = await call({
      method: 'POST',
      path: `${C}/payouts/fail`,
      token: TOKEN.admin,
      body: { reason: 'Bank rejected transfer', bankReference: 'BNK-9' },
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('record_commission_payout_failure')[0]!.arg).toEqual({
      p_commission_id: C,
      p_actor_id: UUID.adminStaff,
      p_reason: 'Bank rejected transfer',
      p_bank_reference: 'BNK-9',
    });
  });

  it('reconciles a payout', async () => {
    const out = await call({
      method: 'POST',
      path: `payouts/${P}/reconcile`,
      token: TOKEN.admin,
      body: { bankReference: 'BNK-1', paidOn: '2026-11-10' },
    });
    expect(out.state.status).toBe(200);
    expect(out.rpc('reconcile_commission_payout')[0]!.arg).toEqual({
      p_payout_id: P,
      p_actor_id: UUID.adminStaff,
      p_bank_reference: 'BNK-1',
      p_paid_on: '2026-11-10',
      p_date_correction_reason: null,
    });
  });

  it('passes a payment-date correction reason through to SQL', async () => {
    const out = await call({
      method: 'POST',
      path: `payouts/${P}/reconcile`,
      token: TOKEN.admin,
      body: { paidOn: '2026-11-09', dateCorrectionReason: 'Bank statement shows the 9th' },
    });
    expect(out.state.status).toBe(200);
    expect(out.rpc('reconcile_commission_payout')[0]!.arg).toMatchObject({
      p_paid_on: '2026-11-09',
      p_date_correction_reason: 'Bank statement shows the 9th',
    });
    const missing = await call({
      method: 'POST',
      path: `payouts/${P}/reconcile`,
      token: TOKEN.admin,
      body: { paidOn: '2026-11-09' },
      rpcError: {
        fn: 'reconcile_commission_payout',
        message: 'PAYMENT_DATE_CORRECTION_REASON_REQUIRED',
      },
    });
    expect(missing.state.status).toBe(400);
  });

  it('labels a payout with no evidence as an evidence exception', async () => {
    const out = await call({ method: 'GET', path: `${C}/payouts`, token: TOKEN2.finance });
    const row = (out.state.body as { data: Record<string, unknown>[] }).data[0]!;
    expect(row).toMatchObject({
      evidenceStatus: 'EVIDENCE_EXCEPTION',
      evidenceExceptionReviewed: false,
      postingPeriod: '2026-11',
    });
  });

  it('lists payout evidence in the contract shape', async () => {
    const out = await call({ method: 'GET', path: `payouts/${P}/evidence`, token: TOKEN.admin });
    expect(out.state.status).toBe(200);
    const body = externalEvidenceListSchema.parse(out.state.body);
    expect(body.status).toBe('EVIDENCE_EXCEPTION');
    expect(body.items).toEqual([]);
  });

  it('shows how many other payments share a reference', async () => {
    const row = (id: string, subject: string, ref: string, amount = '300.00') => ({
      id,
      subject_type: 'commission_payout',
      subject_id: subject,
      evidence_type: 'external_transaction_reference',
      source: 'BDO',
      storage_path: null,
      transaction_reference: ref,
      or_number: null,
      transfer_amount: amount,
      description: null,
      recorded_by: UUID.adminStaff,
      recorded_at: '2026-11-19T00:00:00.000Z',
    });
    const other = '30303030-0000-4000-8000-0000000000d2';
    const third = '30303030-0000-4000-8000-0000000000d3';
    const out = await call({
      method: 'GET',
      path: `payouts/${P}/evidence`,
      token: TOKEN.admin,
      evidence: [
        row('30303030-0000-4000-8000-0000000000e1', P, 'bulk-0099'),
        // Same reference written differently: counted (normalized like the SQL).
        row('30303030-0000-4000-8000-0000000000e2', other, 'BULK 0099'),
        // Same amount, different reference: not counted.
        row('30303030-0000-4000-8000-0000000000e3', third, 'BULK-0100'),
      ],
    });
    expect(out.state.status).toBe(200);
    const body = externalEvidenceListSchema.parse(out.state.body);
    expect(body.status).toBe('SUPPORTED');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ transferAmount: '300.00', sharedWith: 1 });
  });

  it('records a transaction reference as evidence with the session actor', async () => {
    const out = await call({
      method: 'POST',
      path: `payouts/${P}/evidence`,
      token: TOKEN.admin,
      body: {
        evidenceType: 'external_transaction_reference',
        source: 'BDO statement',
        transactionReference: 'TXN-0001',
        transferAmount: '2400.00',
      },
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('record_external_payment_evidence')[0]!.arg).toEqual({
      p_subject_type: 'commission_payout',
      p_subject_id: P,
      p_evidence: {
        evidenceType: 'external_transaction_reference',
        source: 'BDO statement',
        transactionReference: 'TXN-0001',
        transferAmount: '2400.00',
      },
      p_actor_id: UUID.adminStaff,
    });
  });

  it('refuses a reference without a positive transfer amount, before any rpc', async () => {
    for (const transferAmount of [undefined, '0.00', '12.345']) {
      const out = await call({
        method: 'POST',
        path: `payouts/${P}/evidence`,
        token: TOKEN.admin,
        body: {
          evidenceType: 'official_receipt',
          source: 'OR booklet',
          orNumber: 'OR-1001',
          ...(transferAmount ? { transferAmount } : {}),
        },
      });
      expect(out.state.status).toBe(400);
      expect(out.rpc('record_external_payment_evidence')).toHaveLength(0);
    }
  });

  it('refuses a typed description alone, and a document from another payment, before any rpc', async () => {
    const described = await call({
      method: 'POST',
      path: `payouts/${P}/evidence`,
      token: TOKEN.admin,
      body: { evidenceType: 'external_transaction_reference', source: 'BDO', description: 'Paid' },
    });
    expect(described.state.status).toBe(400);
    const foreign = await call({
      method: 'POST',
      path: `payouts/${P}/evidence`,
      token: TOKEN.admin,
      body: {
        evidenceType: 'uploaded_document',
        source: 'Scan',
        storagePath: `external/commission_payout/${C}/x.pdf`,
      },
    });
    expect(foreign.state.status).toBe(400);
    expect(described.rpc('record_external_payment_evidence')).toHaveLength(0);
    expect(foreign.rpc('record_external_payment_evidence')).toHaveLength(0);
  });

  it('issues no upload grant for a failed payout', async () => {
    const out = await call({
      method: 'POST',
      path: `payouts/${P}/evidence/upload`,
      token: TOKEN.admin,
      body: { contentType: 'application/pdf', size: 1000 },
      payouts: [{ ...payoutRow, status: 'failed' }],
    });
    expect(out.state.status).toBe(404);
  });

  it('records an evidence exception review with a real note', async () => {
    const short = await call({
      method: 'POST',
      path: `payouts/${P}/evidence/exception-review`,
      token: TOKEN.admin,
      body: { note: 'none' },
    });
    expect(short.state.status).toBe(400);
    const ok = await call({
      method: 'POST',
      path: `payouts/${P}/evidence/exception-review`,
      token: TOKEN.admin,
      body: { note: 'Paid in cash; payee gave no receipt' },
    });
    expect(ok.state.status).toBe(200);
    expect(ok.rpc('review_commission_payout_evidence_exception')[0]!.arg).toEqual({
      p_payout_id: P,
      p_note: 'Paid in cash; payee gave no receipt',
      p_actor_id: UUID.adminStaff,
    });
  });

  it('proposes and dismisses a recovery; the actor is the session', async () => {
    const proposed = await call({
      method: 'POST',
      path: `${C}/recoveries`,
      token: TOKEN.superAdmin,
      body: {
        trigger: 'rescission',
        amount: '1000.00',
        reason: 'Sale rescinded',
        requestedBy: STAFF2.finance,
      },
    });
    expect(proposed.state.status).toBe(201);
    expect(proposed.rpc('propose_commission_recovery')[0]!.arg).toEqual({
      p_commission_id: C,
      p_actor_id: UUID.superAdminStaff,
      p_trigger: 'rescission',
      p_amount: '1000.00',
      p_reason: 'Sale rescinded',
    });
    const dismissed = await call({
      method: 'POST',
      path: `recoveries/${R}/dismiss`,
      token: TOKEN.admin,
      body: { reason: 'Raised in error' },
    });
    expect(dismissed.state.status).toBe(200);
    expect(dismissed.rpc('dismiss_commission_recovery')[0]!.arg).toEqual({
      p_case_id: R,
      p_actor_id: UUID.adminStaff,
      p_note: 'Raised in error',
    });
  });

  it('rejects invalid bodies with 400 before any rpc runs', async () => {
    const cases: [string, unknown][] = [
      [`${C}/hold`, { withheld: true, reason: 'no' }],
      [`${C}/hold`, { reason: 'Long enough reason' }],
      [`${C}/payouts/fail`, { reason: 'x' }],
      [`payouts/${P}/reconcile`, { bankReference: 'BNK-1', paidOn: 'yesterday' }],
      [`${C}/recoveries`, { trigger: 'bogus', amount: '10.00', reason: 'Long enough' }],
      [`${C}/recoveries`, { trigger: 'rescission', amount: '10.555', reason: 'Long enough' }],
      [`${C}/recoveries`, { trigger: 'rescission', amount: '1e3', reason: 'Long enough' }],
      [`${C}/recoveries`, { trigger: 'rescission', amount: '0.00', reason: 'Long enough' }],
      [`recoveries/${R}/dismiss`, { reason: '' }],
    ];
    for (const [path, body] of cases) {
      const out = await call({ method: 'POST', path, token: TOKEN.admin, body });
      expect(out.state.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(out.anyRpc()).toHaveLength(0);
    }
  });

  it('maps SQL errors through the shared error map', async () => {
    const out = await call({
      method: 'POST',
      path: `${C}/recoveries`,
      token: TOKEN.admin,
      body: { trigger: 'rescission', amount: '1000.00', reason: 'Sale rescinded' },
      rpcError: { fn: 'propose_commission_recovery', message: 'COMMISSION_NOT_PAID' },
    });
    expect(out.state.status).toBe(409);
  });

  it('refuses users without commission update (sales manager, HR) on every route', async () => {
    const routes: [string, string, unknown][] = [
      ['POST', `${C}/hold`, { withheld: true, reason: 'Long enough' }],
      ['GET', `${C}/payouts`, undefined],
      ['POST', `${C}/payouts/fail`, { reason: 'Long enough' }],
      ['POST', `payouts/${P}/reconcile`, { paidOn: '2026-11-10' }],
      ['GET', `${C}/recoveries`, undefined],
      ['POST', `${C}/recoveries`, { trigger: 'rescission', amount: '1.00', reason: 'Long enough' }],
      ['POST', `recoveries/${R}/dismiss`, { reason: 'Long enough' }],
    ];
    for (const token of [TOKEN2.salesManager, TOKEN2.hr]) {
      for (const [m, path, body] of routes) {
        const out = await call({ method: m, path, token, body });
        expect(out.state.status, `${m} ${path}`).toBe(403);
        expect(out.anyRpc()).toHaveLength(0);
      }
    }
  });
});

describe('selected-seller rate configuration', () => {
  const body = {
    memberIds: [UUID.adminStaff],
    rate: '0.05',
    effectiveFrom: '2026-11-18',
    actorId: UUID.superAdminStaff,
  };
  it('uses one transaction RPC and the session actor', async () => {
    const out = await call({ method: 'POST', path: 'rules/bulk', token: TOKEN.admin, body });
    expect(out.state.status).toBe(200);
    expect(out.state.body).toEqual({ created: 1, replaced: 0 });
    expect(out.rpc('bulk_set_commission_rate')[0]!.arg).toEqual({
      p_member_ids: body.memberIds,
      p_rate: body.rate,
      p_effective_from: body.effectiveFrom,
      p_actor_id: UUID.adminStaff,
    });
  });
  it('rejects unauthorized users and malformed input before any RPC', async () => {
    const denied = await call({
      method: 'POST',
      path: 'rules/bulk',
      token: TOKEN2.salesManager,
      body,
    });
    expect(denied.state.status).toBe(403);
    expect(denied.anyRpc()).toHaveLength(0);
    for (const value of [
      { ...body, rate: '5' },
      { ...body, memberIds: [] },
      { ...body, memberIds: [UUID.adminStaff, UUID.adminStaff] },
    ]) {
      const out = await call({
        method: 'POST',
        path: 'rules/bulk',
        token: TOKEN.admin,
        body: value,
      });
      expect(out.state.status).toBe(400);
      expect(out.anyRpc()).toHaveLength(0);
    }
  });
  it('reports a rejected selection without claiming any save', async () => {
    const out = await call({
      method: 'POST',
      path: 'rules/bulk',
      token: TOKEN.admin,
      body,
      rpcError: { fn: 'bulk_set_commission_rate', message: 'COMMISSION_SELLER_NOT_ELIGIBLE' },
    });
    expect(out.state.status).toBe(400);
  });
});
