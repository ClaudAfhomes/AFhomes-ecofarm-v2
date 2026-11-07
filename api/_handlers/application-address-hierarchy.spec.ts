/**
 * Server-side hierarchy validation for a submitted Customer Application.
 *
 * The claim under test: the browser is NOT the boundary. A hand-crafted request
 * body that pairs a Laguna province with a Batangas municipality, or a Calauan
 * barangay with a different municipality, must be refused before anything is
 * persisted - no matter what the cascading controls in the UI would have done.
 *
 * The provider is stubbed because the point is what the HANDLER decides. The
 * hierarchy proof itself is covered in `address-provider.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const upstream = vi.hoisted(() => ({
  provinces: vi.fn(),
  localities: vi.fn(),
  barangays: vi.fn(),
}));

vi.mock('../_lib/psgc-cloud-provider.js', () => ({
  psgcCloudAddressProvider: {
    name: 'psgc-cloud-v2',
    provinces: upstream.provinces,
    localities: upstream.localities,
    barangays: upstream.barangays,
  },
}));

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async () => ({
    userId: '11111111-1111-4111-8111-111111111111',
    roleSlug: 'super_admin',
  }),
}));

const forms = (await import('./official-forms.js')).default;
const { resetAddressProviderCache } = await import('../_lib/address-source.js');

const LAGUNA = { code: '0403400000', name: 'Laguna' };
const BATANGAS = { code: '0406100000', name: 'Batangas' };
const CALAUAN = {
  code: '0403406000',
  name: 'Calauan',
  type: 'municipality' as const,
  provinceCode: LAGUNA.code,
};
const LEMERY = {
  code: '0406110000',
  name: 'Lemery',
  type: 'municipality' as const,
  provinceCode: BATANGAS.code,
};
const DAYAP = { code: '0403406003', name: 'Dayap', localityCode: CALAUAN.code };

const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000003';
const PLAN_ID = 'bbbbbbbb-0000-4000-8000-000000000004';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const STAFF_ID = '11111111-1111-4111-8111-111111111111';

const baseHolder = {
  holderType: 'PRIMARY' as const,
  lastName: 'SANTOS',
  firstName: 'ANA',
  birthDate: '1990-01-01',
  permanentAddressLine1: '1 RPC Street',
  mobile: '+639171234567',
  email: 'ana@example.test',
  printedName: 'ANA SANTOS',
};

const body = (primary: Record<string, unknown>) => ({
  requestId: REQUEST_ID,
  customerId: CUSTOMER_ID,
  planId: PLAN_ID,
  tier: 'BRONZE',
  paymentScheme: 'spot_cash',
  primary,
  consentAcknowledged: true,
  acknowledgedAt: '2026-10-01',
  primarySignatureStatus: 'received',
  validIdReceived: false,
  reservationPaymentProofReceived: false,
});

function tables() {
  return {
    staff_users: [{ id: STAFF_ID, status: 'active', auth_user_id: STAFF_ID }],
    modules: [{ id: 'm1', key: 'sales.customers', is_active: true }],
    role_permissions: [],
    roles: [],
    customers: [{ id: CUSTOMER_ID, full_name: 'ANA SANTOS' }],
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
        vip_amount: '60000.00',
        discount_percent: 10,
        validity_years: 1,
        yearly_points: 60000,
        annual_points_tranches: 1,
        holder_limit: 1,
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
        city_municipality: 'Calauan',
        province: 'Laguna',
        barangay: 'Dayap',
        province_code: LAGUNA.code,
        city_municipality_code: CALAUAN.code,
        barangay_code: DAYAP.code,
        mobile: '+639171234567',
        email: 'ana@example.test',
        printed_name: 'ANA SANTOS',
      },
    ],
  };
}

async function post(payload: unknown) {
  const db = new FakeSupabase({
    tables: tables(),
    rpcs: [{ fn: 'create_customer_application_once', result: APP_ID }],
  });
  holder.db = db;
  const { res, state } = makeRes();
  await forms(makeReq({ method: 'POST', familyPath: 'customer-applications', body: payload, token: 'staff' }), res);
  return { db, state };
}

beforeEach(() => {
  resetAddressProviderCache();
  upstream.provinces.mockReset();
  upstream.localities.mockReset();
  upstream.barangays.mockReset();
  upstream.provinces.mockResolvedValue([LAGUNA, BATANGAS]);
  upstream.localities.mockImplementation(async (code: string) =>
    code === LAGUNA.code ? [CALAUAN] : [LEMERY],
  );
  upstream.barangays.mockImplementation(async (code: string) =>
    code === CALAUAN.code ? [DAYAP] : [],
  );
});

const verifiedTriple = {
  ...baseHolder,
  cityMunicipality: 'CALAUAN',
  province: 'LAGUNA',
  barangay: 'DAYAP',
  provinceCode: LAGUNA.code,
  cityMunicipalityCode: CALAUAN.code,
  barangayCode: DAYAP.code,
};

describe('a consistent hierarchy', () => {
  it('is accepted', async () => {
    const { state } = await post(body(verifiedTriple));
    expect(state.status).toBe(201);
  });

  it('is persisted with the PROVIDER’s spelling, not the browser’s', async () => {
    // The client sent LAGUNA; the authority published Laguna. The provider's name
    // wins, so the stored record never disagrees with the official list.
    const { db } = await post(body(verifiedTriple));
    const call = db.calls.find(
      (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
    );
    expect((call?.arg as { p_primary: Record<string, unknown> }).p_primary).toMatchObject({
      province: 'Laguna',
      cityMunicipality: 'Calauan',
      barangay: 'Dayap',
      provinceCode: LAGUNA.code,
      cityMunicipalityCode: CALAUAN.code,
      barangayCode: DAYAP.code,
    });
  });
});

describe('an inconsistent hierarchy', () => {
  it('refuses a municipality from a different province', async () => {
    const { state, db } = await post(
      body({ ...verifiedTriple, provinceCode: BATANGAS.code }),
    );

    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses a barangay from a different locality', async () => {
    const { state, db } = await post(body({ ...verifiedTriple, barangayCode: '0406110999' }));

    expect(state.status).toBe(400);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an unknown province code', async () => {
    const { state } = await post(body({ ...verifiedTriple, provinceCode: '9999999999' }));

    expect(state.status).toBe(400);
  });

  it('never echoes the codes back in the error', async () => {
    const { state } = await post(body({ ...verifiedTriple, provinceCode: BATANGAS.code }));

    expect(JSON.stringify(state.body)).not.toContain(BATANGAS.code);
  });
});

describe('a legacy free-text address', () => {
  it('is still accepted, because no codes means nothing to contradict', async () => {
    const { state } = await post(
      body({ ...baseHolder, cityMunicipality: 'QUEZON CITY', province: 'METRO MANILA' }),
    );

    expect(state.status).toBe(201);
  });

  it('is not silently given codes', async () => {
    const { db } = await post(
      body({ ...baseHolder, cityMunicipality: 'QUEZON CITY', province: 'METRO MANILA' }),
    );
    const call = db.calls.find(
      (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
    );
    const primary = (call?.arg as { p_primary: Record<string, unknown> }).p_primary;
    expect(primary.provinceCode).toBeUndefined();
    expect(primary.barangayCode).toBeUndefined();
  });
});

describe('a provider outage', () => {
  it('fails closed rather than saving an unverified address', async () => {
    upstream.provinces.mockRejectedValue(new Error('offline'));
    const { state, db } = await post(body(verifiedTriple));

    expect(state.status).toBe(503);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('does not leak the upstream message', async () => {
    upstream.provinces.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'));
    const { state } = await post(body(verifiedTriple));

    expect(JSON.stringify(state.body)).not.toContain('10.0.0.5');
  });
});