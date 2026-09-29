/**
 * AF Homes operations API - direct handler coverage.
 *
 * Exercises `api/_handlers/admin/afhomes.ts` end to end through the same seam
 * production uses: the real handler, the real authorization resolver, the real
 * Zod schemas, and the real Supabase query chains - only the Supabase client is
 * replaced by the in-memory fake in `_lib/testing/supabase-fake.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseTables, baseTokens, TOKEN, UUID, moduleId } from '../../_lib/testing/fixtures.js';
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

// The staff-invite branch refuses to send an Auth invitation without an explicit
// admin redirect target. Set (and restore) so the test exercises the real path.
const ORIGINAL_ADMIN_URL = process.env.AFHOMES_ADMIN_URL;
beforeAll(() => {
  process.env.AFHOMES_ADMIN_URL = 'https://afhomes.test/admin';
});
afterAll(() => {
  if (ORIGINAL_ADMIN_URL === undefined) delete process.env.AFHOMES_ADMIN_URL;
  else process.env.AFHOMES_ADMIN_URL = ORIGINAL_ADMIN_URL;
});

type Json = Record<string, unknown>;

/** Unique keys as declared by the AF Homes foundation migration. */
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

function install(
  options: {
    tables?: Record<string, unknown[]>;
    errors?: Record<string, { code?: string; message: string }>;
    writeErrors?: Record<string, { code?: string; message: string }>;
    tokens?: Record<
      string,
      {
        id: string;
        email: string;
        email_confirmed_at?: string | null;
        amr?: (string | { method: string; timestamp: number })[];
      }
    >;
    invite?: (email: string, options: unknown) => Promise<unknown>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: baseTables(options.tables as never),
    tokens: { ...baseTokens(), ...options.tokens },
    errors: options.errors,
    writeErrors: options.writeErrors,
    unique: UNIQUE,
    defaults: { staff_invitations: { status: 'pending' } },
    invite: options.invite,
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

const err = (body: unknown) => (body as Json).error as Json | undefined;
const data = (body: unknown) => (body as Json).data;

/* ================================================================== */
/* Session / authentication                                           */
/* ================================================================== */

describe('GET /admin/afhomes/session', () => {
  beforeEach(() => install());

  it('rejects an unauthenticated request with 401 and no body echo', async () => {
    const state = await call({ afPath: 'session' });
    expect(state.status).toBe(401);
    expect(err(state.body)?.code).toBe('UNAUTHORIZED');
  });

  it('rejects a token that Supabase does not recognise', async () => {
    const state = await call({ afPath: 'session', token: 'not-a-real-token' });
    expect(state.status).toBe(401);
    expect(err(state.body)?.code).toBe('UNAUTHORIZED');
  });

  it('rejects an authenticated user with no staff profile', async () => {
    // Valid Supabase session, but no row in staff_users at all.
    install({ tokens: { 'token-guest': { id: 'guest-0001', email: 'guest@afhomes.test' } } });

    const state = await call({ afPath: 'session', token: 'token-guest' });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/staff access required/i);
  });

  it('rejects staff with no role assignment (invalid staff-role relationship)', async () => {
    const state = await call({ afPath: 'session', token: TOKEN.unassigned });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/role assignment required/i);
  });

  it('rejects staff whose assigned role is inactive', async () => {
    const db = install();
    const row = db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!;
    row.role_id = UUID.role.retired;

    const state = await call({ afPath: 'session', token: TOKEN.viewer });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/role is inactive/i);
  });

  it('rejects staff whose assignment points at a role that no longer exists', async () => {
    const db = install();
    db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id =
      '00000000-0000-4000-8000-000000009999';

    const state = await call({ afPath: 'session', token: TOKEN.viewer });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/role is inactive/i);
  });

  it.each(['inactive', 'suspended'] as const)(
    'rejects %s staff even though their Auth session is valid (Invariant G)',
    async (status) => {
      const db = install();
      db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = status;

      const state = await call({ afPath: 'session', token: TOKEN.admin });
      expect(state.status).toBe(403);
      expect(err(state.body)?.message).toMatch(/not active/i);
    },
  );

  it('activates an invited staff member only from a password-authenticated session', async () => {
    const db = install();
    const roleId = db
      .rows('staff_role_assignments')
      .find((row) => row.staff_id === UUID.adminStaff)!.role_id;
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'invited';
    db.rows('staff_invitations').push({
      id: 'inv-1',
      email: 'admin@afhomes.test',
      full_name: 'Ops Admin',
      role_id: UUID.role.admin,
      status: 'pending',
      auth_user_id: UUID.adminStaff,
    });

    const state = await call({ afPath: 'session', token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect((state.body as Json).status).toBe('active');
    expect(db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status).toBe('active');
    expect(db.rows('staff_invitations')[0]!.status).toBe('accepted');
    expect(
      db.rows('staff_role_assignments').find((row) => row.staff_id === UUID.adminStaff)!.role_id,
    ).toBe(roleId);
    const activationAudit = db
      .rows('audit_events')
      .find((row) => row.action === 'STAFF_ACCOUNT_ACTIVATED');
    expect(activationAudit).toBeDefined();
    expect(activationAudit?.after_data).toEqual({ authenticationMethod: 'password' });
  });

  it('does not activate an invited staff member from the invitation session', async () => {
    const db = install({
      tokens: {
        [TOKEN.admin]: {
          id: UUID.adminStaff,
          email: 'admin@afhomes.test',
          email_confirmed_at: new Date().toISOString(),
          amr: [{ method: 'invite', timestamp: 1 }],
        },
      },
    });
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'invited';
    db.rows('staff_invitations').push({
      id: 'inv-setup',
      email: 'admin@afhomes.test',
      full_name: 'Ops Admin',
      role_id: UUID.role.admin,
      status: 'pending',
      auth_user_id: UUID.adminStaff,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const state = await call({ afPath: 'session', token: TOKEN.admin });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/account setup required/i);
    expect(db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status).toBe('invited');
    expect(db.rows('staff_invitations')[0]!.status).toBe('pending');
  });

  it('does not activate an invited staff member whose email is unconfirmed', async () => {
    const db = install();
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'invited';
    db.tokens[TOKEN.admin] = {
      id: UUID.adminStaff,
      email: 'admin@afhomes.test',
      email_confirmed_at: null,
    };

    const state = await call({ afPath: 'session', token: TOKEN.admin });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status).toBe('invited');
  });

  it('resolves a Super Admin session with every module granted', async () => {
    const state = await call({ afPath: 'session', token: TOKEN.superAdmin });
    expect(state.status).toBe(200);
    const body = state.body as Json;
    expect(body.roleSlug).toBe('super_admin');
    const perms = body.permissions as { moduleKey: string; canView: boolean }[];
    expect(perms).toHaveLength(22);
    expect(perms.every((p) => p.canView)).toBe(true);
  });

  it('resolves a custom role with exactly its granted matrix', async () => {
    const db = install();
    db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id =
      UUID.role.custom;

    const state = await call({ afPath: 'session', token: TOKEN.viewer });
    expect(state.status).toBe(200);
    const perms = (state.body as Json).permissions as {
      moduleKey: string;
      canView: boolean;
      canCreate: boolean;
    }[];
    const sales = perms.find((p) => p.moduleKey === 'sales.card_sales')!;
    expect(sales.canView).toBe(true);
    expect(sales.canCreate).toBe(true);
    const governance = perms.find((p) => p.moduleKey === 'governance.audit')!;
    expect(governance.canView).toBe(false);
  });

  it('reduces effective permissions with a deny-only user restriction (Invariant A)', async () => {
    const state = await call({ afPath: 'session', token: TOKEN.restricted });
    expect(state.status).toBe(200);
    const perms = (state.body as Json).permissions as {
      moduleKey: string;
      canView: boolean;
      canCreate: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }[];
    // The admin role grants organization.roles (view+create+update); the
    // restriction denies view, and view is a precondition for the others.
    const roles = perms.find((p) => p.moduleKey === 'organization.roles')!;
    expect(roles.canView).toBe(false);
    expect(roles.canCreate).toBe(false);
    expect(roles.canUpdate).toBe(false);
    // Unrelated modules are untouched.
    expect(perms.find((p) => p.moduleKey === 'organization.staff')!.canView).toBe(true);
  });

  it('never lets a restriction grant a permission the role lacks (Invariant A)', async () => {
    const db = install();
    // Employee role has dashboard.view only. Add a restriction that would
    // "deny create" on a module the role never had - resolution must not add.
    db.rows('staff_permission_restrictions').push({
      staff_id: UUID.viewerStaff,
      module_id: moduleId('organization.roles'),
      deny_view: false,
      deny_create: true,
      deny_update: true,
      deny_delete: true,
    });

    const state = await call({ afPath: 'session', token: TOKEN.viewer });
    const perms = (state.body as Json).permissions as {
      moduleKey: string;
      canView: boolean;
      canCreate: boolean;
    }[];
    const roles = perms.find((p) => p.moduleKey === 'organization.roles')!;
    expect(roles.canView).toBe(false);
    expect(roles.canCreate).toBe(false);
  });

  it('excludes inactive modules from the effective matrix', async () => {
    const db = install();
    db.rows('modules').find((m) => m.key === 'organization.roles')!.is_active = false;

    const state = await call({ afPath: 'session', token: TOKEN.admin });
    const perms = (state.body as Json).permissions as { moduleKey: string }[];
    expect(perms.some((p) => p.moduleKey === 'organization.roles')).toBe(false);
  });
});

