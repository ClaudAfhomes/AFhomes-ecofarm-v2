/**
 * Finance Phase 2 routes: receipt details on record, cross-contract duplicate
 * review, and propose-only adjustments. The SQL holds the rules; these tests pin
 * authorization and that the actor always comes from the session.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  paymentAdjustmentResolutionGateSchema,
  paymentAdjustmentSchema,
  resolvePaymentAdjustmentResultSchema,
} from '@afhomes/contracts';

import {
  SALE,
  TOKEN,
  TOKEN2,
  UUID,
  moduleId,
  STAFF2,
  UNIQUE,
  LINKS,
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

const sales = (await import('./sales.js')).default;

const PAY = 'cccccccc-0000-4000-8000-0000000000aa';

const ADJ = 'cccccccc-0000-4000-8000-0000000000bb';

async function call(opts: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  q13?: 'pending' | 'approved';
  rpcError?: string;
  adjustments?: Record<string, unknown>[];
}) {
  const tables = phase2World({
    payment_adjustments: opts.adjustments ?? [],
    governing_policy_decisions: [
      { key: 'Q13_PAYMENT_ADJUSTMENT_AUTHORITY', status: opts.q13 ?? 'pending', note: null },
    ],
  });
  // The fixture world predates migration 20270105000007: add the module (no role row grants it).
  (tables.modules as Record<string, unknown>[]).push({
    id: moduleId('finance.payment_adjustment_decision'),
    key: 'finance.payment_adjustment_decision',
    name: 'Payment Adjustment Decisions',
    group_name: 'Finance',
    sort_order: 49,
    is_active: true,
  });
  holder.db = new FakeSupabase({
    tables,
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      { fn: 'record_card_payment_once', result: PAY },
      { fn: 'set_payment_receipt_details', result: PAY },
      { fn: 'payment_reference_matches', result: [] },
      { fn: 'propose_payment_adjustment', result: PAY },
      {
        fn: 'resolve_payment_adjustment',
        result: (args: Record<string, unknown>) => String(args.p_decision),
      },
    ],
    rpcErrors: opts.rpcError ? { resolve_payment_adjustment: { message: opts.rpcError } } : {},
  });
  const { res, state } = makeRes();
  await sales(
    makeReq({
      method: opts.method,
      familyPath: opts.path,
      body: opts.body,
      token: opts.token,
    }) as never,
    res as never,
  );
  const db = holder.db as FakeSupabase;
  return { state, rpc: (fn: string) => db.calls.filter((c) => c.table === fn) };
}

describe('Finance Phase 2 payment routes', () => {
  it('stores OR number, payment date and payer on the payment just recorded', async () => {
    const out = await call({
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN2.finance,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '100.00',
        paymentType: 'installment',
        method: 'cash',
        receiptStoragePath: `sale/${SALE.unpaid}/receipt.pdf`,
        orNumber: 'OR-1005',
        paidOn: '2026-01-15',
        paidByName: 'A Relative',
      },
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('set_payment_receipt_details')[0]!.arg).toEqual({
      p_payment_id: PAY,
      p_actor_id: STAFF2.finance,
      p_details: { orNumber: 'OR-1005', paidOn: '2026-01-15', paidByName: 'A Relative' },
    });
  });

  it('makes no details call when none were sent', async () => {
    const out = await call({
      method: 'POST',
      path: `${SALE.unpaid}/payments`,
      token: TOKEN2.finance,
      body: {
        requestId: '99999999-9999-4999-8999-999999999999',
        amount: '100.00',
        paymentType: 'installment',
        method: 'cash',
        receiptStoragePath: `sale/${SALE.unpaid}/receipt.pdf`,
      },
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('set_payment_receipt_details')).toHaveLength(0);
  });

  it('records a duplicate-review reason with the session actor; too short is refused', async () => {
    const ok = await call({
      method: 'POST',
      path: `payments/${PAY}/duplicate-review`,
      token: TOKEN2.finance,
      body: { duplicateReviewNote: 'One transfer split across two contracts', actorId: 'spoof' },
    });
    expect(ok.state.status).toBe(200);
    expect(ok.rpc('set_payment_receipt_details')[0]!.arg).toEqual({
      p_payment_id: PAY,
      p_actor_id: STAFF2.finance,
      p_details: { duplicateReviewNote: 'One transfer split across two contracts' },
    });
    const short = await call({
      method: 'POST',
      path: `payments/${PAY}/duplicate-review`,
      token: TOKEN2.finance,
      body: { duplicateReviewNote: 'ok' },
    });
    expect(short.state.status).toBe(400);
    expect(short.rpc('set_payment_receipt_details')).toHaveLength(0);
  });

  it('proposes an adjustment and never sends a status or approver', async () => {
    const out = await call({
      method: 'POST',
      path: `payments/${PAY}/adjustments`,
      token: TOKEN2.finance,
      body: {
        kind: 'returned_check',
        amount: '150000.00',
        reason: 'Check returned by the bank',
        effectiveDate: '2026-11-12',
        status: 'approved',
      },
    });
    expect(out.state.status).toBe(201);
    expect(out.rpc('propose_payment_adjustment')[0]!.arg).toEqual({
      p_payment_id: PAY,
      p_actor_id: STAFF2.finance,
      p_kind: 'returned_check',
      p_amount: '150000.00',
      p_reason: 'Check returned by the bank',
      p_effective_date: '2026-11-12',
      p_evidence_path: null,
    });
  });

  it('refuses callers without Finance permission, and malformed ids', async () => {
    for (const [method, tail, body] of [
      ['GET', 'reference-matches', undefined],
      ['POST', 'duplicate-review', { duplicateReviewNote: 'A valid reason' }],
      ['GET', 'adjustments', undefined],
      [
        'POST',
        'adjustments',
        { kind: 'refund', amount: '1.00', reason: 'A valid reason', effectiveDate: '2026-11-12' },
      ],
    ] as const) {
      const denied = await call({
        method,
        path: `payments/${PAY}/${tail}`,
        token: TOKEN2.hr,
        body,
      });
      expect(denied.state.status, `${method} ${tail}`).toBe(403);
    }
    const bad = await call({
      method: 'GET',
      path: 'payments/abc/reference-matches',
      token: TOKEN2.finance,
    });
    expect(bad.state.status).toBe(404);
  });
});

describe('Payment adjustment resolution (Q13 gated)', () => {
  const PROPOSED = {
    id: ADJ,
    payment_id: PAY,
    kind: 'refund',
    amount: '100.00',
    reason: 'Customer refund request',
    effective_date: '2026-11-12',
    status: 'proposed',
    requested_by: STAFF2.finance,
    requested_at: '2026-11-12T01:00:00.000Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    posting_period: null,
  };
  const resolve = (token: string, body: unknown, extra: Record<string, unknown> = {}) =>
    call({
      method: 'POST',
      path: `payments/${PAY}/adjustments/${ADJ}/resolve`,
      token,
      body,
      adjustments: [PROPOSED],
      q13: 'approved',
      ...extra,
    });

  for (const decision of ['approved', 'rejected', 'withdrawn'] as const) {
    it(`${decision}: Super Admin resolves with the session actor`, async () => {
      const out = await resolve(TOKEN.superAdmin, {
        decision,
        note: 'Checked against the bank statement',
        actorId: 'spoof',
      });
      expect(out.state.status).toBe(200);
      expect(resolvePaymentAdjustmentResultSchema.parse(out.state.body)).toEqual({
        id: ADJ,
        status: decision,
      });
      expect(out.rpc('resolve_payment_adjustment')[0]!.arg).toEqual({
        p_adjustment_id: ADJ,
        p_decision: decision,
        p_note: 'Checked against the bank statement',
        p_actor_id: UUID.superAdminStaff,
      });
    });
  }

  it('refuses Finance (verification rights are not decision rights) and sends no RPC', async () => {
    const out = await resolve(TOKEN2.finance, { decision: 'approved', note: 'Looks right to me' });
    expect(out.state.status).toBe(403);
    expect(out.rpc('resolve_payment_adjustment')).toHaveLength(0);
  });

  it('maps Q13 pending to a readable 409 that says nothing changed', async () => {
    const out = await resolve(
      TOKEN.superAdmin,
      { decision: 'approved', note: 'Checked against the bank statement' },
      { rpcError: 'PAYMENT_ADJUSTMENT_AUTHORITY_PENDING', q13: 'pending' },
    );
    expect(out.state.status).toBe(409);
    const message = JSON.stringify(out.state.body);
    expect(message).toContain('Q13');
    expect(message).toContain('Nothing was changed');
    expect(message).not.toContain('PAYMENT_ADJUSTMENT_AUTHORITY_PENDING');
  });

  it('maps the other resolution codes', async () => {
    for (const [code, status] of [
      ['PAYMENT_ADJUSTMENT_ALREADY_RESOLVED', 409],
      ['PAYMENT_ADJUSTMENT_SELF_DECISION', 403],
      ['PAYMENT_ADJUSTMENT_NOT_FOUND', 404],
      ['PAYMENT_ADJUSTMENT_NOTE_REQUIRED', 400],
      ['PAYMENT_ADJUSTMENT_DECISION_INVALID', 400],
      ['PAYMENT_ADJUSTMENT_DIRECT_WRITE_REFUSED', 403],
    ] as const) {
      const out = await resolve(
        TOKEN.superAdmin,
        { decision: 'rejected', note: 'Not supported by evidence' },
        { rpcError: code },
      );
      expect(out.state.status, code).toBe(status);
    }
  });

  it('validates the body before any RPC', async () => {
    for (const body of [
      { decision: 'deleted', note: 'A valid note here' },
      { decision: 'approved', note: 'no' },
      { decision: 'approved' },
      undefined,
    ]) {
      const out = await resolve(TOKEN.superAdmin, body);
      expect(out.state.status).toBe(400);
      expect(out.rpc('resolve_payment_adjustment')).toHaveLength(0);
    }
  });

  it('404s an adjustment that does not belong to the payment', async () => {
    const out = await resolve(
      TOKEN.superAdmin,
      { decision: 'rejected', note: 'Not supported by evidence' },
      { adjustments: [{ ...PROPOSED, payment_id: 'cccccccc-0000-4000-8000-0000000000ff' }] },
    );
    expect(out.state.status).toBe(404);
    expect(out.rpc('resolve_payment_adjustment')).toHaveLength(0);
  });

  it('reports the read-only gate and exposes resolution fields on the list', async () => {
    const pending = await call({
      method: 'GET',
      path: 'payments/adjustment-resolution-gate',
      token: TOKEN.superAdmin,
    });
    expect(paymentAdjustmentResolutionGateSchema.parse(pending.state.body)).toEqual({
      q13Status: 'pending',
      canDecide: true,
      authorized: false,
    });
    const finance = await call({
      method: 'GET',
      path: 'payments/adjustment-resolution-gate',
      token: TOKEN2.finance,
      q13: 'approved',
    });
    expect(finance.state.body).toEqual({ q13Status: 'approved', canDecide: false, authorized: false });
    const hr = await call({
      method: 'GET',
      path: 'payments/adjustment-resolution-gate',
      token: TOKEN2.hr,
    });
    expect(hr.state.status).toBe(403);

    const approvedRow = {
      ...PROPOSED,
      status: 'approved',
      decided_by: UUID.superAdminStaff,
      decided_at: '2026-11-13T02:00:00.000Z',
      decision_note: 'Checked against the bank statement',
      posting_period: '2026-11',
    };
    const listed = await call({
      method: 'GET',
      path: `payments/${PAY}/adjustments`,
      token: TOKEN2.finance,
      adjustments: [approvedRow],
    });
    expect(listed.state.status).toBe(200);
    const [row] = (listed.state.body as { data: unknown[] }).data;
    expect(paymentAdjustmentSchema.parse(row)).toMatchObject({
      status: 'approved',
      decidedBy: UUID.superAdminStaff,
      decisionNote: 'Checked against the bank statement',
      postingPeriod: '2026-11',
    });
  });
});
