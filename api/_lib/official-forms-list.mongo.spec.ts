import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoOfficialFormsHandler } from './official-forms.mongo.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { makeReq, makeRes } from './testing/supabase-fake.js';

/** List search/date filters (P1): literal search text and one inclusive UTC created_at range. */
let test: Awaited<ReturnType<typeof createTestReplica>>;
let handler: ReturnType<typeof createMongoOfficialFormsHandler>;
const principal = {
  userId: 'aaaaaaaa-0000-4000-8000-0000000000aa',
  roleSlug: 'admin',
  permissions: [],
};

const apps = [
  ['APP-001', '2026-10-31T23:59:59.999Z'],
  ['APP-002', '2026-11-01T00:00:00.000Z'],
  ['APP-003', '2026-11-02T12:00:00.000Z'],
  ['APP-004', '2026-11-03T23:59:59.999Z'],
  ['APP-005', '2026-11-04T00:00:00.000Z'],
  ['APP.(1)+[x]', '2026-11-02T08:00:00.000Z'],
  ['APX-AAA', '2026-11-02T09:00:00.000Z'],
] as const;

beforeAll(async () => {
  test = await createTestReplica();
  handler = createMongoOfficialFormsHandler(test.db, test.client, (async () => principal) as never);
  await test.db.collection('customer_applications').insertMany(
    apps.map(([number, created], i) => ({
      _id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
      application_number: number,
      status: 'submitted',
      created_at: created,
    })) as never[],
  );
  await test.db.collection('reservation_agreements').insertMany([
    {
      _id: 'cccccccc-0000-4000-8000-000000000001',
      reservation_number: 'RES-A.B',
      status: 'submitted',
      created_at: '2026-11-02T00:00:00.000Z',
    },
    {
      _id: 'cccccccc-0000-4000-8000-000000000002',
      reservation_number: 'RES-AXB',
      status: 'submitted',
      created_at: '2026-11-02T00:00:00.000Z',
    },
  ] as never[]);
}, 120_000);
afterAll(async () => {
  await test?.stop();
});

async function list(query: Record<string, string>, path = 'customer-applications') {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method: 'GET',
      familyPath: path,
      query: { limit: '100', offset: '0', ...query },
    }) as never,
    res as never,
  );
  const body = state.body as {
    data?: { application_number?: string; reservation_number?: string }[];
    meta?: { total: number };
  };
  return {
    status: state.status,
    numbers: (body.data ?? [])
      .map((row) => row.application_number ?? row.reservation_number)
      .sort(),
    total: body.meta?.total,
  };
}

describe('official form list search is literal text', () => {
  it('keeps ordinary case-insensitive substring search', async () => {
    expect((await list({ search: 'app-00' })).numbers).toEqual([
      'APP-001',
      'APP-002',
      'APP-003',
      'APP-004',
      'APP-005',
    ]);
  });
  it('treats regex metacharacters literally instead of as a pattern', async () => {
    expect((await list({ search: '.(1)+[x]' })).numbers).toEqual(['APP.(1)+[x]']);
    // As a regex `PP.` would also match APP-001..005; as literal text only the dotted number matches.
    expect((await list({ search: 'PP.' })).numbers).toEqual(['APP.(1)+[x]']);
    expect((await list({ search: 'RES-A.B' }, 'reservations')).numbers).toEqual(['RES-A.B']);
  });
  it('never returns 500 for patterns that are invalid or catastrophic as regexes', async () => {
    for (const search of ['(', '[', '\\', '(a+)+$', '*', '?', '{1,}', '^$|'])
      expect(await list({ search }), search).toMatchObject({ status: 200 });
    expect((await list({ search: '(a+)+$'.repeat(16).slice(0, 100) })).status).toBe(200);
  });
  it('keeps the source ILIKE wildcard stripping and the 100-character limit', async () => {
    // `%`, `_` and `,` are removed first (source ILIKE wildcards), then the rest is literal.
    expect((await list({ search: 'APP-%00_1' })).numbers).toEqual(['APP-001']);
    expect((await list({ search: 'x'.repeat(101) })).status).toBe(400);
  });
});

describe('official form list created_at range', () => {
  it('applies a lower bound alone (inclusive from midnight UTC)', async () => {
    expect((await list({ search: 'APP-', from: '2026-11-01' })).numbers).toEqual([
      'APP-002',
      'APP-003',
      'APP-004',
      'APP-005',
    ]);
  });
  it('applies an upper bound alone (inclusive through 23:59:59.999Z)', async () => {
    expect((await list({ search: 'APP-', to: '2026-11-03' })).numbers).toEqual([
      'APP-001',
      'APP-002',
      'APP-003',
      'APP-004',
    ]);
  });
  it('combines both bounds instead of dropping the lower bound', async () => {
    const result = await list({ search: 'APP-', from: '2026-11-01', to: '2026-11-03' });
    expect(result.numbers).toEqual(['APP-002', 'APP-003', 'APP-004']);
    expect(result.total).toBe(3);
  });
  it('treats a single-day range as that whole UTC day', async () => {
    expect((await list({ from: '2026-11-02', to: '2026-11-02' })).numbers).toEqual([
      'APP-003',
      'APP.(1)+[x]',
      'APX-AAA',
    ]);
  });
  it('returns nothing for an inverted range and rejects malformed dates', async () => {
    expect(await list({ from: '2026-11-04', to: '2026-11-01' })).toMatchObject({
      status: 200,
      numbers: [],
      total: 0,
    });
    expect((await list({ from: '2026-11-1' })).status).toBe(400);
    expect((await list({ to: '11/03/2026' })).status).toBe(400);
  });
});
