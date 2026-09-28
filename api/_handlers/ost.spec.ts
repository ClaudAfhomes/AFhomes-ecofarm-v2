/**
 * AF Homes Phase 8 - OST registration and approval handler tests.
 *
 * Drives the REAL handler, the REAL staff principal resolver, the REAL
 * contracts and the REAL code hashing against the in-memory Supabase fake.
 * The load-bearing assertions are the spoof and scope ones: no sponsor id
 * from the browser is ever honored, an unrelated SM sees nothing, and a
 * repeat approval cannot mint a second member.
 */
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOstRegistrationUrl, normalizeOstReferralCode } from '@jad/contracts';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const ost = (await import('./ost.js')).default;
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');
const { selectHandler } = await import('../_lib/router.js');
const routerSource = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../_lib/router.ts', import.meta.url), 'utf8'),
);

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SM_ID = '22222222-2222-4222-8222-222222222222';
const SM2_ID = '22222222-2222-4222-8222-222222222223';
const ADMIN_SPONSOR_ID = '33333333-3333-4333-8333-333333333333';
const SUSPENDED_SM_ID = '44444444-4444-4444-8444-444444444444';
const OST_ID = '55555555-5555-4555-8555-555555555555';
const NEW_OST_ID = '66666666-6666-4666-8666-666666666666';
const EMP_ID = '77777777-7777-4777-8777-777777777777';

const ADMIN_TOKEN = 'token-admin';
const SM_TOKEN = 'token-sm';
const SM2_TOKEN = 'token-sm2';
const OST_TOKEN = 'token-ost';
const EMP_TOKEN = 'token-emp';

const RAW_CODE = 'OST-ABCDEF-123456';
const CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const EXPIRED_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const INACTIVE_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const NON_SM_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const SUSPENDED_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const EXHAUSTED_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const SM2_CODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';

const APP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const SM2_APP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

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

