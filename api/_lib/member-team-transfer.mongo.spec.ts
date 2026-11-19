import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { memberSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';
import { createMongoMembersHandler } from './members.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let base = '',
  cookie = '',
  managerCookie = '',
  target = '',
  outside = '',
  ssm = '';
const col = (name: string) => replica.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown, auth = cookie, method?: string) {
  return fetch(base + '/api/v1' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: auth } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(r: Response, status = 200) {
  const body = await r.json();
  expect({ status: r.status, body }).toMatchObject({ status });
  return body;
}
const input = () => ({
  requestId: randomUUID(),
  sponsorStaffId: target,
  reason: 'Synthetic management-approved team move',
  managementApproved: true,
});
async function member() {
  return col('ost_members').findOne({ _id: fixture.ost.id });
}
async function reset() {
  await col('ost_members').updateOne(
    { _id: fixture.ost.id },
    { $set: { sponsor_staff_id: fixture.staff.id, status: 'active' } },
  );
  await col('staff_users').updateOne({ _id: fixture.ost.id }, { $set: { status: 'active' } });
  await col('ost_accreditation_terms').updateOne(
    { ost_id: fixture.ost.id },
    { $set: { status: 'active', expires_on: '2025-01-01' } },
  );
  await col('referral_relationships').updateMany(
    { subject_staff_id: fixture.ost.id },
    { $set: { is_active: false } },
  );
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: fixture.ost.id,
    upline_staff_id: fixture.staff.id,
    hierarchy_role: 'ost',
    is_authoritative: true,
    is_active: true,
  });
  await col('ost_accreditation_renewals').deleteMany({ ost_id: fixture.ost.id });
}
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-team-transfer-secret'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticTransfer123!');
  const head = await col('referral_relationships').findOne({
    subject_staff_id: fixture.staff.id,
    is_active: true,
  });
  ssm = String(head!.upline_staff_id);
  const role = await col('roles').findOne({ slug: 'sales_manager' });
  target = randomUUID();
  outside = randomUUID();
  for (const id of [target, outside]) {
    await col('staff_users').insertOne({
      _id: id,
      full_name: 'Synthetic target manager',
      email: `${id}@example.invalid`,
      status: 'active',
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: role!._id,
    });
  }
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: target,
    upline_staff_id: ssm,
    hierarchy_role: 'sales_manager',
    is_active: true,
    is_authoritative: true,
  });
  await col('network_member_profiles').insertOne({
    _id: randomUUID(),
    staff_id: fixture.ost.id,
    referrer_staff_id: fixture.staff.id,
  });
  server.on(
    'request',
    createMongoDevelopmentHandler(createMongoPhase5Runtime(replica.db, replica.client, env), {
      coreWritesEnabled: true,
    }),
  );
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.admin.email, password: 'SyntheticTransfer123!' },
    '',
  );
  await json(login);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  await json(
    await request('/admin/afhomes/session/password', {
      currentPassword: 'SyntheticTransfer123!',
      newPassword: 'SyntheticTransferReady123!',
      confirmPassword: 'SyntheticTransferReady123!',
    }),
  );
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { must_change_password: false } },
  );
  const manager = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: 'SyntheticTransfer123!' },
    '',
  );
  await json(manager);
  managerCookie = manager.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await replica?.stop();
});
it('moves an expired OST once under concurrent retries without changing AA, terms or frozen sale attribution', async () => {
  const aa = await col('sale_team_accreditations').findOne({ staff_id: fixture.ost.id }),
    term = await col('ost_accreditation_terms').findOne({ ost_id: fixture.ost.id });
  const snapshot = {
    _id: randomUUID(),
    sale_id: randomUUID(),
    ancestor_staff_id: fixture.staff.id,
  };
  await col('card_sale_hierarchy_snapshots').insertOne(snapshot);
  const body = input();
  const responses = await Promise.all([
    request(`/members/${fixture.ost.id}/team-transfer`, body),
    request(`/members/${fixture.ost.id}/team-transfer`, body),
  ]);
  for (const r of responses) {
    const view = memberSchema.parse(await json(r));
    expect(view.referrerStaffId).toBe(target);
    expect(view.aaNumber).toBe(aa!.aa_number);
  }
  expect(await col('ost_team_transfers').countDocuments({ _id: body.requestId })).toBe(1);
  expect(
    await col('referral_relationships').countDocuments({
      subject_staff_id: fixture.ost.id,
      is_active: true,
    }),
  ).toBe(1);
  expect(await col('ost_accreditation_terms').findOne({ _id: term!._id })).toEqual(term);
  expect(await col('sale_team_accreditations').findOne({ _id: aa!._id })).toEqual(aa);
  expect(await col('card_sale_hierarchy_snapshots').findOne({ _id: snapshot._id })).toEqual(
    snapshot,
  );
  expect(
    await col('audit_events').countDocuments({
      action: 'OST_TEAM_TRANSFER_APPROVED',
      entity_id: fixture.ost.id,
    }),
  ).toBe(1);
  expect(
    (
      await request(`/members/${fixture.ost.id}/team-transfer`, {
        ...body,
        reason: 'Changed request payload',
      })
    ).status,
  ).toBe(409);
});
it('rejects missing approval, nonreviewers, active terms and in-progress renewals', async () => {
  await reset();
  expect((await request(`/members/${fixture.ost.id}/team-transfer`, input(), '')).status).toBe(401);
  expect(
    (await request(`/members/${fixture.ost.id}/team-transfer`, input(), managerCookie)).status,
  ).toBe(403);
  expect(
    (
      await request(`/members/${fixture.ost.id}/team-transfer`, {
        ...input(),
        managementApproved: false,
      })
    ).status,
  ).toBe(400);
  await col('ost_accreditation_terms').updateOne(
    { ost_id: fixture.ost.id },
    { $set: { expires_on: '2099-01-01' } },
  );
  expect((await request(`/members/${fixture.ost.id}/team-transfer`, input())).status).toBe(409);
  await reset();
  await col('ost_accreditation_renewals').insertOne({
    _id: randomUUID(),
    ost_id: fixture.ost.id,
    status: 'submitted',
  });
  expect((await request(`/members/${fixture.ost.id}/team-transfer`, input())).status).toBe(409);
  expect((await member())!.sponsor_staff_id).toBe(fixture.staff.id);
});
it('rejects an incomplete target hierarchy and conflicting current genealogy', async () => {
  await reset();
  expect(
    (
      await request(`/members/${fixture.ost.id}/team-transfer`, {
        ...input(),
        sponsorStaffId: outside,
      })
    ).status,
  ).toBe(409);
  await col('referral_relationships').updateMany(
    { subject_staff_id: fixture.ost.id },
    { $set: { is_active: false } },
  );
  expect((await request(`/members/${fixture.ost.id}/team-transfer`, input())).status).toBe(409);
});
it('rolls back the move when its audit cannot be committed', async () => {
  await reset();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'OST_TEAM_TRANSFER_APPROVED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await request(`/members/${fixture.ost.id}/team-transfer`, input())).status).toBe(503);
    expect((await member())!.sponsor_staff_id).toBe(fixture.staff.id);
    expect(
      await col('referral_relationships').countDocuments({
        subject_staff_id: fixture.ost.id,
        upline_staff_id: fixture.staff.id,
        is_active: true,
      }),
    ).toBe(1);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
});

