import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase6Fixture } from './testing/phase6-fixture.js';
import { createAfHomesAdminAuth } from './auth.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import type { MongoRow } from './customer-activation.mongo.js';
vi.mock('./address-source.js', () => ({
  addressProvider: () => ({
    provinces: async () => [{ code: '0434000000', name: 'Laguna' }],
    localities: async () => [
      { code: '0434010000', name: 'Victoria', provinceCode: '0434000000', postalCode: '4018' },
    ],
  }),
}));

let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  admin = '',
  manager = '';
let fixture: Awaited<ReturnType<typeof seedPhase6Fixture>>;
let application = '',
  ostId = '';
let istAA = '',
  ostAA = '';
const realFetch = globalThis.fetch;
const password = 'SyntheticAccountOnly123!';
const col = (name: string) => test.db.collection<MongoRow>(name);
async function request(path: string, body?: unknown, cookie = admin, method?: string) {
  return fetch(base + '/api/v1' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response: Response, status = 200) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}
const payload = () => ({
  requestId: randomUUID(),
  sponsorStaffId: fixture.staff.id,
  identity: {
    firstName: 'Synthetic',
    middleName: '',
    lastName: 'Applicant',
    email: 'native-new-ost@example.invalid',
    phone: '+639171234599',
    birthDate: '1990-01-01',
    address: {
      line1: 'Synthetic Street',
      city: 'Quezon City',
      province: 'Metro Manila',
      countryCode: 'PH',
    },
  },
  form: {
    dateApplied: '2026-10-01',
    programCategory: 'non_vip',
    vipCardType: null,
    sex: 'male',
    civilStatus: 'single',
    governmentIdType: 'passport',
    governmentIdNumber: 'SYNTHETIC-PRIVATE-ID',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
    applicantSignedOn: '2026-10-01',
    referrerSignedOn: '2026-10-01',
  },
});
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'synthetic-account-creation-only-'.repeat(3),
    BETTER_AUTH_URL: base,
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    NODE_ENV: 'test',
    AFHOMES_SEARCH_LOCAL_PREVIEW: 'true',
    AFHOMES_SEARCH_ENABLED: 'true',
    AFHOMES_SEARCH_SECRET: 'synthetic-public-search-secret-only-'.repeat(3),
    AFHOMES_SEARCH_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    AFHOMES_SEARCH_TURNSTILE_HOSTNAMES: 'localhost',
    AFHOMES_SEARCH_CONTACT_RETENTION_DAYS: '1',
    AFHOMES_VERIFICATION_PHONE: '+639170000000',
  };
  vi.stubGlobal('fetch', (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
    String(url).startsWith('https://challenges.cloudflare.com/')
      ? Promise.resolve(Response.json({ success: true, hostname: 'localhost' }))
      : realFetch(url, init),
  );
  fixture = await seedPhase6Fixture(test.db, test.client, env, password);
  await col('staff_users').updateOne(
    { _id: fixture.staff.id },
    { $set: { must_change_password: false } },
  );
  await col('mfa_policy').updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  const identity = await createAfHomesAdminAuth(test.db, test.client, env).api.createUser({
    body: {
      email: 'synthetic-account-admin@example.invalid',
      name: 'Synthetic Account Admin',
      password,
      data: { emailVerified: true },
    },
  });
  const roleId = randomUUID();
  await col('roles').insertOne({
    _id: roleId,
    slug: 'super_admin',
    name: 'Synthetic Super Admin',
    is_system: true,
    is_active: true,
  });
  await col('staff_users').insertOne({
    _id: identity.user.id,
    email: identity.user.email,
    full_name: identity.user.name,
    status: 'active',
    must_change_password: false,
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: identity.user.id,
    role_id: roleId,
  });
  for (const key of [
    'organization.staff',
    'organization.roles',
    'organization.departments',
    'network.members',
    'network.ost_members',
    'operations.customer_lookup',
    'governance.config',
  ])
    if (!(await col('modules').findOne({ key })))
      await col('modules').insertOne({ _id: randomUUID(), key, is_active: true });
  await col('departments').insertOne({
    _id: randomUUID(),
    code: 'SALES',
    name: 'Sales',
    is_active: true,
  });
  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const signIn = async (email: string) => {
    const response = await request('/auth/identity/sign-in/email', { email, password }, '');
    await json(response);
    return response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  };
  admin = await signIn(identity.user.email);
  manager = await signIn(fixture.staff.email);
}, 30000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await test.stop();
});

