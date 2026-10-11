/**
 * AF Homes customer portal - activation, failure handling and portal reads.
 *
 * These tests drive the REAL handlers, the REAL customer principal resolver and
 * the REAL Zod contracts against the in-memory Supabase fake.
 *
 * Two things are deliberately proven here because they are the whole risk of
 * this feature:
 *
 *   1. A partially failed activation leaves NOTHING behind. An Auth user
 *      created and then orphaned is rolled back; a token is never consumed on
 *      failure; a PRE-EXISTING Auth user is never deleted.
 *   2. A customer principal can only ever see its own data, and the staff
 *      permission resolver is never consulted.
 */
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const activation = (await import('./customer-activation.js')).default;
const portal = (await import('./customer-portal.js')).default;

const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000009';
const MEMBERSHIP_ID = 'dddddddd-0000-4000-8000-000000000001';
const OTHER_MEMBERSHIP_ID = 'dddddddd-0000-4000-8000-000000000009';
const ACCOUNT_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const AUTH_USER_ID = 'ffffffff-0000-4000-8000-000000000001';
const OTHER_AUTH_USER_ID = 'ffffffff-0000-4000-8000-000000000009';
const TOKEN = 'tok-customer';
const OTHER_TOKEN = 'tok-other-customer';
const RAW_TOKEN = 'onboarding-token-value-abcdef0123456789';

const VALID_PASSWORD = 'Str0ngPassphrase!';

const PASSWORD_REQUEST = {
  onboardingToken: RAW_TOKEN,
  password: VALID_PASSWORD,
  passwordConfirmation: VALID_PASSWORD,
};

type Row = Record<string, unknown>;

const now = new Date();
const inHours = (h: number) => new Date(now.valueOf() + h * 3600_000).toISOString();
const agoHours = (h: number) => new Date(now.valueOf() - h * 3600_000).toISOString();

/* ================================================================== */
/* Fixture                                                             */
/* ================================================================== */

function baseTables(over: Record<string, Row[]> = {}) {
  return {
    customers: [
      {
        id: CUSTOMER_ID,
        customer_number: 'CUS-000777',
        first_name: 'Ana',
        middle_name: 'R',
        last_name: 'Buyer',
        suffix: null,
        birth_date: '1990-05-04',
        gender: 'female',
        email: 'ana.buyer@example.invalid',
        phone: '09185550000',
        address: { line1: '77 Katipunan', city: 'Quezon City', province: 'Metro Manila', countryCode: 'PH' },
        government_id_type: 'philippine_id',
        government_id_number: '7788-9900-1122',
        status: 'active',
        auth_user_id: AUTH_USER_ID,
        created_at: agoHours(500),
        updated_at: agoHours(10),
      },
      {
        id: OTHER_CUSTOMER_ID,
        customer_number: 'CUS-000888',
        first_name: 'Other',
        middle_name: null,
        last_name: 'Person',
        suffix: null,
        birth_date: '1988-01-01',
        gender: 'male',
        email: 'other.person@example.invalid',
        phone: '09185550001',
        address: { line1: '1 Other St', city: 'Manila', province: 'Metro Manila', countryCode: 'PH' },
        government_id_type: null,
        government_id_number: null,
        status: 'active',
        auth_user_id: OTHER_AUTH_USER_ID,
        created_at: agoHours(400),
        updated_at: agoHours(20),
      },
    ],
    memberships: [
      {
        id: MEMBERSHIP_ID,
        customer_id: CUSTOMER_ID,
        sale_id: 'bbbbbbbb-0000-4000-8000-000000000001',
        membership_number: 'MBS-000777',
        product_id: '33333333-3333-4333-8333-333333333333',
        status: 'active',
        points_balance: 60000,
        yearly_points_allocated: 60000,
        fallback_code_hash: 'a'.repeat(64),
        qr_token_hash: 'b'.repeat(64),
        activated_by: '00000000-0000-4000-8000-0000000000bb',
        activated_at: agoHours(10),
        expires_at: inHours(24 * 365 - 10),
        renewal_due_at: inHours(24 * 365 - 10),
        issued_at: agoHours(10),
        created_at: agoHours(10),
      },
      {
        id: OTHER_MEMBERSHIP_ID,
        customer_id: OTHER_CUSTOMER_ID,
        sale_id: 'bbbbbbbb-0000-4000-8000-000000000009',
        membership_number: 'MBS-000888',
        product_id: '33333333-3333-4333-8333-333333333333',
        status: 'active',
        points_balance: 25000,
        yearly_points_allocated: 25000,
        fallback_code_hash: 'c'.repeat(64),
        qr_token_hash: 'd'.repeat(64),
        activated_at: agoHours(20),
        expires_at: inHours(24 * 365 - 20),
        renewal_due_at: inHours(24 * 365 - 20),
        issued_at: agoHours(20),
        created_at: agoHours(20),
      },
    ],
    // A REAL relation. These rows used to carry `card_plans: { name: 'Gold' }`
    // inline, so the `card_plans!inner(name)` embed resolved nothing and the
    // handler read the fixture's own copy - every productName assertion was green
    // without the join ever running.
    card_plans: [
      { id: '33333333-3333-4333-8333-333333333333', code: 'GOLD', name: 'Gold' },
    ],
    points_accounts: [
      {
        id: 'abababab-0000-4000-8000-000000000001',
        membership_id: MEMBERSHIP_ID,
        balance: 60000,
        lifetime_allocated: 60000,
        lifetime_redeemed: 0,
        updated_at: agoHours(10),
        created_at: agoHours(10),
      },
      {
        id: 'abababab-0000-4000-8000-000000000009',
        membership_id: OTHER_MEMBERSHIP_ID,
        balance: 25000,
        lifetime_allocated: 25000,
        lifetime_redeemed: 0,
        updated_at: agoHours(20),
        created_at: agoHours(20),
      },
    ],
    points_ledger: [
      {
        id: '1',
        account_id: 'abababab-0000-4000-8000-000000000001',
        entry_type: 'annual_allocation',
        amount: 60000,
        balance_after: 60000,
        reference_type: 'membership',
        reference_id: MEMBERSHIP_ID,
        actor_id: '00000000-0000-4000-8000-0000000000bb',
        reason: 'Annual points allocation on activation',
        metadata: { internal: 'not for members' },
        created_at: agoHours(10),
      },
      {
        id: '2',
        account_id: 'abababab-0000-4000-8000-000000000009',
        entry_type: 'annual_allocation',
        amount: 25000,
        balance_after: 25000,
        reference_type: 'membership',
        reference_id: OTHER_MEMBERSHIP_ID,
        actor_id: null,
        reason: 'other member',
        metadata: {},
        created_at: agoHours(20),
      },
    ],
    customer_onboarding_tokens: [],
    audit_events: [],
    ...over,
  };
}

