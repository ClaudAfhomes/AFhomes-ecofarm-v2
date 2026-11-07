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
import { verifyPassword } from 'better-auth/crypto';
import type { MongoRow } from './customer-activation.mongo.js';
let replica: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let base = '',
  cookie = '',
  member = '',
  other = '',
  head = '',
  vd = '',
  province = '',
  city = '';
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
const patch = (body: unknown, auth = cookie) => request(`/members/${member}`, body, auth, 'PATCH');
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-member-update-secret'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticMember123!');
  server.on(
    'request',
    createMongoDevelopmentHandler(createMongoPhase5Runtime(replica.db, replica.client, env), {
      coreWritesEnabled: true,
    }),
  );
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.admin.email, password: 'SyntheticMember123!' },
    '',
  );
  await json(login);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  await json(
    await request('/admin/afhomes/session/password', {
      currentPassword: 'SyntheticMember123!',
      newPassword: 'SyntheticMemberReady123!',
      confirmPassword: 'SyntheticMemberReady123!',
    }),
  );
  const members = await json(await request('/members'));
  head = members.data.find((r: { position: string }) => r.position === 'senior_sales_manager').id;
  vd = members.data.find((r: { position: string }) => r.position === 'vice_director').id;
  const departments = await json(await request('/admin/afhomes/departments'));
  const dept = departments.data.find((r: { code: string }) => r.code === 'SALES');
  const provinces = await json(await request('/address'));
  province = provinces.data.find((r: { name: string }) => r.name === 'Metro Manila').code;
  const cities = await json(await request(`/address/provinces/${province}/localities`));
  city = cities.data.find((r: { name: string }) => r.name === 'Quezon City').code;
  for (const suffix of ['main', 'other']) {
    const created = await json(
      await request('/members', {
        fullName: 'Synthetic Editable Member',
        email: `native-edit-${suffix}@example.invalid`,
        temporaryPassword: 'SyntheticMemberTemp123!',
        departmentId: dept.id,
        position: 'sales_manager',
        referrerStaffId: head,
        dateOfBirth: '1990-01-01',
        sex: 'Male',
        civilStatus: 'Single',
        streetNo: 'Synthetic Test Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        provinceCode: province,
        cityMunicipalityCode: city,
        zipCode: '1100',
        mobileNo: '+639171234577',
        employerName: 'Synthetic Employer',
        employerAddress: 'Synthetic Office',
        jobPosition: 'Seller',
        governmentIdType: 'other',
        governmentIdNumber: 'SYNTHETIC-EDIT',
        tin: '123456789',
      }),
      201,
    );
    if (suffix === 'main') member = created.id;
    else other = created.id;
  }
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await replica?.stop();
});
it('persists partial profile edits with masked reads and field-only audit while retaining AA identity', async () => {
  const aa = await col('sale_team_accreditations').findOne({ staff_id: member });
  const body = memberSchema.parse(
    await json(
      await patch({
        fullName: 'Updated Synthetic Member',
        mobileNo: '+639171234588',
        governmentIdNumber: 'SYNTHETIC-NEW',
        tin: '987654321',
        jobPosition: 'Coordinator',
      }),
    ),
  );
  expect(body.fullName).toBe('Updated Synthetic Member');
  expect(body.governmentIdMasked).toBe('***-NEW');
  expect(body.tinMasked).toBe('***4321');
  const reread = await json(await request(`/members/${member}`));
  expect(reread.fullName).toBe(body.fullName);
  expect(reread.jobPosition).toBe('Coordinator');
  expect(await col('sale_team_accreditations').findOne({ _id: aa!._id })).toEqual(aa);
  const audit = await col('audit_events').findOne({ entity_id: member, action: 'MEMBER_UPDATED' });
  expect(audit!.after_data).toMatchObject({
    fields: expect.arrayContaining(['governmentIdNumber', 'tin']),
  });
  expect(JSON.stringify(audit)).not.toContain('SYNTHETIC-NEW');
  expect(JSON.stringify(audit)).not.toContain('987654321');
});
it('keeps private fields on an ordinary save and rejects empty or unverified address updates', async () => {
  await json(await patch({ employerName: 'Updated Employer' }));
  expect(
    (await col('network_member_profiles').findOne({ staff_id: member }))!.government_id_number,
  ).toBe('SYNTHETIC-NEW');
  expect((await patch({})).status).toBe(400);
  expect((await patch({ provinceCode: province })).status).toBe(400);
  expect((await patch({ provinceCode: province, cityMunicipalityCode: '9999999999' })).status).toBe(
    400,
  );
  const updated = await json(
    await patch({
      provinceCode: province,
      cityMunicipalityCode: city,
      province: 'Wrong province',
      cityMunicipality: 'Wrong city',
      zipCode: '1109',
    }),
  );
  expect(updated.province).toBe('Metro Manila');
  expect(updated.cityMunicipality).toBe('Quezon City');
  expect(updated.zipCode).toBe('1109');
});
it('updates login email and temporary credentials atomically and enforces first-password-change access', async () => {
  const first = await request(
    '/auth/identity/sign-in/email',
    { email: 'native-edit-main@example.invalid', password: 'SyntheticMemberTemp123!' },
    '',
  );
  await json(first);
  const priorCookie = first.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  await json(
    await request(
      '/admin/afhomes/session/password',
      {
        currentPassword: 'SyntheticMemberTemp123!',
        newPassword: 'SyntheticBeforeReset123!',
        confirmPassword: 'SyntheticBeforeReset123!',
      },
      priorCookie,
    ),
  );
  expect((await col('staff_users').findOne({ _id: member }))!.must_change_password).toBe(false);
  await json(
    await patch({
      email: 'native-edit-renamed@example.invalid',
      temporaryPassword: 'SyntheticMemberReset123!',
    }),
  );
  expect((await col('staff_users').findOne({ _id: member }))!.must_change_password).toBe(true);
  expect((await col('auth_users').findOne({ _id: member }))!.email).toBe(
    'native-edit-renamed@example.invalid',
  );
  expect(await col('auth_sessions').countDocuments({ userId: member })).toBe(0);
  expect((await request('/admin/afhomes/session', undefined, priorCookie)).status).toBe(401);
  expect(await col('auth_users').findOne({ email: 'native-edit-main@example.invalid' })).toBeNull();
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: 'native-edit-renamed@example.invalid', password: 'SyntheticMemberReset123!' },
    '',
  );
  await json(login);
  const fresh = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  const session = await json(await request('/admin/afhomes/session', undefined, fresh));
  expect(session.mustChangePassword).toBe(true);
  expect((await request('/members', undefined, fresh)).status).toBe(403);
  const account = await col('auth_accounts').findOne({ userId: member, providerId: 'credential' });
  expect(
    await verifyPassword({ hash: String(account!.password), password: 'SyntheticMemberReset123!' }),
  ).toBe(true);
  expect(
    await verifyPassword({ hash: String(account!.password), password: 'SyntheticBeforeReset123!' }),
  ).toBe(false);
  const audits = await col('audit_events').find({ entity_id: member }).toArray();
  expect(JSON.stringify(audits)).not.toContain('SyntheticMemberReset123!');
});
it('rejects duplicate email without changing profile or password', async () => {
  const profile = await col('network_member_profiles').findOne({ staff_id: member });
  const account = await col('auth_accounts').findOne({ userId: member, providerId: 'credential' });
  expect(
    (
      await patch({
        email: 'native-edit-other@example.invalid',
        temporaryPassword: 'SyntheticRejectedReset123!',
        jobPosition: 'Should not persist',
      })
    ).status,
  ).toBe(409);
  expect(await col('network_member_profiles').findOne({ staff_id: member })).toEqual(profile);
  expect(await col('auth_accounts').findOne({ _id: account!._id })).toEqual(account);
});
it('requires immediate-upline roles and reasons and preserves historical sale attribution on a position change', async () => {
  const snap = { _id: randomUUID(), sale_id: randomUUID(), ancestor_staff_id: head };
  await col('card_sale_hierarchy_snapshots').insertOne(snap);
  expect(
    (await patch({ referrerStaffId: vd, headChangeReason: 'Invalid immediate upline' })).status,
  ).toBe(400);
  expect((await patch({ position: 'senior_sales_manager', referrerStaffId: vd })).status).toBe(400);
  const row = await json(
    await patch({
      position: 'senior_sales_manager',
      referrerStaffId: vd,
      headChangeReason: 'Synthetic approved position change',
    }),
  );
  expect(row.position).toBe('senior_sales_manager');
  expect(row.referrerStaffId).toBe(vd);
  expect(
    await col('referral_relationships').countDocuments({
      subject_staff_id: member,
      is_active: true,
    }),
  ).toBe(1);
  expect(await col('card_sale_hierarchy_snapshots').findOne({ _id: snap._id })).toEqual(snap);
  expect((await patch({ position: 'ost' })).status).toBe(400);
});
it('rolls back identity, credential, role and profile writes when audit fails', async () => {
  const staff = await col('staff_users').findOne({ _id: member }),
    auth = await col('auth_users').findOne({ _id: member }),
    account = await col('auth_accounts').findOne({ userId: member, providerId: 'credential' }),
    profile = await col('network_member_profiles').findOne({ staff_id: member });
  const roleBefore = await col('staff_role_assignments').findOne({ staff_id: member });
  const edgesBefore = await col('referral_relationships')
    .find({ subject_staff_id: member })
    .sort({ _id: 1 })
    .toArray();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'MEMBER_UPDATED' } },
    validationLevel: 'strict',
  });
  try {
    expect(
      (
        await patch({
          email: 'rollback-member@example.invalid',
          temporaryPassword: 'SyntheticRollbackOnly123!',
          fullName: 'Must Roll Back',
          jobPosition: 'Must Roll Back',
          position: 'sales_manager',
          referrerStaffId: head,
          headChangeReason: 'Rollback this position change',
        })
      ).status,
    ).toBe(503);
    expect(await col('staff_users').findOne({ _id: member })).toEqual(staff);
    expect(await col('auth_users').findOne({ _id: member })).toEqual(auth);
    expect(await col('auth_accounts').findOne({ _id: account!._id })).toEqual(account);
    expect(await col('network_member_profiles').findOne({ staff_id: member })).toEqual(profile);
    expect(await col('staff_role_assignments').findOne({ staff_id: member })).toEqual(roleBefore);
    expect(
      await col('referral_relationships')
        .find({ subject_staff_id: member })
        .sort({ _id: 1 })
        .toArray(),
    ).toEqual(edgesBefore);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
});
it('requires update permission, limits genealogy scope and never treats an administrator as an editable member', async () => {
  expect((await patch({ jobPosition: 'Blocked' }, '')).status).toBe(401);
  const restriction = randomUUID(),
    module = await col('modules').findOne({ key: 'network.members' });
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_update: true,
  });
  try {
    expect((await patch({ jobPosition: 'Blocked' })).status).toBe(403);
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
  expect(
    (
      await request(
        `/members/${fixture.admin.id}`,
        { temporaryPassword: 'NeverResetAdmin123!' },
        cookie,
        'PATCH',
      )
    ).status,
  ).toBe(404);
});