function baseTables(): Record<string, Row[]> {
  return {
    modules: [
      { id: 'm-reg', key: 'network.ost_registrations', is_active: true },
      { id: 'm-mem', key: 'network.ost_members', is_active: true },
      { id: 'm-ref', key: 'network.referrals', is_active: true },
    ],
    roles: [
      { id: 'r-admin', slug: 'admin', name: 'Admin', is_active: true },
      { id: 'r-sm', slug: 'sales_manager', name: 'Sales Manager', is_active: true },
      { id: 'r-ost', slug: 'ost', name: 'OST', is_active: true },
      { id: 'r-emp', slug: 'employee', name: 'Employee', is_active: true },
    ],
    role_permissions: [
      {
        role_id: 'r-admin',
        module_id: 'm-reg',
        can_view: true,
        can_create: false,
        can_update: true,
        can_delete: false,
      },
      {
        role_id: 'r-admin',
        module_id: 'm-mem',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-admin',
        module_id: 'm-ref',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-sm',
        module_id: 'm-reg',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-sm',
        module_id: 'm-mem',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_id: 'r-sm',
        module_id: 'm-ref',
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
    ],
    staff_users: [
      { id: ADMIN_ID, email: 'admin@afhomes.test', full_name: 'Ada Admin', status: 'active' },
      { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
      { id: SM2_ID, email: 'sm2@afhomes.test', full_name: 'Sue Manager', status: 'active' },
      {
        id: ADMIN_SPONSOR_ID,
        email: 'boss@afhomes.test',
        full_name: 'Boss Admin',
        status: 'active',
      },
      {
        id: SUSPENDED_SM_ID,
        email: 'sus@afhomes.test',
        full_name: 'Sus Pended',
        status: 'suspended',
      },
      { id: OST_ID, email: 'ost@afhomes.test', full_name: 'Ollie Seller', status: 'active' },
      { id: EMP_ID, email: 'emp@afhomes.test', full_name: 'Em Ployee', status: 'active' },
    ],
    staff_role_assignments: [
      { staff_id: ADMIN_ID, role_id: 'r-admin' },
      { staff_id: SM_ID, role_id: 'r-sm' },
      { staff_id: SM2_ID, role_id: 'r-sm' },
      { staff_id: ADMIN_SPONSOR_ID, role_id: 'r-admin' },
      { staff_id: SUSPENDED_SM_ID, role_id: 'r-sm' },
      { staff_id: OST_ID, role_id: 'r-ost' },
      { staff_id: EMP_ID, role_id: 'r-emp' },
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
        id: EXPIRED_CODE_ID,
        code_hash: hash('OST-FFFFFE-000001'),
        code_hint: 'OST-…-0001',
        sponsor_staff_id: SM_ID,
        expires_at: ago(2),
        max_uses: 10,
        use_count: 0,
        is_active: true,
        created_by: SM_ID,
        created_at: ago(50),
      },
      {
        id: INACTIVE_CODE_ID,
        code_hash: hash('OST-FFFFFD-000002'),
        code_hint: 'OST-…-0002',
        sponsor_staff_id: SM_ID,
        expires_at: ahead(72),
        max_uses: 10,
        use_count: 0,
        is_active: false,
        created_by: SM_ID,
        created_at: ago(5),
      },
      {
        id: NON_SM_CODE_ID,
        code_hash: hash('OST-FFFFFC-000003'),
        code_hint: 'OST-…-0003',
        sponsor_staff_id: ADMIN_SPONSOR_ID,
        expires_at: ahead(72),
        max_uses: 10,
        use_count: 0,
        is_active: true,
        created_by: ADMIN_SPONSOR_ID,
        created_at: ago(5),
      },
      {
        id: SUSPENDED_CODE_ID,
        code_hash: hash('OST-FFFFFB-000004'),
        code_hint: 'OST-…-0004',
        sponsor_staff_id: SUSPENDED_SM_ID,
        expires_at: ahead(72),
        max_uses: 10,
        use_count: 0,
        is_active: true,
        created_by: SUSPENDED_SM_ID,
        created_at: ago(5),
      },
      {
        id: EXHAUSTED_CODE_ID,
        code_hash: hash('OST-FFFFFA-000005'),
        code_hint: 'OST-…-0005',
        sponsor_staff_id: SM_ID,
        expires_at: ahead(72),
        max_uses: 1,
        use_count: 1,
        is_active: true,
        created_by: SM_ID,
        created_at: ago(5),
      },
      {
        id: SM2_CODE_ID,
        code_hash: hash('OST-BBCCDD-778899'),
        code_hint: 'OST-…-8899',
        sponsor_staff_id: SM2_ID,
        expires_at: ahead(72),
        max_uses: 10,
        use_count: 0,
        is_active: true,
        created_by: SM2_ID,
        created_at: ago(5),
      },
    ],
    ost_applications: [],
    ost_members: [
      {
        id: OST_ID,
        application_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0',
        sponsor_staff_id: SM_ID,
        ost_number: 'OST-000007',
        full_name: 'Ollie Seller',
        email: 'ost@afhomes.test',
        phone: '+639170000007',
        status: 'active',
        approved_by: ADMIN_ID,
        approved_at: ago(100),
        created_at: ago(100),
      },
    ],
    referral_relationships: [],
    audit_events: [],
  };
}

function install(
  tables?: Record<string, Row[]>,
  opts: {
    inviteUserId?: string;
    invite?: (email: string, options: unknown) => Promise<unknown>;
    unique?: Record<string, string[][]>;
  } = {},
) {
  resetIdentifierRateLimit();
  vi.stubEnv('AFHOMES_ADMIN_URL', 'https://admin.afhomes.test');
  vi.stubEnv('AFHOMES_WEB_URL', 'https://web.afhomes.test');
  const db = new FakeSupabase({
    tables: (tables ?? baseTables()) as never,
    tokens: {
      [ADMIN_TOKEN]: { id: ADMIN_ID, email: 'admin@afhomes.test', email_confirmed_at: ago(200) },
      [SM_TOKEN]: { id: SM_ID, email: 'sm@afhomes.test', email_confirmed_at: ago(200) },
      [SM2_TOKEN]: { id: SM2_ID, email: 'sm2@afhomes.test', email_confirmed_at: ago(200) },
      [OST_TOKEN]: { id: OST_ID, email: 'ost@afhomes.test', email_confirmed_at: ago(200) },
      [EMP_TOKEN]: { id: EMP_ID, email: 'emp@afhomes.test', email_confirmed_at: ago(200) },
    },
    inviteUserId: opts.inviteUserId ?? NEW_OST_ID,
    invite: opts.invite,
    unique: opts.unique,
    rpcs: [{ fn: 'next_ost_number', result: [{ ost_number: 'OST-000001' }] }],
  });
  holder.db = db as unknown;
  return db;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

const submit = async (db: FakeSupabase, body: unknown) => {
  const { res, state } = makeRes();
  await ost(makeReq({ method: 'POST', familyPath: 'applications', body }) as never, res as never);
  void db;
  return state;
};

/* ------------------------------------------------------------------ */

describe('OST referral resolution', () => {
  it('1. resolves a valid SM code without exposing hashes or ids', async () => {
    install();
    const { res, state } = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: `referrals/${RAW_CODE}` }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ sponsorName: 'Sam Manager', codeHint: 'OST-…-3456' });
    expect(JSON.stringify(state.body)).not.toContain('code_hash');
    expect(JSON.stringify(state.body)).not.toContain(SM_ID);
  });

  it('2. rejects a code whose sponsor is not a Sales Manager', async () => {
    install();
    const { res, state } = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: 'referrals/OST-FFFFFC-000003' }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
  });

  it('3. rejects a code whose sponsor is suspended', async () => {
    install();
    const { res, state } = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: 'referrals/OST-FFFFFB-000004' }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
  });

  it('4. rejects expired, inactive, exhausted and unknown codes', async () => {
    install();
    for (const code of [
      'OST-FFFFFE-000001',
      'OST-FFFFFD-000002',
      'OST-FFFFFA-000005',
      'OST-000000-000000',
    ]) {
      const { res, state } = makeRes();
      await ost(makeReq({ method: 'GET', familyPath: `referrals/${code}` }) as never, res as never);
      expect(state.status, code).not.toBe(200);
    }
  });
});