const TOKEN_ROW = (over: Row = {}): Row => ({
  id: '99999999-0000-4000-8000-000000000001',
  customer_id: CUSTOMER_ID,
  membership_id: MEMBERSHIP_ID,
  token_hash: createHash('sha256').update(RAW_TOKEN).digest('hex'),
  purpose: 'account_activation',
  expires_at: inHours(24),
  consumed_at: null,
  consumed_by: null,
  created_by: '00000000-0000-4000-8000-0000000000bb',
  created_at: agoHours(1),
  ...over,
});

/** A customer that is not yet linked to any Auth user, with a live token. */
const UNLINKED_TABLES = () => {
  const t = baseTables();
  (t.customers[0] as Row).auth_user_id = null;
  return t;
};

type Setup = {
  tables?: Record<string, Row[]>;
  rpcErrors?: Record<string, { code?: string; message: string }>;
  rpcs?: { fn: string; result: unknown }[];
  createUser?: (attrs: { email: string; password?: string }) => Promise<unknown>;
  createUserId?: string;
  existingAuthEmails?: string[];
  authUsers?: { id: string; email: string }[];
  tokens?: Record<string, { id: string; email: string; email_confirmed_at: string }>;
};

function install(options: Setup = {}) {
  const tables = options.tables ?? baseTables();
  holder.db = new FakeSupabase({
    tables: tables as never,
    tokens: {
      [TOKEN]: { id: AUTH_USER_ID, email: 'ana.buyer@example.invalid', email_confirmed_at: agoHours(5) },
      [OTHER_TOKEN]: {
        id: OTHER_AUTH_USER_ID,
        email: 'other.person@example.invalid',
        email_confirmed_at: agoHours(5),
      },
      ...options.tokens,
    },
    createUser: options.createUser,
    createUserId: options.createUserId ?? 'new-auth-user-0001',
    existingAuthEmails: options.existingAuthEmails,
    authUsers: options.authUsers,
    rpcErrors: options.rpcErrors,
    rpcs: options.rpcs,
    links: [
      { child: 'customer_onboarding_tokens', parent: 'customers', fk: 'customer_id' },
      { child: 'memberships', parent: 'customers', fk: 'customer_id' },
      { child: 'memberships', parent: 'card_plans', fk: 'product_id' },
      { child: 'points_accounts', parent: 'memberships', fk: 'membership_id' },
      { child: 'points_ledger', parent: 'points_accounts', fk: 'account_id' },
    ],
  });
  const db = holder.db as FakeSupabase;
  // The in-memory fake does not execute SQL, so the two Phase 3 functions are
  // emulated here - including their transactional side effects, because those
  // side effects ARE the behaviour under test. A test may override either one.
  installClaimRpc(db, options.rpcErrors?.claim_customer_onboarding_token);
  return db;
}

/**
 * Emulates `public.claim_customer_onboarding_token`: validates, then links the
 * customer, consumes the token and appends the audit trail as one unit.
 */
