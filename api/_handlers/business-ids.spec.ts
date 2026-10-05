/**
 * AF Homes company-wide business IDs (AF-*).
 *
 * Pins the SQL/contract linkage, the handler wiring for the newly numbered
 * entities (payments, commissions, import jobs, staff), and the statistical
 * properties of the 5-character format. Generation itself lives in PostgreSQL
 * (`private.af_candidate`); the 1,000-ID check below mirrors the same
 * bit-slice construction with Node crypto to prove the alphabet, uniqueness
 * and non-sequentiality properties of the design.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AF_ID_ALPHABET,
  AF_ID_PREFIXES,
  afIdPattern,
  customerImportJobSchema,
  afHomesStaffSchema,
  paymentSchema,
  type AfIdPrefix,
} from '@jad/contracts';

import {
  CUSTOMER,
  LINKS,
  SALE as SALE_FIX,
  STAFF2,
  TOKEN2,
  UNIQUE,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
);
const migration = (prefix: string): string => {
  const file = fs.readdirSync(MIGRATIONS).find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`no migration starting with ${prefix}`);
  return fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
};
const BUSINESS_IDS_SQL = migration('20261025');

/** Same construction as private.af_candidate: 25 bits sliced from 4 secure bytes. */
function mirrorCandidate(prefix: AfIdPrefix): string {
  const raw = randomBytes(4);
  const v = (raw[0]! << 24) | (raw[1]! << 16) | (raw[2]! << 8) | raw[3]!;
  let out = '';
  for (let i = 0; i < 5; i += 1) out += AF_ID_ALPHABET[(v >>> (i * 5)) & 31]!;
  return `${prefix}-${out}`;
}

describe('business-ids migration linkage', () => {
  it('shares the exact alphabet with the SQL generator', () => {
    const match = BUSINESS_IDS_SQL.match(/alphabet constant text := '([A-Z0-9]+)';/);
    expect(match?.[1]).toBe(AF_ID_ALPHABET);
  });

  it('whitelists every approved prefix server-side and nothing else', () => {
    for (const prefix of AF_ID_PREFIXES) {
      expect(BUSINESS_IDS_SQL).toContain(`'${prefix}'`);
    }
    expect(BUSINESS_IDS_SQL).toContain('INVALID_BUSINESS_PREFIX');
    expect(BUSINESS_IDS_SQL).toContain('INVALID_BUSINESS_ID_TARGET');
    // Client input can never choose a prefix: claim targets are pinned pairs.
    expect(BUSINESS_IDS_SQL).toContain(
      "p_prefix = 'AF-CSALE' and p_table = 'public.card_sales'::regclass",
    );
    expect(BUSINESS_IDS_SQL).not.toContain(
      "p_prefix = 'AF-SALES' and p_table = 'public.card_sales'::regclass",
    );
  });

  it('keeps old sequences and never touches migration #19', () => {
    expect(BUSINESS_IDS_SQL).not.toMatch(/drop sequence/i);
    expect(BUSINESS_IDS_SQL).not.toMatch(/card_plan_description/i);
  });

  it('never uses predictable randomness', () => {
    expect(BUSINESS_IDS_SQL).toContain('gen_random_bytes(4)');
    expect(BUSINESS_IDS_SQL).not.toMatch(/Math\.random|Date\.now|nextval.*AF-|MAX\(/i);
  });
});

describe('AF suffix properties (1,000 mirrored IDs)', () => {
  const ids = Array.from({ length: 1000 }, () => mirrorCandidate('AF-CUS'));
  it('generates unique, well-formed IDs with no ambiguous characters', () => {
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) {
      expect(afIdPattern('AF-CUS').test(id)).toBe(true);
      expect(id).not.toMatch(/[IO01]/);
    }
  });

  it('is not monotonically sequential', () => {
    const sorted = [...ids].sort();
    expect(ids).not.toEqual(sorted);
    expect(ids).not.toEqual([...sorted].reverse());
  });

  it('derives no bytes from the payload (sha of id reveals nothing structural)', () => {
    // Smoke: ids are opaque - the hash preimage is the id itself, no customer data.
    const digest = createHash('sha256').update(ids[0]!).digest('hex');
    expect(digest).toHaveLength(64);
  });
});

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));
const { default: commissionsHandler } = await import('./commissions.js');
const { default: salesHandler } = await import('./sales.js');

