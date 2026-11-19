import { afterEach, expect, it, vi } from 'vitest';
import { baseTables, baseTokens, TOKEN } from './testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from './testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { authorizeAfHomes, resolveAfHomesPrincipal } = await import('./afhomes-access.js');
const { handleServiceCatalog } = await import('../_handlers/_service-catalog.js');
afterEach(() => vi.unstubAllEnvs());

it.each([
  'staff_users',
  'staff_role_assignments',
  'roles',
  'modules',
  'role_permissions',
  'staff_permission_restrictions',
])('fails closed before protected reads and mutations when %s fails', async (table) => {
  const db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    errors: { [table]: { message: 'lookup unavailable' } },
  });
  holder.db = db;
  for (const action of ['view', 'create'] as const) {
    const result = await authorizeAfHomes(
      makeReq({ token: TOKEN.superAdmin }),
      'organization.roles',
      action,
    );
    expect(result).toHaveProperty('error.status', 503);
  }
  for (const method of ['GET', 'POST']) {
    const { res, state } = makeRes();
    await handleServiceCatalog(
      makeReq({
        method,
        token: TOKEN.superAdmin,
        body: { name: 'Never created', basePrice: '1.00' },
      }),
      res,
      'services',
    );
    expect(state.status).toBe(503);
  }
  expect(
    db.calls.filter(
      (call) =>
        call.table === 'service_catalog' ||
        (call.op === 'rpc' && call.table !== 'afhomes_admin_mfa_required'),
    ),
  ).toEqual([]);
  expect(db.calls.filter((call) => ['insert', 'update', 'delete'].includes(call.op))).toEqual([]);
});

it.each(['aal1', 'aal2'] as const)(
  'uses the shared administrative MFA policy for %s',
  async (aal) => {
    const tokens = {
      ...baseTokens(),
      [TOKEN.superAdmin]: { ...baseTokens()[TOKEN.superAdmin], aal },
    };
    holder.db = new FakeSupabase({
      tables: baseTables(),
      tokens,
      rpcs: [{ fn: 'afhomes_admin_mfa_required', result: true }],
    });
    const result = await authorizeAfHomes(
      makeReq({ token: TOKEN.superAdmin }),
      'organization.roles',
    );
    if (aal === 'aal1') expect(result).toHaveProperty('error.status', 403);
    else expect(result).toHaveProperty('roleSlug', 'super_admin');
  },
);

it('keeps MFA optional for non-administrative staff', async () => {
  holder.db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    rpcs: [{ fn: 'afhomes_admin_mfa_required', result: true }],
  });
  expect(await resolveAfHomesPrincipal(makeReq({ token: TOKEN.viewer }))).toHaveProperty(
    'mfaRequired',
    false,
  );
});

it('refuses missing, failed or inconsistent security policy instead of disabling MFA', async () => {
  holder.db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    rpcErrors: { afhomes_admin_mfa_required: { message: 'unavailable' } },
  });
  expect(
    await authorizeAfHomes(makeReq({ token: TOKEN.superAdmin }), 'organization.roles'),
  ).toHaveProperty('error.status', 503);
  vi.stubEnv('AFHOMES_REQUIRE_ADMIN_MFA', 'true');
  holder.db = new FakeSupabase({ tables: baseTables(), tokens: baseTokens() });
  expect(
    await authorizeAfHomes(makeReq({ token: TOKEN.superAdmin }), 'organization.roles'),
  ).toHaveProperty('error.status', 503);
});
