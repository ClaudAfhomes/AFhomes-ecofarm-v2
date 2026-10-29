import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { manilaToday } from './sale-team.mongo.js';
import { ostAnnualExpiry, memberSchema } from '@afhomes/contracts';
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

const toIst = (id = fixture.ost.id) => ({
  direction: 'OST_TO_IST',
  requestId: randomUUID(),
  reason: 'Synthetic approved kind conversion',
  targetPosition: 'sales_manager',
  headStaffId: head,
});
const today = manilaToday();
const toOst = (id = member) => ({
  direction: 'IST_TO_OST',
  requestId: randomUUID(),
  reason: 'Synthetic approved kind conversion',
  sponsorStaffId: fixture.staff.id,
  startsOn: today,
  expiresOn: ostAnnualExpiry(today),
  identity: {
    firstName: 'Synthetic',
    lastName: 'Converted',
    email: id === member ? 'native-edit-main@example.invalid' : 'native-edit-other@example.invalid',
    phone: id === member ? '+639171234581' : '+639171234582',
    birthDate: '1990-01-01',
    address: {
      line1: 'Synthetic Street',
      city: 'Quezon City',
      province: 'Metro Manila',
      countryCode: 'PH',
    },
  },
  form: {
    dateApplied: today,
    programCategory: 'non_vip',
    vipCardType: null,
    sex: 'male',
    civilStatus: 'single',
    governmentIdType: 'other',
    governmentIdNumber: 'SYNTHETIC-KIND',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
    applicantSignedOn: today,
    referrerSignedOn: today,
  },
});
const convert = (id: string, body: unknown, auth = cookie) =>
  request(`/members/${id}/transfer`, body, auth);
