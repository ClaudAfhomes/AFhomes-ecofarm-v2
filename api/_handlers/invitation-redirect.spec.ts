/**
 * Phase 1 (JAD parity) staff-creation integrity, executed as tests.
 *
 * Standard staff onboarding creates the Supabase Auth identity FIRST with an
 * administrator-set temporary password (`auth.admin.createUser`,
 * email pre-confirmed) and only then writes database rows, deleting the
 * orphan Auth user when later writes fail. The legacy invitation callback
 * (`inviteUserByEmail` + redirect) is NOT part of this path: creation works
 * with no admin redirect configured, writes no `staff_invitations` row, and
 * never stores or logs the secret. (The OST approval flow below still uses
 * invitations - that surface is out of scope for Phase 1.)
 *
 * These tests pin the redirect-independence, the Auth-first ordering, and
 * the failure semantics. They do not send email and never touch the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseTables, baseTokens, TOKEN, UUID } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const afhomes = (await import('./admin/afhomes.js')).default;
const ost = (await import('./ost.js')).default;

const ADMIN_URL = 'https://afhomes.test/admin';
const ACTIVATION_URL = `${ADMIN_URL}/activate-account`;

beforeEach(() => {
  vi.stubEnv('AFHOMES_ADMIN_URL', ADMIN_URL);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function staffWorld(
  options: {
    createUser?: (attrs: {
      email: string;
      password?: string;
      email_confirm?: boolean;
      user_metadata?: unknown;
    }) => Promise<unknown>;
    writeErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    unique: {
      staff_users: [['id'], ['email']],
      staff_role_assignments: [['staff_id']],
      staff_invitations: [['email', 'status']],
    },
    defaults: { staff_invitations: { status: 'pending' } },
    createUser: options.createUser,
    createUserId: 'new-staff-0001',
    writeErrors: options.writeErrors,
  });
  return holder.db as FakeSupabase;
}

async function createStaff(body: unknown, token: string = TOKEN.admin) {
  const { res, state } = makeRes();
  await afhomes(makeReq({ method: 'POST', afPath: 'staff', body, token }) as never, res as never);
  return state;
}

const createCall = (db: FakeSupabase) =>
  db.calls.find((call) => call.op === 'createUser') as
    { op: string; table: string; arg: { email: string; email_confirm?: boolean } } | undefined;

const inviteCall = (db: FakeSupabase) =>
  db.calls.find((call) => call.op === 'inviteUserByEmail') as
    { op: string; table: string; arg: { email: string; opts: { redirectTo: string } } } | undefined;

const TEMP_PASSWORD = 'TempPass123';

describe('staff creation integrity (temporary-password onboarding)', () => {
  it('creates the Auth identity pre-confirmed with no invitation and no redirect', async () => {
    vi.stubEnv('AFHOMES_ADMIN_URL', '');
    delete process.env.AFHOMES_ADMIN_URL;
    const db = staffWorld();
    const state = await createStaff({
      email: 'new.hire@afhomes.test',
      fullName: 'New Hire',
      departmentId: null,
      roleId: UUID.role.employee,
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(state.status).toBe(201);
    const call = createCall(db);
    expect(call?.arg.email).toBe('new.hire@afhomes.test');
    // Pre-confirmed: the member signs in with the temporary password, so no
    // email round-trip and no redirect value can influence the flow.
    expect(call?.arg.email_confirm).toBe(true);
    expect(db.calls.some((call) => call.op === 'inviteUserByEmail')).toBe(false);
    expect(db.rows('staff_invitations')).toHaveLength(0);
    const row = db.rows('staff_users').find((r) => r.email === 'new.hire@afhomes.test')!;
    expect(row.status).toBe('active');
    expect(row.must_change_password).toBe(true);
  });

  it('commits no staff rows when Auth creation fails', async () => {
    const db = staffWorld({
      createUser: async () => ({
        data: { user: null },
        error: { message: 'Error creating user' },
      }),
    });
    const state = await createStaff({
      email: 'unlucky@afhomes.test',
      fullName: 'Unlucky',
      departmentId: null,
      roleId: UUID.role.employee,
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(state.status).toBe(409);
    expect(db.rows('staff_users').some((row) => row.email === 'unlucky@afhomes.test')).toBe(false);
    expect(db.rows('staff_invitations')).toHaveLength(0);
    expect(db.createdAuthUsers).toHaveLength(0);
  });

  it('creates staff with no admin redirect target and no Auth side effects on duplicates', async () => {
    vi.stubEnv('AFHOMES_ADMIN_URL', '');
    delete process.env.AFHOMES_ADMIN_URL;
    const db = staffWorld();
    const state = await createStaff({
      email: 'noroute@afhomes.test',
      fullName: 'No Route',
      departmentId: null,
      roleId: UUID.role.employee,
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(state.status).toBe(201);
    expect(db.createdAuthUsers).toHaveLength(1);
  });

  it('rejects a duplicate email before touching Auth and removes the orphan on a later write failure', async () => {
    const db = staffWorld();
    db.rows('staff_users').push({
      id: 'clash-0001',
      email: 'clash@afhomes.test',
      full_name: 'Clash',
      status: 'active',
    });
    const clash = await createStaff({
      email: 'clash@afhomes.test',
      fullName: 'Clash Two',
      departmentId: null,
      roleId: UUID.role.employee,
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(clash.status).toBe(409);
    // The duplicate is refused up front: no Auth user is created, so none
    // needs deleting.
    expect(db.createdAuthUsers).toHaveLength(0);
    expect(db.deletedAuthUsers).toHaveLength(0);
  });

  it('removes the orphan Auth user when a later staff write fails', async () => {
    const db = staffWorld({
      writeErrors: { staff_role_assignments: { message: 'assignment failed' } },
    });
    const state = await createStaff({
      email: 'orphan@afhomes.test',
      fullName: 'Orphan Annie',
      departmentId: null,
      roleId: UUID.role.employee,
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(state.status).toBe(500);
    expect(db.deletedAuthUsers).toContain('new-staff-0001');
  });
});

/* ------------------------------------------------------------------ */
/* OST approval invitation                                             */
/* ------------------------------------------------------------------ */

