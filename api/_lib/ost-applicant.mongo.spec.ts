import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';
import type { MongoRow } from './customer-activation.mongo.js';

const provider = vi.hoisted(() => ({
  provinces: vi.fn(),
  provincesInRegion: vi.fn(),
  localities: vi.fn(),
  barangays: vi.fn(),
}));
vi.mock('./address-source.js', () => ({ addressProvider: () => provider }));
let replica: Awaited<ReturnType<typeof createTestReplica>>;
let fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>;
let server: http.Server,
  base = '',
  cookie = '',
  managerCookie = '';
const col = (name: string) => replica.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown, auth = cookie) {
  return fetch(base + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: auth } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response: Response, status = 200) {
  const body = await response.json();
  expect({ status: response.status, body }).toMatchObject({ status });
  return body;
}
async function login(email: string) {
  const response = await request(
    '/auth/identity/sign-in/email',
    { email, password: 'SyntheticCorrection123!' },
    '',
  );
  await json(response);
  return response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
}
const correction = () => ({
  requestId: randomUUID(),
  fullName: 'SYNTHETIC CORRECTED MEMBER',
  birthDate: '1990-01-01',
  phone: '+639171234568',
  sex: 'male',
  civilStatus: 'single',
  messenger: '',
  employerName: '',
  jobPosition: '',
  reason: 'Synthetic verified identity correction',
});
const save = (body: unknown, auth = cookie) =>
  request(`/ost-accreditation/members/${fixture.ost.id}/applicant`, body, auth);
const records = () => request(`/ost-accreditation/members/${fixture.ost.id}`).then((r) => json(r));
beforeAll(async () => {
  replica = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-correction-only'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticCorrection123!');
  server.on(
    'request',
    createMongoDevelopmentHandler(createMongoPhase5Runtime(replica.db, replica.client, env), {
      coreWritesEnabled: true,
    }),
  );
  cookie = await login(fixture.admin.email);
  await json(
    await request('/admin/afhomes/session/password', {
      currentPassword: 'SyntheticCorrection123!',
      newPassword: 'SyntheticCorrectionReady123!',
      confirmPassword: 'SyntheticCorrectionReady123!',
    }),
  );
  managerCookie = await login(fixture.staff.email);
  await json(
    await request(
      '/admin/afhomes/session/password',
      {
        currentPassword: 'SyntheticCorrection123!',
        newPassword: 'SyntheticManagerReady123!',
        confirmPassword: 'SyntheticManagerReady123!',
      },
      managerCookie,
    ),
  );
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await replica?.stop();
});

it('appends one correction under concurrent retries, overlays reads and preserves original records/account', async () => {
  const before = await records();
  const originals = await Promise.all(
    [
      'staff_users',
      'ost_members',
      'ost_applications',
      'ost_registration_details',
      'sale_team_accreditations',
      'auth_accounts',
    ].map((table) => col(table).find().toArray()),
  );
  const body = correction();
  await Promise.all([save(body), save(body)]).then((rs) => Promise.all(rs.map((r) => json(r))));
  expect(await col('ost_applicant_changes').countDocuments()).toBe(1);
  const entry = await col('ost_applicant_changes').findOne({ ost_id: fixture.ost.id });
  expect(entry).toMatchObject({
    changed_fields: ['fullName'],
    prior_values: { fullName: before.currentApplicant.fullName },
    resulting_values: { fullName: body.fullName },
    changed_by: fixture.admin.id,
  });
  expect((await records()).currentApplicant).toMatchObject({
    fullName: body.fullName,
    email: fixture.ost.email,
  });
  expect(await json(await request(`/members/${fixture.ost.id}`))).toMatchObject({
    fullName: body.fullName,
    dateOfBirth: body.birthDate,
    mobileNo: body.phone,
  });
  const after = await Promise.all(
    [
      'staff_users',
      'ost_members',
      'ost_applications',
      'ost_registration_details',
      'sale_team_accreditations',
      'auth_accounts',
    ].map((table) => col(table).find().toArray()),
  );
  expect(after).toEqual(originals);
  const audit = await col('audit_events').findOne({ action: 'OST_APPLICANT_UPDATED' });
  expect(audit?.after_data).toEqual({ changeId: entry!._id, changedFields: ['fullName'] });
  await json(await save(body));
  await json(await save({ ...body, phone: '+639171234589' }), 409);
  await json(await save({ ...body, requestId: randomUUID() }), 400);
});

