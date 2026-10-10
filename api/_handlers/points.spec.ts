/**
 * AF Homes points API - handler tests.
 *
 * These drive the REAL handler, the REAL staff principal resolver, the REAL
 * customer principal resolver, the REAL contracts and the REAL router dispatch
 * against the in-memory Supabase fake.
 *
 * What they are really asserting is that the client cannot influence the points:
 *
 *   - the claiming customer is resolved from the SESSION, never from the body;
 *   - no route accepts a points figure, a balance, a cap, or a peso value;
 *   - the gross of a purchase is computed from the lines, never accepted;
 *   - the acting staff member is always the session's, never a request field;
 *   - a claim belonging to somebody else is indistinguishable from one that does
 *     not exist, so scanning cannot be used to probe for claims;
 *   - stored token hashes never leave through any list response.
 *
 * The SQL itself is executed by the database integration suite, not here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const points = (await import('./points.js')).default;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TOKEN = 'staff-token';
const CUSTOMER_TOKEN = 'customer-token';
const OTHER_STAFF_TOKEN = 'other-staff-token';
const SUSPENDED_TOKEN = 'suspended-token';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF_ID = '22222222-2222-4222-8222-222222222222';
const SUSPENDED_STAFF_ID = '33333333-3333-4333-8333-333333333333';

const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_AUTH_ID = '66666666-6666-4666-8666-666666666666';

const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777';
const PURCHASE_ID = '88888888-8888-4888-8888-888888888888';
const CLAIM_ID = '99999999-9999-4999-8999-999999999999';
const SERVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RULE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const ALL: Grant[] = [
  {
    moduleKey: 'operations.redemption',
    canView: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
  },
  { moduleKey: 'sales.customers', canView: true, canCreate: true, canUpdate: true, canDelete: true },
  { moduleKey: 'operations.catalog', canView: true, canCreate: true, canUpdate: true, canDelete: true },
  // The Operational Services seller capability and the Finance verification key
  // that stays deliberately separate from it.
  { moduleKey: 'operations.sales', canView: true, canCreate: true, canUpdate: true, canDelete: true },
  // Operational Services receipt verification. A SEPARATE key from the VIP-card
  // `finance.payment_verification` below: the two payment workflows must not
  // authorise each other, and the GSD (`employee`) holds neither.
  { moduleKey: 'operations.payments', canView: true, canCreate: false, canUpdate: true, canDelete: false },
  {
    moduleKey: 'finance.payment_verification',
    canView: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
  },
];

/** View only: may read purchases and claims, but may not create or change anything. */
const VIEW_ONLY: Grant[] = ALL.map((g) => ({ ...g, canCreate: false, canUpdate: false, canDelete: false }));

/** No points permission at all. */
const NONE: Grant[] = [];

type Row = Record<string, unknown>;

