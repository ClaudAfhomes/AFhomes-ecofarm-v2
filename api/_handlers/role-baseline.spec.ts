/**
 * AF Homes Phase 2 - default role permission baseline.
 *
 * Proves the matrix in `@jad/contracts` (`role-baseline.ts`, the authority),
 * the migration SQL carrying it, and the enforced behaviour agree:
 *
 *  1. MIGRATION TEXT - every matrix tuple is present verbatim, exactly 70
 *     tuples, no `super_admin`/`customer` tuple, idempotent upsert, and no
 *     destructive statement. A drift between code and SQL fails here, not in
 *     production.
 *  2. EFFECTIVE PERMISSIONS - the real resolver returns exactly the matrix
 *     for each of the eight operational roles, zero admin modules for a
 *     customer (no staff row), and implicit full access for Super Admin.
 *  3. API ALLOWED/DENIED - the real admin handler allows and denies per role.
 *  4. DENY-ONLY RESTRICTIONS - a per-user deny subtracts, never adds.
 *  5. PRIVILEGE SUBSET - nobody grants what they do not hold.
 *  6. SUPER ADMIN PROTECTION - Admin cannot touch a Super Admin account or
 *     assign the Super Admin role.
 *
 * Everything runs through the real handler + real resolver + real Zod
 * schemas against the in-memory fake; only the Supabase client is replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  afHomesModuleKeySchema,
  BASELINE_ROW_COUNT,
  DEFAULT_ROLE_BASELINE,
  type AfHomesPermission,
} from '@jad/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { default: handler } = await import('./admin/afhomes.js');

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
);
const BASELINE_FILE = '20260930000001_afhomes_role_permission_baseline.sql';
const baselineSql = fs.readFileSync(path.join(MIGRATIONS, BASELINE_FILE), 'utf8');
/** SQL with `--` line comments removed, so assertions judge code, not prose. */
const baselineCode = baselineSql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

const ALL_KEYS = afHomesModuleKeySchema.options;
const moduleId = (key: string) => `module:${key}`;
// Synthetic ids must be real UUIDs: the staff/role PATCH routes only match
// `[0-9a-f-]+`, so a non-UUID id would 404 instead of reaching authorization.
const SLUG_INDEX: Record<string, string> = {
  super_admin: '01',
  admin: '02',
  finance: '03',
  hr: '04',
  vice_director: '05',
  senior_sales_manager: '06',
  sales_manager: '07',
  ost: '08',
  employee: '09',
  customer: '10',
};
const roleId = (slug: string) => `10000000-0000-4000-8000-0000000000${SLUG_INDEX[slug]!}`;
const staffId = (slug: string) => `20000000-0000-4000-8000-0000000000${SLUG_INDEX[slug]!}`;
const OUTSIDER_ID = '20000000-0000-4000-8000-000000000099';
const tokenFor = (slug: string) => `tok-${slug}`;

const ROLE_NAMES: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  finance: 'Finance',
  hr: 'HR',
  vice_director: 'Vice Director',
  senior_sales_manager: 'Senior Sales Manager',
  sales_manager: 'Sales Manager',
  ost: 'OST',
  employee: 'Employee',
  customer: 'Customer',
};

function baselineTables() {
  const modules = ALL_KEYS.map((key, index) => ({
    id: moduleId(key),
    key,
    name: key,
    group_name: key.split('.')[0]!,
    sort_order: (index + 1) * 10,
    is_active: true,
  }));
  const roles = Object.keys(ROLE_NAMES).map((slug) => ({
    id: roleId(slug),
    slug,
    name: ROLE_NAMES[slug]!,
    description: null,
    is_system: true,
    is_active: true,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  }));
  const role_permissions = Object.entries(DEFAULT_ROLE_BASELINE).flatMap(([slug, grants]) =>
    grants.map((grant) => ({
      role_id: roleId(slug),
      module_id: moduleId(grant.moduleKey),
      can_view: grant.canView,
      can_create: grant.canCreate,
      can_update: grant.canUpdate,
      can_delete: grant.canDelete,
    })),
  );
  // Every role except customer is held by one active staff account. Customer is
  // deliberately NOT staff: the portal is ownership-based, so a customer has
  // no staff row and the resolver must refuse them staff access entirely.
  const staffSlugs = Object.keys(ROLE_NAMES).filter((slug) => slug !== 'customer');
  const staff_users = staffSlugs.map((slug) => ({
    id: staffId(slug),
    email: `${slug}@afhomes.test`,
    full_name: ROLE_NAMES[slug]!,
    department_id: null,
    status: 'active',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  }));
  const staff_role_assignments = staffSlugs.map((slug) => ({
    staff_id: staffId(slug),
    role_id: roleId(slug),
    assigned_at: '2026-09-01T00:00:00.000Z',
  }));
  return {
    modules,
    roles,
    role_permissions,
    departments: [],
    staff_users,
    staff_role_assignments,
    staff_permission_restrictions: [],
    staff_invitations: [],
    audit_events: [],
  };
}

