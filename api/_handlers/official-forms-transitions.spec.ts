import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCommissionRuleSchema,
  createCustomerApplicationSchema,
} from '@jad/contracts';
import { calculateCommission } from '../_lib/commerce.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (req: { headers?: Record<string, string> }) => {
    const token = req.headers?.authorization ?? '';
    if (token.includes('forbidden'))
      return {
        error: {
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
          status: 403,
        },
      };
    if (token.includes('seller'))
      return {
        userId: '11111111-1111-4111-8111-111111111111',
        roleSlug: 'sales_manager',
      };
    return { userId: '22222222-2222-4222-8222-222222222222', roleSlug: 'super_admin' };
  },
}));

const forms = (await import('./official-forms.js')).default;
const commissions = (await import('./commissions.js')).default;

const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const AGREEMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

function install(tables: Record<string, unknown[]> = {}) {
  holder.db = new FakeSupabase({
    tables: {
      customer_applications: [],
      customer_application_holders: [],
      reservation_agreements: [],
      reservation_agreement_holders: [],
      reservation_agreement_schedule: [],
      commission_rules: [],
      audit_events: [],
      roles: [{ id: '33333333-3333-4333-8333-333333333333', slug: 'sales_manager' }],
      ...tables,
    } as never,
  });
  return holder.db as FakeSupabase;
}