it('denies out-of-team editing and assigning permissions the caller does not possess', async () => {
  const assignment = await col('staff_role_assignments').findOne({ staff_id: other });
  const authorize: typeof authorizeAfHomes = async () => ({
    userId: other,
    email: 'native-edit-other@example.invalid',
    fullName: 'Synthetic scoped member',
    status: 'active',
    roleId: String(assignment!.role_id),
    roleSlug: 'sales_manager',
    roleName: 'Sales Manager',
    mustChangePassword: false,
    permissions: [],
  });
  const handler = createMongoMembersHandler(replica.db, replica.client, authorize);
  const peer = makeRes();
  await handler(
    {
      method: 'PATCH',
      query: { familyPath: member },
      headers: {},
      body: { jobPosition: 'Out of scope' },
    } as VercelRequest,
    peer.res,
  );
  expect(peer.state.status).toBe(403);
  const role = await col('roles').findOne({ slug: 'vice_director' }),
    module = await col('modules').findOne({ key: 'organization.roles' }),
    grant = randomUUID();
  await col('role_permissions').insertOne({
    _id: grant,
    role_id: role!._id,
    module_id: module!._id,
    can_view: true,
    can_update: true,
  });
  try {
    const escalation = makeRes();
    await handler(
      {
        method: 'PATCH',
        query: { familyPath: other },
        headers: {},
        body: {
          position: 'vice_director',
          referrerStaffId: null,
          headChangeReason: 'Denied synthetic escalation',
        },
      } as VercelRequest,
      escalation.res,
    );
    expect(escalation.state.status).toBe(403);
    expect((await col('staff_role_assignments').findOne({ staff_id: other }))!.role_id).toBe(
      assignment!.role_id,
    );
  } finally {
    await col('role_permissions').deleteOne({ _id: grant });
  }
});