describe('GET /admin/afhomes/account-activation', () => {
  it('returns only the invited profile bound to a verified invite session', async () => {
    const db = install({
      tokens: {
        'token-invite': {
          id: UUID.adminStaff,
          email: 'admin@afhomes.test',
          email_confirmed_at: new Date().toISOString(),
          amr: ['invite'],
        },
      },
    });
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'invited';
    db.rows('staff_invitations').push({
      id: 'inv-candidate',
      email: 'admin@afhomes.test',
      full_name: 'Ops Admin',
      role_id: UUID.role.admin,
      status: 'pending',
      auth_user_id: UUID.adminStaff,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const state = await call({ afPath: 'account-activation', token: 'token-invite' });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      id: UUID.adminStaff,
      email: 'admin@afhomes.test',
      fullName: expect.any(String),
    });
    expect(JSON.stringify(state.body)).not.toMatch(/role|permission|password/i);
  });

  it('denies customer, normal staff, expired, and non-invite sessions without changing state', async () => {
    const db = install({
      tokens: {
        'token-customer': {
          id: '00000000-0000-4000-8000-00000000c001',
          email: 'customer@afhomes.test',
          email_confirmed_at: new Date().toISOString(),
          amr: ['invite'],
        },
        'token-active': {
          id: UUID.adminStaff,
          email: 'admin@afhomes.test',
          email_confirmed_at: new Date().toISOString(),
          amr: ['invite'],
        },
        'token-password': {
          id: UUID.viewerStaff,
          email: 'viewer@afhomes.test',
          email_confirmed_at: new Date().toISOString(),
          amr: ['password'],
        },
        'token-expired': {
          id: UUID.viewerStaff,
          email: 'viewer@afhomes.test',
          email_confirmed_at: new Date().toISOString(),
          amr: ['invite'],
        },
      },
    });
    db.rows('staff_users').find((s) => s.id === UUID.viewerStaff)!.status = 'invited';
    db.rows('staff_invitations').push({
      id: 'inv-expired',
      email: 'viewer@afhomes.test',
      full_name: 'Viewer',
      role_id: UUID.role.employee,
      status: 'pending',
      auth_user_id: UUID.viewerStaff,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    for (const token of ['token-customer', 'token-active', 'token-password', 'token-expired']) {
      expect((await call({ afPath: 'account-activation', token })).status).toBeGreaterThanOrEqual(
        400,
      );
    }
    expect(db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status).toBe('active');
    expect(db.rows('staff_users').find((s) => s.id === UUID.viewerStaff)!.status).toBe('invited');
    expect(db.rows('staff_invitations')[0]!.status).toBe('pending');
  });
});

/* ================================================================== */
/* Roles                                                              */
/* ================================================================== */

describe('roles', () => {
  beforeEach(() => install());

  it('lists roles with assigned counts and permission matrices', async () => {
    const state = await call({ afPath: 'roles', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Json[];
    expect(rows.map((r) => r.slug).sort()).toEqual([
      'admin',
      'employee',
      'finance',
      'retired_role',
      'sales_manager',
      'super_admin',
    ]);
    const custom = rows.find((r) => r.slug === 'sales_manager')!;
    expect(custom.isSystem).toBe(false);
    expect(custom.assignedCount).toBe(0);
    expect((custom.permissions as unknown[]).length).toBe(2);
    const admin = rows.find((r) => r.slug === 'admin')!;
    // adminStaff + restrictedStaff + inactiveStaff hold the admin role.
    expect(admin.assignedCount).toBe(3);
  });

  it('reports assigned staff per role', async () => {
    const state = await call({ afPath: 'roles', token: TOKEN.admin });
    const rows = data(state.body) as Json[];
    expect(rows.find((r) => r.slug === 'super_admin')!.assignedCount).toBe(1);
    expect(rows.find((r) => r.slug === 'employee')!.assignedCount).toBe(1);
  });

  it('marks system roles and inactive roles distinctly', async () => {
    const state = await call({ afPath: 'roles', token: TOKEN.admin });
    const rows = data(state.body) as Json[];
    expect(rows.find((r) => r.slug === 'super_admin')!.isSystem).toBe(true);
    expect(rows.find((r) => r.slug === 'retired_role')!.isActive).toBe(false);
  });

  it('denies listing to a role without organization.roles', async () => {
    const state = await call({ afPath: 'roles', token: TOKEN.viewer });
    expect(state.status).toBe(403);
    expect(err(state.body)?.code).toBe('FORBIDDEN');
  });

  it('denies listing to an unauthenticated caller', async () => {
    const state = await call({ afPath: 'roles' });
    expect(state.status).toBe(401);
  });

  it('creates a custom role with a permission subset the actor holds', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.admin,
      body: {
        name: 'Sales Reviewer',
        description: 'Read sales only',
        permissions: [
          {
            moduleKey: 'sales.card_sales',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
        ],
      },
    });
    expect(state.status).toBe(201);
    expect((state.body as Json).slug).toBe('sales_reviewer');
    expect(
      db.rows('role_permissions').filter((r) => r.role_id === (state.body as Json).id),
    ).toHaveLength(1);
    expect(db.rows('audit_events').some((e) => e.action === 'ROLE_CREATED')).toBe(true);
  });

  it('refuses to grant a permission the acting user does not hold (Invariant B)', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.admin,
      body: {
        name: 'Escalation Attempt',
        permissions: [
          {
            moduleKey: 'governance.config',
            canView: true,
            canCreate: true,
            canUpdate: true,
            canDelete: true,
          },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/do not possess/i);
  });

  it('refuses role creation to a role without organization.roles create', async () => {
    const db = install();
    // Give the restricted admin a create grant on roles but keep the deny-view
    // restriction, which removes view and therefore create.
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.restricted,
      body: { name: 'Nope', permissions: [] },
    });
    expect(state.status).toBe(403);
    expect(db.rows('roles').some((r) => r.name === 'Nope')).toBe(false);
  });

  it('rejects an invalid role payload', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.admin,
      body: { name: 'A', permissions: [] },
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.code).toBe('VALIDATION_ERROR');
  });

  it('rolls the role back when the permission write fails', async () => {
    const db = install({
      writeErrors: { role_permissions: { message: 'permission write failed' } },
    });
    const before = db.rows('roles').length;
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.admin,
      body: {
        name: 'Rollback Me',
        permissions: [
          {
            moduleKey: 'sales.card_sales',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
        ],
      },
    });
    expect(state.status).toBe(500);
    expect(db.rows('roles')).toHaveLength(before);
  });

  it('updates a custom role', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.custom}`,
      token: TOKEN.admin,
      body: { name: 'Regional Sales Manager' },
    });
    expect(state.status).toBe(200);
    expect((state.body as Json).name).toBe('Regional Sales Manager');
  });

  it('refuses to edit a protected system role (Invariant D)', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.superAdmin,
      body: { name: 'Hijacked' },
    });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/system roles are protected/i);
  });

  it('refuses to convert a system role into a permissive custom role (Invariant D)', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.admin}`,
      token: TOKEN.admin,
      body: { isActive: true, isSystem: false },
    });
    expect(state.status).toBe(403);
  });

  it('refuses to edit the acting user own role (self-escalation guard)', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.admin}`,
      token: TOKEN.admin,
      body: { name: 'Self Promote' },
    });
    expect(state.status).toBe(403);
  });

  it('refuses an update that grants permissions beyond the actor own (Invariant B)', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.custom}`,
      token: TOKEN.admin,
      body: {
        permissions: [
          {
            moduleKey: 'organization.roles',
            canView: true,
            canCreate: true,
            canUpdate: true,
            canDelete: true,
          },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/do not possess/i);
  });

  it('404s an unknown role and 404s on delete (no role delete surface)', async () => {
    const unknown = await call({
      method: 'PATCH',
      afPath: 'roles/00000000-0000-4000-8000-000000009999',
      token: TOKEN.admin,
      body: { name: 'Ghost' },
    });
    expect(unknown.status).toBe(404);
    const del = await call({
      method: 'DELETE',
      afPath: `roles/${UUID.role.custom}`,
      token: TOKEN.superAdmin,
    });
    expect(del.status).toBe(404);
  });

  it('returns the audit trail for a role', async () => {
    const db = install();
    db.rows('audit_events').push(
      {
        id: '1',
        actor_id: UUID.superAdminStaff,
        action: 'ROLE_CREATED',
        entity_type: 'role',
        entity_id: UUID.role.custom,
        created_at: '2026-09-03T00:00:00.000Z',
      },
      {
        id: '2',
        actor_id: UUID.adminStaff,
        action: 'UNRELATED',
        entity_type: 'department',
        entity_id: UUID.role.custom,
        created_at: '2026-09-04T00:00:00.000Z',
      },
    );
    const state = await call({ afPath: `roles/${UUID.role.custom}/audit`, token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Json[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('ROLE_CREATED');
  });

  it('requires governance.audit to read a role audit trail', async () => {
    const state = await call({ afPath: `roles/${UUID.role.custom}/audit`, token: TOKEN.viewer });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Departments                                                        */
/* ================================================================== */

describe('departments', () => {
  beforeEach(() => install());

  it('lists departments with staff counts', async () => {
    const state = await call({ afPath: 'departments', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Json[];
    expect(rows.map((r) => r.code).sort()).toEqual(['EXECUTIVE', 'LEGACY', 'SALES']);
    expect(rows.find((r) => r.code === 'SALES')!.staffCount).toBe(2);
    expect(rows.find((r) => r.code === 'LEGACY')!.isActive).toBe(false);
  });

  it('denies listing without organization.departments view', async () => {
    const state = await call({ afPath: 'departments', token: TOKEN.viewer });
    expect(state.status).toBe(403);
  });

  it('creates a department and audits it', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { code: 'FINANCE', name: 'Finance' },
    });
    expect(state.status).toBe(201);
    expect((state.body as Json).code).toBe('FINANCE');
    expect(db.rows('departments').some((d) => d.code === 'FINANCE')).toBe(true);
    expect(db.rows('audit_events').some((e) => e.action === 'DEPARTMENT_CREATED')).toBe(true);
  });

  it('rejects a malformed department code', async () => {
    for (const code of ['finance', '1FIN', 'F', '']) {
      const state = await call({
        method: 'POST',
        afPath: 'departments',
        token: TOKEN.admin,
        body: { code, name: 'Finance Team' },
      });
      expect(state.status, code).toBe(400);
    }
  });

  it('rejects a duplicate department code with 409', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { code: 'SALES', name: 'Sales Again' },
    });
    expect(state.status).toBe(409);
    expect(err(state.body)?.code).toBe('CONFLICT');
  });

  it('denies creation without organization.departments create', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.viewer,
      body: { code: 'NEWDEPT', name: 'New Dept' },
    });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Staff                                                              */
/* ================================================================== */

describe('staff', () => {
  beforeEach(() => install());

  it('lists only staff that have a role assignment', async () => {
    const state = await call({ afPath: 'staff', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const rows = data(state.body) as Json[];
    expect(rows.map((r) => r.email)).not.toContain('unassigned@afhomes.test');
    expect(rows).toHaveLength(5);
  });

  it('includes department and role names plus restrictions', async () => {
    const state = await call({ afPath: 'staff', token: TOKEN.admin });
    const rows = data(state.body) as Json[];
    const restricted = rows.find((r) => r.id === UUID.restrictedStaff)!;
    expect(restricted.departmentName).toBe('Sales');
    expect(restricted.roleName).toBe('Admin');
    expect(restricted.restrictions).toEqual([
      {
        moduleKey: 'organization.roles',
        denyView: true,
        denyCreate: false,
        denyUpdate: false,
        denyDelete: false,
      },
    ]);
  });

  it('reports an unassigned department as null', async () => {
    const state = await call({ afPath: 'staff', token: TOKEN.admin });
    const rows = data(state.body) as Json[];
    expect(rows.find((r) => r.id === UUID.viewerStaff)!.departmentName).toBeNull();
  });

  it('denies listing without organization.staff view', async () => {
    const state = await call({ afPath: 'staff', token: TOKEN.viewer });
    expect(state.status).toBe(403);
  });

  it('invites staff with a role and department, and audits it', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'new.hire@afhomes.test',
        fullName: 'New Hire',
        departmentId: UUID.department.sales,
        roleId: UUID.role.employee,
      },
    });
    expect(state.status).toBe(201);
    expect(db.rows('staff_users').some((s) => s.email === 'new.hire@afhomes.test')).toBe(true);
    expect(db.rows('staff_role_assignments').some((r) => r.role_id === UUID.role.employee)).toBe(
      true,
    );
    const invitation = db.rows('staff_invitations')[0]!;
    expect(invitation.status).toBe('pending');
    expect(invitation.invited_by).toBe(UUID.adminStaff);
    expect(new Date(invitation.expires_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(db.rows('audit_events').some((e) => e.action === 'STAFF_INVITED')).toBe(true);
  });

  it('invites staff with no department', async () => {
    install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'solo@afhomes.test',
        fullName: 'Solo',
        departmentId: null,
        roleId: UUID.role.employee,
      },
    });
    expect(state.status).toBe(201);
    expect((state.body as Json).departmentId).toBeNull();
  });

  it('rejects a duplicate invitation with 409 and creates no auth user', async () => {
    const db = install({
      invite: async () => ({
        data: null,
        error: { message: 'A user with this email address has already been registered' },
      }),
    });
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'admin@afhomes.test',
        fullName: 'Impostor',
        departmentId: null,
        roleId: UUID.role.employee,
      },
    });
    expect(state.status).toBe(409);
    expect(db.rows('staff_users').some((s) => s.full_name === 'Impostor')).toBe(false);
  });

  it('rejects an invalid email or missing role', async () => {
    install();
    for (const body of [
      { email: 'not-an-email', fullName: 'X Y', departmentId: null, roleId: UUID.role.employee },
      { email: 'ok@afhomes.test', fullName: '', departmentId: null, roleId: UUID.role.employee },
      { email: 'ok@afhomes.test', fullName: 'Ok Person', departmentId: null, roleId: 'nope' },
    ]) {
      const state = await call({ method: 'POST', afPath: 'staff', token: TOKEN.admin, body });
      expect(state.status).toBe(400);
    }
  });

  it('refuses an inactive role at invitation time', async () => {
    install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'retired@afhomes.test',
        fullName: 'Retired Role',
        departmentId: null,
        roleId: UUID.role.retired,
      },
    });
    expect(state.status).toBe(400);
    expect(err(state.body)?.message).toMatch(/role is not active/i);
  });

  it('refuses to assign Super Admin by a non-Super-Admin (Invariant C)', async () => {
    install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'rival@afhomes.test',
        fullName: 'Rival',
        departmentId: null,
        roleId: UUID.role.superAdmin,
      },
    });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/only super admin can assign super admin/i);
  });

  it('refuses a role whose permissions the actor does not hold (Invariant B)', async () => {
    install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'finance.guy@afhomes.test',
        fullName: 'Finance Guy',
        departmentId: null,
        roleId: UUID.role.superAdmin,
      },
    });
    expect(state.status).toBe(403);
  });

  it('lets a Super Admin invite another Super Admin', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.superAdmin,
      body: {
        email: 'second.owner@afhomes.test',
        fullName: 'Second Owner',
        departmentId: null,
        roleId: UUID.role.superAdmin,
      },
    });
    expect(state.status).toBe(201);
  });

  it('denies invitation without organization.staff create', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.viewer,
      body: {
        email: 'x@afhomes.test',
        fullName: 'X Y',
        departmentId: null,
        roleId: UUID.role.employee,
      },
    });
    expect(state.status).toBe(403);
  });

  it('removes the invited auth user when the staff row write fails', async () => {
    const db = install({ writeErrors: { staff_users: { message: 'insert failed' } } });
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'rollback@afhomes.test',
        fullName: 'Roll Back',
        departmentId: null,
        roleId: UUID.role.employee,
      },
    });
    expect(state.status).toBe(500);
    expect(db.deletedAuthUsers).toHaveLength(1);
  });

  it('updates a department assignment', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { departmentId: UUID.department.executive },
    });
    expect(state.status).toBe(200);
    expect((state.body as Json).departmentId).toBe(UUID.department.executive);
    expect(db.rows('staff_users').find((s) => s.id === UUID.viewerStaff)!.department_id).toBe(
      UUID.department.executive,
    );
  });

  it('clears a department assignment with null', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.inactiveStaff}`,
      token: TOKEN.admin,
      body: { departmentId: null },
    });
    expect(state.status).toBe(200);
    expect((state.body as Json).departmentId).toBeNull();
  });

  it('rejects a malformed department uuid', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { departmentId: 'not-a-uuid' },
    });
    expect(state.status).toBe(400);
  });

  it('activates and deactivates a staff account', async () => {
    const db = install();
    const suspended = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.inactiveStaff}`,
      token: TOKEN.admin,
      body: { status: 'active' },
    });
    expect(suspended.status).toBe(200);
    expect(db.rows('staff_users').find((s) => s.id === UUID.inactiveStaff)!.status).toBe('active');

    const off = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { status: 'inactive' },
    });
    expect(off.status).toBe(200);
    expect(db.rows('staff_users').find((s) => s.id === UUID.viewerStaff)!.status).toBe('inactive');
  });

  it('replaces user restrictions and audits the change', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: {
        restrictions: [
          {
            moduleKey: 'dashboard.view',
            denyView: true,
            denyCreate: false,
            denyUpdate: false,
            denyDelete: false,
          },
        ],
      },
    });
    expect(state.status).toBe(200);
    expect(
      db.rows('staff_permission_restrictions').some((r) => r.staff_id === UUID.viewerStaff),
    ).toBe(true);
    expect(db.rows('audit_events').some((e) => e.action === 'STAFF_ACCESS_UPDATED')).toBe(true);
  });

  it('drops all restrictions when an empty list is sent', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.restrictedStaff}`,
      token: TOKEN.admin,
      body: { restrictions: [] },
    });
    expect(state.status).toBe(200);
    expect(
      db.rows('staff_permission_restrictions').filter((r) => r.staff_id === UUID.restrictedStaff),
    ).toHaveLength(0);
  });

  it('ignores an all-false restriction row (deny-only invariant)', async () => {
    const db = install();
    await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: {
        restrictions: [
          {
            moduleKey: 'dashboard.view',
            denyView: false,
            denyCreate: false,
            denyUpdate: false,
            denyDelete: false,
          },
        ],
      },
    });
    expect(
      db.rows('staff_permission_restrictions').filter((r) => r.staff_id === UUID.viewerStaff),
    ).toHaveLength(0);
  });

  it('rejects an unknown module key in restrictions', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: {
        restrictions: [
          {
            moduleKey: 'made.up.module',
            denyView: true,
            denyCreate: false,
            denyUpdate: false,
            denyDelete: false,
          },
        ],
      },
    });
    expect(state.status).toBe(400);
  });

  it('refuses to edit the acting user own account (self-elevation guard)', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.adminStaff}`,
      token: TOKEN.admin,
      body: { status: 'inactive' },
    });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/your own account/i);
  });

  it('refuses an Admin suspending the Super Admin (Invariant C)', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { status: 'suspended' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.status).toBe(
      'active',
    );
  });

  it('refuses an Admin locking the Super Admin out with restrictions (Invariant C)', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: {
        restrictions: [
          {
            moduleKey: 'dashboard.view',
            denyView: true,
            denyCreate: false,
            denyUpdate: false,
            denyDelete: false,
          },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(
      db.rows('staff_permission_restrictions').some((r) => r.staff_id === UUID.superAdminStaff),
    ).toBe(false);
  });

  it('refuses an Admin moving the Super Admin to another department (Invariant C)', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { departmentId: UUID.department.sales },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.department_id).toBe(
      UUID.department.executive,
    );
  });

  it('lets a Super Admin suspend another Super Admin', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.adminStaff}`,
      token: TOKEN.superAdmin,
      body: { status: 'suspended' },
    });
    expect(state.status).toBe(200);
  });

  it('refuses a lower role elevating another user (Invariant B)', async () => {
    const db = install();
    // Restricted admin holds organization.staff view but the role view is
    // denied; give the target an admin role the actor cannot grant.
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.restricted,
      body: { roleId: UUID.role.superAdmin },
    });
    expect(state.status).toBe(403);
    expect(
      db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
    ).toBe(UUID.role.employee);
  });

  it('refuses reassigning a role the actor cannot grant (Invariant B)', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { roleId: UUID.role.finance },
    });
    expect(state.status).toBe(403);
    expect(err(state.body)?.message).toMatch(/do not possess/i);
    expect(
      db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
    ).toBe(UUID.role.employee);
  });

  it('refuses to assign an inactive role', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { roleId: UUID.role.retired },
    });
    expect(state.status).toBe(400);
  });

  it('404s an unknown staff id', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: 'staff/00000000-0000-4000-8000-000000009999',
      token: TOKEN.admin,
      body: { status: 'active' },
    });
    expect(state.status).toBe(404);
  });

  it('denies updates without organization.staff update', async () => {
    const db = install();
    db.rows('role_permissions').push({
      role_id: UUID.role.employee,
      module_id: moduleId('organization.staff'),
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.viewer,
      body: { status: 'inactive' },
    });
    expect(state.status).toBe(403);
  });
});

/* ================================================================== */
/* Dashboard                                                          */
/* ================================================================== */

describe('dashboard', () => {
  it('returns zeroed metrics and empty trend on an empty database', async () => {
    const db = install();
    for (const table of [
      'card_sales',
      'payments',
      'memberships',
      'final_qualifications',
      'commissions',
      'ost_members',
      'ost_applications',
    ]) {
      db.tables[table] = [];
    }
    const state = await call({ afPath: 'dashboard', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const body = state.body as Json;
    expect((body.totals as Json).verifiedSales).toBe(0);
    expect((body.totals as Json).verifiedCollections).toBe('0.00');
    expect((body.totals as Json).activeMemberships).toBe(0);
    expect(body.trend as unknown[]).toEqual([]);
  });

  it('denies the dashboard without dashboard.view', async () => {
    install();
    const db = holder.db as FakeSupabase;
    db.rows('role_permissions').forEach((r) => {
      if (r.module_id === moduleId('dashboard.view')) r.can_view = false;
    });
    const state = await call({ afPath: 'dashboard', token: TOKEN.admin });
    expect(state.status).toBe(403);
  });

  it('denies the dashboard to an unauthenticated caller', async () => {
    install();
    const state = await call({ afPath: 'dashboard' });
    expect(state.status).toBe(401);
  });

  it('counts verified sales, collections, memberships and queues', async () => {
    const db = install();
    const now = new Date().toISOString();
    db.tables['card_sales'] = [
      { id: 's1', status: 'payment_verified', created_at: now },
      { id: 's2', status: 'qualified', created_at: now },
      { id: 's3', status: 'pending', created_at: now },
      { id: 's4', status: 'down_payment', created_at: now },
      { id: 's5', status: 'overdue', created_at: now },
    ];
    db.tables['payments'] = [
      { id: 'p1', status: 'verified', amount: '15000.00', verified_at: now },
      { id: 'p2', status: 'verified', amount: '25000.50', verified_at: now },
      { id: 'p3', status: 'recorded', amount: '999.00', verified_at: null },
    ];
    db.tables['memberships'] = [
      { id: 'm1', status: 'active', points_balance: 60000, activated_at: now },
      { id: 'm2', status: 'expired', points_balance: 1000, activated_at: null },
    ];
    db.tables['final_qualifications'] = [
      { id: 'q1', status: 'pending' },
      { id: 'q2', status: 'passed' },
    ];
    db.tables['commissions'] = [
      { id: 'c1', status: 'earned', amount: '2400.00' },
      { id: 'c2', status: 'paid', amount: '100.00' },
    ];
    db.tables['ost_members'] = [
      { id: 'o1', status: 'active' },
      { id: 'o2', status: 'inactive' },
    ];
    db.tables['ost_applications'] = [
      { id: 'a1', status: 'submitted' },
      { id: 'a2', status: 'under_review' },
      { id: 'a3', status: 'approved' },
    ];

    const state = await call({ afPath: 'dashboard', token: TOKEN.admin });
    expect(state.status).toBe(200);
    const totals = (state.body as Json).totals as Json;
    expect(totals.verifiedSales).toBe(2);
    expect(totals.verifiedCollections).toBe('40000.50');
    expect(totals.activeMemberships).toBe(1);
    expect(totals.pendingAccounts).toBe(1);
    expect(totals.downPaymentAccounts).toBe(1);
    expect(totals.overdueAccounts).toBe(1);
    expect(totals.pointsIssued).toBe(61000);
    expect(totals.pendingQualifications).toBe(1);
    expect(totals.earnedUnpaidCommissions).toBe('2400.00');
    expect(totals.activeSellers).toBe(1);
    expect(totals.inactiveSellers).toBe(1);
    // Five active staff rows; the suspended one is the only non-active.
    expect(totals.activeEmployees).toBe(5);
    expect(totals.inactiveEmployees).toBe(1);

    const queues = (state.body as Json).queues as Json;
    expect(queues.paymentVerification).toBe(1);
    expect(queues.cardActivation).toBe(1);
    expect(queues.finalQualification).toBe(0);
    expect(queues.ostRegistrations).toBe(2);
    expect(queues.commissionPayouts).toBe(1);
  });

  it('sums money exactly without float drift', async () => {
    const db = install();
    const now = new Date().toISOString();
    db.tables['payments'] = [
      { id: 'p1', status: 'verified', amount: '0.10', verified_at: now },
      { id: 'p2', status: 'verified', amount: '0.20', verified_at: now },
    ];
    const state = await call({ afPath: 'dashboard', token: TOKEN.admin });
    expect((state.body as Json).totals).toMatchObject({ verifiedCollections: '0.30' });
  });

  it('builds a daily trend inside the requested window and excludes older rows', async () => {
    const db = install();
    const iso = (daysAgo: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - daysAgo);
      d.setUTCHours(12, 0, 0, 0);
      return d.toISOString();
    };
    db.tables['card_sales'] = [
      { id: 's1', status: 'qualified', created_at: iso(0) },
      { id: 's2', status: 'qualified', created_at: iso(2) },
      { id: 's3', status: 'qualified', created_at: iso(40) },
    ];
    db.tables['payments'] = [
      { id: 'p1', status: 'verified', amount: '100.00', verified_at: iso(0) },
      { id: 'p2', status: 'verified', amount: '200.00', verified_at: iso(40) },
    ];

    const week = await call({ afPath: 'dashboard', token: TOKEN.admin, query: { range: 'week' } });
    expect(week.status).toBe(200);
    const weekTrend = (week.body as Json).trend as Json[];
    const weekSales = weekTrend.reduce((sum, p) => sum + (p.verifiedSales as number), 0);
    const weekCollections = weekTrend.reduce((sum, p) => sum + Number(p.collections), 0);
    expect(weekSales).toBe(2);
    expect(weekCollections).toBe(100);

    const year = await call({ afPath: 'dashboard', token: TOKEN.admin, query: { range: 'year' } });
    const yearTrend = (year.body as Json).trend as Json[];
    const yearSales = yearTrend.reduce((sum, p) => sum + (p.verifiedSales as number), 0);
    const yearCollections = yearTrend.reduce((sum, p) => sum + Number(p.collections), 0);
    expect(yearSales).toBe(3);
    expect(yearCollections).toBe(300);
  });

  it('falls back to the month window for an unknown range', async () => {
    install();
    const state = await call({
      afPath: 'dashboard',
      token: TOKEN.admin,
      query: { range: 'nonsense' },
    });
    expect(state.status).toBe(200);
  });
});

/* ================================================================== */
/* Routing / error surface                                            */
/* ================================================================== */

describe('handler surface', () => {
  beforeEach(() => install());

  it('404s an unknown AF Homes sub-path', async () => {
    const state = await call({ afPath: 'does/not/exist', token: TOKEN.admin });
    expect(state.status).toBe(404);
    expect(err(state.body)?.code).toBe('NOT_FOUND');
  });

  it('404s an unsupported method on a known path', async () => {
    const state = await call({ method: 'POST', afPath: 'session', token: TOKEN.admin });
    expect(state.status).toBe(404);
  });

  it('never leaks a stack trace or secret in an error body', async () => {
    const state = await call({ afPath: 'session', token: 'garbage' });
    const serialised = JSON.stringify(state.body);
    expect(serialised).not.toMatch(/at \w+ \(/);
    expect(serialised).not.toMatch(/service_role|eyJ|sb_secret/);
  });

  it('returns a 500 INTERNAL when the audit write fails', async () => {
    // Authorization succeeds, the data write succeeds, and the audit write
    // fails - the handler must refuse to report success without an audit trail.
    install({ writeErrors: { audit_events: { message: 'audit table unavailable' } } });
    const state = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { code: 'AUDITLESS', name: 'Auditless' },
    });
    expect(state.status).toBe(500);
    expect(err(state.body)?.code).toBe('INTERNAL');
    // The raw driver message must not be echoed to the client.
    expect(JSON.stringify(state.body)).not.toMatch(/audit table unavailable/);
  });

  it('refuses to invite staff when no admin redirect target is configured', async () => {
    const saved = process.env.AFHOMES_ADMIN_URL;
    delete process.env.AFHOMES_ADMIN_URL;
    try {
      const db = install();
      const state = await call({
        method: 'POST',
        afPath: 'staff',
        token: TOKEN.admin,
        body: {
          email: 'nowhere@afhomes.test',
          fullName: 'No Redirect',
          departmentId: null,
          roleId: UUID.role.employee,
        },
      });
      expect(state.status).toBe(500);
      expect(err(state.body)?.message).toMatch(/AFHOMES_ADMIN_URL/);
      // Nothing may be created when the send is refused.
      expect(db.rows('staff_users').some((s) => s.email === 'nowhere@afhomes.test')).toBe(false);
    } finally {
      process.env.AFHOMES_ADMIN_URL = saved;
    }
  });
});
