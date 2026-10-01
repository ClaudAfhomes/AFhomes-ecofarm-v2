/**
 * Referral + membership-identifier context regression.
 *
 * The OST sponsorship rule ("Referrals must come from an active Sales
 * Manager") is correct in exactly one context: OST sponsorship, where an
 * approved OST joins the genealogy directly under a Sales Manager. This file
 * proves every `checkSponsor` call site uses the rule that belongs to its
 * own context:
 *
 *   - public OST code resolution + public OST application submission keep the
 *     SM-only `validateOstSponsor` rule;
 *   - staff approval re-validates the FROZEN sponsor with an
 *     approval-specific error and never swaps the sponsor;
 *   - staff code issuance validates the ISSUER context (`validateReferralCodeIssuer`):
 *     a non-SM issuing for themselves gets an issuance-specific refusal;
 *   - customer/card-sale registration validates the REFERRER context
 *     (`validateCustomerSaleReferrer`): VD, SSM, SM, OST, Admin and Super
 *     Admin may register, and the OST SM-only message never appears there;
 *   - membership resolution accepts the persistent card number (bare or the
 *     `AFHOMES:` digital-card envelope) alongside the one-time secrets, all
 *     resolving to the same membership with `matchedBy: 'card_number'`.
 *
 * Drives the REAL handlers with the REAL resolvers and contracts against the
 * in-memory Supabase fake.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const ost = (await import('./ost.js')).default;
const customers = (await import('./customers.js')).default;
const redemptions = (await import('./redemptions.js')).default;
const memberships = (await import('./memberships.js')).default;
const portal = (await import('./customer-portal.js')).default;
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const SM_ID = '22222222-2222-4222-8222-222222222222';
const VD_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const EMP_ID = '44444444-4444-4444-8444-444444444444';
const FIN_ID = '55555555-5555-4555-8555-555555555555';

const SM_TOKEN = 'tok-sm';
const VD_TOKEN = 'tok-vd';
const ADMIN_TOKEN = 'tok-admin';
const EMP_TOKEN = 'tok-emp';
const FIN_TOKEN = 'tok-fin';
const CUSTOMER_TOKEN = 'tok-customer';

const RAW_CODE = 'OST-ABCDEF-123456';
const CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const NON_SM_CODE = 'OST-FFFFFC-000003';
const NON_SM_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000001';
const AUTH_USER_ID = 'ffffffff-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = 'dddddddd-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';

const QR_TOKEN = 'OpAqUeQrToKeN-vALue-aAaAaAaAaAaAa';
const FALLBACK_CODE = 'AFH-1A2B-3C4D';
const MEMBERSHIP_NUMBER = 'MBS-000777';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

type Row = Record<string, unknown>;

const applicant = {
  referralCode: RAW_CODE,
  firstName: 'Oscar',
  lastName: 'Trainee',
  email: 'oscar@example.invalid',
  phone: '+639171234567',
  birthDate: '1995-06-15',
  address: { line1: '1 Farm Road', city: 'Tagaytay', province: 'Cavite', countryCode: 'PH' },
};

const newCustomerBody = {
  firstName: 'Referral',
  lastName: 'Buyer',
  email: 'referral.buyer@example.invalid',
  phone: '+639171234567',
  dateOfBirth: '1994-03-03',
  address: { line1: '9 Referral St', city: 'Tagaytay', province: 'Cavite', countryCode: 'PH' },
  referralCode: 'WALK-IN',
};

function baseTables(): Record<string, Row[]> {
  return {
    modules: [
      { id: 'm-reg', key: 'network.ost_registrations', is_active: true },
      { id: 'm-ref', key: 'network.referrals', is_active: true },
      { id: 'm-cust', key: 'sales.customers', is_active: true },
      { id: 'm-red', key: 'operations.redemption', is_active: true },
    ],
    roles: [
      { id: 'r-sm', slug: 'sales_manager', name: 'Sales Manager', is_active: true },
      { id: 'r-vd', slug: 'vice_director', name: 'Vice Director', is_active: true },
      { id: 'r-admin', slug: 'admin', name: 'Admin', is_active: true },
      { id: 'r-emp', slug: 'employee', name: 'Employee', is_active: true },
      { id: 'r-fin', slug: 'finance', name: 'Finance', is_active: true },
    ],
    role_permissions: [
      { role_id: 'r-sm', module_id: 'm-reg', can_view: true, can_create: false, can_update: false, can_delete: false },
      { role_id: 'r-sm', module_id: 'm-ref', can_view: true, can_create: true, can_update: false, can_delete: false },
      { role_id: 'r-sm', module_id: 'm-cust', can_view: true, can_create: true, can_update: true, can_delete: false },
      { role_id: 'r-vd', module_id: 'm-ref', can_view: true, can_create: true, can_update: false, can_delete: false },
      { role_id: 'r-vd', module_id: 'm-cust', can_view: true, can_create: true, can_update: true, can_delete: false },
      { role_id: 'r-admin', module_id: 'm-reg', can_view: true, can_create: false, can_update: true, can_delete: false },
      { role_id: 'r-admin', module_id: 'm-ref', can_view: true, can_create: true, can_update: false, can_delete: false },
      { role_id: 'r-admin', module_id: 'm-cust', can_view: true, can_create: true, can_update: true, can_delete: false },
      // Finance is deliberately NOT a seller, but holds the customer-create
      // grant here to prove the referrer rule refuses with its own message.
      { role_id: 'r-fin', module_id: 'm-cust', can_view: true, can_create: true, can_update: false, can_delete: false },
      { role_id: 'r-emp', module_id: 'm-red', can_view: true, can_create: true, can_update: false, can_delete: false },
    ],
    staff_users: [
      { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
      { id: VD_ID, email: 'vd@afhomes.test', full_name: 'Vic Director', status: 'active' },
      { id: ADMIN_ID, email: 'admin@afhomes.test', full_name: 'Ada Admin', status: 'active' },
      { id: EMP_ID, email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
      { id: FIN_ID, email: 'fin@afhomes.test', full_name: 'Fin Officer', status: 'active' },
    ],
    staff_role_assignments: [
      { staff_id: SM_ID, role_id: 'r-sm' },
      { staff_id: VD_ID, role_id: 'r-vd' },
      { staff_id: ADMIN_ID, role_id: 'r-admin' },
      { staff_id: EMP_ID, role_id: 'r-emp' },
      { staff_id: FIN_ID, role_id: 'r-fin' },
    ],
    staff_permission_restrictions: [],
    staff_invitations: [],
    referral_codes: [
      {
        id: CODE_ID,
        code_hash: hash(RAW_CODE),
        code_hint: 'OST-…-3456',
        sponsor_staff_id: SM_ID,
        expires_at: ahead(72),
        max_uses: 10,
        use_count: 0,
        is_active: true,
        created_by: SM_ID,
        created_at: ago(5),
      },
      {
        id: NON_SM_CODE_ID,
        code_hash: hash(NON_SM_CODE),
        code_hint: 'OST-…-0003',
        sponsor_staff_id: VD_ID,
        expires_at: ahead(72),
        max_uses: 10,
        use_count: 0,
        is_active: true,
        created_by: VD_ID,
        created_at: ago(5),
      },
    ],
    ost_applications: [],
    ost_members: [],
    referral_relationships: [],
    customers: [
      {
        id: CUSTOMER_ID,
        customer_number: 'CUS-000777',
        first_name: 'Ana',
        middle_name: 'R',
        last_name: 'Buyer',
        suffix: null,
        email: 'ana.buyer@example.invalid',
        phone: '09185550000',
        status: 'active',
        auth_user_id: AUTH_USER_ID,
        created_at: ago(500),
        updated_at: ago(100),
      },
    ],
    memberships: [
      {
        id: MEMBERSHIP_ID,
        customer_id: CUSTOMER_ID,
        sale_id: 'bbbbbbbb-0000-4000-8000-000000000001',
        membership_number: MEMBERSHIP_NUMBER,
        product_id: PLAN_ID,
        status: 'active',
        points_balance: 60000,
        yearly_points_allocated: 60000,
        fallback_code_hash: hash(FALLBACK_CODE),
        qr_token_hash: hash(QR_TOKEN),
        activated_at: ago(100),
        expires_at: ahead(24 * 300),
        renewal_due_at: ahead(24 * 300),
        issued_at: ago(100),
        created_at: ago(100),
        customers: { status: 'active' },
        card_plans: { name: 'Gold', code: 'GOLD' },
      },
    ],
    points_accounts: [
      { id: ACCOUNT_ID, membership_id: MEMBERSHIP_ID, balance: 60000, lifetime_allocated: 60000, lifetime_redeemed: 0 },
    ],
    customer_onboarding_tokens: [],
    audit_events: [],
  };
}

function install() {
  resetIdentifierRateLimit();
  holder.db = new FakeSupabase({
    tables: baseTables() as never,
    tokens: {
      [SM_TOKEN]: { id: SM_ID, email: 'sm@afhomes.test', email_confirmed_at: ago(200) },
      [VD_TOKEN]: { id: VD_ID, email: 'vd@afhomes.test', email_confirmed_at: ago(200) },
      [ADMIN_TOKEN]: { id: ADMIN_ID, email: 'admin@afhomes.test', email_confirmed_at: ago(200) },
      [EMP_TOKEN]: { id: EMP_ID, email: 'emp@afhomes.test', email_confirmed_at: ago(200) },
      [FIN_TOKEN]: { id: FIN_ID, email: 'fin@afhomes.test', email_confirmed_at: ago(200) },
      [CUSTOMER_TOKEN]: { id: AUTH_USER_ID, email: 'ana.buyer@example.invalid', email_confirmed_at: ago(200) },
    },
    rpcs: [{ fn: 'next_customer_number', result: [{ customer_number: 'CUS-009001' }] }],
    links: [
      { child: 'staff_role_assignments', parent: 'roles', fk: 'role_id' },
      { child: 'memberships', parent: 'customers', fk: 'customer_id' },
      { child: 'memberships', parent: 'card_plans', fk: 'product_id' },
      { child: 'points_accounts', parent: 'memberships', fk: 'membership_id' },
    ],
  });
  return holder.db as FakeSupabase;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

type State = { status: number; body: unknown };
const body = (s: State) => s.body as Record<string, unknown>;
const messageOf = (s: State) => (s.body as { error: { code: string; message: string } }).error.message;

async function callOst(options: { method?: string; familyPath: string; token?: string | null; body?: unknown; query?: Record<string, string> }): Promise<State> {
  const { res, state } = makeRes();
  await ost(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.familyPath,
      body: options.body,
      ...(options.token === null ? {} : { token: options.token }),
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

async function callCustomers(options: { method?: string; path: string; token?: string; body?: unknown }): Promise<State> {
  const { res, state } = makeRes();
  await customers(
    makeReq({ method: options.method ?? 'GET', familyPath: options.path, body: options.body, token: options.token }) as never,
    res as never,
  );
  return state;
}

async function callRedemptions(options: { familyPath: string; token?: string; query?: Record<string, string> }): Promise<State> {
  const { res, state } = makeRes();
  await redemptions(
    makeReq({ method: 'GET', familyPath: options.familyPath, token: options.token, query: options.query }) as never,
    res as never,
  );
  return state;
}

async function callMemberships(options: { familyPath: string; token?: string; query?: Record<string, string> }): Promise<State> {
  const { res, state } = makeRes();
  await memberships(
    makeReq({ method: 'GET', familyPath: options.familyPath, token: options.token, query: options.query }) as never,
    res as never,
  );
  return state;
}

async function callPortal(path: string): Promise<State> {
  const { res, state } = makeRes();
  await portal(makeReq({ method: 'GET', familyPath: path, token: CUSTOMER_TOKEN }) as never, res as never);
  return state;
}

/* ================================================================== */
/* OST public paths keep the Sales Manager sponsor rule                */
/* ================================================================== */

