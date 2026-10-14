/**
 * Server-side hierarchy + recommender validation for a Customer Application.
 *
 * The claim under test: names prove nothing. A hand-crafted body that pairs an
 * SM with the wrong SSM, names an inactive VD, or cites a recommender that does
 * not exist must be refused before anything is persisted - no matter what the
 * cascading comboboxes in the UI would have done.
 */
import { describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async () => ({
    userId: '11111111-1111-4111-8111-111111111111',
    roleSlug: 'super_admin',
  }),
}));

const forms = (await import('./official-forms.js')).default;

const VD = '22222222-2222-4222-8222-222222222222';
const SSM = '33333333-3333-4333-8333-333333333333';
const SM = '44444444-4444-4444-8444-444444444444';
const SM_OTHER = '99999999-9999-4999-8999-999999999999';
const OST = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OST_SUSPENDED = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const OST_ELSEWHERE = 'cccccccc-1111-4111-8111-cccccccccccc';
const OTHER_SSM = '55555555-5555-4555-8555-555555555555';
const INACTIVE_VD = '66666666-6666-4666-8666-666666666666';
const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000003';
const RECOMMENDER_ID = 'dddddddd-0000-4000-8000-000000000004';
const PLAN_ID = 'bbbbbbbb-0000-4000-8000-000000000004';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

const baseHolder = {
  holderType: 'PRIMARY' as const,
  lastName: 'SANTOS',
  firstName: 'ANA',
  birthDate: '1990-01-01',
  permanentAddressLine1: '1 RPC Street',
  cityMunicipality: 'QUEZON CITY',
  province: 'METRO MANILA',
  mobile: '+639171234567',
  email: 'ana@example.test',
  printedName: 'ANA SANTOS',
};

const body = (extra: Record<string, unknown>) => ({
  requestId: REQUEST_ID,
  customerId: CUSTOMER_ID,
  planId: PLAN_ID,
  tier: 'BRONZE',
  paymentScheme: 'spot_cash',
  primary: baseHolder,
  consentAcknowledged: true,
  acknowledgedAt: '2026-10-01',
  primarySignatureStatus: 'received',
  validIdReceived: false,
  reservationPaymentProofReceived: false,
  ...extra,
});

function tables() {
  return {
    staff_users: [
      { id: STAFF_ID, status: 'active' },
      { id: VD, status: 'active' },
      { id: SSM, status: 'active' },
      { id: SM, status: 'active' },
      { id: SM_OTHER, status: 'active' },
      { id: OST, status: 'active' },
      { id: OST_SUSPENDED, status: 'active' },
      { id: OST_ELSEWHERE, status: 'active' },
      { id: OTHER_SSM, status: 'active' },
      { id: INACTIVE_VD, status: 'inactive' },
    ],
    roles: [
      { id: 'role-vd', slug: 'vice_director' },
      { id: 'role-ssm', slug: 'senior_sales_manager' },
      { id: 'role-sm', slug: 'sales_manager' },
      { id: 'role-ost', slug: 'ost' },
    ],
    staff_role_assignments: [
      { staff_id: VD, role_id: 'role-vd' },
      { staff_id: SSM, role_id: 'role-ssm' },
      { staff_id: SM, role_id: 'role-sm' },
      { staff_id: SM_OTHER, role_id: 'role-sm' },
      { staff_id: OST, role_id: 'role-ost' },
      { staff_id: OST_SUSPENDED, role_id: 'role-ost' },
      { staff_id: OST_ELSEWHERE, role_id: 'role-ost' },
      { staff_id: OTHER_SSM, role_id: 'role-ssm' },
      { staff_id: INACTIVE_VD, role_id: 'role-vd' },
    ],
    ost_members: [
      { id: OST, status: 'active' },
      { id: OST_SUSPENDED, status: 'suspended' },
      { id: OST_ELSEWHERE, status: 'active' },
    ],
    referral_relationships: [
      { subject_staff_id: SSM, upline_staff_id: VD, is_active: true },
      { subject_staff_id: SM, upline_staff_id: SSM, is_active: true },
      { subject_staff_id: OTHER_SSM, upline_staff_id: INACTIVE_VD, is_active: true },
      { subject_staff_id: OST, upline_staff_id: SM, is_active: true },
      { subject_staff_id: OST_ELSEWHERE, upline_staff_id: SM_OTHER, is_active: true },
    ],
    customers: [
      { id: CUSTOMER_ID, full_name: 'ANA SANTOS' },
      { id: RECOMMENDER_ID, full_name: 'JUAN DELA CRUZ' },
    ],
    card_plans: [{ id: PLAN_ID, is_active: true, tier_snapshot: 'BRONZE' }],
    customer_applications: [
      {
        id: APP_ID,
        application_number: 'APP-1',
        purchase_terms_id: null,
        customer_id: CUSTOMER_ID,
        plan_id: PLAN_ID,
        tier_snapshot: 'BRONZE',
        payment_scheme_snapshot: 'spot_cash',
        status: 'draft',
        created_by: STAFF_ID,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        submitted_at: null,
        approved_at: null,
        rejected_at: null,
        sale_id: null,
      },
    ],
    customer_application_holders: [
      {
        id: 'holder-1',
        application_id: APP_ID,
        holder_type: 'PRIMARY',
        last_name: 'SANTOS',
        first_name: 'ANA',
        birth_date: '1990-01-01',
        permanent_address_line_1: '1 RPC STREET',
        city_municipality: 'QUEZON CITY',
        province: 'METRO MANILA',
        mobile: '+639171234567',
        email: 'ana@example.test',
        printed_name: 'ANA SANTOS',
      },
    ],
  };
}