const SM_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_TOKEN = 'token-admin-ost';
const APP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const NEW_OST_ID = '66666666-6666-4666-8666-666666666666';

function ostWorld() {
  holder.db = new FakeSupabase({
    tables: {
      modules: [{ id: 'm-reg', key: 'network.ost_registrations', is_active: true }],
      roles: [
        { id: 'r-admin', slug: 'admin', name: 'Admin', is_active: true },
        { id: 'r-sm', slug: 'sales_manager', name: 'SM', is_active: true },
        { id: 'r-ost', slug: 'ost', name: 'OST', is_active: true },
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
      ],
      staff_users: [
        { id: ADMIN_ID, email: 'admin@afhomes.test', full_name: 'Admin', status: 'active' },
        { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
      ],
      staff_role_assignments: [
        { staff_id: ADMIN_ID, role_id: 'r-admin' },
        { staff_id: SM_ID, role_id: 'r-sm' },
      ],
      ost_applications: [
        {
          id: APP_ID,
          referral_code_id: null,
          sponsor_staff_id: SM_ID,
          email: 'oscar@example.invalid',
          phone: '+639171234567',
          first_name: 'Oscar',
          middle_name: null,
          last_name: 'Trainee',
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
        },
      ],
      ost_members: [],
      referral_relationships: [],
      staff_invitations: [],
      audit_events: [],
    } as never,
    tokens: {
      [ADMIN_TOKEN]: { id: ADMIN_ID, email: 'admin@afhomes.test', email_confirmed_at: ago() },
    },
    inviteUserId: NEW_OST_ID,
    rpcs: [{ fn: 'next_ost_number', result: [{ ost_number: 'OST-000001' }] }],
  });
  return holder.db as FakeSupabase;
}

const ago = () => new Date(Date.now() - 3600_000).toISOString();

describe('OST invitation readiness', () => {
  it('invites the approved applicant with the admin redirect and links every record', async () => {
    const db = ostWorld();
    const { res, state } = makeRes();
    await ost(
      makeReq({
        method: 'POST',
        familyPath: `applications/${APP_ID}/approve`,
        token: ADMIN_TOKEN,
        body: {},
      }) as never,
      res as never,
    );
    expect(state.status).toBe(201);
    const call = inviteCall(db);
    expect(call?.arg.email).toBe('oscar@example.invalid');
    expect(call?.arg.opts.redirectTo).toBe(ACTIVATION_URL);
    // Staff profile, role, invitation, member, and genealogy edge all point
    // at the invited Auth user; the frozen sponsor is the stored one.
    expect(db.rows('staff_users').find((row) => row.id === NEW_OST_ID)?.status).toBe('invited');
    expect(
      db.rows('staff_role_assignments').find((row) => row.staff_id === NEW_OST_ID)?.role_id,
    ).toBe('r-ost');
    expect(db.rows('ost_members').find((row) => row.application_id === APP_ID)).toMatchObject({
      id: NEW_OST_ID,
      sponsor_staff_id: SM_ID,
    });
    expect(
      db.rows('referral_relationships').find((row) => row.subject_staff_id === NEW_OST_ID),
    ).toMatchObject({ upline_staff_id: SM_ID, hierarchy_role: 'ost' });
  });

  it('a repeat approval is idempotent: one member, no duplicate OST accounts', async () => {
    const db = ostWorld();
    const approve = async () => {
      const { res, state } = makeRes();
      await ost(
        makeReq({
          method: 'POST',
          familyPath: `applications/${APP_ID}/approve`,
          token: ADMIN_TOKEN,
          body: {},
        }) as never,
        res as never,
      );
      return state;
    };
    expect((await approve()).status).toBe(201);
    // Repeat returns the existing member (200), never a second account.
    expect((await approve()).status).toBe(200);
    expect(db.rows('ost_members').filter((row) => row.application_id === APP_ID)).toHaveLength(1);
    expect(
      db.rows('referral_relationships').filter((row) => row.subject_staff_id === NEW_OST_ID),
    ).toHaveLength(1);
  });
});
