import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  modulesPhase2Table,
  phase2World,
  phase2WorldTokens,
  TOKEN,
  UUID,
} from '../_lib/testing/phase2-fixtures.js';
import { moduleId } from '../_lib/testing/fixtures.js';
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
  photoUrl: null,
};
/** What the resolver answers for a number a transfer retired. */
const historicalRecord = {
  aaNumber: 'AA-K7Q2M9T4B1R8',
  kind: 'IST',
  fullName: 'SYNTHETIC SELLER',
  status: 'superseded',
  startsOn: '2026-01-01',
  expiresOn: '2027-12-31',
  successorAaNumber: 'AAO26110001',
  photoUrl: null,
};
/**
 * The ordinary Phase 2 dataset plus the `network.members` module row. A super
 * admin is granted every module that EXISTS, so without the row the caller
 * would be refused for the wrong reason (an unknown module, not a missing
 * grant) and the test would prove nothing. The viewer role holds no grant on
 * it, so the same world also supplies the unauthorized caller.
 */
function world(rpcs: FakeSupabase['rpcs'], rpcErrors?: FakeSupabase['rpcErrors']) {
  holder.db = new FakeSupabase({
    tables: phase2World({
      modules: [
        ...modulesPhase2Table(),
        {
          id: moduleId('network.members'),
          key: 'network.members',
          name: 'Network Members',
          group_name: 'Sales & Customers',
          sort_order: 90,
          is_active: true,
        },
      ],
    }),
    tokens: phase2WorldTokens(),
    rpcs,
    rpcErrors,
  });
}
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
  it('never consults the history for a number that is still current', async () => {
    world([
      { fn: 'search_sale_team_accreditation', result: record },
      { fn: 'resolve_sale_team_accreditation_number', result: historicalRecord },
    ]);
    const state = await call('search', { token: TOKEN.superAdmin, query: { aaNumber: record.aaNumber } });
    expect(state.status).toBe(200);
    expect(state.body).toEqual(record);
    expect(
      holder.db?.calls.some(
        (c) => c.op === 'rpc' && c.table === 'resolve_sale_team_accreditation_number',
      ),
    ).toBe(false);
  });
  it('answers a superseded number for an authorized staff caller', async () => {
    world([
      { fn: 'search_sale_team_accreditation', result: null },
      { fn: 'resolve_sale_team_accreditation_number', result: historicalRecord },
    ]);
    const state = await call('search', {
      token: TOKEN.superAdmin,
      query: { aaNumber: ' aa-k7q2m9t4b1r8 ' },
    });
    expect(state.status).toBe(200);
    expect(state.body).toEqual(historicalRecord);
    expect(
      holder.db?.calls.find(
        (c) => c.op === 'rpc' && c.table === 'resolve_sale_team_accreditation_number',
      )?.arg,
    ).toEqual({ p_aa_number: 'AA-K7Q2M9T4B1R8' });
  });
  it('keeps the ordinary not-found answer for anonymous and unauthorized callers', async () => {
    world([
      { fn: 'search_sale_team_accreditation', result: null },
      { fn: 'resolve_sale_team_accreditation_number', result: historicalRecord },
    ]);
    expect((await call('search', { query: { aaNumber: record.aaNumber } })).body).toBeNull();
    expect(
      (await call('search', { token: TOKEN.viewer, query: { aaNumber: record.aaNumber } })).body,
    ).toBeNull();
    expect(
      holder.db?.calls.some(
        (c) => c.op === 'rpc' && c.table === 'resolve_sale_team_accreditation_number',
      ),
    ).toBe(false);
  });
  it('answers not found when history has no successor and fails closed when it errors', async () => {
    world([
      { fn: 'search_sale_team_accreditation', result: null },
      { fn: 'resolve_sale_team_accreditation_number', result: null },
    ]);
    const missing = await call('search', {
      token: TOKEN.superAdmin,
      query: { aaNumber: record.aaNumber },
    });
    expect(missing.status).toBe(200);
    expect(missing.body).toBeNull();
    world([{ fn: 'search_sale_team_accreditation', result: null }], {
      resolve_sale_team_accreditation_number: { code: '42501', message: 'permission denied' },
    });
    const failed = await call('search', {
      token: TOKEN.superAdmin,
      query: { aaNumber: record.aaNumber },
    });
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).not.toContain('permission denied');
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
