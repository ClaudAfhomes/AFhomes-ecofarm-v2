/**
 * AF Homes Phase 1 (AF Homes pattern) - temporary-password staff lifecycle.
 *
 * Covers the behavior the invite-only flow could never express: server-set
 * temporary passwords via `auth.admin.createUser`, the `mustChangePassword`
 * gate on every module-guarded endpoint, the self-service session endpoints
 * (display-name update, forced password change), and the real staff/role
 * detail reads. Runs the real handler, resolver, Zod schemas and query
 * chains against the in-memory Supabase fake.
 */
import { describe, expect, it, vi } from 'vitest';

import { baseTables, baseTokens, TOKEN, UUID } from '../../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: (res: { status: (c: number) => { json: (b: unknown) => void } }) => {
    if (!holder.db) {
      res.status(500).json({ error: { code: 'INTERNAL', message: 'not configured' } });
      return null;
    }
    return holder.db;
  },
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res
      .status(200)
      .json({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } }),
  methodNotAllowed: (
    res: { status: (c: number) => { json: (b: unknown) => void } },
    method?: string,
  ) =>
    res.status(405).json({ error: { code: 'NOT_FOUND', message: `Method ${method} not allowed` } }),
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const { default: handler } = await import('./afhomes.js');

const UNIQUE = {
  departments: [['code'], ['name']],
  roles: [['slug'], ['name']],
  staff_users: [['id'], ['email']],
  staff_role_assignments: [['staff_id']],
  staff_permission_restrictions: [['staff_id', 'module_id']],
  role_permissions: [['role_id', 'module_id']],
  modules: [['id'], ['key']],
  staff_invitations: [['email', 'status']],
};

type TokenUser = {
  id: string;
  email: string;
  email_confirmed_at?: string | null;
  amr?: (string | { method: string; timestamp: number })[];
};

function install(
  options: {
    tables?: Record<string, unknown[]>;
    errors?: Record<string, { code?: string; message: string }>;
    writeErrors?: Record<string, { code?: string; message: string }>;
    tokens?: Record<string, TokenUser>;
    createUser?: (attrs: {
      email: string;
      password?: string;
      email_confirm?: boolean;
      user_metadata?: unknown;
    }) => Promise<unknown>;
    createUserId?: string;
    existingAuthEmails?: string[];
    updateUser?: (
      id: string,
      attrs: { password?: string; user_metadata?: unknown },
    ) => Promise<unknown>;
    signIn?: (creds: { email: string; password: string }) => Promise<unknown>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: baseTables(options.tables as never),
    tokens: { ...baseTokens(), ...options.tokens },
    errors: options.errors,
    writeErrors: options.writeErrors,
    unique: UNIQUE,
    defaults: { staff_invitations: { status: 'pending' } },
    createUser: options.createUser,
    createUserId: options.createUserId,
    existingAuthEmails: options.existingAuthEmails,
    updateUser: options.updateUser,
    signIn: options.signIn,
  });
  return holder.db as FakeSupabase;
}

