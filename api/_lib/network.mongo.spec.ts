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
