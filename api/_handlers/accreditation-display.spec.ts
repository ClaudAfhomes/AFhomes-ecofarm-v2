import { beforeEach, expect, it, vi } from 'vitest';
import {
  phase2World,
  phase2WorldTokens,
  STAFF2,
  ROLE2,
  TOKEN,
  TOKEN2,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes, type FakeTables } from '../_lib/testing/supabase-fake.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const staff = (await import('./admin/afhomes.js')).default;
const ost = (await import('./ost.js')).default;
const records = new Map<
  string,
  {
    aaNumber: string;
    kind: 'IST' | 'OST';
    fullName: string;
    status: 'accredited';
    startsOn: string;
    expiresOn: string;
  }
>();
const other = '81818181-8181-4181-8181-818181818181';
beforeEach(() => {
  records.clear();
  for (const [id, aaNumber, kind] of [
    [STAFF2.viceDirector, 'AAI26100001', 'IST'],
    [STAFF2.salesManager, 'AA-K7Q2M9T4B1R8', 'IST'],
    [STAFF2.ost, 'AAO26100002', 'OST'],
  ] as const)
    records.set(id, {
      aaNumber,
      kind,
      fullName: 'SYNTHETIC',
      status: 'accredited',
      startsOn: '2026-01-01',
      expiresOn: '2027-12-31',
    });
  const member = (id: string, sponsor: string) => ({
    id,
    application_id: '71717171-7171-4171-8171-717171717171',
    sponsor_staff_id: sponsor,
    ost_number: 'OST-HISTORICAL',
    full_name: 'SYNTHETIC OST',
    email: 'synthetic@example.invalid',
    phone: '+639171234567',
    status: 'active',
    approved_by: STAFF2.viceDirector,
    approved_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  });
  const tables: FakeTables = {
    ...phase2World({}),
    ost_members: [member(STAFF2.ost, STAFF2.salesManager), member(other, STAFF2.viceDirector)],
  };
  const module = tables.modules!.find((row) => row.key === 'network.ost_members')!;
  tables.role_permissions!.push({
    role_id: ROLE2.salesManager,
    module_id: module.id,
    can_view: true,
  });
  holder.db = new FakeSupabase({
    tables,
    tokens: phase2WorldTokens(),
    rpcs: [
      {
        fn: 'get_sale_team_accreditation',
        result: (args: Record<string, unknown>) => records.get(String(args.p_staff_id)) ?? null,
      },
    ],
  });
});
async function call(
  handler: typeof staff,
  path: string,
  token: string | undefined,
  query: Record<string, string> = {},
) {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      afPath: path,
      familyPath: path,
      token,
      query: { includeAccreditation: '1', ...query },
    }) as never,
    res as never,
  );
  return state;
}
it('adds only exact stored numbers to the existing authorized staff directory', async () => {
  const result = await call(staff, 'staff', TOKEN.superAdmin);
  expect(result.status).toBe(200);
  const rows = (result.body as { data: { id: string; aaNumber: string | null }[] }).data;
  expect(rows.find((r) => r.id === STAFF2.viceDirector)?.aaNumber).toBe('AAI26100001');
  expect(rows.find((r) => r.id === STAFF2.salesManager)?.aaNumber).toBe('AA-K7Q2M9T4B1R8');
  expect(rows.find((r) => r.id === STAFF2.seniorSalesManager)?.aaNumber).toBe(null);
  expect(holder.db?.calls.some((c) => c.op === 'rpc' && /manage|next_/.test(c.table))).toBe(false);
});
it('searches scoped OST members by their saved official AA number', async () => {
  const result = await call(ost, 'members', TOKEN2.salesManager, { search: 'aao26100002' });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    data: [{ id: STAFF2.ost, aaNumber: 'AAO26100002', ostNumber: 'OST-HISTORICAL' }],
  });
  const lookups = holder.db?.calls.filter(
    (c) => c.op === 'rpc' && c.table === 'get_sale_team_accreditation',
  );
  expect(lookups?.map((c) => c.arg)).toEqual([{ p_staff_id: STAFF2.ost }]);
  expect(JSON.stringify(result.body)).not.toContain(other);
});
it('retains the original directory contract for older clients without the enrichment flag', async () => {
  const { res, state } = makeRes();
  await staff(makeReq({ afPath: 'staff', token: TOKEN.superAdmin }) as never, res as never);
  expect(state.status).toBe(200);
  expect(holder.db?.calls.some((c) => c.table === 'get_sale_team_accreditation')).toBe(false);
});
it('does not substitute unissued when the accreditation read fails', async () => {
  holder.db!.rpcErrors.get_sale_team_accreditation = { message: 'unavailable' };
  const result = await call(staff, 'staff', TOKEN.superAdmin);
  expect(result.status).toBe(500);
  expect(JSON.stringify(result.body)).not.toContain('Not Yet Issued');
});
it.each([undefined, TOKEN2.ost])(
  'denies unauthorized staff-directory enrichment for %s',
  async (token) => {
    const result = await call(staff, 'staff', token);
    expect([401, 403]).toContain(result.status);
    expect(holder.db?.calls.some((c) => c.table === 'get_sale_team_accreditation')).toBe(false);
  },
);
it('never enriches another seller row after an ownership denial', async () => {
  const result = await call(ost, 'members/' + other, TOKEN2.salesManager);
  expect(result.status).toBe(404);
  expect(holder.db?.calls.some((c) => c.table === 'get_sale_team_accreditation')).toBe(false);
});