describe('OST sponsorship keeps the Sales Manager rule', () => {
  it('public resolution of a non-SM-sponsored code keeps the SM-only refusal', async () => {
    install();
    const s = await callOst({ familyPath: `referrals/${NON_SM_CODE}`, token: null });
    expect(s.status).toBe(409);
    expect(messageOf(s)).toBe('Referrals must come from an active Sales Manager');
  });

  it('public submission with a non-SM-sponsored code keeps the SM-only refusal', async () => {
    install();
    const s = await callOst({
      method: 'POST',
      familyPath: 'applications',
      token: null,
      body: { ...applicant, referralCode: NON_SM_CODE },
    });
    expect(s.status).toBe(409);
    expect(messageOf(s)).toBe('Referrals must come from an active Sales Manager');
  });

  it('public submission with an SM code still succeeds', async () => {
    const db = install();
    const s = await callOst({ method: 'POST', familyPath: 'applications', token: null, body: applicant });
    expect(s.status).toBe(201);
    expect(db.rows('ost_applications')).toHaveLength(1);
    expect(db.rows('ost_applications')[0]).toMatchObject({ sponsor_staff_id: SM_ID });
  });
});

/* ================================================================== */
/* Approval re-validates the frozen sponsor, with its own error        */
/* ================================================================== */

