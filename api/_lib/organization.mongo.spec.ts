import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { afHomesDepartmentSchema, afHomesRoleSchema, afHomesStaffSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  cookie = '';
let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;
let departmentId = '',
  customRoleId = '',
  createdStaffId = '';
const staffPassword = 'SyntheticTemp123';
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'organization-local-fixture-only-'.repeat(3),
    BETTER_AUTH_URL: base,
  };
  fixture = await seedPhase5Fixture(test.db, test.client, env);
  const assignment = await test.db
    .collection('staff_role_assignments')
    .findOne({ staff_id: fixture.staff.id });
  await test.db
    .collection('roles')
    .updateOne({ _id: assignment!.role_id }, { $set: { slug: 'super_admin', is_system: true } });
  await test.db
    .collection('staff_users')
    .updateOne({ email: fixture.staff.email }, { $set: { must_change_password: false } });
  await test.db
    .collection('mfa_policy')
    .updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  for (const key of [
    'organization.staff',
    'organization.roles',
    'organization.departments',
    'governance.audit',
  ])
    await test.db
      .collection<{ _id: string; key: string; is_active: boolean }>('modules')
      .insertOne({ _id: randomUUID(), key, is_active: true });
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  cookie = jar(login);
}, 120_000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await test?.stop();
});
const jar = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
async function request(path: string, body?: unknown, session = cookie, verb?: string) {
  return fetch(`${base}/api/v1${path}`, {
    method: verb ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const org = (path: string) => `/admin/afhomes/${path}`;
it('persists department and role contracts while refusing privilege injection', async () => {
  expect((await request(org('departments'), undefined, '')).status).toBe(401);
  const department = await request(org('departments'), { name: 'Synthetic Operations' });
  expect(department.status).toBe(201);
  departmentId = afHomesDepartmentSchema.parse(await department.json()).id;
  const role = await request(org('roles'), {
    name: 'Synthetic Clerk',
    departmentId,
    permissions: [
      {
        moduleKey: 'sales.customers',
        canView: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      },
    ],
  });
  expect(role.status).toBe(201);
  customRoleId = afHomesRoleSchema.parse(await role.json()).id;
  expect(
    (await request(org(`departments/${departmentId}`), undefined, cookie, 'DELETE')).status,
  ).toBe(409);
  expect(
    (
      await request(org('roles'), {
        name: 'Unknown Department',
        departmentId: randomUUID(),
        permissions: [],
      })
    ).status,
  ).toBe(400);
});
it('creates a real temporary-password identity atomically without invitations or credentials in audits', async () => {
  const input = {
    email: 'organization-clerk@example.invalid',
    fullName: 'Synthetic Clerk',
    departmentId,
    roleId: customRoleId,
    temporaryPassword: staffPassword,
  };
  const created = await request(org('staff'), input);
  expect(created.status).toBe(201);
  const staff = afHomesStaffSchema.parse(await created.json());
  createdStaffId = staff.id;
  expect(staff.mustChangePassword).toBe(true);
  expect(staff.employeeNumber).toMatch(/^AF-EMP-[A-Z0-9]{5}$/);
  expect(
    JSON.stringify(
      await test.db.collection('audit_events').find({ entity_id: staff.id }).toArray(),
    ),
  ).not.toContain(staffPassword);
  expect(await test.db.collection('staff_invitations').countDocuments()).toBe(0);
  expect((await request(org('staff'), input)).status).toBe(409);
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: input.email, password: staffPassword },
    '',
  );
  expect(login.status).toBe(200);
  const clerk = jar(login);
  expect((await request('/customers', undefined, clerk)).status).toBe(403);
  expect(
    (
      await request(
        org('session/password'),
        { currentPassword: staffPassword, newPassword: 'SyntheticChanged123' },
        clerk,
      )
    ).status,
  ).toBe(200);
  expect((await request('/customers', undefined, clerk)).status).toBe(200);
  expect((await request(org('staff'), input, clerk)).status).toBe(403);
  const restriction = {
    moduleKey: 'sales.customers',
    denyView: true,
    denyCreate: false,
    denyUpdate: false,
    denyDelete: false,
  };
  expect(
    (await request(org(`staff/${staff.id}`), { restrictions: [restriction] }, cookie, 'PATCH'))
      .status,
  ).toBe(200);
  expect((await request('/customers', undefined, clerk)).status).toBe(403);
});
it('preserves system-role protections and atomically rolls back an audit failure', async () => {
  const self = (await (await request(org('session'))).json()).id;
  expect(
    (await request(org(`staff/${self}`), { status: 'inactive' }, cookie, 'PATCH')).status,
  ).toBe(403);
  const role = await test.db.collection('staff_role_assignments').findOne({ staff_id: self });
  expect((await request(org(`roles/${role!.role_id}`), undefined, cookie, 'DELETE')).status).toBe(
    403,
  );
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'STAFF_CREATED' } },
    validationLevel: 'strict',
  });
  const failed = await request(org('staff'), {
    email: 'must-rollback@example.invalid',
    fullName: 'Rollback Clerk',
    departmentId,
    roleId: customRoleId,
    temporaryPassword: staffPassword,
  });
  expect(failed.status).toBe(503);
  expect(
    await test.db
      .collection('auth_users')
      .countDocuments({ email: 'must-rollback@example.invalid' }),
  ).toBe(0);
  expect(
    await test.db
      .collection('staff_users')
      .countDocuments({ email: 'must-rollback@example.invalid' }),
  ).toBe(0);
  await test.db.command({ collMod: 'audit_events', validator: {} });
});
it('blocks protected deletion, preserves history on deactivation and blocks assigned-role removal', async () => {
  expect((await request(org(`roles/${customRoleId}`), undefined, cookie, 'DELETE')).status).toBe(
    409,
  );
  await test.db
    .collection('card_sales')
    .insertOne({
      seller_staff_id: createdStaffId,
      sale_number: 'AF-CSALE-QAPRT',
      customer_id: fixture.customer.id,
      plan_id: fixture.plan,
      status: 'pending',
    });
  const blocked = await request(org(`staff/${createdStaffId}`), undefined, cookie, 'DELETE');
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toHaveProperty('error.code', 'PROTECTED_HISTORY');
  await test.db.collection('referral_relationships').insertOne({
    upline_staff_id: createdStaffId,
    subject_staff_id: randomUUID(),
    is_active: true,
  });
  expect((await request(org(`staff/${createdStaffId}/deactivate`), {})).status).toBe(200);
  expect(
    await test.db.collection('referral_relationships').findOne({ upline_staff_id: createdStaffId }),
  ).toHaveProperty('is_active', false);
  expect(
    await test.db.collection('card_sales').countDocuments({ seller_staff_id: createdStaffId }),
  ).toBe(1);
});
it('allows only one concurrent account creation and removes an unused identity without cascading business records', async () => {
  const input = {
    email: 'unused-clerk@example.invalid',
    fullName: 'Unused Clerk',
    departmentId,
    roleId: customRoleId,
    temporaryPassword: staffPassword,
  };
  const results = await Promise.all([request(org('staff'), input), request(org('staff'), input)]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  const created = afHomesStaffSchema.parse(
    await results.find((result) => result.status === 201)!.json(),
  );
  expect((await request(org(`staff/${created.id}`), undefined, cookie, 'DELETE')).status).toBe(200);
  expect(await test.db.collection('auth_users').countDocuments({ email: input.email })).toBe(0);
  expect(await test.db.collection('auth_accounts').countDocuments({ userId: created.id })).toBe(0);
  expect(
    await test.db.collection('staff_role_assignments').countDocuments({ staff_id: created.id }),
  ).toBe(0);
  expect(
    await test.db.collection('card_sales').countDocuments({ seller_staff_id: createdStaffId }),
  ).toBe(1);
});
