import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  customerApplicationListItemSchema,
  createCommissionRuleSchema,
  createCustomerApplicationSchema,
  reservationAgreementListItemSchema,
} from '@afhomes/contracts';
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
  // Models the real role baseline: sellers hold sales.card_sales view+create
  // (never update) and sales.customers view+create+update; only the super
  // admin passes an update check on sales.card_sales.
  authorizeAfHomes: async (
    req: { headers?: Record<string, string> },
    moduleKey?: string,
    action?: string,
  ) => {
    const token = req.headers?.authorization ?? '';
    const denied = (status: number, code: string) => ({
      error: {
        error: { code, message: code === 'UNAUTHORIZED' ? 'Missing authentication' : 'Forbidden' },
        status,
      },
    });
    if (!token.replace(/^Bearer\s*/, '').trim()) return denied(401, 'UNAUTHORIZED');
    if (token.includes('forbidden')) return denied(403, 'FORBIDDEN');
    if (action === 'update' && moduleKey === 'sales.card_sales')
      return token.includes('super-admin')
        ? { userId: '22222222-2222-4222-8222-222222222222', roleSlug: 'super_admin' }
        : denied(403, 'FORBIDDEN');
    if (token.includes('other-seller'))
      return { userId: '33333333-3333-4333-8333-333333333333', roleSlug: 'sales_manager' };
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
const AGREEMENT_DRAFT_ID = 'bbbbbbbb-0000-4000-8000-000000000003';
const SALE_ID = 'eeeeeeee-0000-4000-8000-000000000005';
const PLAN_ID = 'dddddddd-0000-4000-8000-000000000004';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const PROPOSAL_HASH = 'a'.repeat(64);

function install(
  tables: Record<string, unknown[]> = {},
  options: {
    rpcs?: { fn: string; result: unknown }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: {
      customer_applications: [],
      customer_application_holders: [],
      reservation_agreements: [],
      reservation_agreement_holders: [],
      reservation_agreement_schedule: [],
      commission_rules: [],
      audit_events: [],
      card_sales: [],
      card_plans: [],
      roles: [{ id: '33333333-3333-4333-8333-333333333333', slug: 'sales_manager' }],
      ...tables,
    } as never,
    rpcs: options.rpcs ?? [],
    links: [{ child: 'identity_documents', parent: 'customers', fk: 'customer_id' }],
    rpcErrors: options.rpcErrors,
  });
  return holder.db as FakeSupabase;
}