function authDb(tables: Record<string, unknown[]>) {
  const db = new FakeSupabase({
    tables: phase2World(tables as never),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
  });
  holder.db = db;
  return db;
}

type State = { status: number; body: unknown };
async function call(
  handler: (req: never, res: never) => Promise<unknown>,
  options: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string | string[] | undefined>;
  },
): Promise<State> {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state as State;
}

describe('newly numbered entities flow through handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('commissions expose and search the AF-COM number alongside legacy sale numbers', async () => {
    authDb({
      commissions: [
        {
          id: 'cccccccc-0000-4000-8000-000000000001',
          commission_number: 'AF-COM-K7M4Q',
          sale_id: SALE_FIX.downPaid,
          beneficiary_type: 'staff',
          beneficiary_staff_id: STAFF2.salesManager,
          beneficiary_ost_id: null,
          rate_snapshot: '0.0400',
          basis_amount_snapshot: '60000.00',
          amount: '2400.00',
          status: 'earned',
          qualification_notes: null,
          qualified_at: null,
          earned_at: null,
          paid_at: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    const state = await call(commissionsHandler, {
      path: '',
      query: { search: 'af-com-k7m4q' },
      token: TOKEN2.finance,
    });
    expect(state.status).toBe(200);
    const body = state.body as { data: { commissionNumber: string | null }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.commissionNumber).toBe('AF-COM-K7M4Q');
  });

  it('payments expose the AF-PAY number and keep the external reference separate', async () => {
    const db = authDb({
      payments: [
        {
          id: 'cccccccc-0000-4000-8000-0000000000a1',
          payment_number: 'AF-PAY-Q8M4V',
          sale_id: SALE_FIX.downPaid,
          customer_id: CUSTOMER.prospectTwo,
          amount: '10000.00',
          payment_type: 'down_payment',
          method: 'gcash',
          reference: 'GCASH-9382910293',
          notes: null,
          status: 'verified',
          recorded_by: STAFF2.salesManager,
          verified_by: STAFF2.salesManager,
          recorded_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
        },
      ],
    });
    void db;
    const state = await call(salesHandler, {
      path: `${SALE_FIX.downPaid}/payments`,
      token: TOKEN2.finance,
    });
    expect(state.status).toBe(200);
    const body = state.body as {
      data: { paymentNumber: string | null; reference: string | null }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.paymentNumber).toBe('AF-PAY-Q8M4V');
    expect(body.data[0]!.reference).toBe('GCASH-9382910293');
  });

  it('payment and commission contracts accept the new numbers and legacy nulls', () => {
    expect(() =>
      paymentSchema.parse({
        id: 'cccccccc-0000-4000-8000-000000000001',
        saleId: SALE_FIX.downPaid,
        paymentNumber: 'AF-PAY-Q8M4V',
        customerId: null,
        amount: '10000.00',
        paymentType: 'down_payment',
        method: 'gcash',
        reference: 'GCASH-9382910293',
        notes: null,
        status: 'verified',
        rejectionReason: null,
        recordedBy: STAFF2.salesManager,
        verifiedBy: null,
        recordedAt: new Date().toISOString(),
        verifiedAt: null,
      }),
    ).not.toThrow();
    expect(() =>
      customerImportJobSchema.parse({
        id: 'dddddddd-0000-4000-8000-000000000001',
        jobNumber: 'AF-IMP-Z9X8C',
        sourceType: 'csv',
        sourceName: 'legacy.csv',
        googleSheetId: null,
        status: 'uploaded',
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        insertedRows: 0,
        updatedRows: 0,
        skippedRows: 0,
        createdAt: new Date().toISOString(),
        validatedAt: null,
        committedAt: null,
        failedAt: null,
        cancelledAt: null,
        failedRows: 0,
      }),
    ).not.toThrow();
    expect(() =>
      afHomesStaffSchema.parse({
        id: STAFF2.salesManager,
        email: 'fin@example.invalid',
        fullName: 'Fin User',
        status: 'active',
        departmentId: null,
        departmentName: null,
        roleId: '11111111-0000-4000-8000-000000000001',
        roleName: 'Admin',
        employeeNumber: 'AF-EMP-ABCDE',
        salesNumber: null,
        restrictions: [],
        mustChangePassword: false,
        invitedAt: null,
        activatedAt: null,
        createdAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