function baselineTokens() {
  const tokens: Record<string, { id: string; email: string; email_confirmed_at: string }> = {};
  for (const slug of Object.keys(ROLE_NAMES)) {
    if (slug === 'customer') continue;
    tokens[tokenFor(slug)] = {
      id: staffId(slug),
      email: `${slug}@afhomes.test`,
      email_confirmed_at: '2026-09-01T00:00:00.000Z',
    };
  }
  // A signed-in user with no staff row: this is what a customer looks like to
  // the STAFF resolver, and it must get zero admin modules.
  tokens['tok-outsider'] = {
    id: OUTSIDER_ID,
    email: 'outsider@afhomes.test',
    email_confirmed_at: '2026-09-01T00:00:00.000Z',
  };
  return tokens;
}

const UNIQUE = {
  roles: [['slug'], ['name']],
  modules: [['id'], ['key']],
  role_permissions: [['role_id', 'module_id']],
  staff_users: [['id'], ['email']],
  staff_role_assignments: [['staff_id']],
  staff_permission_restrictions: [['staff_id', 'module_id']],
};

function install(extraTables: Record<string, unknown[]> = {}) {
  holder.db = new FakeSupabase({
    tables: { ...baselineTables(), ...extraTables } as never,
    tokens: baselineTokens(),
    unique: UNIQUE as never,
  });
  return holder.db as FakeSupabase;
}

async function call(options: {
  afPath: string;
  method?: string;
  token?: string;
  body?: unknown;
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

const permsOf = (body: unknown) =>
  (body as { permissions: AfHomesPermission[] }).permissions;
const byKey = (body: unknown) =>
  new Map(permsOf(body).map((permission) => [permission.moduleKey, permission]));
/** Shorthand permission literals for role-creation bodies. */
const viewOnly = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});
const full = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  ...viewOnly(moduleKey),
  canCreate: true,
  canUpdate: true,
});
const errOf = (body: unknown) => (body as { error?: { code?: string } }).error;

/* ================================================================== */
/* 1. Migration text carries exactly the matrix                        */
/* ================================================================== */

describe('role baseline migration carries exactly the matrix', () => {
  const tuple = (role: string, key: string, grant: AfHomesPermission) =>
    `('${role}','${key}',${grant.canView},${grant.canCreate},` +
    `${grant.canUpdate},${grant.canDelete})`;
  const flat = baselineCode.replace(/\s+/g, '');

  it('installs one tuple per matrix row (70), keyed by role slug and module key', () => {
    const tuples = baselineCode.split('\n').filter((line) => /^ *\('[^']+', '/.test(line));
    expect(tuples.length).toBe(BASELINE_ROW_COUNT);
    expect(tuples.length).toBe(70);
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_BASELINE)) {
      for (const grant of grants) {
        expect(
          flat.includes(tuple(role, grant.moduleKey, grant as AfHomesPermission)),
          `missing tuple ${role} ${grant.moduleKey}`,
        ).toBe(true);
      }
    }
  });

  it('holds no super_admin or customer tuple (their semantics must not move)', () => {
    const tupleLines = baselineCode.split('\n').filter((line) => /^ *\('[^']+', '/.test(line));
    for (const line of tupleLines) {
      expect(line.includes("'super_admin'"), `super_admin tuple: ${line.trim()}`).toBe(false);
      expect(line.includes("'customer'"), `customer tuple: ${line.trim()}`).toBe(false);
    }
  });

  it('is idempotent (upsert on the primary key) and non-destructive', () => {
    expect(baselineCode).toMatch(/on conflict\s*\(\s*role_id\s*,\s*module_id\s*\)\s*do update/i);
    // Statement-level scan: a line STARTING with DELETE or TRUNCATE would be
    // a destructive write. Column names such as `can_delete` must not trip
    // this - hence the line anchor, not a bare substring search.
    expect(baselineCode).not.toMatch(/^\s*(delete\s+from|truncate)\b/im);
  });
});

/* ================================================================== */
/* 2. Effective permissions match the matrix exactly                   */
/* ================================================================== */

