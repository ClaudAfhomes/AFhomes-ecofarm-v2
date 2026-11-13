/**
 * Finance Phase 2 routes: receipt details on record, cross-contract duplicate
 * review, and propose-only adjustments. The SQL holds the rules; these tests pin
 * authorization and that the actor always comes from the session.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  SALE,
  TOKEN2,
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

async function call(opts: { method: string; path: string; token: string; body?: unknown }) {
  holder.db = new FakeSupabase({
    tables: phase2World({ payment_adjustments: [] }),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      { fn: 'record_card_payment_once', result: PAY },
      { fn: 'set_payment_receipt_details', result: PAY },
      { fn: 'payment_reference_matches', result: [] },
      { fn: 'propose_payment_adjustment', result: PAY },
    ],
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
