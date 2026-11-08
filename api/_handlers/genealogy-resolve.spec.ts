import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  phase2World,
  phase2WorldTokens,
  STAFF2,
  TOKEN,
  TOKEN2,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const handler = (await import('./genealogy.js')).default;

/** The same VD -> SSM -> SM -> OST chain `phase2World()` seeds by default
 * (STAFF2), each holding the AA number its role implies. */
const AA: Record<string, string> = {
  [STAFF2.ost]: 'AAO26100001',
  [STAFF2.salesManager]: 'AAI26050002',
  [STAFF2.seniorSalesManager]: 'AAI26040003',
  [STAFF2.viceDirector]: 'AAI26030004',
};

function install() {
  holder.db = new FakeSupabase({
    tables: phase2World({}),
    tokens: phase2WorldTokens(),
    rpcs: [
      {
        fn: 'search_sale_team_accreditation',
        result: (args: Record<string, unknown>) => {
          const aaNumber = args.p_aa_number;
          const staffId = Object.entries(AA).find(([, number]) => number === aaNumber)?.[0];
          if (!staffId) return null;
          return {
            staffId,
            fullName: staffId === STAFF2.ost ? 'OST Seller' : 'Sales Manager',
            aaNumber,
            kind: 'OST',
            status: 'accredited',
          };
        },
      },
      {
        fn: 'get_sale_team_accreditation',
        result: (args: Record<string, unknown>) => {
          const aaNumber = AA[args.p_staff_id as string];
          if (!aaNumber) return null;
          return {
            aaNumber,
            kind: aaNumber.startsWith('AAO') ? 'OST' : 'IST',
            fullName: 'Seller',
            status: 'accredited',
            startsOn: '2026-01-01',
            expiresOn: '2027-12-31',
            photoUrl: null,
          };
        },
      },
    ],
  });
  return holder.db;
}

beforeEach(() => install());

async function call(path: string, options: Parameters<typeof makeReq>[0] = {}) {
  const { res, state } = makeRes();
  await handler(makeReq({ familyPath: path, ...options }), res);
  return state;
}

describe('genealogy: resolve and aa-numbers (New Customer Application)', () => {
  it('resolves an AA number to the accredited seller', async () => {
    const state = await call('resolve', {
      token: TOKEN.superAdmin,
      query: { aaNumber: 'aao26100001' }, // lower-case: the schema normalizes it
    });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      member: {
        staffId: STAFF2.ost,
        fullName: 'OST Seller',
        role: 'ost',
        aaNumber: 'AAO26100001',
        kind: 'OST',
        status: 'accredited',
      },
    });
  });

  it('answers null (not 404) for an AA number with no matching accreditation', async () => {
    const state = await call('resolve', {
      token: TOKEN.superAdmin,
      query: { aaNumber: 'AAO26109999' },
    });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ member: null });
  });

  it('refuses a malformed AA number before ever calling the database', async () => {
    const db = install();
    const state = await call('resolve', {
      token: TOKEN.superAdmin,
      query: { aaNumber: 'not-an-aa-number' },
    });
    expect(state.status).toBe(400);
    expect(
      db.calls.some((c) => c.op === 'rpc' && c.table === 'search_sale_team_accreditation'),
    ).toBe(false);
  });

  it('refuses a caller with no network.genealogy permission, the same gate as the rest of this endpoint', async () => {
    const state = await call('resolve', {
      token: TOKEN2.finance,
      query: { aaNumber: 'AAO26100001' },
    });
    expect(state.status).toBe(403);
  });

  it('batches staffId -> AA number for the read-only upline display', async () => {
    const state = await call('aa-numbers', {
      token: TOKEN.superAdmin,
      query: {
        staffIds: `${STAFF2.salesManager},${STAFF2.seniorSalesManager},${STAFF2.viceDirector}`,
      },
    });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      [STAFF2.salesManager]: 'AAI26050002',
      [STAFF2.seniorSalesManager]: 'AAI26040003',
      [STAFF2.viceDirector]: 'AAI26030004',
    });
  });

  it('answers null for a staff id with no accreditation on file, never guessing one', async () => {
    const state = await call('aa-numbers', {
      token: TOKEN.superAdmin,
      query: { staffIds: STAFF2.finance },
    });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ [STAFF2.finance]: null });
  });
});