describe('effective permissions match the matrix', () => {
  beforeEach(() => install());

  it.each(Object.keys(DEFAULT_ROLE_BASELINE))(
    'resolves %s to exactly its matrix rows',
    async (slug) => {
    const state = await call({ afPath: 'session', token: tokenFor(slug) });
    expect(state.status).toBe(200);
    const actual = byKey(state.body);
    expect(actual.size).toBe(ALL_KEYS.length);
    const grants = new Map(
      DEFAULT_ROLE_BASELINE[slug as keyof typeof DEFAULT_ROLE_BASELINE].map((grant) => [
        grant.moduleKey,
        grant,
      ]),
    );
    for (const key of ALL_KEYS) {
      const permission = actual.get(key)!;
      const grant = grants.get(key);
      expect(permission.canView, `${slug} ${key} view`).toBe(grant?.canView === true);
      expect(permission.canCreate, `${slug} ${key} create`).toBe(grant?.canCreate === true);
      expect(permission.canUpdate, `${slug} ${key} update`).toBe(grant?.canUpdate === true);
      expect(permission.canDelete, `${slug} ${key} delete`).toBe(false);
    }
    },
  );

  it('gives a customer (no staff row) zero admin modules: staff access refused', async () => {
    const state = await call({ afPath: 'session', token: 'tok-outsider' });
    expect(state.status).toBe(403);
    expect(errOf(state.body)?.code).toBe('FORBIDDEN');
  });

  it('keeps Super Admin implicit: every module, every action, with no rows needed', async () => {
    const state = await call({ afPath: 'session', token: tokenFor('super_admin') });
    expect(state.status).toBe(200);
    for (const permission of permsOf(state.body)) {
      expect(permission, permission.moduleKey).toEqual({
        moduleKey: permission.moduleKey,
        canView: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
      });
    }
  });

  it('reports non-zero module counts for every operational role', async () => {
    const state = await call({ afPath: 'roles', token: tokenFor('super_admin') });
    expect(state.status).toBe(200);
    const rows = (state.body as { data: { slug: string; permissions: AfHomesPermission[] }[] })
      .data;
    const counts = new Map(
      rows.map((row) => [row.slug, row.permissions.filter((p) => p.canView).length]),
    );
    expect(counts.get('admin')).toBe(20);
    expect(counts.get('finance')).toBe(8);
    expect(counts.get('hr')).toBe(3);
    expect(counts.get('vice_director')).toBe(10);
    expect(counts.get('senior_sales_manager')).toBe(8);
    expect(counts.get('sales_manager')).toBe(10);
    expect(counts.get('ost')).toBe(8);
    expect(counts.get('employee')).toBe(3);
  });
});

/* ================================================================== */
/* 3. API allowed / denied per role                                    */
/* ================================================================== */

describe('API allowed and denied per role', () => {
  beforeEach(() => install());

  const cases: { role: string; allowed: string[]; denied: string[] }[] = [
    { role: 'admin', allowed: ['roles', 'staff', 'departments', 'dashboard'], denied: [] },
    { role: 'finance', allowed: ['dashboard'], denied: ['roles', 'staff', 'departments'] },
    { role: 'hr', allowed: ['staff', 'departments', 'dashboard'], denied: ['roles'] },
    {
      role: 'vice_director',
      allowed: ['dashboard'],
      denied: ['roles', 'staff', 'departments'],
    },
    {
      role: 'senior_sales_manager',
      allowed: ['dashboard'],
      denied: ['roles', 'staff', 'departments'],
    },
    {
      role: 'sales_manager',
      allowed: ['dashboard'],
      denied: ['roles', 'staff', 'departments'],
    },
    { role: 'ost', allowed: ['dashboard'], denied: ['roles', 'staff', 'departments'] },
    { role: 'employee', allowed: ['dashboard'], denied: ['roles', 'staff', 'departments'] },
  ];

  it.each(cases.map((c) => c.role))('enforces %s allow/deny on admin endpoints', async (role) => {
    const { allowed, denied } = cases.find((c) => c.role === role)!;
    for (const afPath of allowed) {
      const state = await call({ afPath, token: tokenFor(role) });
      expect(state.status, `${role} GET ${afPath}`).toBe(200);
    }
    for (const afPath of denied) {
      const state = await call({ afPath, token: tokenFor(role) });
      expect(state.status, `${role} GET ${afPath}`).toBe(403);
    }
  });

  it('lets finance read the dashboard but not role administration', async () => {
    expect((await call({ afPath: 'dashboard', token: tokenFor('finance') })).status).toBe(200);
    expect((await call({ afPath: 'roles', token: tokenFor('finance') })).status).toBe(403);
  });

  it('lets hr manage staff but not roles', async () => {
    expect((await call({ afPath: 'staff', token: tokenFor('hr') })).status).toBe(200);
    expect((await call({ afPath: 'roles', token: tokenFor('hr') })).status).toBe(403);
  });
});

