import { createAfHomesAdminAuth } from './auth.js';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  saleTeamLookupSchema,
  ostAccreditationRecordsSchema,
  ostMeSchema,
  ostDashboardSchema,
  ostSalesListSchema,
  ostCommissionsListSchema,
} from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  cookie = '';
let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;
let manager = '',
  ost = '',
  managerCookie = '',
  ostCookie = '';
const col = (name: string) =>
  test.db.collection<import('./customer-activation.mongo.js').MongoRow>(name);
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
    'network.ost_registrations',
  ])
    await test.db
      .collection<{ _id: string; key: string; is_active: boolean }>('modules')
      .insertOne({ _id: randomUUID(), key, is_active: true });
  for (const slug of ['sales_manager', 'ost']) {
    const internal = createAfHomesAdminAuth(test.db, test.client, env);
    const created = await internal.api.createUser({
      body: {
        email: `${slug}@example.invalid`,
        password: 'SyntheticNetworkOnly123!',
        name: `Synthetic ${slug}`,
        data: { emailVerified: true },
      },
    });
    const id = created.user.id,
      roleId = randomUUID();
    if (slug === 'ost') ost = id;
    else manager = id;
    await col('staff_users').insertOne({
      _id: id,
      email: `${slug}@example.invalid`,
      full_name: `SYNTHETIC ${slug}`,
      status: 'active',
    });
    await col('roles').insertOne({ _id: roleId, slug, name: `Synthetic ${slug}`, is_active: true });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: roleId,
    });
    if (slug === 'sales_manager') {
      const module = await col('modules').findOne({ key: 'network.ost_registrations' });
      await col('role_permissions').insertOne({
        _id: randomUUID(),
        role_id: roleId,
        module_id: module!._id,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      });
    }
  }
  await col('ost_members').insertOne({
    _id: ost,
    status: 'active',
    sponsor_staff_id: manager,
    ost_number: 'AF-OST-QAABC',
    full_name: 'SYNTHETIC OST',
    email: 'ost@example.invalid',
    approved_by: fixture.staff.id,
    approved_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    '',
  );
  expect(login.status).toBe(200);
  cookie = jar(login);
  const sponsorLogin = await request(
    '/auth/identity/sign-in/email',
    { email: 'sales_manager@example.invalid', password: 'SyntheticNetworkOnly123!' },
    '',
  );
  expect(sponsorLogin.status).toBe(200);
  managerCookie = jar(sponsorLogin);
  const ownLogin = await request(
    '/auth/identity/sign-in/email',
    { email: 'ost@example.invalid', password: 'SyntheticNetworkOnly123!' },
    '',
  );
  expect(ownLogin.status).toBe(200);
  ostCookie = jar(ownLogin);
  const applicationId = randomUUID();
  await col('ost_applications').insertOne({
    _id: applicationId,
    first_name: 'Synthetic',
    last_name: 'OST',
    birth_date: '1990-01-01',
    address: { line1: 'Synthetic Street' },
    sponsor_staff_id: manager,
  });
  await col('ost_members').updateOne(
    { _id: ost },
    { $set: { application_id: applicationId, phone: '+639171234567' } },
  );
  await col('ost_registration_details').insertOne({
    _id: randomUUID(),
    application_id: applicationId,
    form_number: 'SYNTHETIC-FORM',
    date_applied: '2026-01-01',
    program_category: 'future_vip',
    vip_card_type: null,
    applicant_signature_status: 'received',
    referrer_signature_status: 'received',
    endorsed_at: '2026-01-01T00:00:00Z',
    official_details: {
      sex: 'male',
      civilStatus: 'single',
      governmentIdNumber: 'SYNTHETIC-SECRET-ID',
      tin: '123456789',
    },
  });
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

const manage = (id: string, body?: unknown) =>
  request(
    '/sale-team/' + id + (body === undefined ? '?kind=' + (id === manager ? 'IST' : 'OST') : ''),
    body,
  );
it('requires a real staff session and administrator permission while preserving the password-change gate', async () => {
  expect((await request('/sale-team/' + manager + '?kind=IST', undefined, '')).status).toBe(401);
  await col('staff_users').updateOne({_id:fixture.staff.id},{$set:{must_change_password:true}});
  expect((await manage(manager, { kind: 'IST', action: 'approve' })).status).toBe(403);
  await col('staff_users').updateOne({_id:fixture.staff.id},{$set:{must_change_password:false}});
});
it('issues one date-free IST identity on simultaneous approvals and reads it with the original contract', async () => {
  const [a, b] = await Promise.all([
    manage(manager, { kind: 'IST', action: 'approve' }),
    manage(manager, { kind: 'IST', action: 'approve' }),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  const one = saleTeamLookupSchema.parse(await a.json()),
    two = saleTeamLookupSchema.parse(await b.json());
  expect(one).toMatchObject({ kind: 'IST', status: 'accredited', startsOn: null, expiresOn: null });
  expect(one!.aaNumber).toMatch(/^AAI\d{8}$/);
  expect(two!.aaNumber).toBe(one!.aaNumber);
  expect(await col('sale_team_accreditations').countDocuments({ staff_id: manager })).toBe(1);
  expect(
    await col('audit_events').countDocuments({
      entity_id: manager,
      action: 'IST_EMPLOYEE_IDENTITY_ISSUED',
    }),
  ).toBe(1);
  expect(await (await manage(manager)).json()).toEqual(one);
  expect((await manage(manager, { kind: 'IST', action: 'revoke' })).status).toBe(400);
  expect(await col('ost_accreditation_terms').countDocuments({ ost_id: manager })).toBe(0);
});
it('derives OST dates from approved terms rather than the posted dates and preserves its AA on revoke/reapproval', async () => {
  expect(
    (
      await manage(ost, {
        kind: 'OST',
        action: 'approve',
        startsOn: '2000-01-01',
        expiresOn: '2099-01-01',
      })
    ).status,
  ).toBe(409);
  await col('ost_accreditation_terms').insertOne({
    _id: randomUUID(),
    ost_id: ost,
    status: 'active',
    starts_on: '2026-01-01',
    expires_on: '2027-01-01',
    approved_at: new Date().toISOString(),
  });
  const approved = await manage(ost, {
    kind: 'OST',
    action: 'approve',
    startsOn: '2000-01-01',
    expiresOn: '2099-01-01',
  });
  expect(approved.status).toBe(200);
  const value = saleTeamLookupSchema.parse(await approved.json());
  expect(value).toMatchObject({
    kind: 'OST',
    startsOn: '2026-01-01',
    expiresOn: '2027-01-01',
    status: 'accredited',
  });
  expect(value!.aaNumber).toMatch(/^AAO\d{8}$/);
  const revoke = await manage(ost, { kind: 'OST', action: 'revoke' });
  expect(revoke.status).toBe(200);
  expect((await revoke.json()).status).toBe('revoked');
  expect((await manage(ost, { kind: 'OST', action: 'revoke' })).status).toBe(200);
  const restored = await manage(ost, { kind: 'OST', action: 'approve' });
  expect(restored.status).toBe(200);
  expect((await restored.json()).aaNumber).toBe(value!.aaNumber);
  expect(
    await col('audit_events').countDocuments({
      entity_id: ost,
      action: 'SALE_TEAM_ACCREDITATION_REVOKED',
    }),
  ).toBe(1);
});
it('rolls identity issuance back when audit insertion fails', async () => {
  const id = randomUUID(),
    role = await col('roles').findOne({ slug: 'sales_manager' });
  await col('staff_users').insertOne({
    _id: id,
    email: 'rollback-identity@example.invalid',
    full_name: 'SYNTHETIC ROLLBACK',
    status: 'active',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: id,
    role_id: role!._id,
  });
  await test.db.command({
    collMod: 'audit_events',
    validator: { $expr: { $ne: ['$action', 'IST_EMPLOYEE_IDENTITY_ISSUED'] } },
    validationLevel: 'strict',
  });
  try {
    expect((await manage(id, { kind: 'IST', action: 'approve' })).status).toBe(503);
    expect(await col('sale_team_accreditations').countDocuments({ staff_id: id })).toBe(0);
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect((await manage(id, { kind: 'IST', action: 'approve' })).status).toBe(200);
});

it('persists manual OST renewal, requires sponsor endorsement, rolls approval back and keeps immutable prior history', async () => {
  const route = '/ost-accreditation/members/' + ost;
  const body = {
    requestId: randomUUID(),
    dateOfRenewal: '2026-10-26',
    requestedStart: '2027-01-02',
    requestedEnd: '2028-01-02',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
  };
  expect((await request(route + '/renew', body, '')).status).toBe(401);
  expect(
    (
      await request(
        route + '/renew',
        { ...body, requestedStart: '2027-01-01', requestedEnd: '2028-01-01' },
        ostCookie,
      )
    ).status,
  ).toBe(409);
  const response = await request(route + '/renew', body, ostCookie);
  expect(response.status).toBe(201);
  const renewal = (await response.json()).id;
  expect((await (await request(route + '/renew', body, ostCookie)).json()).id).toBe(renewal);
  expect(
    (await request(route + '/renew', { ...body, dateOfRenewal: '2026-10-25' }, ostCookie)).status,
  ).toBe(409);
  const decide = '/ost-accreditation/renewals/' + renewal + '/decision';
  expect((await request(decide, { action: 'approve' }, ostCookie)).status).toBe(403);
  expect((await request(decide, { action: 'approve' })).status).toBe(409);
  expect((await request(decide, { action: 'endorse' })).status).toBe(403);
  expect((await request(decide, { action: 'endorse' }, managerCookie)).status).toBe(200);
  const before = await col('ost_accreditation_renewals').findOne({ _id: renewal });
  await test.db.command({
    collMod: 'audit_events',
    validator: { $expr: { $ne: ['$action', 'OST_RENEWAL_APPROVED'] } },
    validationLevel: 'strict',
  });
  try {
    expect((await request(decide, { action: 'approve' })).status).toBe(503);
    expect((await col('ost_accreditation_renewals').findOne({ _id: renewal }))!.status).toBe(
      'endorsed',
    );
    expect(await col('ost_accreditation_terms').countDocuments({ ost_id: ost })).toBe(1);
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  const [a, b] = await Promise.all([
    request(decide, { action: 'approve' }),
    request(decide, { action: 'approve' }),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect((await a.json()).id).toBe((await b.json()).id);
  const after = await col('ost_accreditation_renewals').findOne({ _id: renewal });
  expect(after!.applicant_snapshot).toEqual(before!.applicant_snapshot);
  expect(
    await col('ost_accreditation_terms').countDocuments({ ost_id: ost, status: 'active' }),
  ).toBe(1);
  expect(
    await col('ost_accreditation_terms').countDocuments({ ost_id: ost, status: 'superseded' }),
  ).toBe(1);
  expect(
    (await request('/ost-accreditation/renewals/' + renewal + '/revise', body, ostCookie)).status,
  ).toBe(409);
  const records = ostAccreditationRecordsSchema.parse(
    await (await request(route, undefined, ostCookie)).json(),
  );
  expect(records.renewals[0]!.status).toBe('approved');
  expect(records.currentApplicant!.programCategory).toBe('unknown');
  expect(JSON.stringify(records)).not.toMatch(
    /SYNTHETIC-SECRET-ID|123456789|payload_hash|request_id/,
  );
  expect((await (await manage(ost)).json()).expiresOn).toBe('2028-01-02');
  expect(
    (await request('/ost-accreditation/members/' + manager, undefined, ostCookie)).status,
  ).toBe(403);
});

it('serves only the signed-in OST portal records with exact commission buckets and persisted pagination', async () => {
  expect((await request('/ost/me', undefined, '')).status).toBe(401);
  expect((await request('/ost/me', undefined, managerCookie)).status).toBe(404);
  const me = await request('/ost/me', undefined, ostCookie);
  expect(me.status).toBe(200);
  expect(ostMeSchema.parse(await me.json())).toMatchObject({
    ostNumber: 'AF-OST-QAABC',
    fullName: 'SYNTHETIC OST',
    status: 'active',
  });
  const saleId = randomUUID(),
    now = new Date().toISOString();
  await col('card_sales').insertOne({
    _id: saleId,
    origin: 'normal',
    sale_number: 'SYNTHETIC-OST-SALE',
    customer_id: fixture.customer.id,
    plan_id: fixture.plan,
    seller_staff_id: ost,
    status: 'active',
    cash_price_snapshot: '0.10',
    created_at: now,
  });
  for (const [number, status, amount, settled] of [
    ['SYNTHETIC-PENDING', 'pending', '0.03', false],
    ['SYNTHETIC-PAID', 'paid', '0.07', false],
    ['SYNTHETIC-SETTLED', 'paid', '100.00', true],
  ])
    await col('commissions').insertOne({
      _id: randomUUID(),
      commission_number: number,
      sale_id: saleId,
      beneficiary_staff_id: ost,
      status,
      amount,
      settled_before_system: settled,
      created_at: now,
    });
  const dashboard = ostDashboardSchema.parse(
    await (await request('/ost/me/dashboard', undefined, ostCookie)).json(),
  );
  expect(dashboard.sales).toMatchObject({
    totalSales: 1,
    periodSales: 1,
    qualifyingSaleStatus: 'active',
  });
  expect(dashboard.commissions).toMatchObject({
    toEarn: { count: 1, amount: '0.03' },
    earned: { count: 0, amount: '0.00' },
    paid: { count: 1, amount: '0.07' },
  });
  const sales = ostSalesListSchema.parse(
    await (await request('/ost/me/sales?limit=1&offset=0', undefined, ostCookie)).json(),
  );
  expect(sales.meta.total).toBe(1);
  expect(sales.data[0]!.id).toBe(saleId);
  expect(sales.summary!.qualifyingSales).toBe(1);
  const commissions = ostCommissionsListSchema.parse(
    await (
      await request('/ost/me/commissions?search=SYNTHETIC-OST-SALE&limit=1', undefined, ostCookie)
    ).json(),
  );
  expect(commissions.meta.total).toBe(2);
  expect(commissions.data).toHaveLength(1);
  expect(JSON.stringify(dashboard)).not.toMatch(
    /government|password|payload_hash|SYNTHETIC-SETTLED/,
  );
  await col('staff_users').updateOne({ _id: ost }, { $set: { must_change_password: true } });
  expect((await request('/ost/me/dashboard', undefined, ostCookie)).status).toBe(403);
  await col('staff_users').updateOne({ _id: ost }, { $set: { must_change_password: false } });
  expect((await request('/ost/me/dashboard', undefined, ostCookie)).status).toBe(200);
});

it('renews an expired OST with a reviewed sponsor change atomically while preserving its AA and sale history', async () => {
  let head = '';
  let newSponsor = '';
  for (const slug of ['vice_director', 'senior_sales_manager', 'sales_manager']) {
    const id = randomUUID();
    let assigned = await col('roles').findOne({ slug });
    if (!assigned) {
      const roleId = randomUUID();
      await col('roles').insertOne({
        _id: roleId,
        slug,
        name: 'Synthetic ' + slug,
        is_active: true,
      });
      assigned = await col('roles').findOne({ _id: roleId });
    }
    await col('staff_users').insertOne({
      _id: id,
      email: id + '@example.invalid',
      full_name: 'SYNTHETIC ' + slug,
      status: 'active',
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: assigned!._id,
    });
    if (head)
      await col('referral_relationships').insertOne({
        _id: randomUUID(),
        subject_staff_id: id,
        upline_staff_id: head,
        hierarchy_role: slug,
        is_active: true,
        is_authoritative: true,
      });
    head = id;
    newSponsor = id;
  }
  const sponsors = await request('/ost-accreditation/sponsors', undefined, ostCookie);
  expect(sponsors.status).toBe(200);
  expect((await sponsors.json()).data).toContainEqual({
    id: newSponsor,
    name: 'SYNTHETIC sales_manager',
  });
  const id = randomUUID(),
    appId = randomUUID(),
    priorId = randomUUID(),
    oldEdge = randomUUID();
  const role = await col('roles').findOne({ slug: 'ost' });
  await col('staff_users').insertOne({
    _id: id,
    email: 'expired-synthetic@example.invalid',
    full_name: 'SYNTHETIC EXPIRED MEMBER',
    status: 'active',
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: id,
    role_id: role!._id,
  });
  await col('ost_applications').insertOne({
    _id: appId,
    first_name: 'Synthetic',
    last_name: 'Expired',
    birth_date: '1990-01-01',
    address: { line1: 'Synthetic Street' },
  });
  await col('ost_members').insertOne({
    _id: id,
    application_id: appId,
    status: 'active',
    sponsor_staff_id: manager,
    phone: '+639171234569',
  });
  await col('ost_accreditation_terms').insertOne({
    _id: priorId,
    application_id: appId,
    ost_id: id,
    status: 'active',
    starts_on: '2024-01-01',
    expires_on: '2025-01-01',
    approved_at: '2024-01-01T00:00:00.000Z',
  });
  await col('referral_relationships').insertOne({
    _id: oldEdge,
    subject_staff_id: id,
    upline_staff_id: manager,
    hierarchy_role: 'ost',
    is_active: true,
    is_authoritative: true,
  });
  const aaResponse = await manage(id, { kind: 'OST', action: 'approve' });
  expect(aaResponse.status).toBe(200);
  const aa = (await aaResponse.json()).aaNumber;
  const frozenId = randomUUID();
  await col('card_sale_hierarchy_snapshots').insertOne({
    _id: frozenId,
    sale_id: fixture.customer.sale,
    ancestor_staff_id: manager,
    hierarchy_role: 'sales_manager',
    depth: 2,
  });
  const snapshot = await col('card_sale_hierarchy_snapshots').findOne({ _id: frozenId });
  const body = {
    requestId: randomUUID(),
    dateOfRenewal: '2026-10-26',
    requestedStart: '2026-10-26',
    requestedEnd: '2027-10-26',
    proposedNewSponsorStaffId: newSponsor,
    reasonForReferrerChange: 'Synthetic approved transfer',
    applicantSignatureStatus: 'pending',
    referrerSignatureStatus: 'received',
  };
  const submitted = await request('/ost-accreditation/members/' + id + '/renew', body);
  expect(submitted.status).toBe(201);
  const renewalId = (await submitted.json()).id;
  const decision = '/ost-accreditation/renewals/' + renewalId + '/decision';
  expect(
    (
      await request(decision, {
        action: 'request-changes',
        notes: 'Please collect both signatures',
      })
    ).status,
  ).toBe(200);
  const revised = await request('/ost-accreditation/renewals/' + renewalId + '/revise', {
    ...body,
    applicantSignatureStatus: 'received',
  });
  expect(revised.status).toBe(200);
  expect((await request(decision, { action: 'endorse' }, managerCookie)).status).toBe(200);
  await test.db.command({
    collMod: 'audit_events',
    validator: { $expr: { $ne: ['$action', 'OST_REFERRER_CHANGED'] } },
    validationLevel: 'strict',
  });
  try {
    expect((await request(decision, { action: 'approve' })).status).toBe(503);
    expect((await col('ost_members').findOne({ _id: id }))!.sponsor_staff_id).toBe(manager);
    expect((await col('referral_relationships').findOne({ _id: oldEdge }))!.is_active).toBe(true);
    expect((await col('ost_accreditation_terms').findOne({ _id: priorId }))!.status).toBe('active');
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect((await request(decision, { action: 'approve' })).status).toBe(200);
  expect((await col('ost_members').findOne({ _id: id }))!.sponsor_staff_id).toBe(newSponsor);
  expect(
    await col('referral_relationships').countDocuments({ subject_staff_id: id, is_active: true }),
  ).toBe(1);
  expect((await col('referral_relationships').findOne({ _id: oldEdge }))!.is_active).toBe(false);
  expect(await col('card_sale_hierarchy_snapshots').findOne({ _id: frozenId })).toEqual(snapshot);
  const current = await (await request('/sale-team/' + id + '?kind=OST')).json();
  expect(current).toMatchObject({ aaNumber: aa, status: 'accredited', expiresOn: '2027-10-26' });
  expect((await request('/ost-accreditation/members/' + id, undefined, managerCookie)).status).toBe(
    403,
  );
});

it('allows a current Sales Manager to read its own retained former OST record without widening the sponsored directory', async () => {
  const moduleId = randomUUID(),
    assigned = await col('staff_role_assignments').findOne({ staff_id: manager });
  await col('modules').insertOne({ _id: moduleId, key: 'network.ost_members', is_active: true });
  await col('role_permissions').insertOne({
    _id: randomUUID(),
    role_id: assigned!.role_id,
    module_id: moduleId,
    can_view: true,
    can_create: false,
    can_update: false,
    can_delete: false,
  });
  const now = new Date().toISOString();
  await col('ost_members').insertOne({
    _id: manager,
    application_id: randomUUID(),
    sponsor_staff_id: fixture.staff.id,
    ost_number: 'SYNTHETIC-FORMER-OST',
    full_name: 'SYNTHETIC FORMER OST',
    email: 'sales_manager@example.invalid',
    phone: '+639171234570',
    status: 'inactive',
    approved_by: fixture.staff.id,
    approved_at: now,
    created_at: now,
  });
  const own = await request('/ost/members/' + manager, undefined, managerCookie);
  expect(own.status).toBe(200);
  expect((await own.json()).status).toBe('inactive');
  const listed = await (await request('/ost/members', undefined, managerCookie)).json();
  expect(listed.data.some((row: { id: string }) => row.id === manager)).toBe(false);
});