it('directly creates an already-accredited OST atomically, without registration or invented sponsor endorsement', async () => {
  const input = {
    ...payload(),
    mode: 'complete',
    startsOn: '2026-10-01',
    expiresOn: '2027-10-01',
    temporaryPassword: password,
  };
  await json(await request('/members/ost', input, ''), 401);
  await json(await request('/members/ost', input, manager), 403);
  const results = await Promise.all([
    request('/members/ost', input),
    request('/members/ost', input),
  ]);
  const values = await Promise.all(results.map((r) => json(r, 201)));
  expect(values[0]).toEqual(values[1]);
  expect(values[0].status).toBe('approved');
  application = values[0].applicationId;
  const member = await col('ost_members').findOne({ application_id: application });
  ostId = member!._id;
  expect(values[0].memberId).toBe(ostId);
  expect(await col('ost_members').countDocuments({ application_id: application })).toBe(1);
  expect(await col('staff_users').findOne({ _id: ostId })).toMatchObject({
    must_change_password: true,
    status: 'active',
  });
  expect(await col('sale_team_accreditations').findOne({ staff_id: ostId })).toMatchObject({
    kind: 'OST',
    status: 'active',
  });
  ostAA = String((await col('sale_team_accreditations').findOne({ staff_id: ostId }))!.aa_number);
  expect(
    await col('referral_relationships').findOne({ subject_staff_id: ostId, is_active: true }),
  ).toMatchObject({ upline_staff_id: fixture.staff.id });
  expect(
    await col('ost_registration_details').findOne({ application_id: application }),
  ).toMatchObject({ endorsed_at: null, endorsed_by: null });
  expect(
    JSON.stringify(await col('audit_events').find({ entity_id: application }).toArray()),
  ).not.toContain(password);
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: 'native-new-ost@example.invalid', password },
    '',
  );
  await json(login);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  await json(await request('/ost/me/dashboard', undefined, cookie), 403);
  await json(
    await request(
      '/admin/afhomes/session/password',
      { currentPassword: password, newPassword: 'SyntheticChangedOnly456!' },
      cookie,
    ),
  );
  await json(await request('/ost/me/dashboard', undefined, cookie));
  await json(
    await request('/members/ost', {
      ...input,
      identity: { ...input.identity, firstName: 'Changed' },
    }),
    409,
  );
  const listing = await json(await request('/members?search=native-new-ost'));
  expect(listing.data.map((row: { id: string }) => row.id)).toContain(ostId);
}, 30000);

it('creates an IST in Members with its full profile, immediate head and stable date-free AA identity', async () => {
  const headRole = await col('roles').findOne({ slug: 'senior_sales_manager' }),
    head = await col('staff_role_assignments').findOne({ role_id: headRole!._id });
  const department = await col('departments').findOne({ code: 'SALES' });
  const input = {
    email: 'native-new-ist@example.invalid',
    fullName: 'Synthetic IST Seller',
    position: 'sales_manager',
    departmentId: department!._id,
    temporaryPassword: password,
    dateOfBirth: '1990-01-01',
    sex: 'Male',
    civilStatus: 'Single',
    streetNo: 'Synthetic Street',
    cityMunicipality: 'Victoria',
    province: 'Laguna',
    zipCode: '4011',
    provinceCode: '0434000000',
    cityMunicipalityCode: '0434010000',
    mobileNo: '+639171234588',
    employerName: 'Synthetic Employer',
    employerAddress: 'Synthetic Office',
    jobPosition: 'Synthetic Job',
    governmentIdType: 'passport',
    governmentIdNumber: 'SYNTHETIC-IST',
    tin: '123456789',
    referrerStaffId: head!.staff_id,
  };
  const staff = await json(await request('/members', input), 201);
  const aa = await json(await request(`/sale-team/${staff.id}?kind=IST`));
  istAA = aa.aaNumber;
  expect(aa.kind).toBe('IST');
  expect(aa.status).toBe('accredited');
  expect(aa.expiresOn).toBeNull();
  expect(
    (await json(await request(`/sale-team/${staff.id}`, { kind: 'IST', action: 'approve' })))
      .aaNumber,
  ).toBe(istAA);
  expect(await col('staff_users').findOne({ _id: staff.id })).toMatchObject({
    must_change_password: true,
  });
  expect(staff.zipCode).toBe('4011');
  expect(staff.governmentIdMasked).toBe('***-IST');
  const detail = await json(await request(`/members/${staff.id}`));
  expect(detail.governmentIdNumber).toBeNull();
  expect(
    JSON.stringify(await col('audit_events').find({ entity_id: staff.id }).toArray()),
  ).not.toContain('123456789');
  await json(await request('/members', input), 409);
}, 30000);