it('serves the sales-involvement panel through the real cookie runtime with a truthful empty result', async () => {
  const response = await json(await request(`/admin/afhomes/staff/${member}/sales-involvement`));
  expect(response.data).toEqual([]);
  const seller = await json(
    await request(`/admin/afhomes/staff/${fixture.staff.id}/sales-involvement`),
  );
  expect(seller.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        roles: expect.arrayContaining(['Seller']),
        reference: 'AF-CSALE-QAABC',
      }),
    ]),
  );
  expect(
    (await request(`/admin/afhomes/staff/${member}/sales-involvement`, undefined, '')).status,
  ).toBe(401);
});
it('allows an authorized profile correction on an inactive position without reactivating its role', async () => {
  const assignment = await col('staff_role_assignments').findOne({ staff_id: other });
  await col('roles').updateOne(
    { _id: String(assignment!.role_id) },
    { $set: { is_active: false } },
  );
  try {
    expect(
      (
        await request(
          `/members/${other}`,
          { jobPosition: 'Archived position correction' },
          cookie,
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await col('roles').findOne({ _id: String(assignment!.role_id) }))!.is_active).toBe(
      false,
    );
  } finally {
    await col('roles').updateOne(
      { _id: String(assignment!.role_id) },
      { $set: { is_active: true } },
    );
  }
});