describe('OST application submission', () => {
  it('5. freezes the sponsor from the code: a smuggled sponsor id is ignored', async () => {
    const db = install();
    const state = await submit(db, { ...applicant, sponsorStaffId: SM2_ID });
    expect(state.status).toBe(201);
    const rows = (holder.db as FakeSupabase).rows('ost_applications');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sponsor_staff_id).toBe(SM_ID);
    expect(rows[0]!.referral_code_id).toBe(CODE_ID);
    expect(rows[0]!.status).toBe('submitted');
  });

  it('6. accepts a valid application and audits without secrets', async () => {
    install();
    const state = await submit(holder.db as FakeSupabase, applicant);
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({ status: 'submitted' });
    const audits = (holder.db as FakeSupabase).rows('audit_events');
    expect(audits.map((a) => a.action)).toContain('OST_APPLICATION_SUBMITTED');
    expect(JSON.stringify(audits)).not.toContain(RAW_CODE);
    expect(JSON.stringify(audits)).not.toContain(hash(RAW_CODE));
  });

  it('7. blocks a duplicate pending application for the same email', async () => {
    const db = install();
    expect((await submit(db, applicant)).status).toBe(201);
    const retry = await submit(db, { ...applicant, firstName: 'Oscar2' });
    expect(retry.status).toBe(409);
  });

  it('8. denies unauthenticated and unpermissioned application listing', async () => {
    install();
    const anon = makeRes();
    await ost(makeReq({ method: 'GET', familyPath: 'applications' }) as never, anon.res as never);
    expect(anon.state.status).toBe(401);
    const emp = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: 'applications', token: EMP_TOKEN }) as never,
      emp.res as never,
    );
    expect(emp.state.status).toBe(403);
  });
});

