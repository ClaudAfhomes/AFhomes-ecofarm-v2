/**
 * AFHomes sales-network Members - handler tests.
 *
 * These drive the REAL handler, the REAL staff principal resolver and the
 * REAL contracts against the in-memory Supabase fake. What they are really
 * asserting: a Member IS a staff account (login provisioned, forced password
 * change), the head is required and must be the immediate upline, the OST
 * referrer is Sales-Manager-only and informational, secrets never come back
 * (no password, masked TIN/government ID, clean audits), and hierarchy
 * sellers leave with an AA number issued.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { AddressProviderError } from '../_lib/address-provider.js';

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const upstream = vi.hoisted(() => ({
  provinces: vi.fn(),
  localities: vi.fn(),
}));

vi.mock('../_lib/psgc-cloud-provider.js', () => ({
  psgcCloudAddressProvider: {
    name: 'psgc-cloud-stub',
    provinces: upstream.provinces,
    localities: upstream.localities,
    barangays: vi.fn(),
  },
}));

const members = (await import('./members.js')).default;
const { resetAddressProviderCache } = await import('../_lib/address-source.js');

const LAGUNA = { code: '0403400000', name: 'Laguna' };
const CALAUAN = {
  code: '0403406000',
  name: 'Calauan',
  type: 'municipality' as const,
  provinceCode: LAGUNA.code,
  postalCode: '4012',
};
const LEMERY = {
  code: '0406110000',
  name: 'Lemery',
  type: 'municipality' as const,
  provinceCode: '0406100000',
};

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SSM_ID = '22222222-2222-4222-8222-222222222222';
const SM_ID = '33333333-3333-4333-8333-333333333333';
const OST_ID = '44444444-4444-4444-8444-444444444444';
const VD_ID = '66666666-6666-4666-8666-666666666666';
const SSM2_ID = '77777777-7777-4777-8777-777777777777';
const ADMIN_TOKEN = 'admin-token';

const MEMBERS_MODULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GENEALOGY_MODULE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROLE_ADMIN = 'c0000000-0000-4000-8000-000000000001';
const ROLE_VD = 'c0000000-0000-4000-8000-000000000002';
const ROLE_SSM = 'c0000000-0000-4000-8000-000000000003';
const ROLE_SM = 'c0000000-0000-4000-8000-000000000004';
const ROLE_OST = 'c0000000-0000-4000-8000-000000000005';
const DEPT_SALES = 'd0000000-0000-4000-8000-000000000001';
const DEPT_OPS = 'd0000000-0000-4000-8000-000000000002';

type Row = Record<string, unknown>;

function baseTables(): Record<string, Row[]> {
  return {
    modules: [
      { id: MEMBERS_MODULE, key: 'network.members', is_active: true },
      { id: GENEALOGY_MODULE, key: 'network.genealogy', is_active: true },
    ],
    roles: [
      { id: ROLE_ADMIN, slug: 'admin', name: 'Admin', is_active: true },
      { id: ROLE_VD, slug: 'vice_director', name: 'Vice Director', is_active: true },
      { id: ROLE_SSM, slug: 'senior_sales_manager', name: 'Senior Sales Manager', is_active: true },
      { id: ROLE_SM, slug: 'sales_manager', name: 'Sales Manager', is_active: true },
      { id: ROLE_OST, slug: 'ost', name: 'OST', is_active: true },
    ],
    role_permissions: [
      {
        role_id: ROLE_ADMIN,
        module_id: MEMBERS_MODULE,
        can_view: true,
        can_create: true,
        can_update: true,
        can_delete: false,
      },
      {
        role_id: ROLE_ADMIN,
        module_id: GENEALOGY_MODULE,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: ROLE_VD,
        module_id: GENEALOGY_MODULE,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: ROLE_SSM,
        module_id: GENEALOGY_MODULE,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: ROLE_SM,
        module_id: GENEALOGY_MODULE,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: ROLE_OST,
        module_id: GENEALOGY_MODULE,
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
    ],
    staff_permission_restrictions: [],
    staff_users: [
      {
        id: ADMIN_ID,
        email: 'admin@afhomes.test',
        full_name: 'ADMIN USER',
        status: 'active',
        department_id: null,
        employee_number: 'AF-EMP-00001',
        created_at: '2026-09-01T00:00:00.000Z',
      },
      {
        id: SSM_ID,
        email: 'ssm@afhomes.test',
        full_name: 'SENIOR MANAGER',
        status: 'active',
        department_id: DEPT_SALES,
        employee_number: 'AF-EMP-00002',
        created_at: '2026-09-02T00:00:00.000Z',
      },
      {
        id: SM_ID,
        email: 'sm@afhomes.test',
        full_name: 'SALES MANAGER',
        status: 'active',
        department_id: DEPT_SALES,
        employee_number: 'AF-EMP-00003',
        created_at: '2026-09-03T00:00:00.000Z',
      },
      {
        id: OST_ID,
        email: 'ost@afhomes.test',
        full_name: 'OST AGENT',
        status: 'active',
        department_id: DEPT_SALES,
        employee_number: null,
        created_at: '2026-09-04T00:00:00.000Z',
      },
    ],
    staff_role_assignments: [
      { staff_id: ADMIN_ID, role_id: ROLE_ADMIN },
      { staff_id: SSM_ID, role_id: ROLE_SSM },
      { staff_id: SM_ID, role_id: ROLE_SM },
      { staff_id: OST_ID, role_id: ROLE_OST },
    ],
    departments: [
      { id: DEPT_SALES, code: 'SALES', name: 'Sales', is_active: true },
      { id: DEPT_OPS, code: 'OPERATIONS', name: 'Operations', is_active: true },
    ],
    network_member_profiles: [
      {
        staff_id: SSM_ID,
        date_of_birth: '1980-01-01',
        sex: 'Male',
        civil_status: 'Married',
        street_no: '1 Main St',
        city_municipality: 'Quezon City',
        province: 'Metro Manila',
        zip_code: '1100',
        tel_no: null,
        mobile_no: '+639171111111',
        fb_messenger: null,
        tin: null,
        employer_name: 'AF Homes',
        employer_address: 'Ecofarm',
        job_position: 'Senior Sales Manager',
        government_id_type: 'passport',
        government_id_number: 'P1234567',
        referrer_staff_id: null,
        ost_referrer_staff_id: null,
      },
      {
        staff_id: SM_ID,
        date_of_birth: '1990-02-02',
        sex: 'Female',
        civil_status: 'Single',
        street_no: '2 Main St',
        city_municipality: 'Quezon City',
        province: 'Metro Manila',
        zip_code: '1100',
        tel_no: null,
        mobile_no: '+639172222222',
        fb_messenger: null,
        tin: '123456789',
        employer_name: 'AF Homes',
        employer_address: 'Ecofarm',
        job_position: 'Sales Manager',
        government_id_type: 'drivers_license',
        government_id_number: 'D7654321',
        referrer_staff_id: SSM_ID,
        ost_referrer_staff_id: OST_ID,
      },
    ],
    referral_relationships: [],
    audit_events: [],
  };
}

function install(
  tables?: Record<string, Row[]>,
  fakeOptions?: {
    authUsers?: { id: string; email: string }[];
    writeErrors?: Record<string, { code?: string; message: string }>;
    rpcErrors?: Record<string, { code?: string; message: string }>;
    rpcs?: { fn: string; result: unknown | ((args: Record<string, unknown>) => unknown) }[];
    /** Id handed back by inviteUserByEmail; must be a UUID to pass contracts. */
    inviteUserId?: string;
  },
) {
  holder.db = new FakeSupabase({
    tables: (tables ?? baseTables()) as never,
    tokens: {
      [ADMIN_TOKEN]: {
        id: ADMIN_ID,
        email: 'admin@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    },
    unique: { staff_users: [['email']] },
    createUserId: '55555555-5555-4555-8555-555555555555',
    rpcs: [
      {
        fn: 'manage_sale_team_accreditation',
        result: { aaNumber: 'AA-NEW123', kind: 'IST', status: 'accredited' },
      },
      { fn: 'get_sale_team_accreditation', result: null },
    ],
    ...fakeOptions,
  });
  return holder.db;
}

async function call(options: {
  method?: string;
  familyPath?: string;
  body?: unknown;
  token?: string;
  query?: Record<string, string>;
}) {
  const { res, state } = makeRes();
  await members(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.familyPath ?? '',
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const profileBody = (extra: Record<string, unknown> = {}) => ({
  dateOfBirth: '1992-05-06',
  sex: 'Male',
  civilStatus: 'Single',
  streetNo: '123 Mango St',
  cityMunicipality: 'Calauan',
  province: 'Laguna',
  provinceCode: LAGUNA.code,
  cityMunicipalityCode: CALAUAN.code,
  zipCode: '4012',
  mobileNo: '+639173333333',
  employerName: 'AF Homes',
  employerAddress: 'Ecofarm, Laguna',
  jobPosition: 'Sales Manager',
  governmentIdType: 'passport',
  governmentIdNumber: 'P9998888',
  ...extra,
});

const createBody = (extra: Record<string, unknown> = {}) => ({
  fullName: 'New Member',
  email: 'new.member@afhomes.test',
  temporaryPassword: 'TempPass123',
  departmentId: DEPT_SALES,
  position: 'sales_manager',
  referrerStaffId: SSM_ID,
  ...profileBody(extra),
});

const err = (body: unknown) => (body as { error?: { code?: string } }).error;
const rpcCalls = (fn: string) =>
  (holder.db as unknown as { calls: { op: string; table: string }[] }).calls.filter(
    (c) => c.op === 'rpc' && c.table === fn,
  );
const rpcArgs = (fn: string) =>
  (
    holder.db as unknown as {
      calls: { op: string; table: string; arg?: Record<string, unknown> }[];
    }
  ).calls.filter((c) => c.op === 'rpc' && c.table === fn);

beforeEach(() => {
  install();
  resetAddressProviderCache();
  upstream.provinces.mockResolvedValue([LAGUNA]);
  upstream.localities.mockImplementation(async (code: string) =>
    code === LAGUNA.code ? [CALAUAN] : [LEMERY],
  );
});

describe('POST /members', () => {
  it('provisions the login, links the head, records the OST referrer and issues the AA', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ tin: '123456789', ostReferrerStaffId: OST_ID }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(201);
    const body = state.body as Record<string, unknown>;
    expect(body.position).toBe('sales_manager');
    expect(body.positionLabel).toBe('Sales Manager');
    expect(body.referrerName).toBe('SENIOR MANAGER');
    expect(body.ostReferrerName).toBe('OST AGENT');
    // Secrets never come back: masked TIN and government ID only.
    expect(body.tin).toBeUndefined();
    expect(body.governmentIdNumber).toBeUndefined();
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.tinMasked).not.toBeNull();
    expect(body.governmentIdMasked).not.toBeNull();
    // The AA number was issued with the account (IST accreditation).
    expect(rpcCalls('manage_sale_team_accreditation')).toHaveLength(1);
    // The auth login was provisioned and the profile stored.
    const db = holder.db as unknown as {
      rows: (table: string) => Row[];
    };
    expect(db.rows('staff_users').some((r) => r.email === 'new.member@afhomes.test')).toBe(true);
    const profile = db.rows('network_member_profiles').find((r) => r.mobile_no === '+639173333333');
    expect(profile?.referrer_staff_id).toBe(SSM_ID);
    expect(profile?.ost_referrer_staff_id).toBe(OST_ID);
    expect(db.rows('referral_relationships').some((r) => r.upline_staff_id === SSM_ID)).toBe(true);
    // Audits carry identity only: no password, TIN or government ID.
    const audits = JSON.stringify(db.rows('audit_events'));
    expect(audits).not.toContain('TempPass123');
    expect(audits).not.toContain('P9998888');
  });

  it('refuses to create an OST through the member endpoint', async () => {
    // OST carries its own footprint (application, sponsor edge, term) and is
    // created through POST /members/ost, never here. The shared contract
    // refuses the position; the handler keeps its own guard behind that.
    const state = await call({
      method: 'POST',
      body: createBody({
        email: 'new.ost@afhomes.test',
        position: 'ost',
        referrerStaffId: SM_ID,
      }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
    expect(rpcCalls('manage_sale_team_accreditation')).toHaveLength(0);
  });

  it('requires the head for headed positions', async () => {
    const { referrerStaffId: _omitted, ...headless } = createBody();
    const state = await call({ method: 'POST', body: headless, token: ADMIN_TOKEN });
    expect(state.status).toBe(400);
  });

  it('refuses a head for a Vice Director', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ position: 'vice_director', referrerStaffId: SSM_ID }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
  });

  it('refuses a head outside the immediate upline', async () => {
    // A Senior Sales Manager cannot report to a Sales Manager.
    const state = await call({
      method: 'POST',
      body: createBody({ position: 'senior_sales_manager', referrerStaffId: SM_ID }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a department outside Sales', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ departmentId: DEPT_OPS }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
  });

  // The reference supplies the names and codes. Its postal code is only a
  // suggestion: PSGC answers 4018 for Victoria, Laguna, whose ZIP is 4011, so
  // a record that could not carry the operator's 4011 would be wrong forever.
  it('keeps the operator\u2019s ZIP while aligning the names and codes', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({
        email: 'aligned@afhomes.test',
        cityMunicipality: 'WRONG',
        province: 'WRONG',
        zipCode: '4011',
      }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(201);
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    const staffId = db.rows('staff_users').find((s) => s.email === 'aligned@afhomes.test')?.id;
    const profile = db.rows('network_member_profiles').find((r) => r.staff_id === staffId);
    expect(profile?.city_municipality).toBe('Calauan');
    expect(profile?.province).toBe('Laguna');
    expect(profile?.province_code).toBe(LAGUNA.code);
    expect(profile?.city_municipality_code).toBe(CALAUAN.code);
    expect(profile?.zip_code).toBe('4011');
  });

  it('refuses a province paired with another province city', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ email: 'mismatch@afhomes.test', cityMunicipalityCode: LEMERY.code }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an unverifiable address instead of saving it unverified', async () => {
    resetAddressProviderCache();
    upstream.localities.mockRejectedValueOnce(new AddressProviderError('PROVIDER_UNAVAILABLE'));
    const state = await call({
      method: 'POST',
      body: createBody({ email: 'outage@afhomes.test' }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(503);
  });

  it('refuses a non-OST referrer and a non-SM referrer holder', async () => {
    const withOst = await call({
      method: 'POST',
      body: createBody({ ostReferrerStaffId: SM_ID }),
      token: ADMIN_TOKEN,
    });
    // A Sales Manager is not an OST, so this referrer is refused.
    expect(withOst.status).toBe(400);
    const onSsm = await call({
      method: 'POST',
      body: createBody({
        email: 'ssm2@afhomes.test',
        position: 'senior_sales_manager',
        referrerStaffId: ADMIN_ID,
        ostReferrerStaffId: OST_ID,
      }),
      token: ADMIN_TOKEN,
    });
    expect(onSsm.status).toBe(400);
  });

  it('refuses a caller without the create grant', async () => {
    const db = holder.db;
    (db as unknown as { tables: Record<string, Row[]> }).tables.role_permissions =
      baseTables().role_permissions!.filter(
        (r) => !(r.role_id === ROLE_ADMIN && r.module_id === MEMBERS_MODULE),
      );
    const state = await call({ method: 'POST', body: createBody(), token: ADMIN_TOKEN });
    expect(state.status).toBe(403);
  });

  it('refuses a duplicate email with 409', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ email: 'sm@afhomes.test' }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
  });

  it('refuses an Auth-only duplicate with 409 and writes no staff rows', async () => {
    install(undefined, {
      authUsers: [{ id: '99999999-9999-4999-8999-999999999999', email: 'ghost@afhomes.test' }],
    });
    const state = await call({
      method: 'POST',
      body: createBody({ email: 'ghost@afhomes.test' }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    expect((state.body as { error?: { message?: string } }).error?.message).toContain(
      'already exists',
    );
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(db.rows('staff_users').some((r) => r.email === 'ghost@afhomes.test')).toBe(false);
  });

  it('compensates a mid-create failure: no orphan rows, Auth login removed', async () => {
    install(undefined, {
      writeErrors: { network_member_profiles: { code: '23505', message: 'duplicate key value' } },
    });
    const state = await call({ method: 'POST', body: createBody(), token: ADMIN_TOKEN });
    // A unique violation mid-create is a conflict, never a 500.
    expect(state.status).toBe(409);
    const db = holder.db as unknown as {
      rows: (table: string) => Row[];
      deletedAuthUsers: string[];
    };
    expect(db.rows('staff_users').some((r) => r.email === 'new.member@afhomes.test')).toBe(false);
    expect(
      db
        .rows('staff_role_assignments')
        .some((r) => r.staff_id === '55555555-5555-4555-8555-555555555555'),
    ).toBe(false);
    expect(db.deletedAuthUsers).toContain('55555555-5555-4555-8555-555555555555');
  });

  it('returns field-keyed details on invalid input', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ mobileNo: 'not-a-phone', email: 'bad' }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
    const details = (state.body as { error?: { details?: Record<string, string> } }).error?.details;
    expect(details?.mobileNo).toBeTruthy();
    expect(details?.email).toBeTruthy();
  });

  it('labels positions from the contract, not the role display name', async () => {
    const tables = baseTables();
    tables.roles = (tables.roles as Row[]).map((r) =>
      r.slug === 'sales_manager' ? { ...r, name: 'Renamed Sellers' } : r,
    );
    install(tables);
    const state = await call({ method: 'POST', body: createBody(), token: ADMIN_TOKEN });
    expect(state.status).toBe(201);
    expect((state.body as Record<string, unknown>).positionLabel).toBe('Sales Manager');
  });

  it('creates with AUTO and never sends an AA number', async () => {
    const state = await call({ method: 'POST', body: createBody(), token: ADMIN_TOKEN });
    expect(state.status).toBe(201);
    const manage = rpcArgs('manage_sale_team_accreditation');
    expect(manage).toHaveLength(1);
    expect(manage[0]!.arg).not.toHaveProperty('p_aa_number');
  });

  it('creates with a typed MANUAL number and passes it to accreditation', async () => {
    install(undefined, {
      rpcs: [
        {
          fn: 'manage_sale_team_accreditation',
          result: { aaNumber: 'AAI26090001', kind: 'IST', status: 'accredited' },
        },
        { fn: 'get_sale_team_accreditation', result: null },
        { fn: 'search_sale_team_accreditation', result: null },
      ],
    });
    const state = await call({
      method: 'POST',
      body: createBody({
        email: 'manual.aa@afhomes.test',
        aaNumberMode: 'manual',
        aaNumber: 'AAI26090001',
      }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(201);
    const manage = rpcArgs('manage_sale_team_accreditation');
    expect(manage).toHaveLength(1);
    expect(manage[0]!.arg?.p_aa_number).toBe('AAI26090001');
  });

  it('refuses a taken MANUAL number before writing anything', async () => {
    install(undefined, {
      rpcs: [
        {
          fn: 'manage_sale_team_accreditation',
          result: { aaNumber: 'AA-NEW123', kind: 'IST', status: 'accredited' },
        },
        { fn: 'get_sale_team_accreditation', result: null },
        {
          fn: 'search_sale_team_accreditation',
          result: { aaNumber: 'AAI26090002', kind: 'IST', status: 'accredited' },
        },
      ],
    });
    const state = await call({
      method: 'POST',
      body: createBody({
        email: 'taken.aa@afhomes.test',
        aaNumberMode: 'manual',
        aaNumber: 'AAI26090002',
      }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    expect(err(state.body)?.code).toBe('CONFLICT');
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(db.rows('staff_users').some((r) => r.email === 'taken.aa@afhomes.test')).toBe(false);
  });

  it('maps an accreditation race on a MANUAL number to 409 with no orphans', async () => {
    install(undefined, {
      rpcs: [{ fn: 'search_sale_team_accreditation', result: null }],
      rpcErrors: { manage_sale_team_accreditation: { message: 'ACCREDITATION_NUMBER_TAKEN' } },
    });
    const state = await call({
      method: 'POST',
      body: createBody({
        email: 'race.aa@afhomes.test',
        aaNumberMode: 'manual',
        aaNumber: 'AAI26090003',
      }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    const db = holder.db as unknown as {
      rows: (table: string) => Row[];
      deletedAuthUsers: string[];
    };
    expect(db.rows('staff_users').some((r) => r.email === 'race.aa@afhomes.test')).toBe(false);
    expect(db.deletedAuthUsers).toContain('55555555-5555-4555-8555-555555555555');
  });
});

describe('POST /members/:id/accreditation', () => {
  const manageOk = {
    fn: 'manage_sale_team_accreditation',
    result: { aaNumber: 'AAI26090004', kind: 'IST', status: 'accredited' },
  };
  const noAccreditation = { fn: 'get_sale_team_accreditation', result: null };
  const noSearchHit = { fn: 'search_sale_team_accreditation', result: null };

  it('issues a missing AA number automatically', async () => {
    install(undefined, { rpcs: [manageOk, noAccreditation, noSearchHit] });
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/accreditation`,
      body: {},
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    const manage = rpcArgs('manage_sale_team_accreditation');
    expect(manage).toHaveLength(1);
    expect(manage[0]!.arg?.p_staff_id).toBe(SM_ID);
    expect(manage[0]!.arg).not.toHaveProperty('p_aa_number');
  });

  it('issues a missing AA number with a typed MANUAL number', async () => {
    install(undefined, { rpcs: [manageOk, noAccreditation, noSearchHit] });
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/accreditation`,
      body: { aaNumberMode: 'manual', aaNumber: 'AAI26090005' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    expect(rpcArgs('manage_sale_team_accreditation')[0]!.arg?.p_aa_number).toBe('AAI26090005');
  });

  it('refuses a second number for an accredited member', async () => {
    install(undefined, {
      rpcs: [
        manageOk,
        {
          fn: 'get_sale_team_accreditation',
          result: { aaNumber: 'AAOLD123456789', kind: 'IST', status: 'accredited' },
        },
        noSearchHit,
      ],
    });
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/accreditation`,
      body: { aaNumberMode: 'manual', aaNumber: 'AAI26090005' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    expect(rpcCalls('manage_sale_team_accreditation')).toHaveLength(0);
  });

  it('refuses unknown members and invalid manual bodies', async () => {
    const missing = await call({
      method: 'POST',
      familyPath: '99999999-9999-4999-8999-999999999999/accreditation',
      body: {},
      token: ADMIN_TOKEN,
    });
    expect(missing.status).toBe(404);
    const invalid = await call({
      method: 'POST',
      familyPath: `${SM_ID}/accreditation`,
      body: { aaNumberMode: 'manual' },
      token: ADMIN_TOKEN,
    });
    expect(invalid.status).toBe(400);
  });
});

describe('GET /members', () => {
  it('lists hierarchy members only, never plain staff', async () => {
    const state = await call({ familyPath: '', token: ADMIN_TOKEN });
    expect(state.status).toBe(200);
    const rows = (state.body as { data: { fullName: string }[] }).data;
    expect(rows.map((r) => r.fullName).sort()).toEqual([
      'OST AGENT',
      'SALES MANAGER',
      'SENIOR MANAGER',
    ]);
  });

  it('serves eligible heads per position and OST referrers', async () => {
    const forSm = await call({
      familyPath: 'uplines',
      query: { position: 'sales_manager' },
      token: ADMIN_TOKEN,
    });
    expect(forSm.status).toBe(200);
    expect((forSm.body as { data: { fullName: string }[] }).data.map((r) => r.fullName)).toEqual([
      'SENIOR MANAGER',
    ]);
    const forOst = await call({
      familyPath: 'uplines',
      query: { position: 'ost' },
      token: ADMIN_TOKEN,
    });
    expect((forOst.body as { data: { fullName: string }[] }).data.map((r) => r.fullName)).toEqual([
      'SALES MANAGER',
    ]);
    const forVd = await call({
      familyPath: 'uplines',
      query: { position: 'vice_director' },
      token: ADMIN_TOKEN,
    });
    expect((forVd.body as { data: unknown[] }).data).toEqual([]);
    const ostReferrers = await call({ familyPath: 'ost-referrers', token: ADMIN_TOKEN });
    expect(
      (ostReferrers.body as { data: { fullName: string }[] }).data.map((r) => r.fullName),
    ).toEqual(['OST AGENT']);
  });
});

describe('GET /members/:id', () => {
  it('carries identification in clear on the single read, never on the list', async () => {
    const detail = await call({ familyPath: SM_ID, token: ADMIN_TOKEN });
    expect(detail.status).toBe(200);
    const body = detail.body as Record<string, unknown>;
    expect(body.tin).toBe('123456789');
    expect(body.governmentIdNumber).toBe('D7654321');
    // A member without a TIN reads as null, not as a mask or a string.
    const sparse = await call({ familyPath: SSM_ID, token: ADMIN_TOKEN });
    expect((sparse.body as Record<string, unknown>).tin).toBeNull();
    expect((sparse.body as Record<string, unknown>).governmentIdNumber).toBe('P1234567');
    // The list-shaped read still masks, and a read writes no audit event.
    const listState = await call({ familyPath: '', token: ADMIN_TOKEN });
    const sm = (listState.body as { data: Record<string, unknown>[] }).data.find(
      (r) => r.id === SM_ID,
    )!;
    expect(sm).not.toHaveProperty('tin');
    expect(sm).not.toHaveProperty('governmentIdNumber');
    expect(sm.tinMasked).toBe('*****6789');
    expect(holder.db.rows('audit_events')).toEqual([]);
  });

  it('refuses unknown ids and non-member staff', async () => {
    const unknown = await call({
      familyPath: '99999999-9999-4999-8999-999999999999',
      token: ADMIN_TOKEN,
    });
    expect(unknown.status).toBe(404);
    const plainStaff = await call({ familyPath: ADMIN_ID, token: ADMIN_TOKEN });
    expect(plainStaff.status).toBe(404);
  });
});

describe('PATCH /members/:id', () => {
  it('updates profile fields and keeps secrets masked', async () => {
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { mobileNo: '+639179999999', tin: '999888777' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    const body = state.body as Record<string, unknown>;
    expect(body.tin).toBeUndefined();
    expect(body.tinMasked).not.toBeNull();
    const audits = JSON.stringify(
      (holder.db as unknown as { rows: (t: string) => Row[] }).rows('audit_events'),
    );
    expect(audits).not.toContain('999888777');
  });

  it('updates the display name on the staff account', async () => {
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { fullName: 'Renamed Seller' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    expect((state.body as Record<string, unknown>).fullName).toBe('Renamed Seller');
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(db.rows('staff_users').find((s) => s.id === SM_ID)?.full_name).toBe('Renamed Seller');
  });

  /** A synthetic hierarchy member with no profile: invisible to member lists. */
  function addStaff(
    tables: Record<string, Row[]>,
    person: { id: string; email: string; fullName: string; roleId: string; status?: string },
  ) {
    tables.staff_users!.push({
      id: person.id,
      email: person.email,
      full_name: person.fullName,
      status: person.status ?? 'active',
      department_id: DEPT_SALES,
      employee_number: null,
      created_at: '2026-09-05T00:00:00.000Z',
    });
    tables.staff_role_assignments!.push({ staff_id: person.id, role_id: person.roleId });
  }

  it('moves the position, re-resolves the role and the head, and retires the OST referrer', async () => {
    const tables = baseTables();
    addStaff(tables, { id: VD_ID, email: 'vd@afhomes.test', fullName: 'VICE DIRECTOR', roleId: ROLE_VD });
    install(tables);
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: {
        position: 'senior_sales_manager',
        referrerStaffId: VD_ID,
        headChangeReason: 'Promoted to Senior Sales Manager',
      },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    expect((state.body as Record<string, unknown>).position).toBe('senior_sales_manager');
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(db.rows('staff_role_assignments').find((r) => r.staff_id === SM_ID)?.role_id).toBe(
      ROLE_SSM,
    );
    const profile = db.rows('network_member_profiles').find((r) => r.staff_id === SM_ID)!;
    expect(profile.referrer_staff_id).toBe(VD_ID);
    // Leaving the Sales Manager seat retires the informational OST referrer.
    expect(profile.ost_referrer_staff_id).toBeNull();
    // The new genealogy edge carries the NEW position; nothing else is active.
    const edges = db.rows('referral_relationships');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      subject_staff_id: SM_ID,
      upline_staff_id: VD_ID,
      hierarchy_role: 'senior_sales_manager',
      is_active: true,
    });
    const audits = JSON.stringify(db.rows('audit_events'));
    expect(audits).toContain('UPLINE_CORRECTED');
    expect(audits).toContain('Promoted to Senior Sales Manager');
  });

  it('requires a head for the new position and none for a Vice Director', async () => {
    const missing = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { position: 'senior_sales_manager' },
      token: ADMIN_TOKEN,
    });
    expect(missing.status).toBe(400);
    const refused = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { position: 'vice_director', referrerStaffId: SSM_ID },
      token: ADMIN_TOKEN,
    });
    expect(refused.status).toBe(400);
    // Neither refusal wrote anything.
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(db.rows('staff_role_assignments').find((r) => r.staff_id === SM_ID)?.role_id).toBe(
      ROLE_SM,
    );
  });

  it('requires a reason when the head moves, then audits the move', async () => {
    const tables = baseTables();
    addStaff(tables, {
      id: SSM2_ID,
      email: 'ssm2@afhomes.test',
      fullName: 'SECOND SENIOR MANAGER',
      roleId: ROLE_SSM,
    });
    install(tables);
    const noReason = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { referrerStaffId: SSM2_ID },
      token: ADMIN_TOKEN,
    });
    expect(noReason.status).toBe(400);
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(
      db.rows('network_member_profiles').find((r) => r.staff_id === SM_ID)?.referrer_staff_id,
    ).toBe(SSM_ID);

    const moved = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { referrerStaffId: SSM2_ID, headChangeReason: 'Reassigned the book' },
      token: ADMIN_TOKEN,
    });
    expect(moved.status).toBe(200);
    expect(
      db.rows('network_member_profiles').find((r) => r.staff_id === SM_ID)?.referrer_staff_id,
    ).toBe(SSM2_ID);
    const active = db.rows('referral_relationships').filter((r) => r.is_active === true);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      subject_staff_id: SM_ID,
      upline_staff_id: SSM2_ID,
      hierarchy_role: 'sales_manager',
    });
    expect(JSON.stringify(db.rows('audit_events'))).toContain('Reassigned the book');
  });

  it('treats a re-picked current head as no change and refuses a bad candidate', async () => {
    const tables = baseTables();
    addStaff(tables, {
      id: VD_ID,
      email: 'vd@afhomes.test',
      fullName: 'VICE DIRECTOR',
      roleId: ROLE_VD,
    });
    addStaff(tables, {
      id: SSM2_ID,
      email: 'ssm2@afhomes.test',
      fullName: 'INACTIVE SENIOR MANAGER',
      roleId: ROLE_SSM,
      status: 'inactive',
    });
    install(tables);
    // Same head, no reason: allowed, and no edge is written.
    const same = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { referrerStaffId: SSM_ID },
      token: ADMIN_TOKEN,
    });
    expect(same.status).toBe(200);
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    expect(db.rows('referral_relationships')).toHaveLength(0);
    expect(JSON.stringify(db.rows('audit_events'))).not.toContain('UPLINE_CORRECTED');

    // A level that is not the immediate upline.
    const offLevel = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { referrerStaffId: VD_ID, headChangeReason: 'trying it on' },
      token: ADMIN_TOKEN,
    });
    expect(offLevel.status).toBe(400);
    // The member cannot be their own head.
    const self = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { referrerStaffId: SM_ID, headChangeReason: 'trying it on' },
      token: ADMIN_TOKEN,
    });
    expect(self.status).toBe(400);
    // An inactive candidate.
    const inactive = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { referrerStaffId: SSM2_ID, headChangeReason: 'trying it on' },
      token: ADMIN_TOKEN,
    });
    expect(inactive.status).toBe(409);
  });

  it('keeps the OST referrer to active OSTs of Sales Managers', async () => {
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { ostReferrerStaffId: SSM_ID },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
  });

  it('rotates the login email and resets the password as a temporary one', async () => {
    install(undefined, { authUsers: [{ id: SM_ID, email: 'sm@afhomes.test' }] });
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { email: 'New.Address@Example.com', temporaryPassword: 'TempPass456' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    expect((state.body as Record<string, unknown>).email).toBe('new.address@example.com');
    const db = holder.db as unknown as {
      rows: (table: string) => Row[];
      calls: { op: string; table: string; arg?: Record<string, unknown> }[];
      authUsers: () => { id: string; email: string }[];
    };
    const staff = db.rows('staff_users').find((s) => s.id === SM_ID)!;
    expect(staff.email).toBe('new.address@example.com');
    // The administrator reset puts the account back on a temporary password.
    expect(staff.must_change_password).toBe(true);
    expect(db.authUsers().find((u) => u.id === SM_ID)?.email).toBe('new.address@example.com');
    const authCall = db.calls.find((c) => c.op === 'updateUserById');
    expect(authCall?.arg).toMatchObject({ id: SM_ID, hasEmail: true, emailConfirmed: true });
    // The password reached GoTrue; the audit trail holds neither secret.
    expect(
      (holder.db as unknown as { passwordsSeen: string[] }).passwordsSeen,
    ).toContain('TempPass456');
    const audits = JSON.stringify(db.rows('audit_events'));
    expect(audits).not.toContain('TempPass456');
    expect(audits).not.toContain('new.address@example.com');
  });

  it('refuses an email another staff member holds without touching anything', async () => {
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { email: 'ssm@afhomes.test' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    const db = holder.db as unknown as {
      rows: (table: string) => Row[];
      calls: { op: string; table: string }[];
    };
    expect(db.rows('staff_users').find((s) => s.id === SM_ID)?.email).toBe('sm@afhomes.test');
    expect(db.calls.some((c) => c.op === 'updateUserById')).toBe(false);
  });

  it('re-verifies the address when the codes travel, and refuses a half pair', async () => {
    const ok = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: {
        province: 'WRONG',
        cityMunicipality: 'WRONG',
        provinceCode: LAGUNA.code,
        cityMunicipalityCode: CALAUAN.code,
        zipCode: '4011',
      },
      token: ADMIN_TOKEN,
    });
    expect(ok.status).toBe(200);
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    const profile = db.rows('network_member_profiles').find((r) => r.staff_id === SM_ID)!;
    // The reference owns the saved names and codes; the ZIP stays the operator's.
    expect(profile.province).toBe('Laguna');
    expect(profile.city_municipality).toBe('Calauan');
    expect(profile.province_code).toBe(LAGUNA.code);
    expect(profile.city_municipality_code).toBe(CALAUAN.code);
    expect(profile.zip_code).toBe('4011');

    const half = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { provinceCode: LAGUNA.code },
      token: ADMIN_TOKEN,
    });
    expect(half.status).toBe(400);
  });

  it('falls back to the published ZIP only when the body carried none', async () => {
    const ok = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { provinceCode: LAGUNA.code, cityMunicipalityCode: CALAUAN.code },
      token: ADMIN_TOKEN,
    });
    expect(ok.status).toBe(200);
    const db = holder.db as unknown as { rows: (table: string) => Row[] };
    const profile = db.rows('network_member_profiles').find((r) => r.staff_id === SM_ID)!;
    expect(profile.zip_code).toBe('4012');
  });
});

const DIRECT_APP_ID = '11111111-2222-4333-8444-555555555555';
const DIRECT_TERM_ID = '99999999-8888-4777-8666-555555555555';
const DIRECT_MEMBER_ID = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
const directIdentity = {
  firstName: 'Ostie',
  middleName: 'R',
  lastName: 'Member',
  email: 'direct.ost@afhomes.test',
  phone: '+639171111111',
  birthDate: '1990-01-02',
  address: {
    line1: '1 Farm Rd',
    city: 'Calauan',
    province: 'Laguna',
    postalCode: '4012',
    countryCode: 'PH',
  },
};
const directForm = {
  dateApplied: '2026-10-01',
  programCategory: 'non_vip',
  vipCardType: null,
  sex: 'male',
  civilStatus: 'single',
  telephone: '',
  messenger: '',
  tin: '',
  employerName: '',
  employerAddress: '',
  jobPosition: '',
  governmentIdType: 'passport',
  governmentIdNumber: 'P1234567',
  applicantSignatureStatus: 'received',
  referrerSignatureStatus: 'received',
  applicantSignedOn: '2026-10-01',
  referrerSignedOn: '2026-10-01',
  referrerSnapshot: { telephone: '', mobile: '', address: '', messenger: '' },
};
const directBody = (extra: Record<string, unknown> = {}) => ({
  mode: 'complete',
  requestId: '22222222-3333-4444-8555-666666666666',
  sponsorStaffId: SM_ID,
  identity: directIdentity,
  form: directForm,
  startsOn: '2026-10-01',
  expiresOn: '2027-10-01',
  ...extra,
});
const installDirect = (extra: Record<string, unknown> = {}) =>
  install(undefined, {
    inviteUserId: DIRECT_MEMBER_ID,
    rpcs: [
      { fn: 'submit_ost_accreditation', result: DIRECT_APP_ID },
      { fn: 'confirm_ost_application_signatures', result: DIRECT_APP_ID },
      { fn: 'install_direct_ost_accreditation', result: DIRECT_TERM_ID },
    ],
    ...extra,
  });

describe('POST /members/ost (direct OST creation)', () => {
  const ORIGINAL_ADMIN_URL = process.env.AFHOMES_ADMIN_URL;
  beforeEach(() => {
    process.env.AFHOMES_ADMIN_URL = 'https://afhomes.test/admin';
  });
  afterAll(() => {
    if (ORIGINAL_ADMIN_URL === undefined) delete process.env.AFHOMES_ADMIN_URL;
    else process.env.AFHOMES_ADMIN_URL = ORIGINAL_ADMIN_URL;
  });

  it('records the application, the real signature dates and the approval in one act', async () => {
    installDirect();
    const state = await call({
      method: 'POST',
      familyPath: 'ost',
      body: directBody(),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(201);
    expect(state.body).toEqual({
      applicationId: DIRECT_APP_ID,
      memberId: DIRECT_MEMBER_ID,
      status: 'approved',
    });
    // The submission carries the referenced sponsor and no referral code the
    // operator could have invented.
    const submitted = rpcArgs('submit_ost_accreditation')[0]!.arg!;
    expect(submitted.p_sponsor_id).toBe(SM_ID);
    expect(submitted.p_code_id).toBeNull();
    expect(submitted.p_source).toBe('manual');
    // The dates the operator transcribed are the dates that travel.
    const signatures = rpcArgs('confirm_ost_application_signatures')[0]!.arg!;
    expect(signatures.p_applicant_date).toBe('2026-10-01');
    expect(signatures.p_referrer_date).toBe('2026-10-01');
    // The install re-validates the sponsor in SQL and never receives a number.
    const installed = rpcArgs('install_direct_ost_accreditation')[0]!.arg!;
    expect(installed.p_actor_id).toBe(ADMIN_ID);
    expect(installed.p_auth_id).toBe(DIRECT_MEMBER_ID);
    expect(installed.p_starts_on).toBe('2026-10-01');
    expect(installed.p_expires_on).toBe('2027-10-01');
    expect(installed).not.toHaveProperty('p_aa_number');
  });

  it('saves the application as pending and invites nobody', async () => {
    installDirect();
    const state = await call({
      method: 'POST',
      familyPath: 'ost',
      body: directBody({ mode: 'pending', startsOn: null, expiresOn: null }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(201);
    expect(state.body).toEqual({
      applicationId: DIRECT_APP_ID,
      memberId: null,
      status: 'submitted',
    });
    expect(rpcCalls('confirm_ost_application_signatures')).toHaveLength(0);
    expect(rpcCalls('install_direct_ost_accreditation')).toHaveLength(0);
    expect(
      (holder.db as unknown as { calls: { op: string }[] }).calls.filter(
        (c) => c.op === 'inviteUserByEmail',
      ),
    ).toHaveLength(0);
  });

  it('keeps the invitation when the install is refused', async () => {
    installDirect({
      rpcErrors: {
        install_direct_ost_accreditation: { message: 'OST_SIGNATURE_EVIDENCE_REQUIRED' },
      },
    });
    const state = await call({
      method: 'POST',
      familyPath: 'ost',
      body: directBody(),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
    // The invitation is deliberately preserved: an invite response does not
    // prove the account was newly created, so deleting it could destroy a
    // pre-existing login. The operator retries from the OST queue.
    expect(
      (holder.db as unknown as { calls: { op: string }[] }).calls.filter(
        (c) => c.op === 'inviteUserByEmail',
      ),
    ).toHaveLength(1);
  });

  it('maps a duplicate registration to a conflict', async () => {
    installDirect({
      rpcErrors: { submit_ost_accreditation: { message: 'OST_DUPLICATE_ACCOUNT' } },
    });
    const state = await call({
      method: 'POST',
      familyPath: 'ost',
      body: directBody({ mode: 'pending', startsOn: null, expiresOn: null }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    expect(err(state.body)?.code).toBe('CONFLICT');
  });

  it('refuses an anonymous caller and a body whose sponsor is not a member', async () => {
    installDirect();
    const anonymous = await call({ method: 'POST', familyPath: 'ost', body: directBody() });
    expect(anonymous.status).toBe(401);
    const missing = await call({
      method: 'POST',
      familyPath: 'ost',
      body: directBody({ sponsorStaffId: 'not-a-uuid' }),
      token: ADMIN_TOKEN,
    });
    expect(missing.status).toBe(400);
    expect(err(missing.body)?.code).toBe('VALIDATION_ERROR');
    expect(rpcCalls('submit_ost_accreditation')).toHaveLength(0);
  });
});

describe('POST /members/:id/transfer', () => {
  const toOstBody = (extra: Record<string, unknown> = {}) => ({
    direction: 'IST_TO_OST',
    reason: 'Moved to the OST desk by management',
    sponsorStaffId: SM_ID,
    identity: directIdentity,
    form: directForm,
    startsOn: '2026-10-01',
    expiresOn: '2027-10-01',
    ...extra,
  });
  const transferRpc = (result: unknown, rpcErrors?: Record<string, { message: string }>) =>
    install(undefined, {
      rpcs: [
        // The member list resolves each row's AA number; the transfer tests
        // assert the provenance state, not the number itself.
        {
          fn: 'get_sale_team_accreditation',
          result: { aaNumber: 'AAI26090001', kind: 'IST', status: 'accredited' },
        },
        { fn: 'transfer_sale_team_member', result },
      ],
      ...(rpcErrors ? { rpcErrors } : {}),
    });

  it('transfers IST to OST in one call and sends no number at all', async () => {
    transferRpc({
      direction: 'IST_TO_OST',
      kind: 'OST',
      previousAaNumber: 'AAI26090001',
      aaNumber: 'AAO26090001',
    });
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/transfer`,
      body: toOstBody(),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    expect((state.body as Record<string, unknown>).id).toBe(SM_ID);
    const args = rpcArgs('transfer_sale_team_member')[0]!.arg!;
    expect(args.p_actor_id).toBe(ADMIN_ID);
    expect(args.p_staff_id).toBe(SM_ID);
    expect(args.p_direction).toBe('IST_TO_OST');
    expect(args.p_reason).toBe('Moved to the OST desk by management');
    expect(args.p_sponsor_id).toBe(SM_ID);
    expect(args.p_starts_on).toBe('2026-10-01');
    expect(args.p_expires_on).toBe('2027-10-01');
    // The client never names a number: the database issues the successor.
    expect(args).not.toHaveProperty('p_aa_number');
    expect(args.p_target_position ?? null).toBeNull();
    expect(args.p_head_id ?? null).toBeNull();
  });

  it('transfers OST to IST with the chosen position and head', async () => {
    transferRpc({
      direction: 'OST_TO_IST',
      kind: 'IST',
      previousAaNumber: 'AAO26090001',
      aaNumber: 'AAI26090009',
    });
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/transfer`,
      body: {
        direction: 'OST_TO_IST',
        reason: 'Returns to the selling hierarchy',
        targetPosition: 'sales_manager',
        headStaffId: SSM_ID,
      },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    const args = rpcArgs('transfer_sale_team_member')[0]!.arg!;
    expect(args.p_direction).toBe('OST_TO_IST');
    expect(args.p_target_position).toBe('sales_manager');
    expect(args.p_head_id).toBe(SSM_ID);
    expect(args.p_sponsor_id ?? null).toBeNull();
    expect(args.p_identity ?? null).toBeNull();
    expect(args).not.toHaveProperty('p_aa_number');
  });

  it('refuses a reason-free transfer before any call reaches SQL', async () => {
    transferRpc({});
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/transfer`,
      body: toOstBody({ reason: 'no' }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
    expect(rpcCalls('transfer_sale_team_member')).toHaveLength(0);
  });

  it('does not transfer a member that does not exist', async () => {
    transferRpc({});
    const state = await call({
      method: 'POST',
      familyPath: '12121212-3434-4565-8787-909090909090/transfer',
      body: toOstBody(),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(404);
    expect(rpcCalls('transfer_sale_team_member')).toHaveLength(0);
  });

  it('maps a refused transfer to a conflict and requires authentication', async () => {
    transferRpc({}, { transfer_sale_team_member: { message: 'OST_RENEWAL_IN_PROGRESS' } });
    const state = await call({
      method: 'POST',
      familyPath: `${SM_ID}/transfer`,
      body: toOstBody(),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(409);
    expect(err(state.body)?.code).toBe('CONFLICT');
    const anonymous = await call({
      method: 'POST',
      familyPath: `${SM_ID}/transfer`,
      body: toOstBody(),
    });
    expect(anonymous.status).toBe(401);
  });
});