it('converts expired OST to a date-free IST once while retaining credentials and retired AA history', async () => {
  const id = fixture.ost.id,
    old = await col('sale_team_accreditations').findOne({ staff_id: id }),
    account = await col('auth_accounts').findOne({ userId: id });
  const body = toIst();
  const responses = await Promise.all([convert(id, body), convert(id, body)]);
  const first = memberSchema.parse(await json(responses[0]!));
  expect(first.position).toBe('sales_manager');
  expect((await col('staff_users').findOne({ _id: id }))!.sales_number).toMatch(/^AF-SALES-/);
  expect(memberSchema.parse(await json(responses[1]!)).aaNumber).toBe(first.aaNumber);
  const aa = await json(await request(`/sale-team/${id}?kind=IST`));
  expect(aa).toMatchObject({ status: 'accredited', startsOn: null, expiresOn: null });
  expect(aa.aaNumber).not.toBe(old!.aa_number);
  expect((await col('ost_members').findOne({ _id: id }))!.status).toBe('inactive');
  expect((await col('ost_accreditation_terms').findOne({ ost_id: id }))!.status).toBe('revoked');
  expect(await col('auth_accounts').findOne({ _id: account!._id })).toEqual(account);
  expect(
    await col('sale_team_accreditation_history').findOne({ aa_number: old!.aa_number }),
  ).toMatchObject({ event: 'transferred', successor_aa_number: aa.aaNumber });
  expect((await json(await request(`/sale-team/search?aaNumber=${old!.aa_number}`))).status).toBe(
    'superseded',
  );
  expect((await convert(id, { ...body, reason: 'Conflicting request payload' })).status).toBe(409);
});
it('converts IST to already-accredited OST with the same AA suffix, complete signed evidence and no new login', async () => {
  const old = await col('sale_team_accreditations').findOne({ staff_id: member }),
    account = await col('auth_accounts').findOne({ userId: member });
  const snapshot = { _id: randomUUID(), sale_id: randomUUID(), ancestor_staff_id: member };
  await col('card_sale_hierarchy_snapshots').insertOne(snapshot);
  const body = toOst();
  const responses = await Promise.all([convert(member, body), convert(member, body)]);
  for (const r of responses)
    expect(memberSchema.parse(await json(r))).toMatchObject({
      position: 'ost',
      aaNumber: 'AAO' + String(old!.aa_number).slice(3),
    });
  const ost = await col('ost_members').findOne({ _id: member });
  const form = await col('ost_registration_details').findOne({
    application_id: ost!.application_id,
  });
  expect(form).toMatchObject({
    source: 'manual',
    endorsed_by: null,
    endorsed_at: null,
    applicant_signature_status: 'received',
  });
  expect(await col('auth_accounts').findOne({ _id: account!._id })).toEqual(account);
  expect(await col('card_sale_hierarchy_snapshots').findOne({ _id: snapshot._id })).toEqual(
    snapshot,
  );
  expect((await convert(member, toIst(member))).status).toBe(409);
});
it('refuses open renewals, missing evidence, mismatched identity and active downlines', async () => {
  const term = await col('ost_accreditation_terms').findOne({ ost_id: member, status: 'active' });
  await col('ost_accreditation_terms').updateOne(
    { _id: term!._id },
    { $set: { expires_on: '2025-01-01' } },
  );
  const pending = randomUUID();
  await col('ost_accreditation_renewals').insertOne({
    _id: pending,
    ost_id: member,
    status: 'submitted',
  });
  expect((await convert(member, toIst(member))).status).toBe(409);
  await col('ost_accreditation_renewals').deleteOne({ _id: pending });
  const body = toOst(other);
  expect(
    (
      await convert(other, {
        ...body,
        identity: { ...body.identity, email: 'wrong@example.invalid' },
      })
    ).status,
  ).toBe(409);
  expect(
    (await convert(other, { ...body, form: { ...body.form, applicantSignatureStatus: 'missing' } }))
      .status,
  ).toBe(400);
  const edge = randomUUID();
  await col('referral_relationships').insertOne({
    _id: edge,
    subject_staff_id: randomUUID(),
    upline_staff_id: other,
    is_active: true,
    hierarchy_role: 'ost',
  });
  expect((await convert(other, body)).status).toBe(409);
  await col('referral_relationships').deleteOne({ _id: edge });
});
it('keeps suffix collisions and audit failures atomic and requires both management permissions', async () => {
  const old = await col('sale_team_accreditations').findOne({ staff_id: other });
  const collision = randomUUID();
  await col('sale_team_accreditation_history').insertOne({
    _id: collision,
    staff_id: other,
    aa_number: 'AAO' + String(old!.aa_number).slice(3),
  });
  expect((await convert(other, toOst(other))).status).toBe(409);
  await col('sale_team_accreditation_history').deleteOne({ _id: collision });
  expect((await convert(other, toOst(other), '')).status).toBe(401);
  const mod = await col('modules').findOne({ key: 'organization.staff' }),
    restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: mod!._id,
    deny_update: true,
  });
  expect((await convert(other, toOst(other))).status).toBe(403);
  await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'SALE_TEAM_ACCREDITATION_TRANSFERRED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await convert(other, toOst(other))).status).toBe(503);
    expect(await col('sale_team_accreditations').findOne({ staff_id: other })).toEqual(old);
    expect(await col('ost_members').findOne({ _id: other })).toBeNull();
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
});
it('rolls back OST retirement, successor allocation and history on a failed IST approval', async () => {
  const old = await col('sale_team_accreditations').findOne({ staff_id: member }),
    term = await col('ost_accreditation_terms').findOne({ ost_id: member, status: 'active' });
  const counters = await col('counters').find({}).sort({ _id: 1 }).toArray();
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'SALE_TEAM_ACCREDITATION_TRANSFERRED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await convert(member, toIst(member))).status).toBe(503);
    expect(await col('sale_team_accreditations').findOne({ staff_id: member })).toEqual(old);
    expect(await col('ost_accreditation_terms').findOne({ _id: term!._id })).toEqual(term);
    expect((await col('ost_members').findOne({ _id: member }))!.status).toBe('active');
    expect(await col('counters').find({}).sort({ _id: 1 }).toArray()).toEqual(counters);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
});