it('publicly finds newly-created eligible IST and OST through masked, contact-gated disclosure without leaking staff identity', async () => {
  const config = await json(await request('/sale-team/search/config', undefined, ''));
  expect(config.available).toBe(true);
  for (const [aaNumber, kind] of [
    [istAA, 'IST'],
    [ostAA, 'OST'],
  ]) {
    const sessionId = randomUUID();
    const start = await json(
      await request(
        '/sale-team/search/start',
        { aaNumber, sessionId, captchaToken: 'synthetic-turnstile-token' },
        '',
      ),
    );
    const body = {
      sessionId,
      searchToken: start.searchToken,
      noticeVersion: config.noticeVersion,
      acknowledged: true,
      contact: {
        name: 'Synthetic Viewer',
        email: 'viewer@example.invalid',
        mobile: '+639170000099',
      },
    };
    const result = await json(await request('/sale-team/search/reveal', body, ''));
    expect(result.result).toMatchObject({ aaNumber, kind, status: 'accredited' });
    expect(result.result.maskedName).not.toBe(
      kind === 'IST' ? 'Synthetic IST Seller' : 'Synthetic Applicant',
    );
    expect(JSON.stringify(result.result)).not.toMatch(/native-new|staffId|phone|@example/);
    const replay = await json(await request('/sale-team/search/reveal', body, ''));
    expect(replay.result).toEqual(result.result);
    expect(typeof replay.contactReceipt).toBe('string');
    await json(
      await request('/sale-team/search/reveal', { ...body, sessionId: randomUUID() }, ''),
      400,
    );
  }
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(2);
}, 30000);

it('rolls back the entire direct creation when the final audit fails', async () => {
  const input = {
    ...payload(),
    mode: 'complete',
    startsOn: '2026-10-01',
    expiresOn: '2027-10-01',
    temporaryPassword: password,
  };
  input.identity = {
    ...input.identity,
    email: 'rollback-ost@example.invalid',
    phone: '+639171234577',
  };
  const prior = await col('ost_members').countDocuments();
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'OST_ACCREDITATION_APPROVED' } },
    validationLevel: 'strict',
  });
  try {
    await json(await request('/members/ost', input), 503);
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(await col('ost_members').countDocuments()).toBe(prior);
  expect(await col('ost_applications').findOne({ email: input.identity.email })).toBeNull();
  expect(await col('auth_users').findOne({ email: input.identity.email })).toBeNull();
  expect(await col('staff_users').findOne({ email: input.identity.email })).toBeNull();
  expect(await col('ost_registration_details').findOne({ request_id: input.requestId })).toBeNull();
}, 30000);

it('hides revoked AA records publicly and counts only successful disclosures under the rolling quota', async () => {
  await col('sale_team_accreditations').updateOne(
    { aa_number: ostAA },
    { $set: { status: 'revoked' } },
  );
  const config = await json(await request('/sale-team/search/config', undefined, ''));
  const reveal = async (aaNumber: string) => {
    const sessionId = randomUUID();
    const start = await json(
      await request(
        '/sale-team/search/start',
        { sessionId, aaNumber, captchaToken: 'synthetic' },
        '',
      ),
    );
    return request(
      '/sale-team/search/reveal',
      {
        sessionId,
        searchToken: start.searchToken,
        noticeVersion: config.noticeVersion,
        acknowledged: true,
        contact: {
          name: 'Synthetic Viewer',
          email: 'viewer@example.invalid',
          mobile: '+639170000099',
        },
      },
      '',
    );
  };
  expect((await json(await reveal(ostAA))).result).toBeNull();
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(2);
  await json(await reveal(istAA));
  await json(await reveal(istAA), 429);
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(3);
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(1);
}, 30000);

it('serves administrator-only public settings, with optimistic updates and server-owned cleanup readiness', async () => {
  const endpoint='/admin/afhomes/public-verification-settings';
  await json(await request(endpoint,undefined,''),401);
  await json(await request(endpoint,undefined,manager),403);
  const initial=await json(await request(endpoint));
  expect(initial).toMatchObject({enabled:false,privacyApproved:false,cleanupReady:false,revision:1});
  expect(await col('public_verification_settings').countDocuments()).toBe(0);
  const {cleanupReady:_ready,noticeVersion:_notice,revision,updatedAt:_updated,...fields}=initial;
  const input={...fields,privacyNotice:'Synthetic local privacy notice for workflow verification. This fictional configuration is limited to disposable data and never approves a real public deployment.',expectedRevision:revision};
  await json(await request(endpoint,{...input,cleanupReady:true},admin,'PUT'),400);
  const saved=await json(await request(endpoint,input,admin,'PUT'));
  expect(saved.revision).toBe(2);expect(saved.cleanupReady).toBe(false);
  const updates=await Promise.all([request(endpoint,{...input,expectedRevision:2,enabled:true},admin,'PUT'),request(endpoint,{...input,expectedRevision:2,enabled:true},admin,'PUT')]);
  expect(updates.map((r)=>r.status).sort()).toEqual([200,409]);
  const after=await json(await request(endpoint));expect(after.noticeVersion).toBe(saved.noticeVersion);
  await test.db.command({collMod:'audit_events',validator:{action:{$ne:'PUBLIC_VERIFICATION_SETTINGS_UPDATED'}},validationLevel:'strict'});
  try { await json(await request(endpoint,{...input,expectedRevision:3,retentionDays:7},admin,'PUT'),503); }
  finally { await test.db.command({collMod:'audit_events',validator:{}}); }
  expect((await json(await request(endpoint))).revision).toBe(3);
},30000);
