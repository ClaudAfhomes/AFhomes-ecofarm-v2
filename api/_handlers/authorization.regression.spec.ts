/**
 * AF Homes authorization regression suite.
 *
 * One explicitly-named test per security invariant, so a regression names the
 * invariant it broke. Backend authorization is authoritative throughout: every
 * case here drives the real handler + the real resolver + the real Zod schemas.
 *
 * Invariants A-G are defined in `AGENTS.md`; the frontend counterparts
 * (E: direct-URL bypass, F: client state is not authorization) live in
 * `apps/admin/src/app/authorization.regression.spec.tsx`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseTables, baseTokens, TOKEN, UUID, moduleId } from '../_lib/testing/fixtures.js';
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

const { default: afhomesHandler } = await import('./admin/afhomes.js');

const ORIGINAL_ADMIN_URL = process.env.AFHOMES_ADMIN_URL;
beforeAll(() => {
  process.env.AFHOMES_ADMIN_URL = 'https://afhomes.test/admin';
});
afterAll(() => {
  if (ORIGINAL_ADMIN_URL === undefined) delete process.env.AFHOMES_ADMIN_URL;
  else process.env.AFHOMES_ADMIN_URL = ORIGINAL_ADMIN_URL;
});

function install(overrides: Record<string, unknown[]> = {}) {
  holder.db = new FakeSupabase({
    tables: baseTables(overrides as never),
    tokens: baseTokens(),
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(options: {
  afPath: string;
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<State> {
  const { res, state } = makeRes();
  await afhomesHandler(
    makeReq({
      method: options.method ?? 'GET',
      afPath: options.afPath,
      body: options.body,
      token: options.token,
      headers: options.headers,
    }) as never,
    res as never,
  );
  return state;
}

const perms = (body: unknown) =>
  (body as { permissions: { moduleKey: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[] })
    .permissions;

describe('Invariant A - a user restriction can remove access but never add it', () => {
  beforeEach(() => install());

  it('subtracts the denied action and every action that depends on view', async () => {
    const state = await call({ afPath: 'session', token: TOKEN.restricted });
    const roles = perms(state.body).find((p) => p.moduleKey === 'organization.roles')!;
    expect(roles).toEqual({
      moduleKey: 'organization.roles',
      canView: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
  });

  it('leaves unrelated modules at the role grant', async () => {
    const state = await call({ afPath: 'session', token: TOKEN.restricted });
    const staff = perms(state.body).find((p) => p.moduleKey === 'organization.staff')!;
    expect(staff.canView).toBe(true);
    expect(staff.canCreate).toBe(true);
  });

  it('cannot manufacture a grant for a module the role does not hold', async () => {
    const db = install();
    // Employee holds dashboard.view only. Add restrictions for a module it
    // never had: resolution must stay denied (no phantom allow).
    for (const deny of ['create', 'update', 'delete'] as const) {
      db.rows('staff_permission_restrictions').push({
        staff_id: UUID.viewerStaff,
        module_id: moduleId('organization.roles'),
        deny_view: false,
        [`deny_${deny}`]: true,
      });
    }
    const state = await call({ afPath: 'session', token: TOKEN.viewer });
    const roles = perms(state.body).find((p) => p.moduleKey === 'organization.roles')!;
    expect(roles.canView).toBe(false);
    expect(roles.canCreate).toBe(false);
    expect(roles.canUpdate).toBe(false);
    expect(roles.canDelete).toBe(false);
  });

  it('denies a real action the role holds once a restriction blocks it', async () => {
    const restrictedAdmin = await call({ afPath: 'roles', token: TOKEN.restricted });
    expect(restrictedAdmin.status).toBe(403);
  });
});

describe('Invariant B - a user cannot assign a permission they do not possess', () => {
  beforeEach(() => install());

  it('rejects creating a role with a module outside the actor own grants', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.admin,
      body: {
        name: 'Escalate',
        permissions: [
          { moduleKey: 'finance.commission_payouts', canView: true, canCreate: true, canUpdate: true, canDelete: true },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(db.rows('roles').some((r) => r.name === 'Escalate')).toBe(false);
  });

  it('rejects a partial over-grant inside a module the actor partly holds', async () => {
    const db = install();
    // The admin role can create organization.staff but not delete it.
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.admin,
      body: {
        name: 'Delete Staff Grant',
        permissions: [
          { moduleKey: 'organization.staff', canView: true, canCreate: false, canUpdate: false, canDelete: true },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(db.rows('roles').some((r) => r.name === 'Delete Staff Grant')).toBe(false);
  });

  it('rejects expanding an existing role beyond the actor own grants', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.custom}`,
      token: TOKEN.admin,
      body: {
        permissions: [
          { moduleKey: 'organization.roles', canView: true, canCreate: true, canUpdate: true, canDelete: true },
        ],
      },
    });
    expect(state.status).toBe(403);
  });

  it('rejects assigning a role whose permissions exceed the actor own', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { roleId: UUID.role.finance },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id).toBe(
      UUID.role.employee,
    );
  });

  it('rejects inviting a user into a role the actor cannot grant', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: { email: 'x@afhomes.test', fullName: 'X Y', departmentId: null, roleId: UUID.role.finance, temporaryPassword: 'TempPass123' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').some((s) => s.email === 'x@afhomes.test')).toBe(false);
  });
});

describe('Invariant C - an Admin cannot alter or deactivate the Super Admin', () => {
  beforeEach(() => install());

  it('rejects suspending the Super Admin', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { status: 'suspended' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.status).toBe('active');
  });

  it('rejects deactivating the Super Admin', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { status: 'inactive' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.status).toBe('active');
  });

  it('rejects moving the Super Admin to another department', async () => {
    const db = install();
    await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { departmentId: UUID.department.sales },
    });
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.department_id).toBe(
      UUID.department.executive,
    );
  });

  it('rejects an owner lockout via restrictions', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: {
        restrictions: [
          { moduleKey: 'dashboard.view', denyView: true, denyCreate: false, denyUpdate: false, denyDelete: false },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_permission_restrictions').some((r) => r.staff_id === UUID.superAdminStaff)).toBe(false);
  });

  it('rejects editing the Super Admin role permissions', async () => {
    install();
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.admin,
      body: { name: 'Renamed Owner' },
    });
    expect(state.status).toBe(403);
  });

  it('rejects creating a second Super Admin', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: { email: 'rival@afhomes.test', fullName: 'Rival', departmentId: null, roleId: UUID.role.superAdmin, temporaryPassword: 'TempPass123' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').some((s) => s.email === 'rival@afhomes.test')).toBe(false);
  });

  it('still lets a Super Admin govern another Super Admin', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.adminStaff}`,
      token: TOKEN.superAdmin,
      body: { status: 'suspended' },
    });
    expect(state.status).toBe(200);
    expect(db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status).toBe('suspended');
  });
});

describe('Invariant D - protected system roles cannot be deleted or defanged', () => {
  beforeEach(() => install());

  it('exposes no delete route for a system role', async () => {
    for (const method of ['DELETE', 'PUT']) {
      const state = await call({
        method,
        afPath: `roles/${UUID.role.superAdmin}`,
        token: TOKEN.superAdmin,
        body: { name: 'x' },
      });
      expect(state.status, method).toBe(404);
    }
    // PATCH is a real route, so it reaches the protection guard rather than 404.
    const patch = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.superAdmin,
      body: { name: 'x' },
    });
    expect(patch.status).toBe(403);
  });

  it('exposes no delete route for a custom role either (deletion is not a Phase 1 surface)', async () => {
    const state = await call({ method: 'DELETE', afPath: `roles/${UUID.role.custom}`, token: TOKEN.superAdmin });
    expect(state.status).toBe(404);
  });

  it('refuses to edit any system role, even by a Super Admin', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.employee}`,
      token: TOKEN.superAdmin,
      body: { name: 'Renamed System Role' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('roles').find((r) => r.id === UUID.role.employee)!.name).toBe('Employee');
  });

  it('refuses to flip isSystem or isActive on a system role', async () => {
    const db = install();
    for (const patch of [{ isSystem: false }, { isActive: false }]) {
      const state = await call({
        method: 'PATCH',
        afPath: `roles/${UUID.role.admin}`,
        token: TOKEN.superAdmin,
        body: patch,
      });
      expect(state.status).toBe(403);
    }
    const row = db.rows('roles').find((r) => r.id === UUID.role.admin)!;
    expect(row.is_system).toBe(true);
    expect(row.is_active).toBe(true);
  });

  it('refuses to reassign a staff member into an inactive role', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: { roleId: UUID.role.retired },
    });
    expect(state.status).toBe(400);
    expect(db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id).toBe(
      UUID.role.employee,
    );
  });
});

describe('Invariant F - client permission state cannot authorize a server action', () => {
  beforeEach(() => install());

  it('rejects a request with no token regardless of any client claim', async () => {
    const state = await call({
      afPath: 'roles',
      headers: {
        'x-role': 'super_admin',
        'x-permissions': 'organization.roles:create',
        'x-forwarded-for': '127.0.0.1',
      },
    });
    expect(state.status).toBe(401);
  });

  it('rejects a forged or unknown token', async () => {
    const state = await call({
      afPath: 'roles',
      token: 'eyJhbGciOiJIUzI1NiJ9.forged.signature',
      headers: { 'x-role': 'super_admin' },
    });
    expect(state.status).toBe(401);
  });

  it('denies a real but unprivileged principal even when the body claims authority', async () => {
    const state = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.viewer,
      body: {
        name: 'Client Says Super Admin',
        permissions: [
          { moduleKey: 'governance.config', canView: true, canCreate: true, canUpdate: true, canDelete: true },
        ],
      },
    });
    expect(state.status).toBe(403);
  });

  it('ignores a client-supplied role in the request body for the session route', async () => {
    const state = await call({
      method: 'GET',
      afPath: 'session',
      token: TOKEN.viewer,
      body: { roleSlug: 'super_admin', permissions: [] },
    });
    expect(state.status).toBe(200);
    expect((state.body as { roleSlug: string }).roleSlug).toBe('employee');
  });
});

describe('Invariant G - inactive staff cannot use staff APIs with a valid session', () => {
  it.each(['inactive', 'suspended'] as const)('blocks a %s account', async (status) => {
    const db = install();
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = status;

    for (const afPath of ['session', 'roles', 'staff', 'departments', 'dashboard']) {
      const state = await call({ afPath, token: TOKEN.admin });
      expect(state.status, afPath).toBe(403);
    }
  });

  it('blocks writes as well as reads', async () => {
    const db = install();
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'suspended';
    const state = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { code: 'NEWONE', name: 'New One' },
    });
    expect(state.status).toBe(403);
    expect(db.rows('departments').some((d) => d.code === 'NEWONE')).toBe(false);
  });

  it('blocks an account whose role was deactivated', async () => {
    const db = install();
    db.rows('roles').find((r) => r.id === UUID.role.admin)!.is_active = false;
    const state = await call({ afPath: 'staff', token: TOKEN.admin });
    expect(state.status).toBe(403);
  });
});

describe('Invariant H - a permission change takes effect on the next resolution', () => {
  it('applies a newly added restriction without any client-side change', async () => {
    const db = install();
    const before = await call({ afPath: 'roles', token: TOKEN.admin });
    expect(before.status).toBe(200);

    db.rows('staff_permission_restrictions').push({
      staff_id: UUID.adminStaff,
      module_id: moduleId('organization.roles'),
      deny_view: true,
      deny_create: true,
      deny_update: true,
      deny_delete: true,
    });

    // Same token, same handler instance, no client cooperation.
    const after = await call({ afPath: 'roles', token: TOKEN.admin });
    expect(after.status).toBe(403);
  });

  it('applies a role reassignment on the very next request', async () => {
    const db = install();
    // Employee role cannot read the role list; the admin role can.
    expect((await call({ afPath: 'roles', token: TOKEN.viewer })).status).toBe(403);

    db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id =
      UUID.role.admin;

    expect((await call({ afPath: 'roles', token: TOKEN.viewer })).status).toBe(200);
  });

  it('restores access when the restriction is removed', async () => {
    const db = install();
    expect((await call({ afPath: 'roles', token: TOKEN.restricted })).status).toBe(403);
    db.rows('staff_permission_restrictions').length = 0;
    expect((await call({ afPath: 'roles', token: TOKEN.restricted })).status).toBe(200);
  });

  it('does not cache a principal across requests', async () => {
    const db = install();
    const first = await call({ afPath: 'session', token: TOKEN.admin });
    const second = await call({ afPath: 'session', token: TOKEN.admin });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Deactivating between calls must be observed by the next one.
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'suspended';
    const third = await call({ afPath: 'session', token: TOKEN.admin });
    expect(third.status).toBe(403);
  });
});