/* ================================================================== */
/* 4. Deny-only per-user restrictions                                  */
/* ================================================================== */

describe('deny-only per-user restrictions override role grants', () => {
  it('subtracts the denied view (and everything depending on it) but keeps the rest', async () => {
    const db = install();
    db.rows('staff_permission_restrictions').push({
      staff_id: staffId('ost'),
      module_id: moduleId('dashboard.view'),
      deny_view: true,
      deny_create: false,
      deny_update: false,
      deny_delete: false,
    });
    const state = await call({ afPath: 'session', token: tokenFor('ost') });
    expect(state.status).toBe(200);
    const actual = byKey(state.body);
    expect(actual.get('dashboard.view')).toEqual({
      moduleKey: 'dashboard.view',
      canView: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
    // An unrelated grant from the same role is untouched.
    expect(actual.get('sales.card_sales')).toMatchObject({ canView: true, canCreate: true });
    expect((await call({ afPath: 'dashboard', token: tokenFor('ost') })).status).toBe(403);
  });

  it('cannot manufacture a grant the role never held', async () => {
    const db = install();
    db.rows('staff_permission_restrictions').push({
      staff_id: staffId('employee'),
      module_id: moduleId('organization.roles'),
      deny_view: false,
      deny_create: true,
      deny_update: false,
      deny_delete: false,
    });
    const state = await call({ afPath: 'session', token: tokenFor('employee') });
    const roles = byKey(state.body).get('organization.roles')!;
    expect(roles.canView).toBe(false);
    expect(roles.canCreate).toBe(false);
  });
});

/* ================================================================== */
/* 5. Privilege subset                                                 */
/* ================================================================== */

describe('privilege-subset enforcement on the baseline', () => {
  beforeEach(() => install());

  it('refuses an Admin grant of a module the Admin does not hold', async () => {
    const state = await call({
      afPath: 'roles',
      method: 'POST',
      token: tokenFor('admin'),
      body: {
        name: 'Config Club',
        permissions: [viewOnly('dashboard.view'), viewOnly('governance.config')],
      },
    });
    expect(state.status).toBe(403);
  });

  it('refuses HR a role carrying anything outside HR scope', async () => {
    // HR holds organization.staff, which is what role creation itself needs -
    // so this reaches the subset check rather than the gate.
    const db = holder.db as FakeSupabase;
    db.rows('role_permissions').push({
      role_id: roleId('hr'),
      module_id: moduleId('organization.roles'),
      can_view: true,
      can_create: true,
      can_update: false,
      can_delete: false,
    });
    const state = await call({
      afPath: 'roles',
      method: 'POST',
      token: tokenFor('hr'),
      body: {
        name: 'Seller Plus',
        permissions: [full('sales.customers')],
      },
    });
    expect(state.status).toBe(403);
  });

  it('accepts an Admin grant strictly inside its own permissions', async () => {
    const state = await call({
      afPath: 'roles',
      method: 'POST',
      token: tokenFor('admin'),
      body: {
        name: 'Dashboard Watcher',
        permissions: [viewOnly('dashboard.view')],
      },
    });
    expect(state.status).toBe(201);
  });
});

/* ================================================================== */
/* 6. Super Admin protection                                           */
/* ================================================================== */

describe('Super Admin protection on the baseline', () => {
  beforeEach(() => install());

  it('refuses an Admin attempt to alter a Super Admin account', async () => {
    const state = await call({
      afPath: `staff/${staffId('super_admin')}`,
      method: 'PATCH',
      token: tokenFor('admin'),
      body: { status: 'suspended' as const },
    });
    expect(state.status).toBe(403);
  });

  it('refuses an Admin attempt to assign the Super Admin role', async () => {
    const state = await call({
      afPath: 'staff',
      method: 'POST',
      token: tokenFor('admin'),
      body: {
        email: 'heir@afhomes.test',
        fullName: 'Heir Apparent',
        departmentId: null,
        roleId: roleId('super_admin'),
      },
    });
    expect(state.status).toBe(403);
  });

  it('refuses an Admin attempt to edit its own role permissions', async () => {
    const state = await call({
      afPath: `roles/${roleId('admin')}`,
      method: 'PATCH',
      token: tokenFor('admin'),
      body: { description: 'self edit' },
    });
    expect(state.status).toBe(403);
  });

  it('refuses an Admin attempt to defang a protected system role', async () => {
    const state = await call({
      afPath: `roles/${roleId('finance')}`,
      method: 'PATCH',
      token: tokenFor('admin'),
      body: { description: 'defang' },
    });
    expect(state.status).toBe(403);
  });
});