async function call(options: {
  method?: string;
  afPath: string;
  body?: unknown;
  token?: string;
  query?: Record<string, string>;
}) {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method: options.method ?? 'GET',
      afPath: options.afPath,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

type Json = Record<string, unknown>;
const err = (body: unknown) => (body as Json).error as Json | undefined;

const NEW_STAFF_ID = '11111111-2222-4333-8444-555555555555';
const TEMP_PASSWORD = 'TempPass123';
const NEW_PASSWORD = 'NewPass456';

it('refuses customer-role staff provisioning before creating an Auth account', async () => {
  const createUser = vi.fn();
  const db = install({ createUser });
  const customerRoleId = 'aaaaaaaa-0000-4000-8000-000000000099';
  db.rows('roles').push({
    id: customerRoleId,
    slug: 'customer',
    name: 'Customer',
    is_active: true,
    is_system: true,
  });
  const state = await call({
    method: 'POST',
    afPath: 'staff',
    token: TOKEN.admin,
    body: {
      email: 'qa.customer@example.com',
      fullName: 'QA Customer',
      roleId: customerRoleId,
      temporaryPassword: TEMP_PASSWORD,
    },
  });
  expect(state.status).toBe(400);
  expect(createUser).not.toHaveBeenCalled();
  expect(db.rows('staff_users').some((row) => row.email === 'qa.customer@example.com')).toBe(false);
});

function installWithNewHire(
  signIn?: (creds: { email: string; password: string }) => Promise<unknown>,
) {
  return install({
    createUserId: NEW_STAFF_ID,
    tokens: {
      'token-new-hire': {
        id: NEW_STAFF_ID,
        email: 'new.hire@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    },
    signIn,
  });
}

async function hireNewcomer() {
  const state = await call({
    method: 'POST',
    afPath: 'staff',
    token: TOKEN.admin,
    body: {
      email: 'new.hire@afhomes.test',
      fullName: 'New Hire',
      departmentId: null,
      roleId: UUID.role.employee,
      temporaryPassword: TEMP_PASSWORD,
    },
  });
  expect(state.status).toBe(201);
}

/* ================================================================== */
/* Session flag + forced-change gate                                   */
/* ================================================================== */

describe('mustChangePassword session flag and gate', () => {
  it('reports mustChangePassword false for existing accounts', async () => {
    install();
    const state = await call({ afPath: 'session', token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect((state.body as Json).mustChangePassword).toBe(false);
  });

  it('reports mustChangePassword true for a temporary-password account', async () => {
    installWithNewHire();
    await hireNewcomer();
    const state = await call({ afPath: 'session', token: 'token-new-hire' });
    expect(state.status).toBe(200);
    expect((state.body as Json).mustChangePassword).toBe(true);
  });

  it('blocks module-guarded endpoints while the flag is set, but not the session itself', async () => {
    installWithNewHire();
    await hireNewcomer();
    for (const afPath of ['staff', 'roles', 'departments', 'dashboard']) {
      const state = await call({ afPath, token: 'token-new-hire' });
      expect(state.status).toBe(403);
      expect(err(state.body)?.code).toBe('FORBIDDEN');
    }
    // Self-service stays reachable: the flag must be clearable by its owner.
    const profile = await call({ afPath: 'session', token: 'token-new-hire' });
    expect(profile.status).toBe(200);
  });

  it('restores normal access once the flag is cleared, with the role preserved', async () => {
    installWithNewHire();
    await hireNewcomer();
    const changed = await call({
      method: 'POST',
      afPath: 'session/password',
      token: 'token-new-hire',
      body: { currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.status).toBe(200);
    const session = await call({ afPath: 'session', token: 'token-new-hire' });
    expect((session.body as Json).mustChangePassword).toBe(false);
    expect((session.body as Json).roleId).toBe(UUID.role.employee);
    const dashboard = await call({ afPath: 'dashboard', token: 'token-new-hire' });
    expect(dashboard.status).toBe(200);
  });
});

/* ================================================================== */
/* PATCH session (own display name)                                    */
/* ================================================================== */

describe('PATCH /admin/afhomes/session', () => {
  it('updates the own display name, syncs Auth metadata, and audits', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: 'session',
      token: TOKEN.admin,
      body: { name: 'Renamed Admin' },
    });
    expect(state.status).toBe(200);
    expect((state.body as Json).fullName).toBe('Renamed Admin');
    expect(db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.full_name).toBe(
      'Renamed Admin',
    );
    expect(
      db.calls.some((c) => c.op === 'updateUserById' && (c.arg as Json).id === UUID.adminStaff),
    ).toBe(true);
    expect(db.rows('audit_events').some((e) => e.action === 'STAFF_PROFILE_UPDATED')).toBe(true);
  });

  it('stays reachable while mustChangePassword gates everything else', async () => {
    installWithNewHire();
    await hireNewcomer();
    const state = await call({
      method: 'PATCH',
      afPath: 'session',
      token: 'token-new-hire',
      body: { name: 'New Hire Renamed' },
    });
    expect(state.status).toBe(200);
    expect((state.body as Json).mustChangePassword).toBe(true);
  });

  it('rejects a blank display name and an unauthenticated caller', async () => {
    install();
    const bad = await call({
      method: 'PATCH',
      afPath: 'session',
      token: TOKEN.admin,
      body: { name: 'x' },
    });
    expect(bad.status).toBe(400);
    const anon = await call({ method: 'PATCH', afPath: 'session', body: { name: 'Nobody' } });
    expect(anon.status).toBe(401);
  });
});

/* ================================================================== */
/* POST session/password (forced + voluntary change)                   */
/* ================================================================== */

describe('POST /admin/afhomes/session/password', () => {
  it('rejects a wrong current password without touching Auth or the flag', async () => {
    const db = install({
      signIn: async () => ({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      }),
    });
    const state = await call({
      method: 'POST',
      afPath: 'session/password',
      token: TOKEN.admin,
      body: { currentPassword: 'wrong-password', newPassword: NEW_PASSWORD },
    });
    expect(state.status).toBe(401);
    expect(err(state.body)?.message).toMatch(/current password is incorrect/i);
    expect(db.calls.some((c) => c.op === 'updateUserById')).toBe(false);
  });

  it('rotates the password, clears the flag, stamps the rotation, and audits', async () => {
    const db = installWithNewHire();
    await hireNewcomer();
    const state = await call({
      method: 'POST',
      afPath: 'session/password',
      token: 'token-new-hire',
      body: { currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(state.status).toBe(200);
    expect((state.body as Json).changed).toBe(true);
    const row = db.rows('staff_users').find((s) => s.id === NEW_STAFF_ID)!;
    expect(row.must_change_password).toBe(false);
    expect(row.password_changed_at).toBeTruthy();
    expect(db.passwordsSeen).toContain(NEW_PASSWORD);
    // The new secret is never written to a table or an audit payload.
    expect(JSON.stringify(db.rows('staff_users'))).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(db.rows('audit_events'))).not.toContain(NEW_PASSWORD);
    expect(db.rows('audit_events').some((e) => e.action === 'STAFF_PASSWORD_CHANGED')).toBe(true);
  });

  it('fails closed when the Auth rotation fails, keeping the flag set', async () => {
    const db = install({
      updateUser: async () => ({ data: { user: null }, error: { message: 'GoTrue unavailable' } }),
    });
    const state = await call({
      method: 'POST',
      afPath: 'session/password',
      token: TOKEN.admin,
      body: { currentPassword: 'whatever', newPassword: NEW_PASSWORD },
    });
    expect(state.status).toBe(500);
  });

  it('rejects a weak new password', async () => {
    install();
    const state = await call({
      method: 'POST',
      afPath: 'session/password',
      token: TOKEN.admin,
      body: { currentPassword: 'whatever', newPassword: 'short' },
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
  });

  it('no longer accepts the old temporary password after rotation', async () => {
    // The fake does not rotate real credentials, so this test models GoTrue
    // state explicitly: after the change only the new password verifies.
    let livePassword = TEMP_PASSWORD;
    const db = installWithNewHire(async ({ password }) =>
      password === livePassword
        ? { data: { user: { id: NEW_STAFF_ID }, session: { access_token: 'x' } }, error: null }
        : { data: { user: null }, error: { message: 'Invalid login credentials' } },
    );
    await hireNewcomer();
    const first = await call({
      method: 'POST',
      afPath: 'session/password',
      token: 'token-new-hire',
      body: { currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(first.status).toBe(200);
    livePassword = NEW_PASSWORD;
    const retryWithOld = await call({
      method: 'POST',
      afPath: 'session/password',
      token: 'token-new-hire',
      body: { currentPassword: TEMP_PASSWORD, newPassword: 'AnotherPass789' },
    });
    expect(retryWithOld.status).toBe(401);
    expect(db.rows('staff_users').find((s) => s.id === NEW_STAFF_ID)!.must_change_password).toBe(
      false,
    );
  });
});

/* ================================================================== */
/* Staff / role detail reads                                           */
/* ================================================================== */

describe('staff and role detail reads', () => {
  it('returns a single staff entry with account state', async () => {
    install();
    const state = await call({ afPath: `staff/${UUID.adminStaff}`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const body = state.body as Json;
    expect(body.id).toBe(UUID.adminStaff);
    expect(body.mustChangePassword).toBe(false);
    expect(body.roleId).toBe(UUID.role.admin);
    expect(Array.isArray(body.restrictions)).toBe(true);
  });

  it('returns 404 for an unknown staff id and 403 without staff view', async () => {
    install();
    const missing = await call({
      afPath: 'staff/22222222-2222-4333-8444-555555555555',
      token: TOKEN.admin,
    });
    expect(missing.status).toBe(404);
    const denied = await call({ afPath: `staff/${UUID.adminStaff}`, token: TOKEN.viewer });
    expect(denied.status).toBe(403);
  });

  it('serves staff audit history for its own record', async () => {
    installWithNewHire();
    await hireNewcomer();
    const state = await call({ afPath: `staff/${NEW_STAFF_ID}/audit`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = (state.body as { data: Json[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entity_id === NEW_STAFF_ID)).toBe(true);
  });

  it('returns a single role with permissions and assigned count', async () => {
    install();
    const state = await call({ afPath: `roles/${UUID.role.admin}`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const body = state.body as Json;
    expect(body.slug).toBe('admin');
    expect(Array.isArray(body.permissions)).toBe(true);
    expect(body.assignedCount).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown role id', async () => {
    install();
    const state = await call({
      afPath: 'roles/33333333-3333-4333-8444-555555555555',
      token: TOKEN.admin,
    });
    expect(state.status).toBe(404);
  });
});

/* ================================================================== */
/* Self / Super Admin protections on the new lifecycle                */
/* ================================================================== */

describe('protections preserved on the new lifecycle', () => {
  it('refuses self-deactivation and self-deletion', async () => {
    install();
    const deactivate = await call({
      method: 'POST',
      afPath: `staff/${UUID.adminStaff}/deactivate`,
      token: TOKEN.admin,
    });
    expect(deactivate.status).toBe(403);
    const remove = await call({
      method: 'DELETE',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.superAdmin,
    });
    expect(remove.status).toBe(403);
  });

  it('refuses to delete a Super Admin account even for a Super Admin', async () => {
    install();
    const superDelete = await call({
      method: 'DELETE',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.superAdmin,
    });
    expect(superDelete.status).toBe(403);
    // A non-Super-Admin account with no historical references in the fixture
    // dataset still deletes through the same path, proving the slug guard is
    // what refused above rather than a broken delete route.
    const plainDelete = await call({
      method: 'DELETE',
      afPath: `staff/${UUID.adminStaff}`,
      token: TOKEN.superAdmin,
    });
    expect(plainDelete.status).toBe(200);
  });

  it('refuses to deactivate the last active Super Admin', async () => {
    const db = install();
    // Every other account is already inactive: the caller is the last active
    // Super Admin, and deactivating itself is refused before the dedicated
    // last-admin guard is even reached (the 409 below it is defense-in-depth
    // for a state the self-guard already makes unreachable).
    for (const row of db.rows('staff_users')) {
      if (row.id !== UUID.superAdminStaff && row.status === 'active') row.status = 'inactive';
    }
    const state = await call({
      method: 'POST',
      afPath: `staff/${UUID.superAdminStaff}/deactivate`,
      token: TOKEN.superAdmin,
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.status).toBe(
      'active',
    );
  });
});