describe('OST review and approval', () => {
  async function submittedApp() {
    const db = install(undefined, { inviteUserId: NEW_OST_ID });
    const state = await submit(db, applicant);
    expect(state.status).toBe(201);
    return (state.body as { applicationId: string }).applicationId;
  }

  it('9. approves: staff identity, OST role, member, genealogy, audits', async () => {
    const db = install(undefined, { inviteUserId: NEW_OST_ID });
    const appId = ((await submit(db, applicant).then((s) => s.body)) as { applicationId: string })
      .applicationId;
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      applicationId: appId,
      sponsorStaffId: SM_ID,
      ostNumber: 'OST-000001',
    });

    const fake = holder.db as FakeSupabase;
    expect(fake.rows('staff_users').find((r) => r.id === NEW_OST_ID)?.status).toBe('invited');
    expect(
      fake.rows('staff_role_assignments').find((r) => r.staff_id === NEW_OST_ID)?.role_id,
    ).toBe('r-ost');
    const member = fake.rows('ost_members').find((r) => r.application_id === appId);
    expect(member).toMatchObject({ id: NEW_OST_ID, sponsor_staff_id: SM_ID, status: 'active' });
    const edge = fake.rows('referral_relationships').find((r) => r.subject_staff_id === NEW_OST_ID);
    expect(edge).toMatchObject({ upline_staff_id: SM_ID, hierarchy_role: 'ost', is_active: true });
    const actions = fake.rows('audit_events').map((a) => a.action);
    expect(actions).toContain('OST_APPLICATION_APPROVED');
    expect(actions).toContain('OST_MEMBER_ACTIVATED');
    expect(fake.rows('ost_applications').find((r) => r.id === appId)?.status).toBe('approved');
  });

  it('10. repeat approval is idempotent: one member, one edge', async () => {
    install(undefined, { inviteUserId: NEW_OST_ID });
    const appId = (
      (await submit(holder.db as FakeSupabase, applicant)).body as { applicationId: string }
    ).applicationId;
    const first = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      first.res as never,
    );
    expect(first.state.status).toBe(201);
    const second = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      second.res as never,
    );
    expect(second.state.status).toBe(200);
    const fake = holder.db as FakeSupabase;
    expect(fake.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(1);
    expect(
      fake.rows('referral_relationships').filter((r) => r.subject_staff_id === NEW_OST_ID),
    ).toHaveLength(1);
  });

  it('11. rejects with a reason and refuses a later approval', async () => {
    install();
    const appId = (
      (await submit(holder.db as FakeSupabase, applicant)).body as { applicationId: string }
    ).applicationId;
    const bad = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/reject`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      bad.res as never,
    );
    expect(bad.state.status).toBe(400);
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/reject`,
        token: ADMIN_TOKEN,
        body: { reason: 'Documents do not match the applicant' },
      }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ status: 'rejected' });
    const late = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      late.res as never,
    );
    expect(late.state.status).toBe(409);
    expect((holder.db as FakeSupabase).rows('audit_events').map((a) => a.action)).toContain(
      'OST_APPLICATION_REJECTED',
    );
  });

  it('requests changes with notes and an audit event', async () => {
    install();
    const appId = (
      (await submit(holder.db as FakeSupabase, applicant)).body as { applicationId: string }
    ).applicationId;
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/request-changes`,
        token: ADMIN_TOKEN,
        body: { notes: 'Please upload a clearer identity scan.' },
      }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      status: 'changes_requested',
      reviewNotes: 'Please upload a clearer identity scan.',
    });
    expect((holder.db as FakeSupabase).rows('audit_events').map((a) => a.action)).toContain(
      'OST_APPLICATION_CHANGES_REQUESTED',
    );
  });

  it('12. the sponsor stays frozen: approval uses the stored sponsor', async () => {
    install(undefined, { inviteUserId: NEW_OST_ID });
    const appId = (
      (await submit(holder.db as FakeSupabase, applicant)).body as { applicationId: string }
    ).applicationId;
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: ADMIN_TOKEN,
        body: { sponsorStaffId: SM2_ID },
      }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    const edge = (holder.db as FakeSupabase)
      .rows('referral_relationships')
      .find((r) => r.subject_staff_id === NEW_OST_ID);
    expect(edge?.upline_staff_id).toBe(SM_ID);
  });

  it('16. blocks approval when the sponsor is no longer an SM', async () => {
    const tables = baseTables();
    const db = install(tables, { inviteUserId: NEW_OST_ID });
    const appId = ((await submit(db, applicant)).body as { applicationId: string }).applicationId;
    // The sponsor is demoted after submission: approval must refuse.
    const assignment = db.rows('staff_role_assignments').find((r) => r.staff_id === SM_ID)!;
    assignment.role_id = 'r-emp';
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
    expect(db.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(0);
  });

  it('SM cannot approve (no update grant) even their own pipeline', async () => {
    install();
    const appId = (
      (await submit(holder.db as FakeSupabase, applicant)).body as { applicationId: string }
    ).applicationId;
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token: SM_TOKEN,
        body: {},
      }) as never,
      res as never,
    );
    expect(state.status).toBe(403);
  });
});

describe('OST visibility scopes', () => {
  function tablesWithTwoApps(): Record<string, Row[]> {
    const tables = baseTables();
    tables.ost_applications = [
      {
        id: APP_ID,
        referral_code_id: CODE_ID,
        sponsor_staff_id: SM_ID,
        email: 'a@example.invalid',
        phone: '+639170000011',
        first_name: 'A',
        middle_name: null,
        last_name: 'One',
        birth_date: '1990-01-01',
        address: {},
        registration_details: {},
        status: 'submitted',
        review_notes: null,
        reviewed_by: null,
        submitted_at: ago(3),
        reviewed_at: null,
      },
      {
        id: SM2_APP_ID,
        referral_code_id: SM2_CODE_ID,
        sponsor_staff_id: SM2_ID,
        email: 'b@example.invalid',
        phone: '+639170000022',
        first_name: 'B',
        middle_name: null,
        last_name: 'Two',
        birth_date: '1991-02-02',
        address: {},
        registration_details: {},
        status: 'submitted',
        review_notes: null,
        reviewed_by: null,
        submitted_at: ago(2),
        reviewed_at: null,
      },
    ];
    return tables;
  }

  it('18. an SM sees only their own sponsored applications', async () => {
    install(tablesWithTwoApps());
    const { res, state } = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: 'applications', token: SM_TOKEN }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect((state.body as { data: { id: string }[] }).data.map((r) => r.id)).toEqual([APP_ID]);
  });

  it('19. an unrelated SM cannot open another sponsor application', async () => {
    install(tablesWithTwoApps());
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'GET',
        familyPath: `applications/${APP_ID}`,
        token: SM2_TOKEN,
      }) as never,
      res as never,
    );
    expect(state.status).toBe(404);
  });

  it('20. an OST reads only itself', async () => {
    install(tablesWithTwoApps());
    const own = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: `members/${OST_ID}`, token: OST_TOKEN }) as never,
      own.res as never,
    );
    expect(own.state.status).toBe(200);
    const other = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: 'members', token: OST_TOKEN }) as never,
      other.res as never,
    );
    expect(other.state.status).toBe(200);
    expect((other.state.body as { data: { id: string }[] }).data.map((r) => r.id)).toEqual([
      OST_ID,
    ]);
  });
});

describe('OST approval state guards', () => {
  async function approve(appId: string, token = ADMIN_TOKEN, body: unknown = {}) {
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${appId}/approve`,
        token,
        body,
      }) as never,
      res as never,
    );
    return state;
  }

  function seedApplication(db: FakeSupabase, over: Row): string {
    const id = String(over.id);
    db.rows('ost_applications').push({
      referral_code_id: CODE_ID,
      sponsor_staff_id: SM_ID,
      email: 'quinn@example.invalid',
      phone: '+639171234567',
      first_name: 'Quinn',
      middle_name: null,
      last_name: 'Applicant',
      birth_date: '1994-03-03',
      address: { line1: '9 Farm Road', city: 'Tagaytay', province: 'Cavite', countryCode: 'PH' },
      registration_details: {},
      status: 'submitted',
      review_notes: null,
      reviewed_by: null,
      submitted_at: ago(10),
      reviewed_at: null,
      ...over,
      id,
    });
    return id;
  }

  it('23. a withdrawn application cannot be approved or rejected', async () => {
    const db = install(undefined, { inviteUserId: NEW_OST_ID });
    const id = seedApplication(db, { id: APP_ID, status: 'withdrawn' });
    expect((await approve(id)).status).toBe(409);
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${id}/reject`,
        token: ADMIN_TOKEN,
        body: { reason: 'Too late to reject.' },
      }) as never,
      res as never,
    );
    expect(state.status).toBe(409);
    expect(db.rows('ost_members')).toHaveLength(1);
  });

  it('24. reviewable states (under_review, changes_requested) approve normally', async () => {
    for (const status of ['under_review', 'changes_requested']) {
      const db = install(undefined, { inviteUserId: NEW_OST_ID });
      const id = seedApplication(db, { id: APP_ID, status });
      const state = await approve(id);
      expect(state.status, status).toBe(201);
      expect(db.rows('ost_members').filter((r) => r.application_id === id)).toHaveLength(1);
    }
  });

  it('25. a suspended sponsor at approval time is refused with nothing written', async () => {
    const db = install(undefined, { inviteUserId: NEW_OST_ID });
    const appId = ((await submit(db, applicant)).body as { applicationId: string }).applicationId;
    db.rows('staff_users').find((r) => r.id === SM_ID)!.status = 'suspended';
    expect((await approve(appId)).status).toBe(409);
    expect(db.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(0);
    expect(
      db.rows('referral_relationships').filter((r) => r.upline_staff_id === SM_ID),
    ).toHaveLength(0);
  });

  it('26. a duplicate email in different case is refused while reviewable', async () => {
    const db = install();
    expect((await submit(db, applicant)).status).toBe(201);
    expect((await submit(db, { ...applicant, email: 'OSCAR@EXAMPLE.INVALID' })).status).toBe(409);
  });

  it('27. an email is reusable after a terminal decision', async () => {
    for (const status of ['rejected', 'withdrawn']) {
      const db = install();
      seedApplication(db, { id: APP_ID, status, email: applicant.email });
      expect((await submit(db, applicant)).status).toBe(201);
    }
  });

  it('28. an email stays blocked while changes are requested', async () => {
    const db = install();
    seedApplication(db, { id: APP_ID, status: 'changes_requested', email: applicant.email });
    expect((await submit(db, applicant)).status).toBe(409);
  });

  it('29. approval without an admin URL fails closed before inviting', async () => {
    const db = install(undefined, { inviteUserId: NEW_OST_ID });
    const appId = ((await submit(db, applicant)).body as { applicationId: string }).applicationId;
    vi.unstubAllEnvs();
    expect((await approve(appId)).status).toBe(500);
    expect(db.calls.filter((c) => c.op === 'inviteUserByEmail')).toHaveLength(0);
    expect(db.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(0);
  });

  it('30. an invitation failure writes nothing', async () => {
    const db = install(undefined, {
      invite: async () => ({ data: { user: null }, error: { message: 'GoTrue is down' } }),
    });
    const appId = ((await submit(db, applicant)).body as { applicationId: string }).applicationId;
    expect((await approve(appId)).status).toBe(409);
    expect(db.rows('staff_users').find((r) => r.email === applicant.email)).toBeUndefined();
    expect(db.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(0);
    expect(db.calls.filter((c) => c.op === 'deleteUser')).toHaveLength(0);
  });

  it('31. a database failure after the invite cleans up the orphan Auth user', async () => {
    const db = install(undefined, {
      inviteUserId: NEW_OST_ID,
      unique: { staff_role_assignments: [['staff_id']] },
    });
    // A prior partial run left the assignment behind; the member insert would
    // land next, so the approval must unwind the Auth user it just invited.
    db.rows('staff_role_assignments').push({ staff_id: NEW_OST_ID, role_id: 'r-ost' });
    const appId = ((await submit(db, applicant)).body as { applicationId: string }).applicationId;
    expect((await approve(appId)).status).toBe(409);
    expect(
      db.calls.filter((c) => c.op === 'deleteUser' && String(c.arg) === NEW_OST_ID),
    ).toHaveLength(1);
    expect(db.rows('ost_members').filter((r) => r.application_id === appId)).toHaveLength(0);
    expect(
      db.rows('referral_relationships').filter((r) => r.subject_staff_id === NEW_OST_ID),
    ).toHaveLength(0);
    expect(db.rows('ost_applications').find((r) => r.id === appId)?.status).toBe('submitted');
  });

  it('32. the issued OST number is non-blank and sequenced', async () => {
    const db = install(undefined, { inviteUserId: NEW_OST_ID });
    const appId = ((await submit(db, applicant)).body as { applicationId: string }).applicationId;
    const state = await approve(appId);
    expect(state.status).toBe(201);
    const ostNumber = (state.body as { ostNumber: string }).ostNumber;
    expect(ostNumber).toMatch(/^OST-\d{6}$/);
    expect(db.rows('ost_members').find((r) => r.application_id === appId)?.ost_number).toBe(
      ostNumber,
    );
  });

  it('33. an anonymous caller cannot open an application by id', async () => {
    install();
    const { res, state } = makeRes();
    await ost(
      makeReq({ method: 'GET', familyPath: `applications/${APP_ID}` }) as never,
      res as never,
    );
    expect(state.status).toBe(401);
  });
});

describe('OST referral QR transport', () => {
  it('21. the QR encodes the registration URL and nothing else', () => {
    expect(buildOstRegistrationUrl(RAW_CODE, 'https://web.afhomes.test')).toBe(
      'https://web.afhomes.test/ost/register?code=OST-ABCDEF-123456',
    );
    expect(normalizeOstReferralCode('  ost-abcdef-123456 ')).toBe(RAW_CODE);
  });

  it('22. the ost family is packaged for Vercel', () => {
    const q: Record<string, string | undefined> = {};
    expect(selectHandler('/api/v1/ost/applications', q)?.routeKey).toBe('ost/applications');
    expect(q.familyPath).toBe('applications');
    expect(routerSource).toContain('../_handlers/ost.js');
  });
});
