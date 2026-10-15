import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phase2World, phase2WorldTokens, TOKEN, UUID } from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { resetIdentifierRateLimit } from '../_lib/rate-limit.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const handler = (await import('./sale-team.js')).default;
const record = {
  aaNumber: 'AA-K7Q2M9T4B1R8',
  kind: 'IST',
  fullName: 'SYNTHETIC SELLER',
  status: 'accredited',
  startsOn: '2026-01-01',
  expiresOn: '2027-12-31',
};
beforeEach(() => {
  resetIdentifierRateLimit();
  holder.db = new FakeSupabase({
    tables: phase2World({}),
    tokens: phase2WorldTokens(),
    rpcs: [
      { fn: 'search_sale_team_accreditation', result: record },
      { fn: 'get_sale_team_accreditation', result: record },
      { fn: 'manage_sale_team_accreditation', result: record },
    ],
  });
});
async function call(path: string, options: Parameters<typeof makeReq>[0] = {}) {
  const { res, state } = makeRes();
  await handler(makeReq({ familyPath: path, ...options }), res);
  return state;
}
describe('sale-team boundaries', () => {
  it('uses the authenticated identity for self-read, ignoring supplied IDs', async () => {
    expect(
      (await call('me', { token: TOKEN.superAdmin, query: { staffId: UUID.viewerStaff } })).status,
    ).toBe(200);
    expect(
      holder.db?.calls.find((c) => c.op === 'rpc' && c.table === 'get_sale_team_accreditation')
        ?.arg,
    ).toEqual({ p_staff_id: UUID.superAdminStaff });
  });
  it('allows exact public searches without authentication', async () => {
    const state = await call('search', { query: { aaNumber: ' aa-k7q2m9t4b1r8 ' } });
    expect(state.status).toBe(200);
    expect(state.body).toEqual(record);
    expect(state.headers['cache-control']).toBe('no-store');
  });
  it.each(['', '%', 'AA-', 'AA-K7Q2M9T4B1R8 OR 1=1'])(
    'refuses malformed AA input %s before lookup',
    async (aaNumber) => {
      expect((await call('search', { query: { aaNumber } })).status).toBe(400);
      expect(holder.db?.calls.some((c) => c.op === 'rpc')).toBe(false);
    },
  );
  it('returns a safe null for unknown or ineligible numbers', async () => {
    holder.db = new FakeSupabase({
      tables: {},
      rpcs: [{ fn: 'search_sale_team_accreditation', result: null }],
    });
    expect((await call('search', { query: { aaNumber: 'AA-Z9Y8X7W6V5U4' } })).body).toBeNull();
  });
  it('fails closed if the database returns extra private fields', async () => {
    holder.db = new FakeSupabase({
      tables: {},
      rpcs: [
        {
          fn: 'search_sale_team_accreditation',
          result: { ...record, email: 'private@example.invalid' },
        },
      ],
    });
    const state = await call('search', { query: { aaNumber: record.aaNumber } });
    expect(state.status).toBe(503);
    expect(JSON.stringify(state.body)).not.toContain('private@example');
  });
  it('limits repeated public searches', async () => {
    for (let i = 0; i < 30; i++) await call('search', { query: { aaNumber: record.aaNumber } });
    const state = await call('search', { query: { aaNumber: record.aaNumber } });
    expect(state.status).toBe(429);
    expect(state.headers['retry-after']).toBeDefined();
  });
  it('requires authentication for self-read and approval', async () => {
    expect((await call('me')).status).toBe(401);
    expect((await call(UUID.viewerStaff, { method: 'POST' })).status).toBe(401);
  });
  it('refuses non-admin issuance and forged date payloads', async () => {
    expect(
      (
        await call(UUID.viewerStaff, {
          token: TOKEN.viewer,
          method: 'POST',
          body: { action: 'approve', kind: 'IST', startsOn: '2026-01-01', expiresOn: '2027-01-01' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(UUID.viewerStaff, {
          token: TOKEN.superAdmin,
          method: 'POST',
          body: { action: 'approve', kind: 'IST', startsOn: '2027-01-01', expiresOn: '2026-01-01' },
        })
      ).status,
    ).toBe(400);
  });
  it('approves through the atomic RPC as an authorized administrator', async () => {
    expect(
      (
        await call(UUID.viewerStaff, {
          token: TOKEN.superAdmin,
          method: 'POST',
          body: { action: 'approve', kind: 'IST', startsOn: '2026-01-01', expiresOn: '2027-01-01' },
        })
      ).status,
    ).toBe(200);
    expect(
      holder.db?.calls.some((c) => c.op === 'rpc' && c.table === 'manage_sale_team_accreditation'),
    ).toBe(true);
  });
});
