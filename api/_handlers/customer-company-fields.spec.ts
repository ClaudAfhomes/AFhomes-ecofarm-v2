/**
 * Company-stated membership fields on the combined customer record
 * (migration 20261130000001).
 *
 * - Manual create/update persist verbatim company fields.
 * - TIN values are write-only: masked on read, absent from raw JSON, and
 *   absent from audit payloads (same treatment as government ID numbers).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
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
  email: 'ana.company@example.com',
  phone: '09185550999',
  address: { line1: '77 Katipunan', city: 'Quezon City', province: 'Metro Manila' },
};

const COMPANY_FIELDS = {
  raNumber: 'RA-2026-0001',
  companyStatus: 'Active Member',
  citizenship: 'Filipino',
  civilStatus: 'Single',
  tinNumber: '123456789012',
  occupationBusinessName: 'Engineer',
  officeBusinessAddress: 'Makati HQ',
  employedPosition: 'Engineer II',
  supplementaryFullName: 'Maria Clara',
  supplementaryBirthday: '1992-08-10',
  supplementaryGender: 'female',
  supplementaryMobile: '09181234567',
  supplementaryEmail: 'maria@example.com',
  ostIstName: 'OST Silk',
  svdName: 'SVD Santos',
  referrerName: 'Ref Reyes',
  relatedContactNo: '09191111111',
  relatedEmail: 'related@example.com',
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

describe('customer company-stated fields', () => {
  it('stores company fields verbatim while masking TIN on read', async () => {
    const db = install();
    const { res, state } = makeRes();
    await customers(
      makeReq({
        method: 'POST',
        familyPath: '',
        body: { ...VALID_CUSTOMER, ...COMPANY_FIELDS },
        token: TOKEN.admin,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    const body = state.body as Record<string, unknown>;
    // Stored verbatim.
    const row = db.rows('customers').find((r) => r.email === 'ana.company@example.com')!;
    expect(row.tin_number).toBe('123456789012');
    expect(row.ra_number).toBe('RA-2026-0001');
    expect(row.supplementary_full_name).toBe('Maria Clara');
    expect(row.svd_name).toBe('SVD Santos');
    // Masked on read; raw values never leave through the API.
    expect(body.tinNumberMasked).toBe('********9012');
    expect(body).not.toHaveProperty('tin_number');
    expect(JSON.stringify(state.body)).not.toContain('123456789012');
    expect(body.raNumber).toBe('RA-2026-0001');
    expect(body.supplementaryMobile).toBe('+639181234567');
    // Audit carries no raw TIN.
    const audits = db
      .rows('audit_events')
      .filter((r) => r.action === 'CUSTOMER_CREATED')
      .map((r) => JSON.stringify(r));
    expect(audits.length).toBe(1);
    expect(audits[0]).not.toContain('123456789012');
  });

  it('updates and clears company fields without leaking TIN to audit', async () => {
    const db = install();
    const id = CUSTOMER.prospectTwo;
    const patchRes = makeRes();
    await customers(
      makeReq({
        method: 'PATCH',
        familyPath: id,
        body: { ...COMPANY_FIELDS, email: undefined, tinNumber: '999888777001' },
        token: TOKEN.admin,
      }) as never,
      patchRes.res as never,
    );
    expect(patchRes.state.status).toBe(200);
    expect((patchRes.state.body as Record<string, unknown>).tinNumberMasked).toContain('7001');
    const stored = db.rows('customers').find((r) => r.id === id)!;
    expect(stored.tin_number).toBe('999888777001');

    const clearRes = makeRes();
    await customers(
      makeReq({
        method: 'PATCH',
        familyPath: id,
        body: { tinNumber: null, svdName: null },
        token: TOKEN.admin,
      }) as never,
      clearRes.res as never,
    );
    expect(clearRes.state.status).toBe(200);
    const cleared = db.rows('customers').find((r) => r.id === id)!;
    expect(cleared.tin_number).toBeNull();
    expect(cleared.svd_name).toBeNull();
    const audits = db
      .rows('audit_events')
      .filter((r) => r.action === 'CUSTOMER_EDITED')
      .map((r) => JSON.stringify(r));
    expect(audits.join('|')).not.toContain('999888777001');
  });
});
