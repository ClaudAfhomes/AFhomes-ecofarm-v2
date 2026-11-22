import { afterEach, expect, it, vi } from 'vitest';
import { baseTables, baseTokens, TOKEN } from './testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from './testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { authorizeAfHomes, authorizeAnyAfHomes, resolveAfHomesPrincipal } =
  await import('./afhomes-access.js');
const { handleServiceCatalog } = await import('../_handlers/_service-catalog.js');
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function rpcSession(overrides: Record<string, unknown> = {}) {
  const tables = baseTables();
  const id = baseTokens()[TOKEN.superAdmin]!.id;
  const staff = tables.staff_users!.find((row) => row.id === id)!;
  const role = tables.roles!.find((row) => row.slug === 'super_admin')!;
  return {
    id,
    email: staff.email,
    fullName: staff.full_name,
    status: 'active',
    roleId: role.id,
    roleSlug: role.slug,
    roleName: role.name,
    mustChangePassword: false,
    testPurgeEnabled: false,
    permissions: [
      {
        moduleKey: 'organization.roles',
        canView: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      },
    ],
    ...overrides,
  };
}

it.each([
  { label: 'another owner', data: { id: baseTokens()[TOKEN.viewer]!.id } },
  { label: 'inactive staff', data: { status: 'inactive' } },
  { label: 'mandatory password change', data: { mustChangePassword: true } },
  { label: 'missing permission', data: { permissions: [] } },
  { label: 'administrative MFA', data: {}, mfa: true },
])('denies the fast self-session path for $label', async ({ data, mfa }) => {
  holder.db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    rpcs: [
      { fn: 'afhomes_self_session', result: rpcSession(data) },
      { fn: 'afhomes_admin_mfa_required', result: mfa === true },
    ],
  });
  expect(
    await authorizeAfHomes(makeReq({ token: TOKEN.superAdmin }), 'organization.roles'),
  ).toHaveProperty('error.status', 403);
});

it('fails closed on a self-session RPC error instead of using privileged table reads', async () => {
  const db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    rpcErrors: { afhomes_self_session: { code: 'P0001', message: 'PRIVATE failure' } },
  });
  holder.db = db;
  const result = await resolveAfHomesPrincipal(makeReq({ token: TOKEN.superAdmin }));
  expect(result).toHaveProperty('error.status', 503);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(db.calls.filter((call) => call.op === 'select')).toEqual([]);
});

it('resolves an active staff session with a bearer-scoped RPC and no per-table lookups', async () => {
  const tables = baseTables();
  const session = rpcSession();
  const db = new FakeSupabase({ tables, tokens: baseTokens() });
  holder.db = db;
  const original = db.rpc.bind(db);
  const request = Promise.resolve({ data: session, error: null });
  const setHeader = vi.fn(() => request);
  vi.spyOn(db, 'rpc').mockImplementation((fn, args) =>
    fn === 'afhomes_self_session' ? Object.assign(request, { setHeader }) : original(fn, args),
  );
  expect(
    await authorizeAfHomes(makeReq({ token: TOKEN.superAdmin }), 'organization.roles'),
  ).toHaveProperty('userId', session.id);
  expect(setHeader).toHaveBeenCalledWith('Authorization', `Bearer ${TOKEN.superAdmin}`);
  expect(db.calls.filter((call) => call.op === 'select')).toEqual([]);
});

it('reads the verified staff profile and role assignment concurrently', async () => {
  const db = new FakeSupabase({ tables: baseTables(), tokens: baseTokens() });
  holder.db = db;
  const from = db.from.bind(db);
  const started = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(db, 'from').mockImplementation((table) => {
    const query = from(table);
    if (table === 'staff_users' || table === 'staff_role_assignments') {
      const maybeSingle = query.maybeSingle.bind(query);
      query.maybeSingle = async () => {
        started.add(table);
        await gate;
        return maybeSingle();
      };
    }
    return query;
  });
  const pending = resolveAfHomesPrincipal(makeReq({ token: TOKEN.superAdmin }));
  try {
    await vi.waitFor(() => expect(started.size).toBe(2), { timeout: 300 });
  } finally {
    release();
    expect(await pending).toHaveProperty('roleSlug', 'super_admin');
  }
  expect(db.calls.filter((call) => ['insert', 'update', 'delete'].includes(call.op))).toEqual([]);
});

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
    const result = await authorizeAnyAfHomes(
      makeReq({ token: TOKEN.superAdmin }),
      ['organization.roles', 'dashboard.view'],
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
        (call.op === 'rpc' &&
          !['afhomes_admin_mfa_required', 'afhomes_self_session'].includes(call.table)),
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

it('keeps the password-change gate when checking alternative modules', async () => {
  const tables = baseTables();
  tables.staff_users!.forEach((staff) => {
    staff.must_change_password = true;
  });
  holder.db = new FakeSupabase({ tables, tokens: baseTokens() });
  expect(
    await authorizeAnyAfHomes(makeReq({ token: TOKEN.superAdmin }), [
      'organization.roles',
      'dashboard.view',
    ]),
  ).toHaveProperty('error.status', 403);
});

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