it('requires identity-change reasons and rejects protected fields and unauthorized users', async () => {
  await json(await save({ ...correction(), fullName: 'ANOTHER SYNTHETIC NAME', reason: '' }), 400);
  await json(await save({ ...correction(), email: 'replacement@example.invalid' }), 400);
  await json(await save({ ...correction(), programCategory: 'vip_holder' }), 400);
  await json(await save(correction(), ''), 401);
  await json(await save(correction(), managerCookie), 403);
  const module = await col('modules').findOne({ key: 'network.members' });
  const restriction = randomUUID();
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_update: true,
  });
  try {
    await json(await save(correction()), 403);
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
  const ownCookie = await login(fixture.ost.email);
  await json(
    await request(
      '/admin/afhomes/session/password',
      {
        currentPassword: 'SyntheticCorrection123!',
        newPassword: 'SyntheticOstReady123!',
        confirmPassword: 'SyntheticOstReady123!',
      },
      ownCookie,
    ),
  );
  await json(await save(correction(), ownCookie), 403);
  const recordsModule = await col('modules').findOne({ key: 'network.ost_registrations' });
  await col('staff_permission_restrictions').insertOne({
    _id: restriction,
    staff_id: fixture.admin.id,
    module_id: recordsModule!._id,
    deny_view: true,
  });
  try {
    await json(await request(`/ost-accreditation/members/${fixture.ost.id}`), 403);
    expect(await json(await request(`/members/${fixture.ost.id}`))).toMatchObject({
      fullName: 'SYNTHETIC OST MEMBER',
      dateOfBirth: null,
    });
  } finally {
    await col('staff_permission_restrictions').deleteOne({ _id: restriction });
  }
});

it('verifies address names/codes, supports explicit clearing, and preserves frozen renewal snapshots', async () => {
  provider.provinces.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  provider.provincesInRegion.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  provider.localities.mockResolvedValue([
    {
      code: '0403406000',
      name: 'Calauan',
      type: 'municipality',
      provinceCode: '0403400000',
      postalCode: '4000',
    },
  ]);
  provider.barangays.mockResolvedValue([
    { code: '0403406003', name: 'Dayap', localityCode: '0403406000' },
  ]);
  const body = {
    ...correction(),
    messenger: 'Synthetic Messenger',
    address: {
      line1: 'Synthetic Street',
      city: 'submitted',
      province: 'submitted',
      countryCode: 'PH',
    },
    addressHierarchy: {
      regionCode: '0400000000',
      provinceCode: '0403400000',
      localityCode: '0403406000',
      barangayCode: '0403406003',
    },
  };
  await json(await save(body));
  await json(await save({ ...body, requestId: randomUUID() }), 400);
  expect((await records()).currentApplicant.address).toMatchObject({
    city: 'Calauan',
    province: 'Laguna',
    postalCode: '4000',
  });
  expect(
    (await col('ost_applicant_changes').findOne({ 'resulting_values.messenger': body.messenger }))
      ?.resulting_values,
  ).toMatchObject({ address: { ...body.addressHierarchy, city: 'Calauan' } });
  const renewal = {
    requestId: randomUUID(),
    dateOfRenewal: '2026-10-27',
    requestedStart: '2027-01-02',
    requestedEnd: '2028-01-02',
    proposedNewSponsorStaffId: null,
    reasonForReferrerChange: '',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
  };
  await json(await request(`/ost-accreditation/members/${fixture.ost.id}/renew`, renewal), 201);
  const frozen = await col('ost_accreditation_renewals').findOne({ ost_id: fixture.ost.id });
  expect(frozen?.applicant_snapshot).toMatchObject({ messenger: body.messenger });
  await json(await save(correction()));
  expect((await records()).currentApplicant.messenger).toBeNull();
  expect(await col('ost_accreditation_renewals').findOne({ _id: frozen!._id })).toEqual(frozen);
  provider.barangays.mockResolvedValueOnce([]);
  await json(await save({ ...body, requestId: randomUUID() }), 400);
  provider.provincesInRegion.mockRejectedValueOnce(new Error('Synthetic reference outage'));
  await json(await save({ ...body, requestId: randomUUID() }), 503);
  await json(await save({ ...correction(), address: body.address }), 400);
});

it('rolls back the ledger, replay record and sequence if audit insertion fails', async () => {
  const count = await col('ost_applicant_changes').countDocuments();
  const counter = await col('counters').findOne({ _id: 'ost-applicant-change' });
  const body = { ...correction(), phone: '+639171234590' };
  await replica.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'OST_APPLICANT_UPDATED' } },
  });
  try {
    await json(await save(body), 503);
  } finally {
    await replica.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(await col('ost_applicant_changes').countDocuments()).toBe(count);
  expect(await col('mutation_requests').countDocuments({ request_id: body.requestId })).toBe(0);
  expect(await col('counters').findOne({ _id: 'ost-applicant-change' })).toEqual(counter);
  await json(await save(body));
});
