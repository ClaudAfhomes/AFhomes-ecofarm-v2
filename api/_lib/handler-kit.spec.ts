import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapRpcError } from './handler-kit.js';

function capture() {
  const state = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.status = code;
      return { json: (body: unknown) => void (state.body = body) };
    },
  };
  return { res: res as never, state };
}

describe('mapRpcError hierarchy codes (D4)', () => {
  it('maps an incomplete seller hierarchy to 409 without internals', () => {
    const { res, state } = capture();
    mapRpcError(res, { message: 'SALE_COMPLETE_HIERARCHY_REQUIRED' });
    expect(state.status).toBe(409);
    const body = state.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('Complete the seller hierarchy before creating this sale.');
    expect(JSON.stringify(body)).not.toContain('SALE_COMPLETE_HIERARCHY_REQUIRED');
    expect(JSON.stringify(body)).not.toContain('23514');
  });
  it('maps an over-deep hierarchy to 409 without internals', () => {
    const { res, state } = capture();
    mapRpcError(res, { message: 'SALE_HIERARCHY_TOO_DEEP' });
    expect(state.status).toBe(409);
    expect((state.body as { error: { code: string } }).error.code).toBe('CONFLICT');
  });
  it('keeps unknown failures as opaque 500s', () => {
    const { res, state } = capture();
    mapRpcError(res, { message: 'something entirely unexpected' });
    expect(state.status).toBe(500);
    expect((state.body as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});

describe('operational sale reference conflicts', () => {
  it('maps SQLSTATE 42501 SALE_REFERENCE_CONFLICT to a controlled 409', () => {
    const { res, state } = capture();
    mapRpcError(res, { code: '42501', message: 'SALE_REFERENCE_CONFLICT' });
    expect(state.status).toBe(409);
    expect(state.body).toMatchObject({ error: { code: 'CONFLICT' } });
    expect(JSON.stringify(state.body)).not.toContain('42501');
    expect(JSON.stringify(state.body)).not.toContain('SALE_REFERENCE_CONFLICT');
  });
  it('does not turn an unrelated permission failure into success or conflict', () => {
    const { res, state } = capture();
    mapRpcError(res, { code: '42501', message: 'permission denied for function unexpected' });
    expect(state.status).toBe(500);
    expect(state.body).toMatchObject({ error: { code: 'INTERNAL' } });
  });
});

describe('purchase workflow error codes never surface as a 500', () => {
  // Tripwire: every code the purchase-workflow migrations raise must be mapped.
  // An unmapped code falls through to "Internal server error" (e.g. an
  // overpayment refusal looked like a server crash to Finance).
  const migrations = [
    '20261230000003_afhomes_finance_evidence_overpayment.sql',
    '20261231000001_afhomes_workflow_integrity_repair.sql',
    '20270105000001_afhomes_finops_foundation.sql',
    '20270105000002_afhomes_finops_payments.sql',
    '20270105000003_afhomes_finops_periods.sql',
  ];
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const codes = new Set<string>();
  for (const file of migrations) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    for (const m of sql.matchAll(/raise exception '([A-Z][A-Z_]+)'/g)) codes.add(m[1]!);
  }
  // MUTATION_RECEIPT_INVALID means the server built a malformed replay receipt:
  // an internal invariant failure, where a 500 is the honest answer.
  codes.delete('MUTATION_RECEIPT_INVALID');
  // Raised only while the migration itself runs, never by a request.
  for (const code of [...codes])
    if (/_PATCH_DRIFT$|_BYPASS_REMAINS$|_DUPLICATES_PRESENT$/.test(code)) codes.delete(code);
  // Removed by section 22 (the uploader may review their own document); the
  // code only survives in the superseded function text earlier in the file.
  codes.delete('SIGNED_DOCUMENT_SELF_REVIEW');

  it('finds the codes to check', () => {
    expect(codes.size).toBeGreaterThan(40);
    expect(codes.has('OVERPAYMENT_NOT_ALLOWED')).toBe(true);
  });

  for (const code of [...codes].sort()) {
    it(`maps ${code}`, () => {
      const { res, state } = capture();
      mapRpcError(res, { message: code });
      expect(state.status).not.toBe(500);
      expect(JSON.stringify(state.body)).not.toContain(code);
    });
  }
});
