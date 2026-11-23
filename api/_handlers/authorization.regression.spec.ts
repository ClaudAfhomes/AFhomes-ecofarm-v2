/**
 * AFHomes authorization regression suite.
 *
 * One explicitly-named test per security invariant, so a regression names the
 * invariant it broke. Backend authorization is authoritative throughout: every
 * case here drives the real handler + the real resolver + the real Zod schemas.
 *
 * Invariants A-H are defined in `AGENTS.md`; the frontend counterparts
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
  (
    body as {
      permissions: {
        moduleKey: string;
        canView: boolean;
        canCreate: boolean;
        canUpdate: boolean;
        canDelete: boolean;
      }[];
    }
  ).permissions;

/**
 * The refusal's message. Asserting it pins WHICH guard refused, so a test
 * cannot stay green because an unrelated check (missing module grant, schema
 * validation) happened to return the same status first.
 */
const reason = (state: State) =>
  (state.body as { error?: { message?: string } } | undefined)?.error?.message;

/** A deep copy of a fake table, for "nothing was written" assertions. */
const snapshot = (db: FakeSupabase, table: string) => structuredClone(db.rows(table));

/** Give the fixture Admin role `organization.roles` delete, so a DELETE reaches the protection guard. */
function grantAdminRoleDelete(db: FakeSupabase) {
  db.rows('role_permissions').find(
    (p) => p.role_id === UUID.role.admin && p.module_id === moduleId('organization.roles'),
  )!.can_delete = true;
}

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

  it('a write-only restriction blocks the write but leaves the view it did not deny', async () => {
    // Control: the unrestricted Admin role creates a department with this exact
    // body, so the refusal below cannot be a validation error.
    const control = install();
    const created = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { name: 'Control Unit' },
    });
    expect(created.status).toBe(201);
    expect(control.rows('departments').some((d) => d.name === 'Control Unit')).toBe(true);

    const db = install();
    db.rows('staff_permission_restrictions').push({
      staff_id: UUID.adminStaff,
      module_id: moduleId('organization.departments'),
      deny_view: false,
      deny_create: true,
      deny_update: false,
      deny_delete: false,
    });
    const session = await call({ afPath: 'session', token: TOKEN.admin });
    expect(perms(session.body).find((p) => p.moduleKey === 'organization.departments')).toEqual({
      moduleKey: 'organization.departments',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    });

    expect((await call({ afPath: 'departments', token: TOKEN.admin })).status).toBe(200);

    const before = snapshot(db, 'departments');
    const refused = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { name: 'Control Unit' },
    });
    expect(refused.status).toBe(403);
    expect(reason(refused)).toBe('Insufficient permission');
    expect(db.rows('departments')).toEqual(before);
    expect(db.rows('audit_events').some((e) => e.action === 'DEPARTMENT_CREATED')).toBe(false);
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
        departmentId: UUID.department.sales,
        permissions: [
          {
            moduleKey: 'finance.commission_payouts',
            canView: true,
            canCreate: true,
            canUpdate: true,
            canDelete: true,
          },
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
        departmentId: UUID.department.sales,
        permissions: [
          {
            moduleKey: 'organization.staff',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: true,
          },
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
    expect(
      db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
    ).toBe(UUID.role.employee);
  });

  it('rejects inviting a user into a role the actor cannot grant', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'x@afhomes.test',
        fullName: 'X Y',
        departmentId: null,
        roleId: UUID.role.finance,
        temporaryPassword: 'TempPass123',
      },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').some((s) => s.email === 'x@afhomes.test')).toBe(false);
  });

  describe('enforces the EFFECTIVE permission, not the raw role grant', () => {
    // The Admin ROLE grants organization.staff update; a personal restriction
    // removes it. Each case runs once unrestricted (control: proves the request
    // is valid and would succeed) and once restricted (must be refused).
    const staffUpdate = {
      moduleKey: 'organization.staff',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    } as const;
    const restrictStaffUpdate = (db: FakeSupabase) =>
      db.rows('staff_permission_restrictions').push({
        staff_id: UUID.adminStaff,
        module_id: moduleId('organization.staff'),
        deny_view: false,
        deny_create: false,
        deny_update: true,
        deny_delete: false,
      });

    it('creating a role', async () => {
      const body = {
        name: 'Staff Editors',
        departmentId: UUID.department.sales,
        permissions: [staffUpdate],
      };
      install();
      expect((await call({ method: 'POST', afPath: 'roles', token: TOKEN.admin, body })).status).toBe(
        201,
      );

      const db = install();
      restrictStaffUpdate(db);
      const roles = snapshot(db, 'roles');
      const grants = snapshot(db, 'role_permissions');
      const refused = await call({ method: 'POST', afPath: 'roles', token: TOKEN.admin, body });
      expect(refused.status).toBe(403);
      expect(reason(refused)).toBe('Cannot grant permissions you do not possess');
      expect(db.rows('roles')).toEqual(roles);
      expect(db.rows('role_permissions')).toEqual(grants);
    });

    it('expanding an existing role', async () => {
      const body = { permissions: [staffUpdate] };
      const afPath = `roles/${UUID.role.custom}`;
      install();
      expect((await call({ method: 'PATCH', afPath, token: TOKEN.admin, body })).status).toBe(200);

      const db = install();
      restrictStaffUpdate(db);
      const grants = snapshot(db, 'role_permissions');
      const refused = await call({ method: 'PATCH', afPath, token: TOKEN.admin, body });
      expect(refused.status).toBe(403);
      expect(reason(refused)).toBe('Cannot grant permissions you do not possess');
      expect(db.rows('role_permissions')).toEqual(grants);
    });

    it('assigning a role that carries the removed permission', async () => {
      const body = { roleId: UUID.role.admin };
      const afPath = `staff/${UUID.viewerStaff}`;
      install();
      expect((await call({ method: 'PATCH', afPath, token: TOKEN.admin, body })).status).toBe(200);

      const db = install();
      restrictStaffUpdate(db);
      // Staff PATCH itself needs organization.staff update, which the restriction
      // removed - so this is refused before it can even reach the subset rule.
      // Either way the assignment must not move.
      const refused = await call({ method: 'PATCH', afPath, token: TOKEN.admin, body });
      expect(refused.status).toBe(403);
      expect(reason(refused)).toBe('Insufficient permission');
      expect(
        db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
      ).toBe(UUID.role.employee);
    });

    it('assigning a role whose grant the actor lost through a restriction on another module', async () => {
      // Keeps organization.staff update (so the route is reachable) and removes
      // governance.audit view, which the Admin role grants and the target
      // (Admin) role carries. The subset rule must see the restriction.
      const body = { roleId: UUID.role.admin };
      const afPath = `staff/${UUID.viewerStaff}`;
      const db = install();
      db.rows('staff_permission_restrictions').push({
        staff_id: UUID.adminStaff,
        module_id: moduleId('governance.audit'),
        deny_view: true,
        deny_create: false,
        deny_update: false,
        deny_delete: false,
      });
      const refused = await call({ method: 'PATCH', afPath, token: TOKEN.admin, body });
      expect(refused.status).toBe(403);
      expect(reason(refused)).toBe('Cannot assign permissions you do not possess');
      expect(
        db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
      ).toBe(UUID.role.employee);
    });
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
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.status).toBe(
      'active',
    );
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
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.status).toBe(
      'active',
    );
  });

  it('rejects moving the Super Admin to another department', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { departmentId: UUID.department.sales },
    });
    expect(state.status).toBe(403);
    expect(reason(state)).toBe('Only Super Admin can modify a Super Admin');
    expect(db.rows('staff_users').find((s) => s.id === UUID.superAdminStaff)!.department_id).toBe(
      UUID.department.executive,
    );
  });

  it('rejects changing the Super Admin staff member role', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${UUID.superAdminStaff}`,
      token: TOKEN.admin,
      body: { roleId: UUID.role.admin },
    });
    expect(state.status).toBe(403);
    expect(reason(state)).toBe('Only Super Admin can modify a Super Admin');
    expect(
      db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.superAdminStaff)!.role_id,
    ).toBe(UUID.role.superAdmin);
  });

  it('rejects an Admin deleting the Super Admin role, at the protection guard', async () => {
    const db = install();
    // Without delete on organization.roles the request would be refused by the
    // module check instead; grant it so the system-role guard is what refuses.
    grantAdminRoleDelete(db);
    const roles = snapshot(db, 'roles');
    const grants = snapshot(db, 'role_permissions');
    const state = await call({
      method: 'DELETE',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.admin,
    });
    expect(state.status).toBe(403);
    expect(reason(state)).toBe('System roles cannot be deleted');
    expect(db.rows('roles')).toEqual(roles);
    expect(db.rows('role_permissions')).toEqual(grants);
  });

  it('rejects an Admin rewriting the Super Admin role permissions', async () => {
    const db = install();
    const grants = snapshot(db, 'role_permissions');
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.admin,
      body: {
        permissions: [
          {
            moduleKey: 'dashboard.view',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
        ],
      },
    });
    expect(state.status).toBe(403);
    expect(reason(state)).toBe('System access and protected role titles cannot be changed');
    expect(db.rows('role_permissions')).toEqual(grants);
  });

  it('rejects an owner lockout via restrictions', async () => {
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
    expect(reason(state)).toBe('Only Super Admin can modify a Super Admin');
    expect(
      db.rows('staff_permission_restrictions').some((r) => r.staff_id === UUID.superAdminStaff),
    ).toBe(false);
  });

  it('rejects renaming the Super Admin role', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.admin,
      body: { name: 'Renamed Owner' },
    });
    expect(state.status).toBe(403);
    expect(reason(state)).toBe('System access and protected role titles cannot be changed');
    expect(db.rows('roles').find((r) => r.id === UUID.role.superAdmin)!.name).toBe('Super Admin');
  });

  it('rejects creating a second Super Admin', async () => {
    const db = install();
    const state = await call({
      method: 'POST',
      afPath: 'staff',
      token: TOKEN.admin,
      body: {
        email: 'rival@afhomes.test',
        fullName: 'Rival',
        departmentId: null,
        roleId: UUID.role.superAdmin,
        temporaryPassword: 'TempPass123',
      },
    });
    expect(state.status).toBe(403);
    expect(db.rows('staff_users').some((s) => s.email === 'rival@afhomes.test')).toBe(false);
  });

  it('still lets a Super Admin govern an Admin', async () => {
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

  it('still lets a Super Admin govern another Super Admin', async () => {
    const db = install();
    const secondOwner = '00000000-0000-4000-8000-0000000000a2';
    db.rows('staff_users').push({
      id: secondOwner,
      email: 'second-owner@afhomes.test',
      full_name: 'Second Owner',
      department_id: UUID.department.admins,
      status: 'active',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    });
    db.rows('staff_role_assignments').push({ staff_id: secondOwner, role_id: UUID.role.superAdmin });
    // The same request from an Admin is refused...
    const denied = await call({
      method: 'PATCH',
      afPath: `staff/${secondOwner}`,
      token: TOKEN.admin,
      body: { status: 'suspended' },
    });
    expect(denied.status).toBe(403);
    expect(reason(denied)).toBe('Only Super Admin can modify a Super Admin');
    expect(db.rows('staff_users').find((s) => s.id === secondOwner)!.status).toBe('active');
    // ...and allowed from a Super Admin.
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${secondOwner}`,
      token: TOKEN.superAdmin,
      body: { status: 'suspended' },
    });
    expect(state.status).toBe(200);
    expect(db.rows('staff_users').find((s) => s.id === secondOwner)!.status).toBe('suspended');
  });
});