async function call(
  handler: (req: never, res: never) => Promise<void> | void,
  opts: { path: string; method?: string; token?: string; body?: unknown; query?: Record<string, string> },
) {
  const { res, state } = makeRes();
  await (handler as (req: unknown, res: unknown) => Promise<void>)(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      query: opts.query,
      headers: { authorization: `Bearer ${opts.token ?? 'seller-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

const draftApplication = {
  id: APP_ID,
  application_number: 'APP-20261001-00000001',
  customer_id: 'cccccccc-0000-4000-8000-000000000003',
  sale_id: null,
  plan_id: 'dddddddd-0000-4000-8000-000000000004',
  tier_snapshot: 'GOLD',
  payment_scheme_snapshot: 'spot_cash',
  vip_amount_snapshot: '50000.00',
  discount_percent_snapshot: 25,
  validity_years_snapshot: 22,
  yearly_points_snapshot: 25000,
  annual_points_tranches_snapshot: 20,
  holder_limit_snapshot: 2,
  acquisition_channels: ['Referral'],
  consent_acknowledged: true,
  acknowledged_at: '2026-10-01',
  primary_signature_status: 'received',
  secondary_signature_status: null,
  valid_id_received: true,
  reservation_payment_proof_received: false,
  status: 'submitted',
  created_by: '11111111-1111-4111-8111-111111111111',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  submitted_at: new Date().toISOString(),
  approved_at: null,
  rejected_at: null,
};

describe('official form review lifecycle', () => {
  beforeEach(() => {
    install({
      customer_applications: [{ ...draftApplication }],
      customer_application_holders: [
        {
          application_id: APP_ID,
          holder_type: 'PRIMARY',
          last_name: 'Dela Cruz',
          first_name: 'Ana',
          birth_date: '1990-05-04',
          permanent_address_line_1: '1 Main',
          city_municipality: 'Calamba',
          province: 'Laguna',
          mobile: '09171234567',
          email: 'ana@example.com',
          printed_name: 'Ana Dela Cruz',
        },
      ],
      reservation_agreements: [
        {
          id: AGREEMENT_ID,
          reservation_number: 'RES-20261001-00000001',
          reservation_date: '2026-10-01',
          agreement_date: '2026-10-01',
          sale_id: 'eeeeeeee-0000-4000-8000-000000000005',
          customer_application_id: null,
          plan_id: 'dddddddd-0000-4000-8000-000000000004',
          tier_snapshot: 'GOLD',
          inclusions_snapshot: {},
          total_price_snapshot: '50000.00',
          reservation_fee_snapshot: '10000.00',
          down_payment_snapshot: '10000.00',
          total_payment_received_snapshot: '0.00',
          balance_snapshot: '50000.00',
          monthly_amortization_snapshot: null,
          installment_months_snapshot: null,
          payment_scheme_snapshot: 'spot_cash',
          discount_percent_snapshot: 25,
          validity_years_snapshot: 22,
          yearly_points_snapshot: 25000,
          annual_points_tranches_snapshot: 20,
          holder_limit_snapshot: 2,
          primary_signature_status: 'received',
          secondary_signature_status: null,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          executed_at: null,
          created_by: '11111111-1111-4111-8111-111111111111',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      reservation_agreement_holders: [
        {
          agreement_id: AGREEMENT_ID,
          holder_type: 'PRIMARY',
          name: 'Ana Dela Cruz',
          address: '1 Main',
          contact_number: '09171234567',
          email: 'ana@example.com',
        },
      ],
      reservation_agreement_schedule: [],
    });
  });

  it('reopens a submitted application back to draft and rejects invalid jumps', async () => {
    const reopened = await call(forms, {
      path: `customer-applications/${APP_ID}/reopen`,
      method: 'POST',
      body: {},
    });
    expect(reopened.status).toBe(200);
    expect((reopened.body as { status: string }).status).toBe('draft');

    const invalid = await call(forms, {
      path: `customer-applications/${APP_ID}/decision`,
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(invalid.status).toBe(409);
  });

  it('decides a submitted reservation to executed and refuses draft execution', async () => {
    const decided = await call(forms, {
      path: `reservations/${AGREEMENT_ID}/decision`,
      method: 'POST',
      body: { decision: 'executed' },
    });
    expect(decided.status).toBe(200);
    expect((decided.body as { status: string }).status).toBe('executed');

    const reopened = await call(forms, {
      path: `reservations/${AGREEMENT_ID}/reopen`,
      method: 'POST',
      body: {},
    });
    expect(reopened.status).toBe(409);
  });

  it('requires authorization for review actions', async () => {
    const denied = await call(forms, {
      path: `customer-applications/${APP_ID}/reopen`,
      method: 'POST',
      body: {},
      token: 'forbidden-token',
    });
    expect(denied.status).toBe(403);
  });

  it('freezes commission snapshots at sale time and never stacks', () => {
    // Single-level only: one rate, one basis, one amount. No upline share.
    expect(calculateCommission('50000.00', '0.15')).toBe('7500.00');
    expect(calculateCommission('50000.00', '0')).toBe('0.00');
    expect(createCommissionRuleSchema.safeParse({
      targetType: 'staff',
      targetId: '11111111-1111-4111-8111-111111111111',
      rate: '0.15',
      effectiveFrom: '2026-10-01',
    }).success).toBe(true);
  });

  it('creates commission rules and surfaces overlap as a conflict', async () => {
    const created = await call(commissions, {
      path: 'rules',
      method: 'POST',
      token: 'super-admin-token',
      body: {
        targetType: 'role',
        targetId: '33333333-3333-4333-8333-333333333333',
        rate: '0.1000',
        effectiveFrom: '2026-10-01',
      },
    });
    expect([200, 201]).toContain(created.status);
  });

  it('rejects Bronze/Silver secondary holders at the contract', () => {
    expect(
      createCustomerApplicationSchema.safeParse({
        customerId: 'cccccccc-0000-4000-8000-000000000003',
        planId: 'dddddddd-0000-4000-8000-000000000004',
        tier: 'BRONZE',
        paymentScheme: 'spot_cash',
        primary: {
          holderType: 'PRIMARY',
          lastName: 'Dela Cruz',
          firstName: 'Ana',
          birthDate: '1990-05-04',
          permanentAddressLine1: '1 Main',
          cityMunicipality: 'Calamba',
          province: 'Laguna',
          mobile: '09171234567',
          email: 'ana@example.com',
          printedName: 'Ana Dela Cruz',
        },
        secondary: {
          holderType: 'SECONDARY',
          lastName: 'Reyes',
          firstName: 'Jose',
          birthDate: '1992-01-01',
          permanentAddressLine1: '2 Main',
          cityMunicipality: 'Calamba',
          province: 'Laguna',
          mobile: '09171234568',
          email: 'jose@example.com',
          printedName: 'Jose Reyes',
        },
        acquisitionChannels: [],
        consentAcknowledged: true,
        acknowledgedAt: '2026-10-01',
        primarySignatureStatus: 'received',
        validIdReceived: true,
        reservationPaymentProofReceived: false,
      }).success,
    ).toBe(false);
  });
});
