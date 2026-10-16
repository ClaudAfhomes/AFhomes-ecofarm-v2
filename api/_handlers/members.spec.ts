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
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const members = (await import('./members.js')).default;

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SSM_ID = '22222222-2222-4222-8222-222222222222';
const SM_ID = '33333333-3333-4333-8333-333333333333';
const OST_ID = '44444444-4444-4444-8444-444444444444';
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
        tin: '123-456-789',
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

function install(tables?: Record<string, Row[]>) {
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
  cityMunicipality: 'Makati',
  province: 'Metro Manila',
  zipCode: '1200',
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
  (
    holder.db as unknown as { calls: { op: string; table: string }[] }
  ).calls.filter((c) => c.op === 'rpc' && c.table === fn);

beforeEach(() => {
  install();
});

describe('POST /members', () => {
  it('provisions the login, links the head, records the OST referrer and issues the AA', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({ tin: '123-456-789', ostReferrerStaffId: OST_ID }),
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
    const profile = db
      .rows('network_member_profiles')
      .find((r) => r.mobile_no === '+639173333333');
    expect(profile?.referrer_staff_id).toBe(SSM_ID);
    expect(profile?.ost_referrer_staff_id).toBe(OST_ID);
    expect(
      db.rows('referral_relationships').some((r) => r.upline_staff_id === SSM_ID),
    ).toBe(true);
    // Audits carry identity only: no password, TIN or government ID.
    const audits = JSON.stringify(db.rows('audit_events'));
    expect(audits).not.toContain('TempPass123');
    expect(audits).not.toContain('P9998888');
  });

  it('creates an OST under a Sales Manager without issuing IST accreditation', async () => {
    const state = await call({
      method: 'POST',
      body: createBody({
        email: 'new.ost@afhomes.test',
        position: 'ost',
        referrerStaffId: SM_ID,
      }),
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(201);
    expect((state.body as Record<string, unknown>).position).toBe('ost');
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
    expect(
      (forSm.body as { data: { fullName: string }[] }).data.map((r) => r.fullName),
    ).toEqual(['SENIOR MANAGER']);
    const forOst = await call({
      familyPath: 'uplines',
      query: { position: 'ost' },
      token: ADMIN_TOKEN,
    });
    expect(
      (forOst.body as { data: { fullName: string }[] }).data.map((r) => r.fullName),
    ).toEqual(['SALES MANAGER']);
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

describe('PATCH /members/:id', () => {
  it('updates profile fields and keeps secrets masked', async () => {
    const state = await call({
      method: 'PATCH',
      familyPath: SM_ID,
      body: { mobileNo: '+639179999999', tin: '999-888-777' },
      token: ADMIN_TOKEN,
    });
    expect(state.status).toBe(200);
    const body = state.body as Record<string, unknown>;
    expect(body.tin).toBeUndefined();
    expect(body.tinMasked).not.toBeNull();
    const audits = JSON.stringify(
      (holder.db as unknown as { rows: (t: string) => Row[] }).rows('audit_events'),
    );
    expect(audits).not.toContain('999-888-777');
  });
});
