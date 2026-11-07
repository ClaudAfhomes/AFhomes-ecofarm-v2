/**
 * Customer creation ordering (BR-RATE-06).
 *
 * Company rule: invalid inputs generate NO number (A2 Control Panel A23).
 * In v2 terms: a duplicate government ID or email must be rejected before
 * `next_customer_number` is consumed, so a refused registration burns no
 * customer number. The unique constraint on insert stays as the race net.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  LINKS,
  TOKEN,
  UNIQUE,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import type { FakeTables } from '../_lib/testing/supabase-fake.js';

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

const customers = (await import('./customers.js')).default;

const VALID_CUSTOMER = {
  firstName: 'Ana',
  middleName: 'R',
  lastName: 'Reyes',
  dateOfBirth: '1993-04-05',
  gender: 'female',
  email: 'ana.reyes@example.com',
  phone: '09185550999',
  address: { line1: '77 Katipunan', city: 'Quezon City', province: 'Metro Manila' },
  governmentIdType: 'philippine_id',
  governmentIdNumber: '7788-9900-1122',
};

function install(overrides: Partial<FakeTables> = {}) {
  holder.db = new FakeSupabase({
    tables: phase2World(overrides as never),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [{ fn: 'next_customer_number', result: [{ customer_number: 'CUS-920001' }] }],
  });
  return holder.db as FakeSupabase;
}

const numberCalls = (db: FakeSupabase) =>
  db.calls.filter((c) => c.table === 'next_customer_number');

describe('POST /customers ordering (BR-RATE-06: duplicates before number)', () => {
  it('rejects a duplicate government ID before consuming a customer number', async () => {
    const db = install();
    const before = db.rows('customers').length;
    const { res, state } = makeRes();
    await customers(
      makeReq({
        method: 'POST',
        familyPath: '',
        // '0011-2233-4455' belongs to the fixture prospect (CUSTOMER.prospect).
        body: { ...VALID_CUSTOMER, governmentIdNumber: '0011-2233-4455' },
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
    expect(numberCalls(db)).toHaveLength(0);
    expect(db.rows('customers')).toHaveLength(before);
  });

  it('rejects a duplicate email before consuming a customer number', async () => {
    const db = install();
    const before = db.rows('customers').length;
    const { res, state } = makeRes();
    await customers(
      makeReq({
        method: 'POST',
        familyPath: '',
        // 'juan@example.com' belongs to the fixture prospect.
        body: { ...VALID_CUSTOMER, email: 'juan@example.com' },
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
    expect(numberCalls(db)).toHaveLength(0);
    expect(db.rows('customers')).toHaveLength(before);
  });

  it('issues exactly one customer number per registered customer', async () => {
    const db = install();
    const { res, state } = makeRes();
    await customers(
      makeReq({
        method: 'POST',
        familyPath: '',
        body: VALID_CUSTOMER,
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    expect(numberCalls(db)).toHaveLength(1);
    expect((state.body as { customerNumber: string }).customerNumber).toMatch(/^CUS-/);
  });
});