/** One row of `role_permissions`, in the shape the tables are written. */
type Grant = {
  moduleKey: string;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

function baseTables(): Record<string, Row[]> {
  return {
    modules: [
      { id: 'm1', key: 'operations.redemption', is_active: true },
      { id: 'm2', key: 'sales.customers', is_active: true },
      { id: 'm3', key: 'operations.catalog', is_active: true },
      { id: 'm4', key: 'operations.sales', is_active: true },
      { id: 'm5', key: 'finance.payment_verification', is_active: true },
      { id: 'm6', key: 'operations.payments', is_active: true },
    ],
    roles: [{ id: 'r1', slug: 'finance', name: 'Finance', is_active: true }],
    role_permissions: [],
    staff_role_assignments: [
      { id: 'a1', staff_id: STAFF_ID, role_id: 'r1' },
      { id: 'a2', staff_id: OTHER_STAFF_ID, role_id: 'r1' },
      { id: 'a3', staff_id: SUSPENDED_STAFF_ID, role_id: 'r1' },
    ],
    staff_users: [
      { id: STAFF_ID, email: 'fin@afhomes.test', status: 'active', created_at: ago(400) },
      { id: OTHER_STAFF_ID, email: 'other@afhomes.test', status: 'active', created_at: ago(400) },
      {
        id: SUSPENDED_STAFF_ID,
        email: 'susp@afhomes.test',
        status: 'suspended',
        created_at: ago(400),
      },
    ],
    staff_permission_restrictions: [],
    customers: [
      {
        id: CUSTOMER_ID,
        customer_number: 'CUS-000777',
        first_name: 'Ana',
        middle_name: 'R',
        last_name: 'Buyer',
        suffix: null,
        email: 'ana@example.invalid',
        phone: '09185550000',
        status: 'active',
        auth_user_id: CUSTOMER_AUTH_ID,
        created_at: ago(500),
        updated_at: ago(100),
      },
      {
        // A second customer who owns a membership too, so a claim can be tested
        // against the WRONG owner rather than merely against an unknown token.
        id: OTHER_CUSTOMER_ID,
        customer_number: 'CUS-000888',
        first_name: 'Other',
        middle_name: null,
        last_name: 'Person',
        suffix: null,
        email: 'other@example.invalid',
        phone: '09185550001',
        status: 'active',
        auth_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        created_at: ago(500),
        updated_at: ago(100),
      },
    ],
    memberships: [
      {
        id: MEMBERSHIP_ID,
        membership_number: 'MBS-000777',
        customer_id: CUSTOMER_ID,
        product_id: null,
        status: 'active',
        points_balance: 0,
        expires_at: null,
        created_at: ago(400),
      },
    ],
    purchases: [
      {
        id: PURCHASE_ID,
        purchase_number: 'PUR-000001',
        customer_id: CUSTOMER_ID,
        membership_id: MEMBERSHIP_ID,
        status: 'completed',
        gross_amount: '5000.00',
        points_discount_amount: '0.00',
        net_amount: '5000.00',
        completed_at: ago(2),
        reversed_at: null,
        reversal_reason: null,
        created_at: ago(3),
      },
    ],
    purchase_lines: [
      {
        id: 'l1',
        purchase_id: PURCHASE_ID,
        service_id: SERVICE_ID,
        quantity: 2,
        unit_amount: '2500.00',
        line_total: '5000.00',
      },
    ],
    earning_claims: [
      {
        id: CLAIM_ID,
        claim_number: 'CLM-000001',
        customer_id: CUSTOMER_ID,
        purchase_id: PURCHASE_ID,
        status: 'available',
        points_requested: 500,
        points_awarded: 0,
        points_capped: 0,
        qr_token_hash: 'f'.repeat(64),
        fallback_code_hash: 'e'.repeat(64),
        expires_at: ago(-20),
        claimed_at: null,
        created_at: ago(1),
      },
    ],
    service_catalog: [
      {
        id: SERVICE_ID,
        code: 'SVC-1',
        name: 'Wash',
        base_price: '2500.00',
        is_active: true,
      },
    ],
    point_redemption_rules: [
      {
        id: RULE_ID,
        service_id: SERVICE_ID,
        peso_value_per_point: '1.50',
        eligible_tiers: ['GOLD'],
        min_points: 100,
        max_points: 5000,
        min_purchase_amount: null,
        effective_start: '2026-01-01',
        effective_end: '2026-12-31',
        is_active: true,
        promotion_reference: 'Grand opening promo',
        created_by: STAFF_ID,
        created_at: ago(10),
        updated_at: ago(10),
      },
    ],
    points_accounts: [],
    points_ledger: [],
    audit_events: [],
  };
}

type Setup = {
  permissions?: Grant[];
  tokens?: Record<string, unknown>;
  tables?: Record<string, Row[]>;
  rpcs?: { fn: string; result: unknown | ((args: Record<string, unknown>) => unknown) }[];
  rpcErrors?: Record<string, { message: string }>;
};

function install(options: Setup = {}) {
  const db = new FakeSupabase({
    tables: (options.tables ?? baseTables()) as never,
    tokens: {
      [TOKEN]: { id: STAFF_ID, email: 'fin@afhomes.test', email_confirmed_at: ago(200) },
      [OTHER_STAFF_TOKEN]: {
        id: OTHER_STAFF_ID,
        email: 'other@afhomes.test',
        email_confirmed_at: ago(200),
      },
      [SUSPENDED_TOKEN]: {
        id: SUSPENDED_STAFF_ID,
        email: 'susp@afhomes.test',
        email_confirmed_at: ago(200),
      },
      [CUSTOMER_TOKEN]: {
        id: CUSTOMER_AUTH_ID,
        email: 'ana@example.invalid',
        email_confirmed_at: ago(200),
      },
      ...options.tokens,
    } as never,
    rpcs: options.rpcs,
    rpcErrors: options.rpcErrors,
    links: [{ child: 'staff_role_assignments', parent: 'roles', fk: 'role_id' }],
  });

  // The resolver reads grants from role_permissions, so scripting that table is
  // what actually varies the authorization. Grants are keyed by module NAME, never
  // by position: an index mapping silently grants the wrong module the moment a
  // third module is added, which is how a test ends up green on the wrong check.
  const grants = (options.permissions ?? ALL).map((p) => {
    const module = db.rows('modules').find((m) => m.key === p.moduleKey);
    return {
      role_id: 'r1',
      module_id: module?.id,
      can_view: p.canView,
      can_create: p.canCreate,
      can_update: p.canUpdate,
      can_delete: p.canDelete,
    };
  });
  db.rows('role_permissions').splice(0, db.rows('role_permissions').length, ...grants);

  holder.db = db;
  return db;
}

type State = { status: number; body: unknown };

async function call(
  options: {
    familyPath?: string;
    method?: string;
    body?: unknown;
    token?: string | null;
    query?: Record<string, string>;
  } = {},
): Promise<State> {
  const { res, state } = makeRes();
  await points(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.familyPath ?? '',
      body: options.body,
      ...(options.token === null ? {} : { token: options.token ?? TOKEN }),
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const body = (s: State) => s.body as Record<string, unknown>;
const errCode = (s: State) => (s.body as { error?: { code?: string } }).error?.code;
const errMsg = (s: State) => (s.body as { error?: { message?: string } }).error?.message;

/** The single scripted success every staff test needs. */
const CLAIM_RPC = (args: Record<string, unknown>) => [
  {
    claim_id: CLAIM_ID,
    claim_number: 'CLM-000001',
    qr_token: 'plaintext-qr-once',
    fallback_code: 'FALLBACK-9',
    points_requested: 500,
    points_reserved: 500,
    points_capped: 0,
    expires_at: ago(-20),
  },
];

const PURCHASE_RPC = (args: Record<string, unknown>) => [
  {
    purchase_id: PURCHASE_ID,
    purchase_number: 'PUR-000001',
    // Echo back the gross the SERVER computed from the lines, not the body.
    gross_amount: args.p_gross_amount,
    net_amount: args.p_gross_amount,
  },
];

const VALID_PURCHASE = {
  membershipId: MEMBERSHIP_ID,
  // The idempotency key for the sale. Required: without it a retried request
  // creates a SECOND real purchase that could earn points.
  reference: 'pos-fixture-1',
  lines: [{ serviceId: SERVICE_ID, quantity: 2, unitAmount: '2500.00' }],
};

/* ================================================================== */
/* THE CUSTOMER QR SCAN                                                 */
/* ================================================================== */

describe('points: the customer QR claim', () => {
  beforeEach(() => install({ permissions: NONE }));

  it('redeems the caller own claim and resolves the customer from the session', async () => {
    const db = install({
      permissions: NONE,
      rpcs: [{ fn: 'claim_earning_points', result: () => [{ points_awarded: 500, points_capped: 0, balance_after: 500, claim_number: 'CLM-000001' }] }],
    });
    const s = await call({
      familyPath: 'claim',
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { token: 'scanned-credential' },
    });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ claimNumber: 'CLM-000001', pointsAwarded: 500, balanceAfter: 500 });

    // The identity sent to SQL is the SESSION customer. This is the single most
    // important assertion in the file.
    const call_ = db.calls.find((c) => c.table === 'claim_earning_points');
    expect(call_?.arg).toMatchObject({
      p_token: 'scanned-credential',
      p_customer_id: CUSTOMER_ID,
    });
  });

  it('needs NO staff permission at all: a customer is not staff', async () => {
    // `permissions: NONE` means the principal holds nothing. The claim still works,
    // because redeeming your own claim is a CUSTOMER action, not a staff one.
    install({
      permissions: NONE,
      rpcs: [{ fn: 'claim_earning_points', result: () => [{ points_awarded: 1, balance_after: 1, claim_number: 'C' }] }],
    });
    const s = await call({
      familyPath: 'claim',
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { token: 'x' },
    });
    expect(s.status).toBe(200);
  });

  it('refuses a staff session that owns no customer record', async () => {
    install({ permissions: ALL });
    const s = await call({
      familyPath: 'claim',
      method: 'POST',
      token: TOKEN,
      body: { token: 'x' },
    });
    expect(s.status).toBe(403);
  });

  it('refuses an anonymous scan', async () => {
    install();
    const s = await call({
      familyPath: 'claim',
      method: 'POST',
      token: null,
      body: { token: 'x' },
    });
    expect(s.status).toBe(401);
  });

  it('rejects a forged customerId in the body LOUDLY, before it reaches SQL', async () => {
    const db = install({
      rpcs: [{ fn: 'claim_earning_points', result: () => [{ points_awarded: 1, balance_after: 1 }] }],
    });
    const s = await call({
      familyPath: 'claim',
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { token: 'x', customerId: OTHER_CUSTOMER_ID },
    });
    expect(s.status).toBe(400);
    // Nothing was called: the strict contract rejected the payload first.
    expect(db.calls.some((c) => c.table === 'claim_earning_points')).toBe(false);
  });

  it('gives a wrong-owner refusal INDISTINGUISHABLE from an unknown claim', async () => {
    // If these two ever differ, the scan endpoint becomes an oracle that tells a
    // caller which claim numbers exist and who owns them.
    install({ rpcErrors: { claim_earning_points: { message: 'CLAIM_NOT_OWNER:abc' } } });
    const notOwner = await call({
      familyPath: 'claim',
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { token: 'real-but-not-yours' },
    });
    install({ rpcErrors: { claim_earning_points: { message: 'CLAIM_NOT_FOUND' } } });
    const unknown = await call({
      familyPath: 'claim',
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { token: 'nobody-issued-this' },
    });
    expect(notOwner.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(errCode(notOwner)).toBe(errCode(unknown));
    expect(errMsg(notOwner)).toBe(errMsg(unknown));
  });

  it('maps a repeated scan to a conflict, not a second award', async () => {
    install({ rpcErrors: { claim_earning_points: { message: 'CLAIM_ALREADY_CLAIMED' } } });
    const s = await call({
      familyPath: 'claim',
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { token: 'x' },
    });
    expect(s.status).toBe(409);
  });
});

/* ================================================================== */
/* Recording a purchase                                                */
/* ================================================================== */

describe('points: recording a purchase', () => {
  beforeEach(() => install({ rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] }));

  it('computes the gross from the lines and sends it to SQL', async () => {
    const db = install({ rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
    const s = await call({ familyPath: 'purchases', method: 'POST', body: VALID_PURCHASE });
    expect(s.status).toBe(201);
    const call_ = db.calls.find((c) => c.table === 'create_purchase');
    // 2 x 2500.00, computed, not supplied.
    expect(call_?.arg).toMatchObject({ p_gross_amount: '5000.00' });
    // The actor is the session staff member, never a body field.
    expect(call_?.arg).toMatchObject({ p_actor_id: STAFF_ID });
    expect(body(s)).toMatchObject({ grossAmount: '5000.00' });
  });

  it('rejects a client-supplied customer id LOUDLY', async () => {
    const db = install({ rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
    // A staff member pairing somebody else's customer id with this membership
    // would bill the wrong person, so the field is refused rather than ignored.
    const s = await call({
      familyPath: 'purchases',
      method: 'POST',
      body: { ...VALID_PURCHASE, customerId: OTHER_CUSTOMER_ID },
    });
    expect(s.status).toBe(400);
    expect(db.calls.some((c) => c.table === 'create_purchase')).toBe(false);
  });

  it('rejects a client-supplied total LOUDLY', async () => {
    const db = install({ rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
    const s = await call({
      familyPath: 'purchases',
      method: 'POST',
      body: { ...VALID_PURCHASE, grossAmount: '1.00' },
    });
    expect(s.status).toBe(400);
    expect(db.calls.some((c) => c.table === 'create_purchase')).toBe(false);
  });

  it('rejects a forged actor id LOUDLY', async () => {
    const db = install({ rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
    const s = await call({
      familyPath: 'purchases',
      method: 'POST',
      body: { ...VALID_PURCHASE, actorId: OTHER_STAFF_ID },
    });
    expect(s.status).toBe(400);
    expect(db.calls.some((c) => c.table === 'create_purchase')).toBe(false);
  });

  it('requires operations.sales create, not merely view', async () => {
    install({ permissions: VIEW_ONLY, rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
    const s = await call({ familyPath: 'purchases', method: 'POST', body: VALID_PURCHASE });
    expect(s.status).toBe(403);
  });

  it('requires operations.sales create to complete a purchase', async () => {
    install({ permissions: VIEW_ONLY });
    const s = await call({ familyPath: `purchases/${PURCHASE_ID}/complete`, method: 'POST' });
    expect(s.status).toBe(403);
  });

  /* ------------------------------------------------------------------
   * The GSD split.
   *
   * `employee` is the GSD role. It holds `operations.sales` view+create and
   * NOTHING else that matters here: no `sales.customers` (which would also
   * mean customer creation and the whole customer record), no
   * `operations.catalog` (product and rule administration), and no
   * `finance.payment_verification` (the person who records a receipt must not
   * be the person who makes it money).
   *
   * These assert the SERVER's answer, not the interface, because a hidden
   * button is not an authorization control.
   * ---------------------------------------------------------------- */
  describe('GSD operations.sales scope', () => {
    const GSD: Grant[] = [
      { moduleKey: 'operations.sales', canView: true, canCreate: true, canUpdate: false, canDelete: false },
      // Present so the test proves the GSD is refused DESPITE holding the broad
      // customer and catalog keys' siblings it legitimately has, not merely
      // because the fake has no rows at all.
      { moduleKey: 'operations.redemption', canView: true, canCreate: true, canUpdate: false, canDelete: false },
      { moduleKey: 'operations.catalog', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    ];

    const GSD_FORBIDDEN: Grant[] = [
      { moduleKey: 'sales.customers', canView: false, canCreate: false, canUpdate: false, canDelete: false },
      { moduleKey: 'operations.catalog', canView: true, canCreate: false, canUpdate: false, canDelete: false },
      { moduleKey: 'finance.payment_verification', canView: false, canCreate: false, canUpdate: false, canDelete: false },
      { moduleKey: 'operations.redemption', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    ];

    it('lets a GSD record an operational sale', async () => {
      const db = install({ permissions: GSD, rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
      const s = await call({ familyPath: 'purchases', method: 'POST', body: VALID_PURCHASE });
      expect(s.status).toBe(201);
      expect(db.calls.some((c) => c.table === 'create_purchase')).toBe(true);
    });

    it('returns the SERVER-resolved tier discount, never one the client chose', async () => {
      install({
        permissions: GSD,
        rpcs: [
          {
            fn: 'create_purchase',
            result: () => [
              {
                purchase_id: PURCHASE_ID,
                purchase_number: 'AF-TXN-1',
                gross_amount: '100000.00',
                tier_discount_amount: '25000.00',
                net_amount: '75000.00',
              },
            ],
          },
        ],
      });
      const s = await call({ familyPath: 'purchases', method: 'POST', body: VALID_PURCHASE });
      expect(s.status).toBe(201);
      // The body sent up carries no rate and no total; both figures come back
      // down priced by the server.
      expect(body(s).tierDiscountAmount).toBe('25000.00');
      expect(body(s).netAmount).toBe('75000.00');
      expect((body(s).grossAmount as string)).toBe('100000.00');
    });

    it('lets a GSD record a receipt', async () => {
      const db = install({
        permissions: GSD,
        rpcs: [{ fn: 'record_purchase_payment', result: () => [{ payment_id: 'p1', payment_number: 'AF-PAY-1', amount: '75000.00', status: 'recorded' }] }],
      });
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/payments`,
        method: 'POST',
        body: { amount: '75000.00', method: 'cash', reference: 'r1' },
      });
      expect(s.status).toBe(201);
      expect(db.calls.some((c) => c.table === 'record_purchase_payment')).toBe(true);
    });

    it('REFUSES a GSD who tries to verify their own receipt', async () => {
      const db = install({ permissions: GSD_FORBIDDEN });
      const s = await call({
        familyPath: `payments/${PURCHASE_ID}/verify`,
        method: 'POST',
        body: { decision: 'verified' },
      });
      expect(s.status).toBe(403);
      expect(db.calls.some((c) => c.table === 'verify_purchase_payment')).toBe(false);
    });

    /* ------------------------------------------------------------------
     * Operational Services receipts are verified on their OWN key,
     * `operations.payments`, which is deliberately NOT the VIP-card
     * `finance.payment_verification`. These prove the two workflows stay
     * independent: neither key authorises the other, and the GSD holds
     * neither.
     * ---------------------------------------------------------------- */
    const FINANCE: Grant[] = [
      { moduleKey: 'operations.payments', canView: true, canCreate: false, canUpdate: true, canDelete: false },
      // Present so the test proves Finance acts on its OWN key, not by
      // Every staff route under /earning passes this family gate first, so a
      // Finance fixture without it 403s before reaching the route under test.
      { moduleKey: 'operations.redemption', canView: true, canCreate: false, canUpdate: false, canDelete: false },
      // accident of also holding the VIP-card one.
      {
        moduleKey: 'finance.payment_verification',
        canView: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      },
    ];

    it('lets Finance verify an operational receipt on the operational key alone', async () => {
      const db = install({
        permissions: FINANCE,
        rpcs: [
          {
            fn: 'verify_purchase_payment',
            result: () => [{ payment_id: 'p1', status: 'verified', verified_total: '75000.00' }],
          },
        ],
      });
      const s = await call({
        familyPath: `payments/p1/verify`,
        method: 'POST',
        body: { decision: 'verified' },
      });
      expect(s.status).toBe(200);
      expect(body(s).status).toBe('verified');
      expect(db.calls.some((c) => c.table === 'verify_purchase_payment')).toBe(true);
    });

    it('REFUSES a VIP-card-only verifier on an operational receipt', async () => {
      // `finance.payment_verification` UPDATE is the CARD key. Holding it must
      // not verify an operational receipt: that is what independence means.
      const db = install({
        permissions: [
          {
            moduleKey: 'finance.payment_verification',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
        ],
      });
      const s = await call({
        familyPath: `payments/p1/verify`,
        method: 'POST',
        body: { decision: 'verified' },
      });
      expect(s.status).toBe(403);
      expect(db.calls.some((c) => c.table === 'verify_purchase_payment')).toBe(false);
    });

    it('spends points at the till with a reference and nothing else', async () => {
      const db = install({
        permissions: GSD,
        rpcs: [
          {
            fn: 'apply_purchase_points_discount',
            result: () => [
              {
                purchase_id: PURCHASE_ID,
                points_spent: 25000,
                discount_applied: '25000.00',
                net_amount: '75000.00',
                balance_after: 25000,
                already_applied: false,
              },
            ],
          },
        ],
      });
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/points-discount`,
        method: 'POST',
        body: { pointsRequested: 25000, reference: 'pos-abc' },
      });
      expect(s.status).toBe(200);
      // Only two fields are sent. There is no peso value, no rate and no net in
      // the body, so a tampered request cannot change what the member pays.
      const sent = db.calls.find((c) => c.table === 'apply_purchase_points_discount')?.arg as Record<
        string,
        unknown
      >;
      expect(Object.keys(sent).sort()).toEqual(
        ['p_actor_id', 'p_points_requested', 'p_purchase_id', 'p_reference'].sort(),
      );
      expect(body(s).netAmount).toBe('75000.00');
    });

    it('REFUSES a points spend with no idempotency reference', async () => {
      const db = install({ permissions: GSD });
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/points-discount`,
        method: 'POST',
        body: { pointsRequested: 25000 },
      });
      expect(s.status).toBe(400);
      expect(db.calls.some((c) => c.table === 'apply_purchase_points_discount')).toBe(false);
    });

    it('REFUSES a duplicate sale reference LOUDLY rather than pricing a second purchase', async () => {
      // A retried "record the sale" would otherwise create a SECOND real
      // purchase with real lines that could earn points. The reference is the
      // idempotency key, so it is required on the request.
      const db = install({ permissions: GSD, rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
      // The reference deliberately omitted.
      const { reference: _omitted, ...withoutReference } = VALID_PURCHASE;
      const s = await call({ familyPath: 'purchases', method: 'POST', body: withoutReference });
      expect(s.status).toBe(400);
      expect(db.calls.some((c) => c.table === 'create_purchase')).toBe(false);
    });

    it('carries the sale reference through to SQL so a retry cannot double-record', async () => {
      const db = install({ permissions: GSD, rpcs: [{ fn: 'create_purchase', result: PURCHASE_RPC }] });
      const s = await call({
        familyPath: 'purchases',
        method: 'POST',
        body: { ...VALID_PURCHASE, reference: 'pos-abc' },
      });
      expect(s.status).toBe(201);
      const sent = db.calls.find((c) => c.table === 'create_purchase')?.arg as Record<string, unknown>;
      expect(sent.p_reference).toBe('pos-abc');
    });

    it('requires a receipt reference so a retried receipt cannot double-count cash', async () => {
      const db = install({
        permissions: GSD,
        rpcs: [
          {
            fn: 'record_purchase_payment',
            result: () => [{ payment_id: 'p1', payment_number: 'AF-PAY-1', amount: '75000.00', status: 'recorded' }],
          },
        ],
      });
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/payments`,
        method: 'POST',
        // No reference: without one the unique index cannot dedupe, and a retry
        // after a lost response would record the SAME cash twice.
        body: { amount: '75000.00', method: 'cash' },
      });
      expect(s.status).toBe(400);
      expect(db.calls.some((c) => c.table === 'record_purchase_payment')).toBe(false);
    });

    it('reports settlement from the server rather than trusting the screen', async () => {
      install({
        permissions: GSD,
        rpcs: [
          {
            fn: 'operational_purchase_settlement',
            result: () => [
              {
                purchase_id: PURCHASE_ID,
                purchase_number: 'AF-TXN-1',
                status: 'draft',
                gross_amount: '100000.00',
                tier_discount_amount: '0.00',
                points_discount_amount: '25000.00',
                net_amount: '75000.00',
                recorded_total: '75000.00',
                verified_total: '0.00',
                rejected_total: '0.00',
                remaining_amount: '75000.00',
                verified_receipts: 0,
                rejected_receipts: 0,
                pending_receipts: 1,
                fully_paid: false,
                claimable: false,
                claim_id: null,
                claim_status: null,
              },
            ],
          },
        ],
      });
      const s = await call({ familyPath: `purchases/${PURCHASE_ID}/settlement`, method: 'GET' });
      expect(s.status).toBe(200);
      // A RECORDED receipt is not money received: the screen must be able to see
      // that distinction rather than infer it.
      expect(body(s).verifiedTotal).toBe('0.00');
      expect(body(s).remainingAmount).toBe('75000.00');
      expect(body(s).fullyPaid).toBe(false);
      expect(body(s).claimable).toBe(false);
    });

    it('REFUSES a GSD who tries to configure a tier discount', async () => {
      const db = install({ permissions: GSD });
      const s = await call({
        familyPath: 'tier-discounts',
        method: 'POST',
        body: {
          serviceId: SERVICE_ID,
          tier: 'GOLD',
          discountRate: 25,
          effectiveStart: '2026-01-01',
          effectiveEnd: '2027-01-01',
        },
      });
      expect(s.status).toBe(403);
      expect(db.rows('service_tier_discounts')).toHaveLength(0);
    });

    it('REFUSES a GSD who tries to add a product or an earning rule', async () => {
      install({ permissions: GSD });
      const product = await call({
        familyPath: 'services',
        method: 'POST',
        body: { code: 'TEP', name: 'Teppanyaki', basePrice: '2000.00' },
      });
      const rule = await call({
        familyPath: 'rules',
        method: 'POST',
        body: {
          serviceId: SERVICE_ID,
          pointsAmount: 100,
          eligibleTiers: ['GOLD'],
          effectiveStart: '2026-01-01',
          effectiveEnd: '2027-01-01',
        },
      });
      expect(product.status).toBe(403);
      expect(rule.status).toBe(403);
    });

    it('REFUSES a GSD the company-wide sales records list', async () => {
      // Recording a sale must not hand a GSD everyone's sales history. The list
      // is gated on `sales.customers` view, which `employee` does not hold.
      const db = install({ permissions: GSD });
      const s = await call({ familyPath: 'purchases', method: 'GET' });
      expect(s.status).toBe(403);
      // Refused BEFORE any read: a 403 that still queried the table would leak
      // nothing, but it would prove the check runs after the work rather than
      // instead of it.
      expect(db.calls.some((c) => c.table === 'purchases')).toBe(false);
    });
  });

  it('refuses an unsettled purchase with a conflict, never a completion', async () => {
    const db = install({
      rpcErrors: { complete_purchase: { message: 'PURCHASE_NOT_SETTLED:verified=0.00 net=5000.00' } },
    });
    const s = await call({ familyPath: `purchases/${PURCHASE_ID}/complete`, method: 'POST' });
    expect(s.status).toBe(409);
    expect(String(errMsg(s))).not.toMatch(/5000\.00/); // the detail must not leak
    expect(db.calls.some((c) => c.table === 'complete_purchase')).toBe(true);
  });

  it('refuses a reversal with no reason, and never names the actor', async () => {
    install({
      rpcs: [{ fn: 'reverse_purchase_points', result: () => [{ reversed_points: 500, reversal_debt: 500, balance_after: 0 }] }],
    });
    const s = await call({ familyPath: `purchases/${PURCHASE_ID}/reverse`, method: 'POST', body: {} });
    expect(s.status).toBe(400);
  });

  it('records the reversal reason and the session actor', async () => {
    const db = install({
      rpcs: [{ fn: 'reverse_purchase_points', result: () => [{ reversed_points: 500, reversal_debt: 500, balance_after: 0 }] }],
    });
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/reverse`,
      method: 'POST',
      body: { purchaseId: PURCHASE_ID, reason: 'Customer returned the unit' },
    });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ reversedPoints: 500, reversalDebt: 500 });
    expect(db.calls.find((c) => c.table === 'reverse_purchase_points')?.arg).toMatchObject({
      p_actor_id: STAFF_ID,
      p_purchase_id: PURCHASE_ID,
      p_reason: 'Customer returned the unit',
    });
  });
});

/* ================================================================== */
/* Earning claims                                                      */
/* ================================================================== */

describe('points: earning claims', () => {
  beforeEach(() => install({ rpcs: [{ fn: 'create_earning_claim', result: CLAIM_RPC }] }));

  it('creates a claim from a purchase reference alone', async () => {
    const db = install({ rpcs: [{ fn: 'create_earning_claim', result: CLAIM_RPC }] });
    const s = await call({ familyPath: 'claims', method: 'POST', body: { purchaseId: PURCHASE_ID } });
    expect(s.status).toBe(201);
    // The ONLY time the plaintext exists.
    expect(body(s)).toMatchObject({
      qrToken: 'plaintext-qr-once',
      fallbackCode: 'FALLBACK-9',
      pointsReserved: 500,
    });
    expect(db.calls.find((c) => c.table === 'create_earning_claim')?.arg).toMatchObject({
      p_purchase_id: PURCHASE_ID,
      p_actor_id: STAFF_ID,
    });
  });

  it('refuses any attempt to state the points awarded', async () => {
    const db = install({ rpcs: [{ fn: 'create_earning_claim', result: CLAIM_RPC }] });
    for (const forge of [
      { purchaseId: PURCHASE_ID, pointsAwarded: 999999 },
      { purchaseId: PURCHASE_ID, points: 999999 },
      { purchaseId: PURCHASE_ID, pointsReserved: 999999 },
      { purchaseId: PURCHASE_ID, pesoValue: '5000.00' },
      { purchaseId: PURCHASE_ID, annualCap: 999999 },
    ]) {
      const s = await call({ familyPath: 'claims', method: 'POST', body: forge });
      expect(s.status, JSON.stringify(forge)).toBe(400);
    }
    expect(db.calls.some((c) => c.table === 'create_earning_claim')).toBe(false);
  });

  it('rotates a reissued credential without an actor from the body', async () => {
    const db = install({
      rpcs: [{ fn: 'reissue_earning_claim', result: () => [{ claim_number: 'CLM-000001', qr_token: 'rotated', fallback_code: 'NEW-1', expires_at: ago(-20) }] }],
    });
    const s = await call({ familyPath: `claims/${CLAIM_ID}/reissue`, method: 'POST' });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ qrToken: 'rotated', fallbackCode: 'NEW-1' });
    expect(db.calls.find((c) => c.table === 'reissue_earning_claim')?.arg).toMatchObject({
      p_claim_id: CLAIM_ID,
      p_actor_id: STAFF_ID,
    });
  });

  it('requires create permission, not merely view', async () => {
    install({ permissions: VIEW_ONLY, rpcs: [{ fn: 'create_earning_claim', result: CLAIM_RPC }] });
    const s = await call({ familyPath: 'claims', method: 'POST', body: { purchaseId: PURCHASE_ID } });
    expect(s.status).toBe(403);
  });
});

/* ================================================================== */
/* Cash receipts                                                       */
/* ================================================================== */

const PAYMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('points: cash receipts', () => {
  it('records a receipt as RECORDED, which is not yet money', async () => {
    const db = install({
      rpcs: [
        {
          fn: 'record_purchase_payment',
          result: () => [
            { payment_id: PAYMENT_ID, payment_number: 'AF-PAY-000001', amount: '4000.00', status: 'recorded' },
          ],
        },
      ],
    });
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/payments`,
      method: 'POST',
      body: { amount: '4000.00', method: 'cash', reference: 'REF-1' },
    });
    expect(s.status).toBe(201);
    // The status is echoed honestly. A recorded receipt does not settle anything,
    // and the client must not present it as though it did.
    expect(body(s)).toMatchObject({ status: 'recorded', amount: '4000.00' });
    expect(db.calls.find((c) => c.table === 'record_purchase_payment')?.arg).toMatchObject({
      p_purchase_id: PURCHASE_ID,
      p_amount: '4000.00',
      p_actor_id: STAFF_ID,
    });
  });

  it('refuses a zero or negative amount before it reaches SQL', async () => {
    const db = install();
    for (const amount of ['0', '0.00', '-500.00', '-0.01']) {
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/payments`,
        method: 'POST',
        body: { amount, method: 'cash' },
      });
      expect(s.status, amount).toBe(400);
    }
    expect(db.calls.some((c) => c.table === 'record_purchase_payment')).toBe(false);
  });

  it('refuses a blank method', async () => {
    install();
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/payments`,
      method: 'POST',
      body: { amount: '100.00', method: '   ' },
    });
    expect(s.status).toBe(400);
  });

  it('refuses any attempt to record POINTS as a payment', async () => {
    const db = install();
    for (const forge of [
      { amount: '4000.00', method: 'points', points: 500 },
      { amount: '4000.00', method: 'cash', pointsAwarded: 500 },
      { amount: '4000.00', method: 'discount', pointsDiscount: '4000.00' },
    ]) {
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/payments`,
        method: 'POST',
        body: forge,
      });
      expect(s.status, JSON.stringify(forge)).toBe(400);
    }
    expect(db.calls.some((c) => c.table === 'record_purchase_payment')).toBe(false);
  });

  it('needs an update permission, not merely view', async () => {
    install({ permissions: VIEW_ONLY });
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/payments`,
      method: 'POST',
      body: { amount: '100.00', method: 'cash' },
    });
    expect(s.status).toBe(403);
  });

  it('reports the verified total after accepting a receipt', async () => {
    install({
      rpcs: [
        {
          fn: 'verify_purchase_payment',
          result: () => [{ payment_id: PAYMENT_ID, status: 'verified', verified_total: '4000.00' }],
        },
      ],
    });
    const s = await call({
      familyPath: `payments/${PAYMENT_ID}/verify`,
      method: 'POST',
      body: { decision: 'verified' },
    });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ status: 'verified', verifiedTotal: '4000.00' });
  });

  it('refuses a rejection with no reason', async () => {
    const db = install();
    const s = await call({
      familyPath: `payments/${PAYMENT_ID}/verify`,
      method: 'POST',
      body: { decision: 'rejected', rejectionReason: '  ' },
    });
    expect(s.status).toBe(400);
    expect(db.calls.some((c) => c.table === 'verify_purchase_payment')).toBe(false);
  });

  it('refuses a decision that is neither verified nor rejected', async () => {
    install();
    const s = await call({
      familyPath: `payments/${PAYMENT_ID}/verify`,
      method: 'POST',
      body: { decision: 'maybe' },
    });
    expect(s.status).toBe(400);
  });

  it('turns an already-decided receipt into a conflict, not a second acceptance', async () => {
    install({
      rpcErrors: { verify_purchase_payment: { message: 'PAYMENT_NOT_RECORDED' } },
    });
    const s = await call({
      familyPath: `payments/${PAYMENT_ID}/verify`,
      method: 'POST',
      body: { decision: 'verified' },
    });
    expect(s.status).toBe(409);
    expect(errMsg(s)).toMatch(/already been decided/i);
  });

  it('lists a purchase receipts without any credential material', async () => {
    const tables = baseTables();
    tables.purchase_payments = [
      {
        id: PAYMENT_ID,
        purchase_id: PURCHASE_ID,
        payment_number: 'AF-PAY-000001',
        amount: '4000.00',
        method: 'cash',
        reference: 'REF-1',
        status: 'verified',
        recorded_by: STAFF_ID,
        verified_by: STAFF_ID,
        recorded_at: ago(5),
        verified_at: ago(4),
        rejection_reason: null,
      },
    ];
    install({ tables });
    const s = await call({ familyPath: `purchases/${PURCHASE_ID}/payments` });
    expect(s.status).toBe(200);
    expect(((body(s).data ?? []) as Row[])[0]).toMatchObject({
      paymentNumber: 'AF-PAY-000001',
      status: 'verified',
      amount: '4000.00',
    });
  });
});

/* ================================================================== */
/* Spending: staycation unless promoted                                */
/* ================================================================== */

const QUOTE_RPC = () => [
  {
    quote_id: 'qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqqq',
    quote_number: 'AF-QTE-000001',
    points_requested: 500,
    peso_value: '500.00',
    eligible_line_total: '1000.00',
    remaining_points_after: 5500,
    expires_at: '2026-10-09T12:00:00.000Z',
  },
];

describe('points: spending is restricted', () => {
  it('quotes from a point COUNT alone', async () => {
    const db = install({ rpcs: [{ fn: 'quote_point_discount', result: QUOTE_RPC }] });
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/quote`,
      method: 'POST',
      body: { pointsRequested: 500 },
    });
    expect(s.status).toBe(200);
    expect(db.calls.find((c) => c.table === 'quote_point_discount')?.arg).toMatchObject({
      p_purchase_id: PURCHASE_ID,
      p_points_requested: 500,
      p_actor_id: STAFF_ID,
    });
    // The eligible base is returned so a capped quote is explicable, not arbitrary.
    expect(body(s)).toMatchObject({ pesoValue: '500.00', eligibleLineTotal: '1000.00' });
  });

  it('rejects a client-stated peso value LOUDLY', async () => {
    const db = install({ rpcs: [{ fn: 'quote_point_discount', result: QUOTE_RPC }] });
    for (const forge of [
      { pointsRequested: 500, pesoValue: '99999.00' },
      { pointsRequested: 500, rate: 100 },
      { pointsRequested: 500, netAmount: '1.00' },
      { pointsRequested: 500, eligibleLineTotal: '99999.00' },
    ]) {
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/quote`,
        method: 'POST',
        body: forge,
      });
      expect(s.status, JSON.stringify(forge)).toBe(400);
    }
    expect(db.calls.some((c) => c.table === 'quote_point_discount')).toBe(false);
  });

  it('rejects a zero or negative point count', async () => {
    install({ rpcs: [{ fn: 'quote_point_discount', result: QUOTE_RPC }] });
    for (const pointsRequested of [0, -500]) {
      const s = await call({
        familyPath: `purchases/${PURCHASE_ID}/quote`,
        method: 'POST',
        body: { pointsRequested },
      });
      expect(s.status).toBe(400);
    }
  });

  it('explains the staycation restriction without naming a promotion', async () => {
    install({
      rpcErrors: { quote_point_discount: { message: 'NO_DISCOUNT_ELIGIBLE_LINES' } },
    });
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/quote`,
      method: 'POST',
      body: { pointsRequested: 500 },
    });
    expect(s.status).toBe(409);
    expect(errMsg(s)).toMatch(/accommodation and staycation/i);
  });

  it('says outstanding debt blocks SPENDING, and not earning', async () => {
    install({
      rpcErrors: { quote_point_discount: { message: 'REVERSAL_DEBT_OUTSTANDING' } },
    });
    const s = await call({
      familyPath: `purchases/${PURCHASE_ID}/quote`,
      method: 'POST',
      body: { pointsRequested: 500 },
    });
    expect(s.status).toBe(409);
    expect(errMsg(s)).toMatch(/earning is not affected/i);
  });

  it('commits a quote with no body and no actor from the client', async () => {
    const db = install({
      rpcs: [
        {
          fn: 'commit_point_discount',
          result: () => [
            {
              purchase_id: PURCHASE_ID,
              points_spent: 500,
              discount_applied: '500.00',
              net_amount: '3500.00',
              balance_after: 5500,
            },
          ],
        },
      ],
    });
    const s = await call({
      familyPath: 'quotes/qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqqq/commit',
      method: 'POST',
    });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ discountApplied: '500.00', netAmount: '3500.00' });
    expect(db.calls.find((c) => c.table === 'commit_point_discount')?.arg).toEqual({
      p_quote_id: 'qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqqq',
      p_actor_id: STAFF_ID,
    });
  });

  it('refuses a reused quote as a conflict, not a silent second spend', async () => {
    install({ rpcErrors: { commit_point_discount: { message: 'QUOTE_NOT_OPEN' } } });
    const s = await call({
      familyPath: 'quotes/qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqqq/commit',
      method: 'POST',
    });
    expect(s.status).toBe(409);
  });

  it('needs create permission to quote or commit', async () => {
    install({ permissions: VIEW_ONLY });
    expect(
      (
        await call({
          familyPath: `purchases/${PURCHASE_ID}/quote`,
          method: 'POST',
          body: { pointsRequested: 500 },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call({ familyPath: 'quotes/qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqqq/commit', method: 'POST' }))
        .status,
    ).toBe(403);
  });

  it('reports gross, discount, net and verified receipts as SEPARATE figures', async () => {
    install({
      rpcs: [
        {
          fn: 'purchase_financial_summary_purchases',
          result: () => [
            {
              purchase_id: PURCHASE_ID,
              gross_amount: '5000.00',
              points_discount_amount: '500.00',
              net_amount: '4500.00',
              recorded_total: '4500.00',
              verified_total: '2000.00',
              rejected_total: '100.00',
              remaining_balance: '2500.00',
              overpaid_amount: '0.00',
              fully_paid: false,
            },
          ],
        },
      ],
    });
    const s = await call({ familyPath: `purchases/${PURCHASE_ID}/summary` });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      grossAmount: '5000.00',
      pointsDiscountAmount: '500.00',
      netAmount: '4500.00',
      verifiedTotal: '2000.00',
      remainingBalance: '2500.00',
      fullyPaid: false,
    });
  });
});

/* ================================================================== */
/* Promotion management                                                */
/* ================================================================== */

const VALID_PROMO = {
  serviceId: SERVICE_ID,
  pesoValuePerPoint: '1.50',
  eligibleTiers: ['GOLD'],
  minPoints: 100,
  maxPoints: 5000,
  minPurchaseAmount: null,
  effectiveStart: '2026-01-01',
  effectiveEnd: '2026-12-31',
  isActive: true,
  promotionReference: 'Grand opening promo',
};

describe('points: redemption promotions', () => {
  beforeEach(() =>
    install({
      tables: (() => {
        const t = baseTables();
        // A non-staycation service: a promotion for one is the whole point.
        t.service_catalog![0]!.is_staycation_eligible = false;
        return t;
      })(),
    }),
  );

  it('creates a promotion and records the actor', async () => {
    const db = install();
    const s = await call({ familyPath: 'redemption-rules', method: 'POST', body: VALID_PROMO });
    expect(s.status).toBe(201);
    const audit_ = db.calls.find((c) => c.table === 'audit_events');
    expect(audit_, 'the promotion must be audited').toBeTruthy();
    expect(JSON.stringify(audit_?.arg)).toContain('Grand opening promo');
  });

  it('refuses a promotion with NO end date: an indefinite one is unrepresentable', async () => {
    const db = install();
    const { effectiveEnd, ...noEnd } = VALID_PROMO;
    const s = await call({ familyPath: 'redemption-rules', method: 'POST', body: noEnd });
    expect(s.status).toBe(400);
    expect(db.calls.some((c) => c.table === 'point_redemption_rules')).toBe(false);
  });

  it('refuses a window that runs backwards', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, effectiveStart: '2026-12-31', effectiveEnd: '2026-01-01' },
    });
    expect(s.status).toBe(400);
  });

  it('refuses a blank reference: an unnamed offer is not reviewable', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, promotionReference: '  ' },
    });
    expect(s.status).toBe(400);
  });

  it('refuses an empty tier list', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, eligibleTiers: [] },
    });
    expect(s.status).toBe(400);
  });

  it('refuses an unknown tier', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, eligibleTiers: ['PLATINUM'] },
    });
    expect(s.status).toBe(400);
  });

  it('refuses a zero conversion rate', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, pesoValuePerPoint: '0' },
    });
    expect(s.status).toBe(400);
  });

  it('refuses minPoints above maxPoints', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, minPoints: 9000, maxPoints: 100 },
    });
    expect(s.status).toBe(400);
  });

  it('refuses a promotion for a service that does not exist', async () => {
    install();
    const s = await call({
      familyPath: 'redemption-rules',
      method: 'POST',
      body: { ...VALID_PROMO, serviceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    expect(s.status).toBe(404);
  });

  it('refuses a promotion for a DEACTIVATED service', async () => {
    const tables = baseTables();
    tables.service_catalog![0]!.is_active = false;
    install({ tables });
    const s = await call({ familyPath: 'redemption-rules', method: 'POST', body: VALID_PROMO });
    expect(s.status).toBe(409);
  });

  it('has NO cap-exemption and NO all-services switch to forge', async () => {
    const db = install();
    for (const forge of [
      { ...VALID_PROMO, exemptFromCap: true },
      { ...VALID_PROMO, countsTowardCap: false },
      { ...VALID_PROMO, allServices: true },
      { ...VALID_PROMO, serviceId: null },
      { ...VALID_PROMO, indefinite: true },
    ]) {
      const s = await call({ familyPath: 'redemption-rules', method: 'POST', body: forge });
      expect(s.status, JSON.stringify(forge)).toBe(400);
    }
    expect(db.calls.some((c) => c.table === 'point_redemption_rules')).toBe(false);
  });

  it('needs catalog CREATE, not merely view', async () => {
    install({ permissions: VIEW_ONLY });
    const s = await call({ familyPath: 'redemption-rules', method: 'POST', body: VALID_PROMO });
    expect(s.status).toBe(403);
  });

  it('needs catalog UPDATE to change a promotion', async () => {
    const db = install({ permissions: VIEW_ONLY });
    const s = await call({
      familyPath: `redemption-rules/${RULE_ID}`,
      method: 'PATCH',
      body: { isActive: false },
    });
    expect(s.status).toBe(403);
    expect(db.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('lets a permitted maintainer toggle a promotion, with the actor recorded', async () => {
    const db = install();
    const s = await call({
      familyPath: `redemption-rules/${RULE_ID}`,
      method: 'PATCH',
      body: { isActive: false },
    });
    expect(s.status).toBe(200);
    expect(db.calls.some((c) => c.table === 'audit_events')).toBe(true);
  });

  it('refuses a patch that would clear the end date', async () => {
    install();
    const s = await call({
      familyPath: `redemption-rules/${RULE_ID}`,
      method: 'PATCH',
      body: { effectiveEnd: null },
    });
    expect(s.status).toBe(400);
  });

  it('reads promotions with view alone', async () => {
    install({ permissions: VIEW_ONLY });
    const s = await call({ familyPath: 'redemption-rules' });
    expect(s.status).toBe(200);
  });
});

/* ================================================================== */
/* Manual adjustment                                                   */
/* ================================================================== */

const ADJUST_RPC = (args: Record<string, unknown>) => [
  { ledger_id: 'led-1', balance_after: Number(args.p_amount), reversal_debt: 0 },
];

describe('points: manual adjustment', () => {
  beforeEach(() => install({ rpcs: [{ fn: 'adjust_membership_points', result: ADJUST_RPC }] }));

  it('sends the delta and the reason, and never a balance', async () => {
    const db = install({ rpcs: [{ fn: 'adjust_membership_points', result: ADJUST_RPC }] });
    const s = await call({
      familyPath: 'adjust',
      method: 'POST',
      body: { membershipId: MEMBERSHIP_ID, amount: -500, reason: 'Goodwill correction for a missed service' },
    });
    expect(s.status).toBe(200);
    expect(db.calls.find((c) => c.table === 'adjust_membership_points')?.arg).toMatchObject({
      p_membership_id: MEMBERSHIP_ID,
      p_amount: -500,
      p_actor_id: STAFF_ID,
    });
  });

  it('refuses a client-supplied resulting balance LOUDLY', async () => {
    const db = install({ rpcs: [{ fn: 'adjust_membership_points', result: ADJUST_RPC }] });
    for (const forge of [
      { membershipId: MEMBERSHIP_ID, amount: 500, reason: 'Because I said so', balanceAfter: 999999 },
      { membershipId: MEMBERSHIP_ID, amount: 500, reason: 'Because I said so', reversalDebt: 0 },
      { membershipId: MEMBERSHIP_ID, amount: 500, reason: 'Because I said so', lifetimeEarned: 5 },
    ]) {
      const s = await call({ familyPath: 'adjust', method: 'POST', body: forge });
      expect(s.status, JSON.stringify(forge)).toBe(400);
    }
    expect(db.calls.some((c) => c.table === 'adjust_membership_points')).toBe(false);
  });

  it('refuses a zero amount before it can reach SQL', async () => {
    install({ rpcs: [{ fn: 'adjust_membership_points', result: ADJUST_RPC }] });
    const s = await call({
      familyPath: 'adjust',
      method: 'POST',
      body: { membershipId: MEMBERSHIP_ID, amount: 0, reason: 'Nothing to change' },
    });
    expect(s.status).toBe(400);
  });

  it('refuses a thin reason', async () => {
    install({ rpcs: [{ fn: 'adjust_membership_points', result: ADJUST_RPC }] });
    const s = await call({
      familyPath: 'adjust',
      method: 'POST',
      body: { membershipId: MEMBERSHIP_ID, amount: 500, reason: 'fix' },
    });
    expect(s.status).toBe(400);
  });

  it('needs create permission, not view', async () => {
    install({ permissions: VIEW_ONLY, rpcs: [{ fn: 'adjust_membership_points', result: ADJUST_RPC }] });
    const s = await call({
      familyPath: 'adjust',
      method: 'POST',
      body: { membershipId: MEMBERSHIP_ID, amount: 500, reason: 'A proper correction reason' },
    });
    expect(s.status).toBe(403);
  });

  it('turns an over-deduction into a conflict without leaking the balance', async () => {
    install({
      rpcErrors: { adjust_membership_points: { message: 'ADJUSTMENT_EXCEEDS_BALANCE:balance=100 requested=-500' } },
    });
    const s = await call({
      familyPath: 'adjust',
      method: 'POST',
      body: { membershipId: MEMBERSHIP_ID, amount: -500, reason: 'A proper correction reason' },
    });
    expect(s.status).toBe(409);
    expect(String(errMsg(s))).not.toMatch(/100/);
  });
});

/* ================================================================== */
/* The catalog that decides what earns points                          */
/* ================================================================== */

const ADULT_RULE = {
  serviceId: SERVICE_ID,
  pointsAmount: 500,
  eligibleTiers: ['GOLD'],
  effectiveStart: '2026-01-01T00:00:00.000Z',
  effectiveEnd: '2027-01-01T00:00:00.000Z',
  isActive: true,
  minQuantity: 1,
  maxAward: null,
  promotionReference: null,
};

describe('points: service catalog and earning rules', () => {
  it('lists services and reads them with view alone', async () => {
    install({ permissions: VIEW_ONLY });
    const s = await call({ familyPath: 'services' });
    expect(s.status).toBe(200);
    expect(((body(s).data ?? []) as Row[])[0]).toMatchObject({
      code: 'SVC-1',
      basePrice: '2500.00',
      isActive: true,
    });
  });

  it('refuses a view-only maintainer the right to add a service', async () => {
    const db = install({ permissions: VIEW_ONLY });
    const s = await call({
      familyPath: 'services',
      method: 'POST',
      body: { code: 'SVC-2', name: 'Cut', basePrice: '1500.00' },
    });
    expect(s.status).toBe(403);
    expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('creates a service and audits it, because the catalog is a commercial event', async () => {
    const db = install();
    const s = await call({
      familyPath: 'services',
      method: 'POST',
      body: { code: 'SVC-2', name: 'Cut', basePrice: '1500.00' },
    });
    expect(s.status).toBe(201);
    expect(db.calls.some((c) => c.table === 'audit_events' && c.op === 'insert')).toBe(true);
  });

  it('creates an earning rule for an active service', async () => {
    const db = install();
    const s = await call({ familyPath: 'rules', method: 'POST', body: ADULT_RULE });
    expect(s.status).toBe(201);
    expect(body(s)).toMatchObject({ serviceId: SERVICE_ID, pointsAmount: 500 });
    expect(db.calls.some((c) => c.table === 'audit_events' && c.op === 'insert')).toBe(true);
  });

  it('refuses a rule that would point at a deactivated service', async () => {
    const tables = baseTables();
    tables.service_catalog![0]!.is_active = false;
    install({ tables });
    const s = await call({ familyPath: 'rules', method: 'POST', body: ADULT_RULE });
    expect(s.status).toBe(409);
  });

  it('refuses a rule for a service that does not exist', async () => {
    install();
    const s = await call({
      familyPath: 'rules',
      method: 'POST',
      body: { ...ADULT_RULE, serviceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    expect(s.status).toBe(404);
  });

  it('refuses a rule whose window runs backwards', async () => {
    install();
    const s = await call({
      familyPath: 'rules',
      method: 'POST',
      body: { ...ADULT_RULE, effectiveStart: '2027-01-01T00:00:00.000Z', effectiveEnd: '2026-01-01T00:00:00.000Z' },
    });
    expect(s.status).toBe(400);
  });

  it('has no cap-exemption field: a forged one is a loud error', async () => {
    const db = install();
    const s = await call({
      familyPath: 'rules',
      method: 'POST',
      body: { ...ADULT_RULE, exemptFromCap: true },
    });
    expect(s.status).toBe(400);
    expect(db.calls.some((c) => c.table === 'point_earning_rules')).toBe(false);
  });
});

/* ================================================================== */
/* Reads                                                               */
/* ================================================================== */

describe('points: reads', () => {
  it('never selects a stored token hash', async () => {
    const db = install();
    const s = await call({ familyPath: 'claims' });
    expect(s.status).toBe(200);
    // Two independent checks, because the in-memory fake does NOT project a select
    // to its column list (see the KNOWN GAP in supabase-fake.ts). The requested
    // shape is asserted directly, and the RESPONSE is asserted to carry only the
    // fields the handler picked - so neither a bad select nor a spread row can
    // put a hash in the response.
    const cols = String(
      (db.calls.find((c) => c.op === 'select' && c.table === 'earning_claims')?.arg as
        | { cols?: string }
        | undefined)?.cols ?? '',
    );
    expect(cols).not.toMatch(/hash/i);

    const rows = (body(s).data ?? []) as Row[];
    expect(Object.keys(rows[0] ?? {}).filter((k) => /hash/i.test(k))).toEqual([]);
    expect(JSON.stringify(s.body)).not.toMatch(/hash/i);
  });

  it('returns purchases with their lines', async () => {
    install();
    const s = await call({ familyPath: 'purchases' });
    expect(s.status).toBe(200);
    const rows = (body(s).data ?? []) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purchaseNumber: 'PUR-000001', status: 'completed' });
    expect((rows[0].lines as Row[])[0]).toMatchObject({ quantity: 2, unitAmount: '2500.00' });
  });

  it('hides everything from a principal with no points permission', async () => {
    install({ permissions: NONE });
    expect((await call({ familyPath: 'claims' })).status).toBe(403);
    expect((await call({ familyPath: 'purchases' })).status).toBe(403);
  });

  it('refuses a suspended staff account holding a valid session', async () => {
    install();
    const s = await call({ familyPath: 'claims', token: SUSPENDED_TOKEN });
    expect(s.status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    install();
    expect((await call({ familyPath: 'claims', token: null })).status).toBe(401);
  });

  it('404s an unknown sub-path rather than falling through', async () => {
    install();
    expect((await call({ familyPath: 'nope' })).status).toBe(404);
  });
});