it('prevents the generic upline API from bypassing an OST transfer approval', async () => {
  await reset();
  const edge = await col('referral_relationships').findOne({
    subject_staff_id: fixture.ost.id,
    is_active: true,
  });
  expect(
    (
      await request(
        `/referrals/${edge!._id}`,
        { uplineStaffId: target, reason: 'Unapproved bypass attempt' },
        cookie,
        'PATCH',
      )
    ).status,
  ).toBe(403);
  expect((await col('referral_relationships').findOne({ _id: edge!._id }))!.is_active).toBe(true);
});

it('honors deny-only restrictions on accreditation review independently of member update permission', async () => {
  await reset();
  const module = await col('modules').findOne({ key: 'network.ost_registrations' });
  const restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_update: true,
  });
  try {
    expect((await request(`/members/${fixture.ost.id}/team-transfer`, input())).status).toBe(403);
    expect((await member())!.sponsor_staff_id).toBe(fixture.staff.id);
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
});

it('keeps a reviewer inside both the old and the new team scopes', async () => {
  await reset();
  const role = await col('roles').findOne({ slug: 'senior_sales_manager' });
  const vdEdge = await col('referral_relationships').findOne({
    subject_staff_id: ssm,
    is_active: true,
  });
  const otherSsm = randomUUID();
  await col('staff_users').insertOne({
    _id: otherSsm,
    status: 'active',
    full_name: 'Synthetic outside SSM',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: otherSsm,
    role_id: role!._id,
  });
  await col('referral_relationships').insertMany([
    {
      _id: randomUUID(),
      subject_staff_id: otherSsm,
      upline_staff_id: vdEdge!.upline_staff_id,
      hierarchy_role: 'senior_sales_manager',
      is_active: true,
    },
    {
      _id: randomUUID(),
      subject_staff_id: outside,
      upline_staff_id: otherSsm,
      hierarchy_role: 'sales_manager',
      is_active: true,
    },
  ]);
  const authorize: typeof authorizeAfHomes = async () => ({
    userId: ssm,
    email: 'synthetic-scope@example.invalid',
    fullName: 'Synthetic reviewer',
    status: 'active',
    roleId: role!._id,
    roleSlug: 'senior_sales_manager',
    roleName: 'Synthetic SSM',
    mustChangePassword: false,
    permissions: [],
  });
  const handler = createMongoMembersHandler(replica.db, replica.client, authorize),
    response = makeRes();
  await handler(
    {
      method: 'POST',
      query: { familyPath: `${fixture.ost.id}/team-transfer` },
      headers: {},
      body: { ...input(), sponsorStaffId: outside },
    } as VercelRequest,
    response.res,
  );
  expect(response.state.status).toBe(403);
  expect((await member())!.sponsor_staff_id).toBe(fixture.staff.id);
});