describe('OST approval sponsor re-validation', () => {
  it('refuses with an approval-specific error when the sponsor lapses, and never swaps the sponsor', async () => {
    const db = install();
    const submitted = await callOst({ method: 'POST', familyPath: 'applications', token: null, body: applicant });
    expect(submitted.status).toBe(201);
    const appId = (submitted.body as { applicationId: string }).applicationId;
    db.rows('staff_users').find((r) => r.id === SM_ID)!.status = 'suspended';

    vi.stubEnv('AFHOMES_ADMIN_URL', 'https://admin.afhomes.test');
    const s = await callOst({ method: 'POST', familyPath: `applications/${appId}/approve`, token: ADMIN_TOKEN, body: {} });
    expect(s.status).toBe(409);
    expect(messageOf(s)).toMatch(/cannot be approved/i);
    expect(messageOf(s)).toMatch(/sponsor is unchanged/i);
    expect(messageOf(s)).not.toBe('Referrals must come from an active Sales Manager');
    // Nothing written, sponsor frozen.
    expect(db.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(0);
    expect(db.rows('ost_applications').find((r) => r.id === appId)).toMatchObject({
      sponsor_staff_id: SM_ID,
      status: 'submitted',
    });
  });
});

/* ================================================================== */
/* Issuance validates the issuer context, not the public message       */
/* ================================================================== */

describe('referral-code issuance validates the issuer', () => {
  it('a non-SM issuing for themselves gets an issuance-specific refusal and no code row', async () => {
    const db = install();
    const before = db.rows('referral_codes').length;
    const s = await callOst({
      method: 'POST',
      familyPath: 'referral-codes',
      token: VD_TOKEN,
      body: { maxUses: 5, expiresInHours: 72 },
    });
    expect(s.status).toBe(403);
    expect(messageOf(s)).toMatch(/only an active sales manager can sponsor/i);
    expect(messageOf(s)).not.toBe('Referrals must come from an active Sales Manager');
    expect(db.rows('referral_codes')).toHaveLength(before);
  });

  it('an SM issuing for themselves still succeeds', async () => {
    install();
    const s = await callOst({
      method: 'POST',
      familyPath: 'referral-codes',
      token: SM_TOKEN,
      body: { maxUses: 5, expiresInHours: 72 },
    });
    expect(s.status).toBe(201);
    expect((s.body as { code: string }).code).toMatch(/^OST-/);
  });

  it('an admin issuing on behalf of a non-SM gets an issuance-specific refusal', async () => {
    const db = install();
    const before = db.rows('referral_codes').length;
    const s = await callOst({
      method: 'POST',
      familyPath: 'referral-codes',
      token: ADMIN_TOKEN,
      body: { maxUses: 5, expiresInHours: 72, sponsorStaffId: VD_ID },
    });
    expect(s.status).toBe(409);
    expect(messageOf(s)).toMatch(/cannot back an OST referral code/i);
    expect(db.rows('referral_codes')).toHaveLength(before);
  });

  it('an admin issuing on behalf of an SM still succeeds', async () => {
    install();
    const s = await callOst({
      method: 'POST',
      familyPath: 'referral-codes',
      token: ADMIN_TOKEN,
      body: { maxUses: 5, expiresInHours: 72, sponsorStaffId: SM_ID },
    });
    expect(s.status).toBe(201);
  });
});

/* ================================================================== */
/* Customer registration validates the referrer, never the OST rule    */
/* ================================================================== */

describe('customer registration validates the seller referrer', () => {
  it('a non-selling role with the create grant is refused with the customer-specific message', async () => {
    const db = install();
    const before = db.rows('customers').length;
    const s = await callCustomers({ method: 'POST', path: '', token: FIN_TOKEN, body: newCustomerBody });
    expect(s.status).toBe(403);
    expect(messageOf(s)).toMatch(/selling role/i);
    expect(messageOf(s)).not.toContain('Referrals must come from an active Sales Manager');
    expect(db.rows('customers')).toHaveLength(before);
  });

  it('a Sales Manager registers with a free-text referral code and stays the referrer of record', async () => {
    const db = install();
    const s = await callCustomers({ method: 'POST', path: '', token: SM_TOKEN, body: newCustomerBody });
    expect(s.status).toBe(201);
    const row = db.rows('customers').find((r) => r.email === newCustomerBody.email)!;
    expect(row.referred_by_staff_id).toBe(SM_ID);
    expect(row.referral_code_used).toBe('WALK-IN');
  });

  it('a Vice Director registers: VD is an eligible customer referrer', async () => {
    const db = install();
    const s = await callCustomers({
      method: 'POST',
      path: '',
      token: VD_TOKEN,
      body: { ...newCustomerBody, email: 'vd.referral@example.invalid' },
    });
    expect(s.status).toBe(201);
    expect(db.rows('customers').find((r) => r.email === 'vd.referral@example.invalid')).toMatchObject({
      referred_by_staff_id: VD_ID,
    });
  });
});

/* ================================================================== */
/* Persistent card-number resolution                                   */
/* ================================================================== */

describe('persistent membership-card identifier', () => {
  it('the QR envelope, the bare number and the secrets resolve to the same membership', async () => {
    install();
    const qr = await callRedemptions({ familyPath: 'resolve', token: EMP_TOKEN, query: { identifier: QR_TOKEN } });
    const fb = await callRedemptions({ familyPath: 'resolve', token: EMP_TOKEN, query: { identifier: ` ${FALLBACK_CODE.toLowerCase()} ` } });
    const envelope = await callRedemptions({ familyPath: 'resolve', token: EMP_TOKEN, query: { identifier: `AFHOMES:${MEMBERSHIP_NUMBER}` } });
    const bare = await callRedemptions({ familyPath: 'resolve', token: EMP_TOKEN, query: { identifier: MEMBERSHIP_NUMBER.toLowerCase() } });
    expect(qr.status).toBe(200);
    expect(fb.status).toBe(200);
    expect(envelope.status).toBe(200);
    expect(bare.status).toBe(200);
    for (const s of [qr, fb, envelope, bare]) {
      expect(body(s)).toMatchObject({ membershipId: MEMBERSHIP_ID, membershipNumber: MEMBERSHIP_NUMBER, redeemable: true, pointsBalance: 60000 });
    }
    expect(body(qr).matchedBy).toBe('qr');
    expect(body(fb).matchedBy).toBe('fallback_code');
    expect(body(envelope).matchedBy).toBe('card_number');
    expect(body(bare).matchedBy).toBe('card_number');
  });

  it('an unknown card number gets the same generic refusal as an unknown secret', async () => {
    install();
    const s = await callRedemptions({ familyPath: 'resolve', token: EMP_TOKEN, query: { identifier: 'AFHOMES:MBS-009999' } });
    expect(s.status).toBe(404);
    expect(messageOf(s)).toBe('No membership matches that identifier');
  });

  it('an activation-style token can never be used as a member code', async () => {
    install();
    // A base64 onboarding/secret-shaped value is not a card number and must
    // fail exactly like an unknown identifier - never resolve, never hint.
    const s = await callRedemptions({
      familyPath: 'resolve',
      token: EMP_TOKEN,
      query: { identifier: 'dG9rZW4tdmFsdWUtYWJjZGVmMDEyMzQ1Njc4OTo=' },
    });
    expect(s.status).toBe(404);
    expect(messageOf(s)).toBe('No membership matches that identifier');
  });

  it('the card QR payload carries the identifier only - no tokens, no JWT', async () => {
    install();
    const s = await callPortal('membership');
    expect(s.status).toBe(200);
    expect(body(s).qrPayload).toBe(`AFHOMES:${MEMBERSHIP_NUMBER}`);
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toMatch(/eyJ/);
    expect(serialised).not.toMatch(/onboardingToken|qr_token|fallback_code|_hash/);
  });

  it('staff card lookup resolves the persistent number too', async () => {
    install();
    const s = await callMemberships({ familyPath: 'resolve', token: EMP_TOKEN, query: { identifier: MEMBERSHIP_NUMBER } });
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({ membershipId: MEMBERSHIP_ID, membershipNumber: MEMBERSHIP_NUMBER });
  });

  it('the portal membership exposes the persistent member code and QR payload, never a hash', async () => {
    install();
    const s = await callPortal('membership');
    expect(s.status).toBe(200);
    expect(body(s)).toMatchObject({
      membershipNumber: MEMBERSHIP_NUMBER,
      memberCode: MEMBERSHIP_NUMBER,
      qrPayload: `AFHOMES:${MEMBERSHIP_NUMBER}`,
      credentialsAvailable: false,
    });
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain(hash(QR_TOKEN));
    expect(serialised).not.toContain(hash(FALLBACK_CODE));
  });
});

/* ================================================================== */
/* Card-plan presentation order                                        */
/* ================================================================== */

describe('VIP card presentation order is Gold, Silver, Bronze', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  it('the reference seed pins GOLD 10, SILVER 20, BRONZE 30', () => {
    const seed = fs.readFileSync(path.join(ROOT, 'supabase/seed.ts'), 'utf8');
    const gold = seed.indexOf("'GOLD'");
    const silver = seed.indexOf("'SILVER'");
    const bronze = seed.indexOf("'BRONZE'");
    expect(gold).toBeGreaterThan(-1);
    expect(silver).toBeGreaterThan(-1);
    expect(bronze).toBeGreaterThan(-1);
    // Reference tiers are declared Gold-first.
    expect(gold).toBeLessThan(silver);
    expect(silver).toBeLessThan(bronze);
    // sort_order rides in the same VALUES row: 10 / 20 / 30.
    expect(seed).toMatch(/'GOLD'[^;]*?,10\)/);
    expect(seed).toMatch(/'SILVER'[^;]*?,20\)/);
    expect(seed).toMatch(/'BRONZE'[^;]*?,30\)/);
  });

  it('the order migration pins the same values without touching economics', () => {
    const file = fs
      .readdirSync(path.join(ROOT, 'supabase/migrations'))
      .filter((n) => n.endsWith('_afhomes_card_plan_order.sql'))
      .sort()[0];
    expect(file).toBeTruthy();
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', file!), 'utf8');
    expect(sql).toMatch(/where code = 'GOLD'/);
    expect(sql).toMatch(/where code = 'SILVER'/);
    expect(sql).toMatch(/where code = 'BRONZE'/);
    expect(sql).toMatch(/sort_order = 10/);
    expect(sql).toMatch(/sort_order = 20/);
    expect(sql).toMatch(/sort_order = 30/);
    expect(sql).not.toMatch(/cash_price|yearly_points|commission/i);
  });
});