async function post(payload: unknown, configure?: (db: FakeSupabase) => void) {
  const fixture = tables();
  const db = new FakeSupabase({
    tables: { ...fixture, roles: fixture.roles.map((role) => ({ ...role, is_active: true })) },
    rpcs: [{ fn: 'create_customer_application_once', result: APP_ID }],
  });
  configure?.(db);
  holder.db = db;
  const { res, state } = makeRes();
  await forms(
    makeReq({ method: 'POST', familyPath: 'customer-applications', body: payload, token: 'staff' }),
    res,
  );
  return { db, state };
}

const validChain = {
  vdStaffId: VD,
  ssmStaffId: SSM,
  smStaffId: SM,
  salesManagerName: 'SM NAME',
};

describe('a valid hierarchy + recommender', () => {
  it('is accepted and forwarded with the stable ids', async () => {
    const { state, db } = await post(
      body({ ...validChain, recommenderCustomerId: RECOMMENDER_ID }),
    );
    expect(state.status).toBe(201);
    const call = db.calls.find(
      (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
    );
    expect((call?.arg as { p_header: Record<string, unknown> }).p_header).toMatchObject({
      vdStaffId: VD,
      ssmStaffId: SSM,
      smStaffId: SM,
      recommenderCustomerId: RECOMMENDER_ID,
    });
  });

  it('still accepts a legacy free-text record with no ids', async () => {
    const { state } = await post(body({ salesManagerName: 'OLD NAME' }));
    expect(state.status).toBe(201);
  });
});

describe('a manipulated hierarchy', () => {
  it('refuses a disabled hierarchy role before saving', async () => {
    const { state, db } = await post(body(validChain), (db) => {
      db.rows('roles').find((role) => role.id === 'role-sm')!.is_active = false;
    });
    expect(state.status).toBe(400);
    expect(db.calls.some((call) => call.op === 'rpc')).toBe(false);
  });
  it('refuses an inactive OST account even when its accreditation remains active', async () => {
    const { state, db } = await post(body({ ...validChain, referrerOstId: OST }), (db) => {
      db.rows('staff_users').find((staff) => staff.id === OST)!.status = 'inactive';
    });
    expect(state.status).toBe(409);
    expect(db.calls.some((call) => call.op === 'rpc')).toBe(false);
  });
  it('refuses an SM under the wrong SSM', async () => {
    const { state, db } = await post(body({ vdStaffId: VD, ssmStaffId: OTHER_SSM, smStaffId: SM }));
    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an SSM under the wrong VD', async () => {
    const { state, db } = await post(body({ vdStaffId: VD, ssmStaffId: OTHER_SSM }));
    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an SM without its SSM and VD', async () => {
    const { state, db } = await post(body({ smStaffId: SM }));
    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an SSM without its VD', async () => {
    const { state, db } = await post(body({ ssmStaffId: SSM }));
    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an inactive VD', async () => {
    const { state, db } = await post(
      body({ vdStaffId: INACTIVE_VD, ssmStaffId: OTHER_SSM, salesManagerName: 'X' }),
    );
    expect(state.status).toBe(409);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an unknown VD id', async () => {
    const { state, db } = await post(body({ vdStaffId: '77777777-7777-4777-8777-777777777777' }));
    expect(state.status).toBe(404);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});

describe('a manipulated recommender', () => {
  it('refuses an unknown recommender id', async () => {
    const { state, db } = await post(
      body({ recommenderCustomerId: '88888888-8888-4888-8888-888888888888' }),
    );
    expect(state.status).toBe(404);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});

describe('a referring OST under the SM', () => {
  it('is accepted and forwarded with the stable id', async () => {
    const { state, db } = await post(
      body({ ...validChain, referrerOstId: OST, vipReferrer: 'OST NAME' }),
    );
    expect(state.status).toBe(201);
    const call = db.calls.find(
      (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
    );
    expect((call?.arg as { p_header: Record<string, unknown> }).p_header).toMatchObject({
      referrerOstId: OST,
    });
  });

  it('refuses an OST from another SM', async () => {
    const { state, db } = await post(body({ ...validChain, referrerOstId: OST_ELSEWHERE }));
    expect(state.status).toBe(400);
    expect(JSON.stringify(state.body)).toContain('does not belong to the selected Sales Manager');
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an OST without its SM', async () => {
    const { state, db } = await post(body({ referrerOstId: OST }));
    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses a suspended OST', async () => {
    const { state, db } = await post(body({ ...validChain, referrerOstId: OST_SUSPENDED }));
    expect(state.status).toBe(409);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an unknown OST id', async () => {
    const { state, db } = await post(
      body({ ...validChain, referrerOstId: '99999999-9999-4999-8999-999999999999' }),
    );
    expect(state.status).toBe(404);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});