describe('Invariant D - protected system roles cannot be deleted or defanged', () => {
  it('lets only Super Admin change an employee display title without changing identity or access', async () => {
    const db = install();
    const grants = structuredClone(db.rows('role_permissions'));
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.employee}`,
      token: TOKEN.superAdmin,
      body: { name: 'Receptionist' },
    });
    expect(state.status).toBe(200);
    expect(db.rows('roles').find((role) => role.id === UUID.role.employee)).toMatchObject({
      name: 'Receptionist',
      slug: 'employee',
      is_system: true,
    });
    expect(db.rows('role_permissions')).toEqual(grants);
  });
  it.each([UUID.role.admin, UUID.role.superAdmin])(
    'never renames protected title %s',
    async (id) => {
      install();
      const state = await call({
        method: 'PATCH',
        afPath: `roles/${id}`,
        token: TOKEN.superAdmin,
        body: { name: 'Renamed' },
      });
      expect(state.status).toBe(403);
    },
  );
  beforeEach(() => install());

  it('refuses to delete a system role', async () => {
    for (const method of ['PUT']) {
      const state = await call({
        method,
        afPath: `roles/${UUID.role.superAdmin}`,
        token: TOKEN.superAdmin,
        body: { name: 'x' },
      });
      expect(state.status, method).toBe(404);
    }
    // DELETE is a real route, so it reaches the protection guard rather than 404.
    const del = await call({
      method: 'DELETE',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.superAdmin,
    });
    expect(del.status).toBe(403);
    // PATCH is a real route, so it reaches the protection guard rather than 404.
    const patch = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.superAdmin}`,
      token: TOKEN.superAdmin,
      body: { name: 'x' },
    });
    expect(patch.status).toBe(403);
  });

  it('deletes an unassigned custom role and refuses an assigned one', async () => {
    const db = install();
    // Fixture custom role is unassigned: safe delete succeeds and audits.
    const before = db.rows('roles').length;
    const del = await call({
      method: 'DELETE',
      afPath: `roles/${UUID.role.custom}`,
      token: TOKEN.superAdmin,
    });
    expect(del.status).toBe(200);
    expect(db.rows('roles').length).toBe(before - 1);
    expect(db.rows('audit_events').some((e) => e.action === 'ROLE_DELETED')).toBe(true);
    // An assigned custom role is refused without deleting.
    const assigned = await call({
      method: 'POST',
      afPath: 'roles',
      token: TOKEN.superAdmin,
      body: {
        name: 'Assigned Temp Role',
        isActive: true,
        departmentId: UUID.department.sales,
        permissions: [],
      },
    });
    expect(assigned.status).toBe(201);
    const newId = (assigned.body as { id: string }).id;
    db.rows('staff_role_assignments').push({ staff_id: UUID.viewerStaff, role_id: newId });
    const refused = await call({
      method: 'DELETE',
      afPath: `roles/${newId}`,
      token: TOKEN.superAdmin,
    });
    expect(refused.status).toBe(409);
    expect(db.rows('roles').some((r) => r.id === newId)).toBe(true);
  });

  it('refuses to change system access through a display-title edit', async () => {
    const db = install();
    const state = await call({
      method: 'PATCH',
      afPath: `roles/${UUID.role.employee}`,
      token: TOKEN.superAdmin,
      body: { name: 'Renamed System Role', isActive: false },
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
    expect(
      db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
    ).toBe(UUID.role.employee);
  });

  const SYSTEM_ROLES = [
    ['super_admin', UUID.role.superAdmin],
    ['admin', UUID.role.admin],
    ['finance', UUID.role.finance],
    ['employee', UUID.role.employee],
  ] as const;

  describe.each([
    ['Super Admin', TOKEN.superAdmin],
    ['Admin (holding organization.roles delete)', TOKEN.admin],
  ])('as %s', (_actor, token) => {
    it.each(SYSTEM_ROLES)('refuses to delete the %s system role', async (_slug, id) => {
      const db = install();
      grantAdminRoleDelete(db);
      const roles = snapshot(db, 'roles');
      const grants = snapshot(db, 'role_permissions');
      const assignments = snapshot(db, 'staff_role_assignments');
      const state = await call({ method: 'DELETE', afPath: `roles/${id}`, token });
      expect(state.status).toBe(403);
      expect(reason(state)).toBe('System roles cannot be deleted');
      expect(db.rows('roles')).toEqual(roles);
      expect(db.rows('role_permissions')).toEqual(grants);
      expect(db.rows('staff_role_assignments')).toEqual(assignments);
      expect(db.rows('audit_events').some((e) => e.action === 'ROLE_DELETED')).toBe(false);
    });

    // Every shape of "defanging": strip everything, strip one critical grant,
    // replace with an unrelated subset, and smuggle permissions alongside a
    // legitimate display-title edit.
    const DEFANG = [
      ['removes every permission', { permissions: [] }],
      [
        'keeps only dashboard.view (drops every critical grant)',
        {
          permissions: [
            {
              moduleKey: 'dashboard.view',
              canView: true,
              canCreate: false,
              canUpdate: false,
              canDelete: false,
            },
          ],
        },
      ],
      [
        'replaces the set with an unauthorized subset',
        {
          permissions: [
            {
              moduleKey: 'organization.staff',
              canView: true,
              canCreate: false,
              canUpdate: false,
              canDelete: false,
            },
          ],
        },
      ],
      ['carries permissions inside a display-title edit', { name: 'Renamed', permissions: [] }],
    ] as const;

    it.each(SYSTEM_ROLES)('refuses to defang the %s system role', async (_slug, id) => {
      for (const [label, body] of DEFANG) {
        const db = install();
        const roles = snapshot(db, 'roles');
        const grants = snapshot(db, 'role_permissions');
        const state = await call({ method: 'PATCH', afPath: `roles/${id}`, token, body });
        expect(state.status, label).toBe(403);
        expect(reason(state), label).toBe(
          'System access and protected role titles cannot be changed',
        );
        expect(db.rows('roles'), label).toEqual(roles);
        expect(db.rows('role_permissions'), label).toEqual(grants);
      }
    });
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
    expect(reason(state)).toBe('Insufficient permission');
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

  describe('with a VALID low-privilege session and forged authority claims', () => {
    const FORGED_HEADERS = {
      'x-role': 'super_admin',
      'x-role-slug': 'super_admin',
      'x-permissions': 'organization.roles:view,create,update,delete;governance.config:update',
      'x-user-id': UUID.superAdminStaff,
    };
    const FORGED_CLAIMS = {
      roleSlug: 'super_admin',
      roleId: UUID.role.superAdmin,
      userId: UUID.superAdminStaff,
      permissions: [
        {
          moduleKey: 'organization.roles',
          canView: true,
          canCreate: true,
          canUpdate: true,
          canDelete: true,
        },
      ],
    };

    it('resolves the real principal, not the forged one', async () => {
      install();
      const honest = await call({ afPath: 'session', token: TOKEN.viewer });
      const forged = await call({
        afPath: 'session',
        token: TOKEN.viewer,
        headers: FORGED_HEADERS,
        body: FORGED_CLAIMS,
      });
      expect(forged.status).toBe(200);
      expect(forged.body).toMatchObject({ id: UUID.viewerStaff, roleSlug: 'employee' });
      expect(perms(forged.body)).toEqual(perms(honest.body));
    });

    it('refuses a read the real principal does not hold', async () => {
      install();
      const state = await call({ afPath: 'roles', token: TOKEN.viewer, headers: FORGED_HEADERS });
      expect(state.status).toBe(403);
      expect(reason(state)).toBe('Insufficient permission');
    });

    it('refuses a write and persists nothing', async () => {
      const db = install();
      const roles = snapshot(db, 'roles');
      const grants = snapshot(db, 'role_permissions');
      // A schema-valid body, so a 403 cannot be a disguised validation failure.
      const state = await call({
        method: 'POST',
        afPath: 'roles',
        token: TOKEN.viewer,
        headers: FORGED_HEADERS,
        body: {
          ...FORGED_CLAIMS,
          name: 'Forged Owner',
          departmentId: UUID.department.sales,
          isActive: true,
        },
      });
      expect(state.status).toBe(403);
      expect(reason(state)).toBe('Insufficient permission');
      expect(db.rows('roles')).toEqual(roles);
      expect(db.rows('role_permissions')).toEqual(grants);
    });

    it('cannot self-escalate through the staff route either', async () => {
      const db = install();
      const state = await call({
        method: 'PATCH',
        afPath: `staff/${UUID.viewerStaff}`,
        token: TOKEN.viewer,
        headers: FORGED_HEADERS,
        body: { roleId: UUID.role.superAdmin },
      });
      expect(state.status).toBe(403);
      expect(
        db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.viewerStaff)!.role_id,
      ).toBe(UUID.role.employee);
    });
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
    // `{ name }` is the schema-valid body (the schema is strict), so the only
    // thing that can refuse this is the account standing.
    const state = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { name: 'New One' },
    });
    expect(state.status).toBe(403);
    expect(reason(state)).toBe('Staff account is not active');
    expect(db.rows('departments').some((d) => d.name === 'New One')).toBe(false);
  });

  // Sales and Finance endpoints (create a sale, record a payment, finance and
  // activation queues, commissions, ...) are covered for both fixture accounts
  // by the business MATRIX in `phase2-migration.spec.ts` ("a staff member with
  // no role assignment is refused everywhere" / "a suspended staff account
  // cannot use the business APIs"). These pin the Admin-console endpoints.
  it.each([
    ['suspended (fixture account)', TOKEN.inactive, 'Staff account is not active'],
    ['without a role assignment', TOKEN.unassigned, 'Staff role assignment required'],
  ])('refuses a %s staff member on every Admin endpoint', async (_label, token, message) => {
    const db = install();
    for (const afPath of ['roles', 'staff', 'departments', 'dashboard']) {
      const state = await call({ afPath, token });
      expect(state.status, afPath).toBe(403);
      expect(reason(state), afPath).toBe(message);
    }
    const before = snapshot(db, 'departments');
    const write = await call({
      method: 'POST',
      afPath: 'departments',
      token,
      body: { name: 'Ghost Unit' },
    });
    expect(write.status).toBe(403);
    expect(reason(write)).toBe(message);
    expect(db.rows('departments')).toEqual(before);
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

  // The grant a role holds is a row; revoking it is the ordinary way access is
  // removed. Same token, same handler, no fresh session: only the row changes.
  const roleGrant = (db: FakeSupabase, roleId: string, key: string) =>
    db.rows('role_permissions').find((p) => p.role_id === roleId && p.module_id === moduleId(key))!;

  it('revoking a role_permissions VIEW grant denies the very next read', async () => {
    const db = install();
    expect((await call({ afPath: 'roles', token: TOKEN.admin })).status).toBe(200);

    roleGrant(db, UUID.role.admin, 'organization.roles').can_view = false;

    const after = await call({ afPath: 'roles', token: TOKEN.admin });
    expect(after.status).toBe(403);
    expect(reason(after)).toBe('Insufficient permission');
  });

  it('revoking a role_permissions WRITE grant denies the very next write', async () => {
    const db = install();
    const first = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { name: 'First Unit' },
    });
    expect(first.status).toBe(201);

    roleGrant(db, UUID.role.admin, 'organization.departments').can_create = false;

    const before = snapshot(db, 'departments');
    const second = await call({
      method: 'POST',
      afPath: 'departments',
      token: TOKEN.admin,
      body: { name: 'Second Unit' },
    });
    expect(second.status).toBe(403);
    expect(reason(second)).toBe('Insufficient permission');
    expect(db.rows('departments')).toEqual(before);
    // The view the role still holds is unaffected.
    expect((await call({ afPath: 'departments', token: TOKEN.admin })).status).toBe(200);
  });

  it('deleting the grant row outright denies the very next request', async () => {
    const db = install();
    expect((await call({ afPath: 'roles', token: TOKEN.admin })).status).toBe(200);
    const grant = roleGrant(db, UUID.role.admin, 'organization.roles');
    db.tables.role_permissions = db.rows('role_permissions').filter((p) => p !== grant);
    expect((await call({ afPath: 'roles', token: TOKEN.admin })).status).toBe(403);
  });

  it('a role DOWNGRADE applies on the very next request', async () => {
    const db = install();
    expect((await call({ afPath: 'roles', token: TOKEN.admin })).status).toBe(200);

    db.rows('staff_role_assignments').find((r) => r.staff_id === UUID.adminStaff)!.role_id =
      UUID.role.employee;

    const session = await call({ afPath: 'session', token: TOKEN.admin });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ roleSlug: 'employee', roleId: UUID.role.employee });
    expect(perms(session.body).find((p) => p.moduleKey === 'organization.roles')!.canView).toBe(
      false,
    );
    const denied = await call({ afPath: 'roles', token: TOKEN.admin });
    expect(denied.status).toBe(403);
    expect(reason(denied)).toBe('Insufficient permission');
  });

  it('a suspension applies to a module endpoint on the very next request', async () => {
    const db = install();
    expect((await call({ afPath: 'departments', token: TOKEN.admin })).status).toBe(200);
    db.rows('staff_users').find((s) => s.id === UUID.adminStaff)!.status = 'suspended';
    const denied = await call({ afPath: 'departments', token: TOKEN.admin });
    expect(denied.status).toBe(403);
    expect(reason(denied)).toBe('Staff account is not active');
  });
});
