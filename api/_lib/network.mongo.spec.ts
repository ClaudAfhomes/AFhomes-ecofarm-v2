import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { createAfHomesAdminAuth } from './auth.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;
let server: http.Server,
  base = '',
  admin = '';
const ids: Record<string, string> = {},
  cookies: Record<string, string> = {};
let oldEdge = '',
  saleId = '';
const col = (name: string) => test.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown, cookie = admin, verb?: string) {
  return fetch(`${base}/api/v1${path}`, {
    method: verb ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'native-network-fixture-only-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_WEB_URL: base,
  };
  fixture = await seedPhase5Fixture(test.db, test.client, env);
  const assignment = await col('staff_role_assignments').findOne({ staff_id: fixture.staff.id });
  await col('roles').updateOne(
    { _id: String(assignment!.role_id) },
    { $set: { slug: 'super_admin', is_system: true } },
  );
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { must_change_password: false } },
  );
  await col('mfa_policy').updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  for (const key of [
    'organization.staff',
    'organization.roles',
    'organization.departments',
    'network.genealogy',
    'network.referrals',
    'sales.uplines',
    'sales.card_sales',
  ])
    await col('modules').insertOne({ _id: randomUUID(), key, is_active: true });
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  admin = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const department = await request('/admin/afhomes/departments', { name: 'Network Fixture' });
  expect(department.status).toBe(201);
  const departmentId = (await department.json()).id;
  for (const [key, slug] of [
    ['vd', 'vice_director'],
    ['ssm', 'senior_sales_manager'],
    ['ssm2', 'senior_sales_manager'],
    ['sm', 'sales_manager'],
    ['ost', 'ost'],
    ['other', 'vice_director'],
  ]) {
    const existingRole = await col('roles').findOne({ slug });
    const roleId = existingRole?._id ?? randomUUID();
    if (!existingRole)
      await col('roles').insertOne({
        _id: roleId,
        name: `Synthetic ${key}`,
        slug,
        department_id: departmentId,
        is_active: true,
        is_system: false,
      });
    for (const moduleKey of existingRole
      ? []
      : ['network.genealogy', 'network.referrals', 'sales.card_sales']) {
      const module = await col('modules').findOne({ key: moduleKey });
      await col('role_permissions').insertOne({
        _id: randomUUID(),
        role_id: roleId,
        module_id: module!._id,
        can_view: true,
        can_create: moduleKey === 'sales.card_sales',
        can_update: false,
        can_delete: false,
      });
    }
    const email = `network-${key}@example.invalid`,
      password = `NetworkFixture${key}123`;
    const created = await request('/admin/afhomes/staff', {
      fullName: `Network ${key!.replace('2', ' Two')}`,
      email,
      temporaryPassword: password,
      departmentId,
      roleId,
    });
    if (slug === 'ost') {
      expect(created.status).toBe(409);
      // Accreditation is a separate port; seed only this synthetic OST identity in the fresh test database.
      const identity = await createAfHomesAdminAuth(test.db, test.client, env).api.createUser({
        body: { email, name: 'Network OST', password, data: { emailVerified: true } },
      });
      ids[key!] = identity.user.id;
      await col('staff_users').insertOne({
        _id: identity.user.id,
        email,
        full_name: 'Network OST',
        status: 'active',
        department_id: departmentId,
        must_change_password: false,
      });
      await col('staff_role_assignments').insertOne({
        _id: randomUUID(),
        staff_id: identity.user.id,
        role_id: roleId,
      });
    } else {
      expect(created.status, `${key}: ${JSON.stringify(await created.clone().json())}`).toBe(201);
      ids[key!] = (await created.json()).id;
    }
    await col('staff_users').updateOne(
      { _id: ids[key!] },
      { $set: { must_change_password: false } },
    );
    if (slug === 'ost')
      await col('ost_members').insertOne({
        _id: ids[key!],
        status: 'active',
        email,
        phone: '09185550999',
        sponsor_staff_id: ids.sm,
      });
    if (!['sm', 'ost'].includes(key!)) continue;
    const signed = await request('/auth/identity/sign-in/email', { email, password }, '');
    expect(signed.status).toBe(200);
    cookies[key!] = signed.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  }
}, 120_000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await test?.stop();
});
it('enforces immediate role direction, single active upline and no self assignment', async () => {
  const invalid = await request('/referrals', {
    subjectStaffId: ids.sm,
    uplineStaffId: ids.vd,
    hierarchyRole: 'sales_manager',
  });
  expect(invalid.status).toBe(400);
  for (const [subject, head, role] of [
    ['ssm', 'vd', 'senior_sales_manager'],
    ['ssm2', 'vd', 'senior_sales_manager'],
    ['sm', 'ssm', 'sales_manager'],
    ['ost', 'sm', 'ost'],
  ]) {
    const result = await request('/referrals', {
      subjectStaffId: ids[subject!],
      uplineStaffId: ids[head!],
      hierarchyRole: role,
    });
    expect(result.status).toBe(201);
    if (subject === 'sm') oldEdge = (await result.json()).id;
  }
  expect(
    (
      await request('/referrals', {
        subjectStaffId: ids.sm,
        uplineStaffId: ids.ssm2,
        hierarchyRole: 'sales_manager',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('/referrals', {
        subjectStaffId: ids.sm,
        uplineStaffId: ids.sm,
        hierarchyRole: 'sales_manager',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        '/referrals',
        { subjectStaffId: ids.sm, uplineStaffId: ids.ssm2, hierarchyRole: 'sales_manager' },
        cookies.sm,
      )
    ).status,
  ).toBe(403);
});
it('shows upline names while denying upline and unrelated profiles and preserving downline summaries', async () => {
  const data = (await (await request('/genealogy', undefined, cookies.sm)).json()).data;
  expect(new Set(data.map((row: { staffId: string }) => row.staffId))).toEqual(
    new Set([ids.vd, ids.ssm, ids.sm, ids.ost]),
  );
  expect((await request(`/genealogy/${ids.ssm}`, undefined, cookies.sm)).status).toBe(403);
  expect((await request(`/genealogy/${ids.other}`, undefined, cookies.sm)).status).toBe(403);
  expect((await request(`/genealogy/${ids.sm}`, undefined, cookies.ost)).status).toBe(403);
  expect((await request(`/genealogy/${ids.ost}`, undefined, cookies.sm)).status).toBe(200);
  expect(
    await (await request(`/genealogy/${ids.sm}/summary`, undefined, cookies.sm)).json(),
  ).toMatchObject({
    totalDirectDownline: 1,
    totalDescendants: 1,
    activeSellerCount: 1,
    roleCounts: { ost: 1 },
  });
  expect((await request('/genealogy', undefined, '')).status).toBe(401);
});
it('returns OST contacts only inside the caller genealogy view and never reveals other ids', async () => {
  const blank = { phone: null, email: '' };
  const contacts = async (staffIds: string[], cookie: string) => {
    const response = await request(
      `/genealogy/ost-contacts?staffIds=${encodeURIComponent(staffIds.join(','))}`,
      undefined,
      cookie,
    );
    return { status: response.status, text: await response.text() };
  };
  const json = (result: { text: string }) => JSON.parse(result.text);
  const unknown = randomUUID();
  // Disposable fixture only: the setup's sign-ins used the sign-in rate-limit window.
  await col('auth_rate_limits').deleteMany({});
  const otherSignIn = await request(
    '/auth/identity/sign-in/email',
    { email: 'network-other@example.invalid', password: 'NetworkFixtureother123' },
    '',
  );
  expect(otherSignIn.status).toBe(200);
  const otherTeam = otherSignIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

  // Unauthenticated: rejected before any lookup, no contact data.
  const anonymous = await contacts([ids.ost!], '');
  expect(anonymous.status).toBe(401);
  expect(anonymous.text).not.toContain('09185550999');

  // SM: own downline OST and own uplines (the official-form referral chain) are returned.
  const own = await contacts([ids.ost!, ids.ssm!, ids.vd!], cookies.sm!);
  expect(own.status).toBe(200);
  expect(json(own)).toEqual({
    [ids.ost!]: { phone: '09185550999', email: 'network-ost@example.invalid' },
    [ids.ssm!]: { phone: null, email: 'network-ssm@example.invalid' },
    [ids.vd!]: { phone: null, email: 'network-vd@example.invalid' },
  });

  // SM: other teams, a sibling branch and unknown ids are indistinguishable empty entries.
  const mixed = await contacts([ids.ost!, ids.other!, ids.ssm2!, unknown], cookies.sm!);
  expect(mixed.status).toBe(200);
  expect(json(mixed)).toEqual({
    [ids.ost!]: { phone: '09185550999', email: 'network-ost@example.invalid' },
    [ids.other!]: blank,
    [ids.ssm2!]: blank,
    [unknown]: blank,
  });
  expect(mixed.text).not.toMatch(/network-other|network-ssm2/);

  // Another team's VD cannot read this team's contacts.
  const foreign = await contacts([ids.ost!, ids.sm!, ids.other!], otherTeam);
  expect(json(foreign)).toEqual({
    [ids.ost!]: blank,
    [ids.sm!]: blank,
    [ids.other!]: { phone: null, email: 'network-other@example.invalid' },
  });
  expect(foreign.text).not.toContain('09185550999');

  // OST: itself and its uplines only; nothing sideways.
  expect(json(await contacts([ids.ost!, ids.sm!, ids.other!], cookies.ost!))).toEqual({
    [ids.ost!]: { phone: '09185550999', email: 'network-ost@example.invalid' },
    [ids.sm!]: { phone: null, email: 'network-sm@example.invalid' },
    [ids.other!]: blank,
  });

  // Super Admin keeps access to every seller; non-seller ids are not genealogy contacts.
  expect(json(await contacts([ids.ost!, ids.other!, fixture.staff.id, unknown], admin))).toEqual({
    [ids.ost!]: { phone: '09185550999', email: 'network-ost@example.invalid' },
    [ids.other!]: { phone: null, email: 'network-other@example.invalid' },
    [fixture.staff.id]: blank,
    [unknown]: blank,
  });

  // Enumeration: a burst of guessed ids yields only identical empty entries.
  const guesses = Array.from({ length: 200 }, () => randomUUID());
  const probe = await contacts(guesses, cookies.sm!);
  expect(probe.status).toBe(200);
  expect(
    Object.values(json(probe)).every((entry) => JSON.stringify(entry) === JSON.stringify(blank)),
  ).toBe(true);

  // A role without genealogy view (deny-only restriction) gets 403 and no data.
  const genealogyModule = await col('modules').findOne({ key: 'network.genealogy' });
  const restrictionId = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restrictionId,
    staff_id: ids.ost!,
    module_id: genealogyModule!._id,
    deny_view: true,
  });
  const restricted = await contacts([ids.ost!], cookies.ost!);
  expect(restricted.status).toBe(403);
  expect(restricted.text).not.toContain('09185550999');
  await col('staff_permission_restrictions').deleteOne({ _id: restrictionId });

  // Malformed requests fail closed without data.
  const missing = await request('/genealogy/ost-contacts', undefined, cookies.sm);
  expect(missing.status).toBe(400);
  expect(await missing.text()).not.toContain('09185550999');
});
it('limits referral relationships to the caller genealogy (U8) and proves retired history', async () => {
  const signIn = async (key: string) => {
    await col('auth_rate_limits').deleteMany({});
    const signed = await request(
      '/auth/identity/sign-in/email',
      { email: `network-${key}@example.invalid`, password: `NetworkFixture${key}123` },
      '',
    );
    expect(signed.status).toBe(200);
    return signed.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  };
  const vd = await signIn('vd'),
    ssm = await signIn('ssm'),
    other = await signIn('other');
  // Retired history: the OST once reported to the sibling SSM2.
  const retiredId = randomUUID();
  await col('referral_relationships').insertOne({
    _id: retiredId,
    subject_staff_id: ids.ost,
    upline_staff_id: ids.ssm2,
    hierarchy_role: 'ost',
    is_authoritative: false,
    is_active: false,
    assigned_at: '2024-01-01T00:00:00.000Z',
  });
  const edges = async (cookie: string) => {
    const response = await request('/referrals', undefined, cookie);
    const text = await response.text();
    const body = response.status === 200 ? JSON.parse(text) : null;
    return {
      status: response.status,
      text,
      pairs: new Set<string>(
        (body?.data ?? []).map(
          (row: { subjectStaffId: string; uplineStaffId: string; isActive: boolean }) =>
            `${row.subjectStaffId}>${row.uplineStaffId}${row.isActive ? '' : ':retired'}`,
        ),
      ),
    };
  };
  const pair = (a: string, b: string, retired = false) =>
    `${ids[a]}>${ids[b]}${retired ? ':retired' : ''}`;
  const chain = [pair('ost', 'sm'), pair('sm', 'ssm'), pair('ssm', 'vd')];
  try {
    // Super Admin keeps full visibility, including the retired history and the sibling branch.
    const all = await edges(admin);
    for (const expected of [...chain, pair('ssm2', 'vd'), pair('ost', 'ssm2', true)])
      expect(all.pairs.has(expected), expected).toBe(true);
    // VD: its own subtree only; retired history it was not a party to stays hidden.
    expect([...(await edges(vd)).pairs].sort()).toEqual([...chain, pair('ssm2', 'vd')].sort());
    // SSM / SM: own chain and downline; never the sibling SSM2 branch or its name.
    for (const cookie of [ssm, cookies.sm!]) {
      const seen = await edges(cookie);
      expect([...seen.pairs].sort()).toEqual([...chain].sort());
      expect(seen.text).not.toContain(ids.ssm2);
      expect(seen.text.toLowerCase()).not.toContain('ssm two');
    }
    // OST: its upline chain plus its own retired relationship (it was a party to it).
    expect([...(await edges(cookies.ost!)).pairs].sort()).toEqual(
      [...chain, pair('ost', 'ssm2', true)].sort(),
    );
    // Another team's VD sees nothing of this branch (no names, no ids).
    const foreign = await edges(other);
    expect(foreign.status).toBe(200);
    expect(foreign.pairs.size).toBe(0);
    for (const key of ['vd', 'ssm', 'ssm2', 'sm', 'ost'])
      expect(foreign.text).not.toContain(ids[key]);
    // Unauthenticated and inactive callers are refused before any relationship is read.
    expect((await edges('')).status).toBe(401);
    await col('staff_users').updateOne({ _id: ids.other }, { $set: { status: 'inactive' } });
    const inactive = await edges(other);
    expect(inactive.status).toBe(403);
    expect(inactive.text).not.toContain(ids.vd);
  } finally {
    await col('staff_users').updateOne({ _id: ids.other }, { $set: { status: 'active' } });
    await col('referral_relationships').deleteOne({ _id: retiredId });
  }
});
it('freezes a sale hierarchy and atomically retires an old upline during correction', async () => {
  const customer = await request('/customers', {
    firstName: 'Network',
    lastName: 'Purchase',
    dateOfBirth: '1990-01-01',
    email: 'network-purchase@example.invalid',
    phone: '09185551234',
    address: { line1: 'Synthetic address', city: 'Quezon City', province: 'Metro Manila' },
  });
  expect(customer.status).toBe(201);
  const sale = await request(
    '/sales',
    { customerId: (await customer.json()).id, productId: fixture.plan },
    cookies.sm,
  );
  expect({ status: sale.status, body: await sale.clone().json() }).toMatchObject({ status: 201 });
  saleId = (await sale.json()).id;
  const snapshots = await col('card_sale_hierarchy_snapshots')
    .find({ sale_id: saleId })
    .sort({ depth: 1 })
    .toArray();
  expect(snapshots.map((row) => row.ancestor_staff_id)).toEqual([ids.sm, ids.ssm, ids.vd]);
  const correction = await request(
    `/referrals/${oldEdge}`,
    { uplineStaffId: ids.ssm2, reason: 'Synthetic corrected reporting head' },
    admin,
    'PATCH',
  );
  expect(correction.status).toBe(200);
  expect(await col('referral_relationships').findOne({ _id: oldEdge })).toHaveProperty(
    'is_active',
    false,
  );
  expect(
    await col('referral_relationships').countDocuments({
      subject_staff_id: ids.sm,
      is_active: true,
    }),
  ).toBe(1);
  expect(
    await col('card_sale_hierarchy_snapshots')
      .find({ sale_id: saleId })
      .sort({ depth: 1 })
      .toArray(),
  ).toEqual(snapshots);
  expect(
    (
      await request(
        `/referrals/${oldEdge}`,
        { uplineStaffId: ids.ssm, reason: 'Cannot revive retired history' },
        admin,
        'PATCH',
      )
    ).status,
  ).toBe(409);
});
it('rolls back retirement when its audit fails and displays the next active head after departure', async () => {
  const edge = await col('referral_relationships').findOne({
    subject_staff_id: ids.sm,
    is_active: true,
  });
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'UPLINE_CORRECTED' } },
    validationLevel: 'strict',
  });
  try {
    expect(
      (
        await request(
          `/referrals/${edge!._id}`,
          { uplineStaffId: ids.ssm, reason: 'Synthetic forced audit failure' },
          admin,
          'PATCH',
        )
      ).status,
    ).toBe(503);
    expect(await col('referral_relationships').findOne({ _id: edge!._id })).toHaveProperty(
      'is_active',
      true,
    );
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {}, validationLevel: 'off' });
  }
  expect((await request(`/admin/afhomes/staff/${ids.ssm2}/deactivate`, {})).status).toBe(200);
  const row = await (await request(`/genealogy/${ids.sm}`, undefined, cookies.sm)).json();
  // Source display logic sorts stored heads by ID when no active edge remains.
  expect(row.uplineStaffId).toBe(ids.ssm! < ids.ssm2! ? ids.ssm : ids.vd);
  expect(
    await col('card_sale_hierarchy_snapshots').countDocuments({
      sale_id: saleId,
      ancestor_staff_id: ids.ssm,
    }),
  ).toBe(1);
});