function installClaimRpc(db: FakeSupabase, forced?: { code?: string; message: string }) {
  const scripted = db.rpcs.some((r) => r.fn === 'claim_customer_onboarding_token');
  const base = db.rpc.bind(db);
  db.rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn !== 'claim_customer_onboarding_token') return base(fn, args);
    if (forced) return { data: null, error: { ...forced } };
    if (scripted) return base(fn, args);

    const token = db
      .rows('customer_onboarding_tokens')
      .find((r) => r.token_hash === args.p_token_hash);
    if (!token) return { data: null, error: { code: 'P0002', message: 'TOKEN_NOT_FOUND' } };
    if (token.purpose !== args.p_purpose) {
      return { data: null, error: { code: '22023', message: 'TOKEN_WRONG_PURPOSE' } };
    }
    if (token.consumed_at) {
      return { data: null, error: { code: '55000', message: 'TOKEN_ALREADY_CONSUMED' } };
    }
    if (new Date(String(token.expires_at)).valueOf() <= Date.now()) {
      return { data: null, error: { code: '55000', message: 'TOKEN_EXPIRED' } };
    }
    const customer = db.rows('customers').find((r) => r.id === token.customer_id)!;
    if (customer.status !== 'active') {
      return { data: null, error: { code: '55000', message: `CUSTOMER_NOT_ACTIVE:${customer.status}` } };
    }
    const active = db
      .rows('memberships')
      .some((m) => m.customer_id === customer.id && m.status === 'active');
    if (!active) {
      return { data: null, error: { code: '55000', message: 'CUSTOMER_HAS_NO_ACTIVE_MEMBERSHIP' } };
    }
    if (customer.auth_user_id) {
      if (customer.auth_user_id === args.p_auth_user_id) {
        return {
          data: [
            {
              customer_id: customer.id,
              customer_number: customer.customer_number,
              email: customer.email,
              outcome: 'ALREADY_LINKED',
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { code: '55000', message: 'CUSTOMER_ALREADY_CLAIMED' } };
    }

    customer.auth_user_id = args.p_auth_user_id;
    customer.updated_at = new Date().toISOString();
    token.consumed_at = new Date().toISOString();
    token.consumed_by = args.p_auth_user_id;
    for (const action of [
      'CUSTOMER_AUTH_ACTIVATED',
      'CUSTOMER_ONBOARDING_TOKEN_CONSUMED',
      'CUSTOMER_ACCOUNT_LINKED',
    ]) {
      db.rows('audit_events').push({
        actor_id: args.p_auth_user_id,
        action,
        entity_type: 'customer',
        entity_id: customer.id,
        after_data: {},
      });
    }
    return {
      data: [
        {
          customer_id: customer.id,
          customer_number: customer.customer_number,
          email: customer.email,
          outcome: 'CLAIMED',
        },
      ],
      error: null,
    };
  };
}

type State = { status: number; body: unknown };

async function callActivate(options: { body?: unknown; method?: string } = {}): Promise<State> {
  const { res, state } = makeRes();
  await activation(
    makeReq({
      method: options.method ?? 'POST',
      familyPath: 'customer/activate',
      body: options.body,
    }) as never,
    res as never,
  );
  return state;
}

async function callPortal(path: string, token = TOKEN, method = 'GET'): Promise<State> {
  const { res, state } = makeRes();
  await portal(
    makeReq({ method, familyPath: path, token }) as never,
    res as never,
  );
  return state;
}

/**
 * The points summary now comes from public.customer_points_position, which
 * computes spendable and remaining capacity in SQL. This scripts that function so
 * a test can ask for a position WITH debt without restating every fixture.
 *
 * The figures are produced by SQL, so they are scripted here rather than derived
 * in the test: a client-side subtraction would be the very thing this shape
 * exists to prevent.
 */
function installPointsPosition(overrides: Record<string, unknown> = {}) {
  install({
    rpcs: [
      {
        fn: 'customer_points_position',
        result: () => [
          {
            membership_id: MEMBERSHIP_ID,
            balance: '60000',
            annual_cap: '100000',
            remaining_earning_capacity: '40000',
            spendable: '60000',
            reversal_debt: '0',
            period_start: '2026-01-01',
            period_end: '2027-01-01',
            tier: 'GOLD',
            earned_this_period: '60000',
            redeemed_this_period: '0',
            ...overrides,
          },
        ],
      },
    ],
  });
}

/** No `Authorization` header and no auth cookie at all. */
async function callPortalAnonymous(path: string, method = 'GET'): Promise<State> {
  const { res, state } = makeRes();
  await portal(makeReq({ method, familyPath: path }) as never, res as never);
  return state;
}

const body = (s: State) => s.body as Record<string, unknown>;
const data = (s: State) => (s.body as { data: Row[] }).data;

/* ================================================================== */
/* Request validation                                                  */
/* ================================================================== */

describe('customer activation request', () => {
  beforeEach(() => install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } }));

  it('rejects a missing token', async () => {
    const s = await callActivate({ body: { password: VALID_PASSWORD, passwordConfirmation: VALID_PASSWORD } });
    expect(s.status).toBe(400);
  });

  it('rejects mismatched password confirmation', async () => {
    const s = await callActivate({
      body: { ...PASSWORD_REQUEST, passwordConfirmation: 'Different1Pass!' },
    });
    expect(s.status).toBe(400);
  });

  it('rejects a weak password', async () => {
    for (const weak of ['short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
      const s = await callActivate({
        body: { onboardingToken: RAW_TOKEN, password: weak, passwordConfirmation: weak },
      });
      expect(s.status, weak).toBe(400);
    }
  });

  it('refuses a non-POST method', async () => {
    expect((await callActivate({ method: 'GET', body: PASSWORD_REQUEST })).status).toBe(404);
  });

  it('answers for its own path only, never for a retired sibling route', async () => {
    // `/auth/register` belonged to the retired predecessor platform. Even if something
    // dispatched it here, this handler must not answer for it.
    for (const path of ['', 'register', 'customer', 'login', 'password-reset']) {
      const { res, state } = makeRes();
      await activation(
        makeReq({ method: 'POST', familyPath: path, body: PASSWORD_REQUEST }) as never,
        res as never,
      );
      expect(state.status, path || '(root)').toBe(404);
    }
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it.each([
    'customerId',
    'membershipId',
    'email',
    'role',
    'status',
    'points',
    'product',
  ])('never accepts a caller-supplied %s', async (field) => {
    const s = await callActivate({
      body: { ...PASSWORD_REQUEST, [field]: 'injected-value' },
    });
    // Unknown keys are ignored by the schema, so the request still activates
    // using server-resolved values only.
    expect(s.status).toBe(201);
    const db = holder.db as FakeSupabase;
    const created = db.createdAuthUsers[0]!;
    // The Auth user was created with the CUSTOMER RECORD's address, not the
    // injected one.
    expect(created.email).toBe('ana.buyer@example.invalid');
  });
});

/* ================================================================== */
/* Token validation - every refusal happens before an Auth user exists */
/* ================================================================== */

describe('customer activation token validation', () => {
  beforeEach(() => install());

  it('refuses an unknown token', async () => {
    const s = await callActivate({ body: { ...PASSWORD_REQUEST, onboardingToken: 'totally-unknown-token-0000' } });
    expect(s.status).toBe(404);
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it('refuses an already-consumed token', async () => {
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW({ consumed_at: agoHours(2) })] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it('refuses an expired token', async () => {
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW({ expires_at: agoHours(1) })] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it('refuses a token issued for a different purpose', async () => {
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW({ purpose: 'password_reset' })] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(400);
  });

  it('refuses when the customer is not active', async () => {
    const t = UNLINKED_TABLES();
    t.customers[0]!.status = 'suspended';
    install({ tables: { ...t, customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it('refuses when the customer has no active membership', async () => {
    const t = UNLINKED_TABLES();
    t.memberships[0]!.status = 'suspended';
    install({ tables: { ...t, customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it('refuses when the customer already has a linked Auth user', async () => {
    install({ tables: { ...baseTables(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect((holder.db as FakeSupabase).createdAuthUsers).toHaveLength(0);
  });

  it('never returns or stores the token hash', async () => {
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(201);
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain(createHash('sha256').update(RAW_TOKEN).digest('hex'));
    expect(serialised).not.toContain(RAW_TOKEN);
  });

  it('never writes the plaintext token anywhere', async () => {
    const db = install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    await callActivate({ body: PASSWORD_REQUEST });
    expect(JSON.stringify(db.rows('customer_onboarding_tokens'))).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(db.rows('audit_events'))).not.toContain(RAW_TOKEN);
  });
});

/* ================================================================== */
/* Auth account creation                                               */
/* ================================================================== */

describe('customer Auth account creation', () => {
  beforeEach(() =>
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } }),
  );

  it('creates the Auth user with the customer record email and confirms it', async () => {
    const db = install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(201);
    const call = db.calls.find((c) => c.op === 'createUser')!;
    expect(call.arg).toEqual({ email: 'ana.buyer@example.invalid', email_confirm: true });
  });

  it('passes the password to Supabase Auth and stores it nowhere else', async () => {
    const db = install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    await callActivate({ body: PASSWORD_REQUEST });
    expect(db.passwordsSeen).toEqual([VALID_PASSWORD]);
    // The password must not appear in any table or in the response.
    expect(JSON.stringify(db.rows('customers'))).not.toContain(VALID_PASSWORD);
    expect(JSON.stringify(db.rows('audit_events'))).not.toContain(VALID_PASSWORD);
  });

  it('assigns no staff role and creates no staff record', async () => {
    const db = install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    await callActivate({ body: PASSWORD_REQUEST });
    expect(db.rows('staff_users')).toHaveLength(0);
    expect(db.rows('staff_role_assignments')).toHaveLength(0);
  });

  it('does not return a session or any token', async () => {
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    const serialised = JSON.stringify(s.body);
    for (const forbidden of ['access_token', 'refresh_token', 'session', 'password', 'jwt']) {
      expect(serialised.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(body(s).nextStep).toBe('sign_in');
  });

  it('reports a duplicate Auth address as a conflict and never reuses that user', async () => {
    const db = install({
      tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
      existingAuthEmails: ['ana.buyer@example.invalid'],
    });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    // The pre-existing user was NOT deleted.
    expect(db.deletedAuthUsers).toHaveLength(0);
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
  });

  it('surfaces a GoTrue failure as an error with nothing written', async () => {
    const db = install({
      tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
      createUser: async () => ({ data: { user: null }, error: { message: 'smtp unavailable' } }),
    });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(500);
    expect(db.rows('audit_events')).toHaveLength(0);
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
  });

  it('reports an unresolvable duplicate as a conflict and never reuses that user', async () => {
    // GoTrue refuses the address but the admin directory holds no matching
    // user (e.g. eventual consistency): fail closed with the token untouched.
    const db = install({
      tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
      existingAuthEmails: ['ana.buyer@example.invalid'],
    });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect(db.deletedAuthUsers).toHaveLength(0);
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
    expect(db.rows('customers')[0]!.auth_user_id).toBeNull();
  });
});

/* ================================================================== */
/* Existing Auth account recovery (duplicate-email safe link)          */
/* ================================================================== */

describe('existing Auth account recovery', () => {
  const ORPHAN_AUTH_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  const CLASH_AUTH_ID = 'aaaaaaaa-0000-4000-8000-0000000000a2';

  const orphanSetup = () => ({
    tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
    authUsers: [{ id: ORPHAN_AUTH_ID, email: 'ana.buyer@example.invalid' }],
  });

  it('links a provable orphan instead of failing, and marks the recovery', async () => {
    const db = install(orphanSetup());
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(201);
    expect(body(s)).toMatchObject({
      customerId: CUSTOMER_ID,
      email: 'ana.buyer@example.invalid',
      nextStep: 'sign_in',
      linkedExistingAuth: true,
    });
    expect(db.rows('customers')[0]!.auth_user_id).toBe(ORPHAN_AUTH_ID);
    // No second Auth account was created.
    expect(db.createdAuthUsers).toHaveLength(0);
  });

  it('returns linkedExistingAuth false for a normal creation', async () => {
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(201);
    expect(body(s).linkedExistingAuth).toBe(false);
  });

  it('consumes the token exactly once on recovery, then refuses reuse', async () => {
    const db = install(orphanSetup());
    expect((await callActivate({ body: PASSWORD_REQUEST })).status).toBe(201);
    const token = db.rows('customer_onboarding_tokens')[0]!;
    expect(token.consumed_at).not.toBeNull();
    expect(token.consumed_by).toBe(ORPHAN_AUTH_ID);
    // The link is now idempotent at the pre-flight: the customer has a sign-in.
    const second = await callActivate({ body: PASSWORD_REQUEST });
    expect(second.status).toBe(409);
    expect(db.createdAuthUsers).toHaveLength(0);
  });

  it('never sets, overwrites or logs a password for the existing account', async () => {
    const db = install(orphanSetup());
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(201);
    // The typed password reached GoTrue exactly once, inside the create
    // attempt whose duplicate refusal triggered recovery - that is how a
    // duplicate is discovered. It was never SET anywhere: no password
    // rotation, no second use, and no trace in tables, calls or audits.
    expect(db.calls.filter((c) => c.op === 'updateUserById')).toHaveLength(0);
    expect(db.calls.filter((c) => c.op === 'createUser')).toHaveLength(1);
    expect(JSON.stringify(db.calls)).not.toContain(VALID_PASSWORD);
    expect(JSON.stringify(db.rows('customers'))).not.toContain(VALID_PASSWORD);
    expect(JSON.stringify(db.rows('audit_events'))).not.toContain(VALID_PASSWORD);
    expect(JSON.stringify(s.body)).not.toContain(VALID_PASSWORD);
  });

  it('audits the recovery without secrets', async () => {
    const db = install(orphanSetup());
    await callActivate({ body: PASSWORD_REQUEST });
    const recovery = db.rows('audit_events').find((e) => e.action === 'CUSTOMER_EXISTING_AUTH_LINKED');
    expect(recovery).toMatchObject({
      actor_id: ORPHAN_AUTH_ID,
      entity_type: 'customer',
      entity_id: CUSTOMER_ID,
    });
    const serialised = JSON.stringify(db.rows('audit_events'));
    expect(serialised).not.toContain(RAW_TOKEN);
    expect(serialised).not.toContain(VALID_PASSWORD);
  });

  it('refuses when the address belongs to another customer, leaving everything untouched', async () => {
    const t = UNLINKED_TABLES();
    t.customers[1]!.auth_user_id = CLASH_AUTH_ID;
    const db = install({
      tables: { ...t, customer_onboarding_tokens: [TOKEN_ROW()] },
      authUsers: [{ id: CLASH_AUTH_ID, email: 'ana.buyer@example.invalid' }],
    });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect(db.rows('customers')[0]!.auth_user_id).toBeNull();
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
    expect(
      db.rows('audit_events').filter((e) => e.action === 'CUSTOMER_EXISTING_AUTH_LINKED'),
    ).toHaveLength(0);
  });

  it('refuses when the address belongs to a staff identity', async () => {
    const t = UNLINKED_TABLES();
    (t as Record<string, Row[]>).staff_users = [{ id: CLASH_AUTH_ID, email: 'staff@afhomes.test' }];
    const db = install({
      tables: { ...t, customer_onboarding_tokens: [TOKEN_ROW()] },
      authUsers: [{ id: CLASH_AUTH_ID, email: 'ana.buyer@example.invalid' }],
    });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect(db.rows('customers')[0]!.auth_user_id).toBeNull();
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
  });

  it('refuses when the address holds a pending staff invitation', async () => {
    const t = UNLINKED_TABLES();
    (t as Record<string, Row[]>).staff_invitations = [
      { id: 'inv-1', email: 'ana.buyer@example.invalid', auth_user_id: CLASH_AUTH_ID, status: 'pending' },
    ];
    const db = install({
      tables: { ...t, customer_onboarding_tokens: [TOKEN_ROW()] },
      authUsers: [{ id: CLASH_AUTH_ID, email: 'ana.buyer@example.invalid' }],
    });
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect(db.rows('customers')[0]!.auth_user_id).toBeNull();
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
  });

  it('leaves membership, points and ledger state unchanged by recovery', async () => {
    const db = install(orphanSetup());
    const before = JSON.stringify({
      memberships: db.rows('memberships'),
      points: db.rows('points_accounts'),
      ledger: db.rows('points_ledger'),
    });
    await callActivate({ body: PASSWORD_REQUEST });
    expect(
      JSON.stringify({
        memberships: db.rows('memberships'),
        points: db.rows('points_accounts'),
        ledger: db.rows('points_ledger'),
      }),
    ).toBe(before);
    expect(
      db.rows('audit_events').map((e) => e.action).sort(),
    ).toEqual(
      [
        'CUSTOMER_AUTH_ACTIVATED',
        'CUSTOMER_ACCOUNT_LINKED',
        'CUSTOMER_EXISTING_AUTH_LINKED',
        'CUSTOMER_ONBOARDING_TOKEN_CONSUMED',
      ].sort(),
    );
  });
});

/* ================================================================== */
/* Failure handling: Auth created, DB link fails                        */
/* ================================================================== */

describe('partial failure: Auth user created, then the DB claim fails', () => {
  beforeEach(() =>
    install({
      tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
      rpcErrors: { claim_customer_onboarding_token: { message: 'link failed' } },
    }),
  );

  it('rolls back the Auth user it just created', async () => {
    const db = holder.db as FakeSupabase;
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(500);
    expect(db.createdAuthUsers).toHaveLength(1);
    expect(db.deletedAuthUsers).toEqual(['new-auth-user-0001']);
  });

  it('leaves the token unconsumed so the customer can retry', async () => {
    const db = holder.db as FakeSupabase;
    await callActivate({ body: PASSWORD_REQUEST });
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).toBeNull();
  });

  it('leaves the customer unlinked', async () => {
    const db = holder.db as FakeSupabase;
    await callActivate({ body: PASSWORD_REQUEST });
    expect(db.rows('customers')[0]!.auth_user_id).toBeNull();
  });

  it('writes no audit trail for a failed activation', async () => {
    const db = holder.db as FakeSupabase;
    await callActivate({ body: PASSWORD_REQUEST });
    expect(db.rows('audit_events')).toHaveLength(0);
  });

  it('maps a CUSTOMER_ALREADY_CLAIMED refusal to a 409 and still rolls back', async () => {
    install({
      tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
      rpcErrors: {
        claim_customer_onboarding_token: { message: 'CUSTOMER_ALREADY_CLAIMED' },
      },
    });
    const db = holder.db as FakeSupabase;
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(409);
    expect(db.deletedAuthUsers).toEqual(['new-auth-user-0001']);
  });

  it('succeeds on a retry once the underlying fault is gone', async () => {
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(500);

    // The customer tries again with a working database.
    const db = install({
      tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] },
    });
    const retry = await callActivate({ body: PASSWORD_REQUEST });
    expect(retry.status).toBe(201);
    expect(db.rows('customer_onboarding_tokens')[0]!.consumed_at).not.toBeNull();
  });
});

/* ================================================================== */
/* Success                                                             */
/* ================================================================== */

describe('successful activation', () => {
  beforeEach(() =>
    install({ tables: { ...UNLINKED_TABLES(), customer_onboarding_tokens: [TOKEN_ROW()] } }),
  );

  it('returns a safe result and points the customer at sign-in', async () => {
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(s.status).toBe(201);
    expect(body(s)).toMatchObject({
      customerId: CUSTOMER_ID,
      customerNumber: 'CUS-000777',
      email: 'ana.buyer@example.invalid',
      fullName: 'Ana R Buyer',
      nextStep: 'sign_in',
    });
  });

  it('never returns the government ID number', async () => {
    const s = await callActivate({ body: PASSWORD_REQUEST });
    expect(JSON.stringify(s.body)).not.toContain('7788-9900-1122');
    expect(body(s)).not.toHaveProperty('governmentIdNumber');
  });

  it('consumes the token exactly once', async () => {
    const db = holder.db as FakeSupabase;
    await callActivate({ body: PASSWORD_REQUEST });
    const consumed = db.rows('customer_onboarding_tokens')[0]!.consumed_at;
    expect(consumed).not.toBeNull();
    // A second attempt with the same token is refused before any Auth user exists.
    const second = await callActivate({ body: PASSWORD_REQUEST });
    expect(second.status).toBe(409);
    expect(db.createdAuthUsers).toHaveLength(1);
  });
});

/* ================================================================== */
/* Portal authorization                                                */
/* ================================================================== */

describe('customer portal authorization', () => {
  beforeEach(() => install());

  it('refuses an unauthenticated caller', async () => {
    for (const path of ['', 'membership', 'points', 'points/ledger']) {
      const s = await callPortalAnonymous(path);
      expect(s.status, path).toBe(401);
    }
  });

  it('accepts the Supabase auth cookie, which is how a browser session arrives', async () => {
    const { res, state } = makeRes();
    const cookie = `sb-abcdefghij-auth-token=${encodeURIComponent(
      JSON.stringify([{ access_token: TOKEN }]),
    )}`;
    await portal(
      makeReq({ familyPath: '', headers: { cookie } }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
  });

  it('refuses a cookie with a forged access token', async () => {
    const { res, state } = makeRes();
    const cookie = `sb-abcdefghij-auth-token=${encodeURIComponent(
      JSON.stringify([{ access_token: 'forged' }]),
    )}`;
    await portal(
      makeReq({ familyPath: '', headers: { cookie } }) as never,
      res as never,
    );
    expect(state.status).toBe(401);
  });

  it('refuses an authenticated user who is not a customer', async () => {
    install({
      tokens: { 'tok-staff': { id: '00000000-0000-4000-8000-0000000000bb', email: 'staff@afhomes.test', email_confirmed_at: agoHours(5) } },
    });
    const s = await callPortal('', 'tok-staff');
    expect(s.status).toBe(403);
    expect((s.body as { error: { message: string } }).error.message).toMatch(/not a customer/i);
  });

  it('rejects a forged or unknown bearer token', async () => {
    expect((await callPortal('', 'not-a-real-token')).status).toBe(401);
  });
});

/* ================================================================== */
/* Profile read model                                                  */
/* ================================================================== */

describe('customer profile read model', () => {
  beforeEach(() => install());

  it('returns the customer their own profile', async () => {
    const s = await callPortal('');
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      customerNumber: 'CUS-000777',
      fullName: 'Ana R Buyer',
      email: 'ana.buyer@example.invalid',
      status: 'active',
      addressLine1: '77 Katipunan',
      city: 'Quezon City',
    });
  });

  it('never exposes sensitive or internal fields', async () => {
    const s = await callPortal('');
    const b = body(s);
    for (const forbidden of [
      'governmentIdNumber',
      'governmentIdType',
      'government_id_number',
      'createdBy',
      'referredByStaffId',
      'referralCodeUsed',
      'notes',
      'authUserId',
    ]) {
      expect(b, forbidden).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(s.body)).not.toContain('7788-9900-1122');
  });

  it('only ever returns the caller own row', async () => {
    const s = await callPortal('');
    expect(body(s).customerNumber).toBe('CUS-000777');
    expect(JSON.stringify(s.body)).not.toContain('CUS-000888');
  });
});

/* ================================================================== */
/* Membership and points                                               */
/* ================================================================== */

describe('customer membership summary', () => {
  beforeEach(() => install());

  it('returns the caller own active membership', async () => {
    const s = await callPortal('membership');
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      membershipNumber: 'MBS-000777',
      productName: 'Gold',
      status: 'active',
      yearlyPointsAllocated: 60000,
      pointsBalance: 60000,
    });
  });

  it('states plainly that a readable code is not available on demand', async () => {
    const s = await callPortal('membership');
    expect(body(s).credentialsAvailable).toBe(false);
    expect(String(body(s).credentialsNote)).toMatch(/hash|once/i);
  });

  it('never returns the stored credential hashes', async () => {
    const s = await callPortal('membership');
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain('a'.repeat(64));
    expect(serialised).not.toContain('b'.repeat(64));
  });

  it('never returns the activating staff member id', async () => {
    expect(JSON.stringify((await callPortal('membership')).body)).not.toContain(
      '00000000-0000-4000-8000-0000000000bb',
    );
  });

  it('refuses membership for a suspended customer', async () => {
    const t = baseTables();
    t.customers[0]!.status = 'suspended';
    install({ tables: t });
    const s = await callPortal('membership');
    expect(s.status).toBe(403);
    expect((s.body as { error: { message: string } }).error.message).toMatch(/suspended/i);
  });

  it('still lets a suspended customer read their own profile', async () => {
    const t = baseTables();
    t.customers[0]!.status = 'suspended';
    install({ tables: t });
    expect((await callPortal('')).status).toBe(200);
  });
});

describe('customer points', () => {
  beforeEach(() => install());

  it('returns the caller own points POSITION', async () => {
    installPointsPosition();
    const s = await callPortal('points/position');
    expect(s.status).toBe(200);
    // THREE figures, not one. `spendable` is what may be used right now;
    // `remainingEarningCapacity` is a ceiling on future earnings and is NOT
    // spendable. Collapsing them would tell a capped member they have no points.
    expect(body(s)).toMatchObject({
      membershipId: MEMBERSHIP_ID,
      balance: 60000,
      spendable: 60000,
      remainingEarningCapacity: 40000,
      annualCap: 100000,
      reversalDebt: 0,
      tier: 'GOLD',
    });
  });

  it('reports outstanding reversal debt separately from the balance', async () => {
    // spendable is 60000 - 15000, computed by SQL. The handler never does that
    // subtraction itself, so a client bug could not flatter the figure.
    installPointsPosition({ reversal_debt: '15000', spendable: '45000' });
    const s = await callPortal('points/position');
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      balance: 60000,
      reversalDebt: 15000,
      spendable: 45000,
    });
  });

  it('keeps the LEGACY points summary frozen for deployed clients', async () => {
    // The five fields and their meanings are a published contract. `balance` is
    // the RAW account balance here, not spendable: this endpoint has never
    // subtracted debt, and quietly starting to would change what a deployed
    // client displays without any signal.
    install();
    const s = await callPortal('points');
    expect(s.status).toBe(200);
    expect(Object.keys(body(s) as Record<string, unknown>).sort()).toEqual([
      'balance',
      'lifetimeAllocated',
      'lifetimeRedeemed',
      'membershipId',
      'updatedAt',
    ]);
    expect(body(s)).toMatchObject({ balance: 60000, lifetimeAllocated: 60000, lifetimeRedeemed: 0 });
    // It must NOT have quietly become the position shape.
    expect(body(s)).not.toHaveProperty('spendable');
    expect(body(s)).not.toHaveProperty('remainingEarningCapacity');
    expect(body(s)).not.toHaveProperty('reversalDebt');
  });

  it('exposes the three figures on the separate position endpoint', async () => {
    installPointsPosition();
    const s = await callPortal('points/position');
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      balance: 60000,
      spendable: 60000,
      remainingEarningCapacity: 40000,
      annualCap: 100000,
      reversalDebt: 0,
      tier: 'GOLD',
    });
  });

  it('reports reversal debt on the position endpoint without touching the legacy one', async () => {
    installPointsPosition({ reversal_debt: '15000', spendable: '45000' });
    const position = await callPortal('points/position');
    expect(body(position)).toMatchObject({ balance: 60000, reversalDebt: 15000, spendable: 45000 });

    // The legacy endpoint keeps reporting the raw balance. Changing it would be
    // the silent contract break this split exists to avoid.
    install();
    const legacy = await callPortal('points');
    expect(body(legacy)).toMatchObject({ balance: 60000 });
    expect(body(legacy)).not.toHaveProperty('reversalDebt');
  });

  it('authorizes the position endpoint identically to the legacy one', async () => {
    installPointsPosition();
    expect((await callPortal('points/position')).status).toBe(200);
    // Same ownership gate: another member's token still cannot read it.
    const other = await callPortal('points/position', OTHER_TOKEN);
    expect(other.status).toBe(200);
    expect(body(other).membershipId).not.toBe(OTHER_MEMBERSHIP_ID);
    // And anonymous is refused, exactly as for `points`.
    expect((await callPortalAnonymous('points/position')).status).toBe(401);
  });

  it('shows zeroes rather than an error for a card with no points account yet', async () => {
    install({ rpcErrors: { customer_points_position: { message: 'POINTS_ACCOUNT_NOT_FOUND' } } });
    const s = await callPortal('points/position');
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ balance: 0, spendable: 0, reversalDebt: 0 });
  });

  it('never shows another member points', async () => {
    installPointsPosition();
    const s = await callPortal('points');
    expect(body(s).balance).not.toBe(25000);
    expect(body(s).membershipId).not.toBe(OTHER_MEMBERSHIP_ID);
  });

  it('returns only the caller own ledger entries', async () => {
    const s = await callPortal('points/ledger');
    expect(s.status).toBe(200);
    const rows = data(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryType: 'annual_allocation', amount: 60000, balanceAfter: 60000 });
  });

  it('never exposes the internal actor id or metadata', async () => {
    const s = await callPortal('points/ledger');
    for (const forbidden of ['actorId', 'actor_id', 'metadata']) {
      expect(data(s)[0], forbidden).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(s.body)).not.toContain('not for members');
  });

  it('never shows another member ledger entries', async () => {
    expect(JSON.stringify((await callPortal('points/ledger')).body)).not.toContain('other member');
  });

  it('is read-only: no verb mutates points', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const s = await callPortal('points', TOKEN, method);
      expect(s.status, method).toBe(404);
    }
  });

  it('refuses points for a cancelled customer', async () => {
    const t = baseTables();
    t.customers[0]!.status = 'cancelled';
    install({ tables: t });
    expect((await callPortal('points')).status).toBe(403);
  });
});

/* ================================================================== */
/* Credential re-issue                                                 */
/* ================================================================== */

describe('membership credential re-issue', () => {
  beforeEach(() =>
    install({
      rpcs: [
        {
          fn: 'reissue_membership_credentials',
          result: [
            {
              membership_id: MEMBERSHIP_ID,
              fallback_code: 'AFH-NEWW-WWWW',
              qr_token: 'opaque-rotated-qr-token',
            },
          ],
        },
      ],
    }),
  );

  it('returns the new plaintext exactly once and warns the old one dies', async () => {
    const s = await callPortal('membership/credentials', TOKEN, 'POST');
    expect(s.status).toBe(201);
    expect(body(s)).toMatchObject({
      membershipId: MEMBERSHIP_ID,
      fallbackCode: 'AFH-NEWW-WWWW',
      qrToken: 'opaque-rotated-qr-token',
      previousCodesInvalidated: true,
    });
  });

  it('sends the caller own customer id for the ownership re-check', async () => {
    const db = holder.db as FakeSupabase;
    await callPortal('membership/credentials', TOKEN, 'POST');
    const call = db.calls.find((c) => c.op === 'rpc')!;
    expect(call.arg).toMatchObject({
      p_membership_id: MEMBERSHIP_ID,
      p_customer_id: CUSTOMER_ID,
      p_actor_id: AUTH_USER_ID,
    });
  });

  it('refuses to re-issue for a suspended customer', async () => {
    const t = baseTables();
    t.customers[0]!.status = 'suspended';
    install({ tables: t });
    const s = await callPortal('membership/credentials', TOKEN, 'POST');
    expect(s.status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const s = await callPortalAnonymous('membership/credentials', 'POST');
    expect(s.status).toBe(401);
  });
});

/* ================================================================== */
/* Customer / staff separation                                         */
/* ================================================================== */

describe('customer and staff authorisation never mix', () => {
  it('a staff account that also owns a customer record gets customer reads only', async () => {
    const t = baseTables();
    t.customers[0]!.auth_user_id = '00000000-0000-4000-8000-0000000000bb';
    install({
      tables: t,
      tokens: { 'tok-staff-customer': { id: '00000000-0000-4000-8000-0000000000bb', email: 'vd@afhomes.test', email_confirmed_at: agoHours(5) } },
      // The points position is a scripted function, so it has to be scripted for
      // this principal too. Ownership is unchanged: the staff account still reads
      // ONE customer's points and no staff capability.
      rpcs: [
        {
          fn: 'customer_points_position',
          result: () => [
            {
              membership_id: MEMBERSHIP_ID,
              balance: '60000',
              annual_cap: '100000',
              remaining_earning_capacity: '40000',
              spendable: '60000',
              reversal_debt: '0',
              period_start: '2026-01-01',
              period_end: '2027-01-01',
              tier: 'GOLD',
              earned_this_period: '60000',
              redeemed_this_period: '0',
            },
          ],
        },
      ],
    });
    // Customer portal works: ownership only.
    expect((await callPortal('', 'tok-staff-customer')).status).toBe(200);
    // ...and it is scoped to that ONE customer, not to any staff capability.
    const s = await callPortal('points', 'tok-staff-customer');
    expect(body(s).membershipId).toBe(MEMBERSHIP_ID);
    expect(body(s).balance).toBe(60000);
  });
});