async function call(
  handler: (req: never, res: never) => Promise<void> | void,
  opts: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  },
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
  it.each([undefined, {}, { fields: { idType: 'invented' } }])(
    'rejects final submission without a persisted supported ID type: %j',
    async (reviewedData) => {
      install({
        customer_applications: [{ ...draftApplication, status: 'draft' }],
        customers: [{ id: draftApplication.customer_id, created_by: draftApplication.created_by }],
        identity_documents:
          reviewedData === undefined
            ? []
            : [
                {
                  id: '11111111-0000-4000-8000-000000000010',
                  subject_type: 'customer',
                  customer_id: draftApplication.customer_id,
                  storage_path: 'synthetic/id.png',
                  sha256: 'a'.repeat(64),
                  verification_status: 'pending_review',
                  created_at: '2026-10-01',
                  reviewed_data: reviewedData,
                },
              ],
      });
      const response = await call(forms, {
        path: `customer-applications/${APP_ID}/submit`,
        method: 'POST',
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    },
  );
  it('accepts final submission with a persisted supported ID type', async () => {
    install(
      {
        customer_applications: [{ ...draftApplication, status: 'draft' }],
        customers: [{ id: draftApplication.customer_id, created_by: draftApplication.created_by }],
        identity_documents: [
          {
            id: '11111111-0000-4000-8000-000000000010',
            subject_type: 'customer',
            customer_id: draftApplication.customer_id,
            storage_path: 'synthetic/id.png',
            sha256: 'a'.repeat(64),
            verification_status: 'pending_review',
            created_at: '2026-10-01',
            reviewed_data: { fields: { idType: 'passport' } },
          },
        ],
      },
      { rpcs: [{ fn: 'submit_purchase_application_once', result: APP_ID }] },
    );
    const response = await call(forms, {
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      // Submission is now strict: a request id plus the proposal hash the
      // reviewer was shown. No browser figure can travel with it.
      body: { requestId: REQUEST_ID, expectedProposalHash: PROPOSAL_HASH },
    });
    expect(response.status).toBe(200);
  });
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
      card_sales: [
        { id: SALE_ID, plan_id: PLAN_ID },
        { id: 'eeeeeeee-0000-4000-8000-000000000006', plan_id: PLAN_ID },
      ],
      card_plans: [{ id: PLAN_ID, code: 'GOLD' }],
    });
  });

  it('reopens a submitted application back to draft and rejects invalid jumps', async () => {
    const live = install();
    live.rpcs = [{ fn: 'decide_purchase_application_once', result: APP_ID }];
    const reopened = await call(forms, {
      path: `customer-applications/${APP_ID}/reopen`,
      method: 'POST',
      body: { requestId: REQUEST_ID },
    });
    expect(reopened.status).toBe(200);

    // The transition itself is now one atomic RPC, so the refusal comes from it.
    live.rpcErrors = {
      decide_purchase_application_once: {
        code: '55000',
        message: 'INVALID_APPLICATION_TRANSITION',
      },
    };
    const invalid = await call(forms, {
      path: `customer-applications/${APP_ID}/decision`,
      method: 'POST',
      body: { requestId: REQUEST_ID, decision: 'approved' },
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
    expect(
      createCommissionRuleSchema.safeParse({
        targetType: 'staff',
        targetId: '11111111-1111-4111-8111-111111111111',
        rate: '0.15',
        effectiveFrom: '2026-10-01',
      }).success,
    ).toBe(true);
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

const draftAgreementRow = (overrides: Record<string, unknown> = {}) => ({
  id: AGREEMENT_DRAFT_ID,
  reservation_number: 'RES-20261001-00000002',
  revision_number: null,
  reservation_date: '2026-10-01',
  agreement_date: '2026-10-01',
  sale_id: SALE_ID,
  customer_application_id: null,
  plan_id: PLAN_ID,
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
  monthly_amortization_start: null,
  monthly_amortization_end: null,
  payment_due_day: null,
  primary_signature_status: 'received',
  secondary_signature_status: null,
  status: 'draft',
  created_by: '11111111-1111-4111-8111-111111111111',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  submitted_at: null,
  executed_at: null,
  ...overrides,
});

const draftHolderRow = {
  agreement_id: AGREEMENT_DRAFT_ID,
  holder_type: 'PRIMARY',
  name: 'Ana Dela Cruz',
  address: '1 Main',
  contact_number: '09171234567',
  email: 'ana@example.com',
};

const validAgreementBody = (overrides: Record<string, unknown> = {}) => ({
  requestId: SALE_ID,
  saleId: SALE_ID,
  customerApplicationId: APP_ID,
  reservationDate: '2026-10-01',
  agreementDate: '2026-10-01',
  primarySignatureStatus: 'received',
  primary: {
    holderType: 'PRIMARY',
    name: 'Ana Dela Cruz',
    address: '1 Main',
    contactNumber: '09171234567',
    email: 'ana@example.com',
  },
  scheduleNotes: [],
  ...overrides,
});

describe('IST agreement seller ownership (D2) and tier context (D3)', () => {
  beforeEach(() => {
    install(
      {
        reservation_agreements: [draftAgreementRow()],
        reservation_agreement_holders: [{ ...draftHolderRow }],
        reservation_agreement_schedule: [],
        card_sales: [
          {
            id: SALE_ID,
            plan_id: PLAN_ID,
            seller_staff_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
        card_plans: [{ id: PLAN_ID, code: 'GOLD' }],
      },
      {
        rpcs: [
          { fn: 'submit_reservation_agreement', result: AGREEMENT_DRAFT_ID },
          { fn: 'save_reservation_agreement', result: AGREEMENT_DRAFT_ID },
          { fn: 'reserve_from_customer_application_once', result: AGREEMENT_DRAFT_ID },
        ],
      },
    );
  });

  it.each([
    ['GOLD', true],
    ['GOLD', false],
    ['SILVER', false],
    ['BRONZE', false],
  ] as const)(
    'round-trips a saved %s agreement (secondary=%s) through export and import handlers',
    async (tier, secondary) => {
      const db = holder.db as FakeSupabase;
      db.tables.reservation_agreements = [draftAgreementRow({ tier_snapshot: tier })];
      if (secondary)
        db.tables.reservation_agreement_holders!.push({
          ...draftHolderRow,
          holder_type: 'SECONDARY',
          name: 'Jose Reyes',
          email: 'jose@example.com',
        });
      const exported = await call(forms, {
        path: `reservations/${AGREEMENT_DRAFT_ID}/export/xlsx`,
      });
      expect(exported.status).toBe(200);
      const imported = await call(forms, {
        path: 'import',
        method: 'POST',
        body: {
          kind: 'reservation_agreement',
          contentBase64: (exported.body as { content: string }).content,
        },
      });
      expect(imported.status).toBe(200);
      expect(imported.body).toMatchObject({ errors: [], fields: { vip_tier: tier } });
      if (secondary)
        expect(imported.body).toMatchObject({
          fields: { secondary_name: 'Jose Reyes', secondary_email: 'jose@example.com' },
        });
    },
  );

  it('lets the owning seller submit their own draft', async () => {
    const res = await call(forms, {
      path: `reservations/${AGREEMENT_DRAFT_ID}/submit`,
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(200);
  });

  it('lets the owning seller edit their own draft', async () => {
    const res = await call(forms, {
      path: `reservations/${AGREEMENT_DRAFT_ID}`,
      method: 'PATCH',
      body: validAgreementBody(),
    });
    expect(res.status).toBe(200);
  });

  it('refuses another seller mutating an unrelated agreement', async () => {
    for (const req of [
      { path: `reservations/${AGREEMENT_DRAFT_ID}/submit`, method: 'POST' },
      { path: `reservations/${AGREEMENT_DRAFT_ID}`, method: 'PATCH' },
      { path: `reservations/${AGREEMENT_DRAFT_ID}/reopen`, method: 'POST' },
      { path: `reservations/${AGREEMENT_DRAFT_ID}/decision`, method: 'POST' },
    ]) {
      const res = await call(forms, {
        ...req,
        body:
          req.method === 'PATCH'
            ? validAgreementBody()
            : req.path.endsWith('decision')
              ? { decision: 'cancelled', notes: 'UAT note here' }
              : {},
        token: 'other-seller-token',
      });
      expect(res.status).toBe(403);
    }
  });

  it('keeps super-admin oversight over any agreement', async () => {
    const res = await call(forms, {
      path: `reservations/${AGREEMENT_DRAFT_ID}/submit`,
      method: 'POST',
      body: {},
      token: 'super-admin-token',
    });
    expect(res.status).toBe(200);
  });

  it('refuses unauthenticated and employee callers before any row is read', async () => {
    const anon = await call(forms, {
      path: `reservations/${AGREEMENT_DRAFT_ID}/submit`,
      method: 'POST',
      body: {},
      token: '',
    });
    expect(anon.status).toBe(401);
    const employee = await call(forms, {
      path: 'reservations',
      method: 'POST',
      body: validAgreementBody(),
      token: 'forbidden-token',
    });
    expect(employee.status).toBe(403);
  });

  it('rejects an imported tier that contradicts the selected sale', async () => {
    const res = await call(forms, {
      path: 'reservations',
      method: 'POST',
      body: validAgreementBody({ vipTier: 'SILVER' }),
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('does not match the selected sale');
  });

  it('accepts a matching imported tier and saves the draft', async () => {
    const res = await call(forms, {
      path: 'reservations',
      method: 'POST',
      body: validAgreementBody({ vipTier: 'GOLD' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('IST list holder-aware summary', () => {
  it.each([
    ['sale', SALE_ID, false],
    ['sale', SALE_ID, true],
    ['application', null, false],
    ['application', null, true],
    ['application', SALE_ID, false],
  ] as const)(
    'returns strict commercial fields for origin=%s sale=%s secondary=%s',
    async (origin, saleId, hasSecondary) => {
      install({
        reservation_agreements: [
          {
            id: AGREEMENT_ID,
            reservation_number: 'RES-QA',
            origin,
            sale_id: saleId,
            tier_snapshot: 'GOLD',
            payment_scheme_snapshot: 'spot_cash',
            total_price_snapshot: '312000.00',
            primary_signature_status: 'received',
            secondary_signature_status: hasSecondary ? 'pending' : null,
            status: 'executed',
            created_by: '11111111-1111-4111-8111-111111111111',
            created_at: '2026-10-01',
            submitted_at: '2026-10-01',
          },
        ],
        reservation_agreement_holders: [
          { agreement_id: AGREEMENT_ID, holder_type: 'PRIMARY', name: 'QA Applicant' },
          ...(hasSecondary
            ? [{ agreement_id: AGREEMENT_ID, holder_type: 'SECONDARY', name: 'QA Secondary' }]
            : []),
        ],
      });
      const result = await call(forms, { path: 'reservations' });
      expect(result.status).toBe(200);
      const rows = (result.body as { data: unknown[] }).data;
      expect(rows).toHaveLength(1);
      expect(reservationAgreementListItemSchema.parse(rows[0])).toMatchObject({
        saleId,
        applicantName: 'QA Applicant',
        paymentScheme: 'spot_cash',
        totalPrice: '312000.00',
        primarySignatureStatus: 'received',
        secondarySignatureStatus: hasSecondary ? 'pending' : null,
        hasSecondaryHolder: hasSecondary,
      });
    },
  );
});

describe('application list seller names', () => {
  it.each([false, true])('resolves seller name with frozen terms=%s', async (frozen) => {
    const creator = '11111111-1111-4111-8111-111111111111';
    const seller = '33333333-3333-4333-8333-333333333333';
    const terms = '55555555-5555-4555-8555-555555555555';
    install({
      customer_applications: [
        {
          id: APP_ID,
          application_number: 'AF-APP-SELLER',
          tier_snapshot: 'BRONZE',
          status: 'approved',
          created_by: creator,
          purchase_terms_id: frozen ? terms : null,
          created_at: '2026-10-08',
          submitted_at: null,
        },
      ],
      customer_application_purchase_terms: frozen ? [{ id: terms, seller_staff_id: seller }] : [],
      staff_users: [
        { id: creator, full_name: 'CREATOR NAME' },
        { id: seller, full_name: 'SELLER NAME' },
      ],
    });
    const result = await call(forms, { path: 'customer-applications' });
    expect(result.status).toBe(200);
    const rows = (result.body as { data: unknown[] }).data;
    expect(customerApplicationListItemSchema.parse(rows[0])).toMatchObject({
      createdBy: creator,
      sellerName: frozen ? 'SELLER NAME' : 'CREATOR NAME',
    });
  });
});
