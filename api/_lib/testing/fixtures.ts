/**
 * Canonical AF Homes fixtures for handler tests.
 *
 * Mirrors the shape produced by `supabase/migrations/20260926023325_afhomes_phase1_foundation.sql`:
 * 22 modules, 10 system roles, 5 departments, and the `staff_users` /
 * `staff_role_assignments` / `role_permissions` / `staff_permission_restrictions`
 * links the resolver walks. Nothing here is production data - ids are stable
 * literals so assertions can name them.
 */
import type { AfHomesPermission } from '@jad/contracts';

import type { FakeRow, FakeTables } from './supabase-fake.js';

export const MODULE_KEYS = [
  'dashboard.view',
  'organization.staff',
  'organization.departments',
  'organization.roles',
  'sales.card_sales',
  'sales.card_plans',
  'sales.customers',
  'sales.id_documents',
  'finance.payment_verification',
  'finance.card_activation',
  'finance.final_qualification',
  'finance.commission_payouts',
  'network.ost_registrations',
  'network.ost_members',
  'network.genealogy',
  'network.referrals',
  'network.commissions',
  'network.withdrawals',
  'operations.redemption',
  'operations.catalog',
  'governance.audit',
  'governance.config',
] as const satisfies readonly AfHomesPermission['moduleKey'][];

export const UUID = {
  superAdminStaff: '00000000-0000-4000-8000-0000000000aa',
  adminStaff: '00000000-0000-4000-8000-0000000000bb',
  viewerStaff: '00000000-0000-4000-8000-0000000000cc',
  restrictedStaff: '00000000-0000-4000-8000-0000000000dd',
  inactiveStaff: '00000000-0000-4000-8000-0000000000ee',
  unassignedStaff: '00000000-0000-4000-8000-0000000000ff',
  role: {
    superAdmin: '00000000-0000-4000-8000-000000000aa1',
    admin: '00000000-0000-4000-8000-000000000aa2',
    finance: '00000000-0000-4000-8000-000000000aa3',
    employee: '00000000-0000-4000-8000-000000000aa4',
    custom: '00000000-0000-4000-8000-000000000aa5',
    retired: '00000000-0000-4000-8000-000000000aa6',
  },
  department: {
    executive: '00000000-0000-4000-8000-000000000bb1',
    sales: '00000000-0000-4000-8000-000000000bb2',
    retired: '00000000-0000-4000-8000-000000000bb3',
  },
  customRole: '00000000-0000-4000-8000-000000000cc1',
} as const;

export const TOKEN = {
  superAdmin: 'token-super-admin',
  admin: 'token-admin',
  viewer: 'token-viewer',
  restricted: 'token-restricted',
  inactive: 'token-inactive',
  unassigned: 'token-unassigned',
} as const;

export const moduleId = (key: string) => `module:${key}`;

export function modulesTable(): FakeRow[] {
  return MODULE_KEYS.map((key, index) => ({
    id: moduleId(key),
    key,
    name: key,
    group_name: key.split('.')[0]!,
    sort_order: (index + 1) * 10,
    is_active: true,
  }));
}

export function departmentsTable(): FakeRow[] {
  return [
    {
      id: UUID.department.executive,
      code: 'EXECUTIVE',
      name: 'Executive',
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.department.sales,
      code: 'SALES',
      name: 'Sales',
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.department.retired,
      code: 'LEGACY',
      name: 'Legacy Unit',
      is_active: false,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
  ];
}

export function rolesTable(): FakeRow[] {
  return [
    {
      id: UUID.role.superAdmin,
      slug: 'super_admin',
      name: 'Super Admin',
      description: 'Full access',
      is_system: true,
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.role.admin,
      slug: 'admin',
      name: 'Admin',
      description: 'Operations admin',
      is_system: true,
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.role.finance,
      slug: 'finance',
      name: 'Finance',
      description: 'Finance operator',
      is_system: true,
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.role.employee,
      slug: 'employee',
      name: 'Employee',
      description: 'Base staff role',
      is_system: true,
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.role.custom,
      slug: 'sales_manager',
      name: 'Sales Manager',
      description: 'Custom role',
      is_system: false,
      is_active: true,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    },
    {
      id: UUID.role.retired,
      slug: 'retired_role',
      name: 'Retired Role',
      description: 'Inactive role',
      is_system: false,
      is_active: false,
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    },
  ];
}

/** Role grants keyed by role id. Super Admin is granted implicitly by slug. */
export function rolePermissionsTable(): FakeRow[] {
  const rows: FakeRow[] = [];
  const grant = (roleId: string, keys: readonly string[], level: FakeRow = {}) => {
    for (const key of keys) {
      rows.push({
        role_id: roleId,
        module_id: moduleId(key),
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
        ...level,
      });
    }
  };

  grant(
    UUID.role.admin,
    [
      'dashboard.view',
      'organization.staff',
      'organization.departments',
      'organization.roles',
      'sales.card_sales',
      'governance.audit',
    ],
    { can_create: true, can_update: true },
  );
  grant(UUID.role.finance, ['dashboard.view', 'finance.payment_verification', 'finance.card_activation'], {
    can_update: true,
  });
  grant(UUID.role.employee, ['dashboard.view']);
  grant(UUID.role.custom, ['dashboard.view', 'sales.card_sales'], { can_create: true });
  return rows;
}

export function staffUsersTable(): FakeRow[] {
  return [
    {
      id: UUID.superAdminStaff,
      email: 'super@afhomes.test',
      full_name: 'Super Admin',
      department_id: UUID.department.executive,
      status: 'active',
      invited_at: '2026-09-01T00:00:00.000Z',
      activated_at: '2026-09-01T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.adminStaff,
      email: 'admin@afhomes.test',
      full_name: 'Ops Admin',
      department_id: UUID.department.sales,
      status: 'active',
      invited_at: '2026-09-01T00:00:00.000Z',
      activated_at: '2026-09-01T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.viewerStaff,
      email: 'viewer@afhomes.test',
      full_name: 'Read Only',
      department_id: null,
      status: 'active',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.restrictedStaff,
      email: 'restricted@afhomes.test',
      full_name: 'Restricted Admin',
      department_id: UUID.department.sales,
      status: 'active',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.inactiveStaff,
      email: 'inactive@afhomes.test',
      full_name: 'Suspended Person',
      department_id: null,
      status: 'suspended',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: UUID.unassignedStaff,
      email: 'unassigned@afhomes.test',
      full_name: 'No Role',
      department_id: null,
      status: 'active',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
  ];
}

export function staffRoleAssignmentsTable(): FakeRow[] {
  return [
    { staff_id: UUID.superAdminStaff, role_id: UUID.role.superAdmin, assigned_at: '2026-09-01T00:00:00.000Z' },
    { staff_id: UUID.adminStaff, role_id: UUID.role.admin, assigned_at: '2026-09-01T00:00:00.000Z' },
    { staff_id: UUID.viewerStaff, role_id: UUID.role.employee, assigned_at: '2026-09-01T00:00:00.000Z' },
    { staff_id: UUID.restrictedStaff, role_id: UUID.role.admin, assigned_at: '2026-09-01T00:00:00.000Z' },
    { staff_id: UUID.inactiveStaff, role_id: UUID.role.admin, assigned_at: '2026-09-01T00:00:00.000Z' },
    // unassignedStaff intentionally has no assignment.
  ];
}

export function restrictionsTable(): FakeRow[] {
  return [
    {
      staff_id: UUID.restrictedStaff,
      module_id: moduleId('organization.roles'),
      deny_view: true,
      deny_create: false,
      deny_update: false,
      deny_delete: false,
    },
  ];
}

export type FixtureOverrides = {
  tables?: Partial<FakeTables>;
  tokens?: Record<string, { id: string; email: string; email_confirmed_at?: string | null }>;
};

/** A complete, internally consistent dataset. Merge overrides to vary a case. */
export function baseTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    modules: modulesTable(),
    roles: rolesTable(),
    role_permissions: rolePermissionsTable(),
    departments: departmentsTable(),
    staff_users: staffUsersTable(),
    staff_role_assignments: staffRoleAssignmentsTable(),
    staff_permission_restrictions: restrictionsTable(),
    staff_invitations: [],
    audit_events: [],
    ...overrides,
  };
}

/** Token -> auth user, derived from the staff table (all email-confirmed). */
export function baseTokens(): Record<string, { id: string; email: string; email_confirmed_at: string }> {
  const out: Record<string, { id: string; email: string; email_confirmed_at: string }> = {};
  for (const [token, id] of Object.entries({
    [TOKEN.superAdmin]: UUID.superAdminStaff,
    [TOKEN.admin]: UUID.adminStaff,
    [TOKEN.viewer]: UUID.viewerStaff,
    [TOKEN.restricted]: UUID.restrictedStaff,
    [TOKEN.inactive]: UUID.inactiveStaff,
    [TOKEN.unassigned]: UUID.unassignedStaff,
  })) {
    const staff = staffUsersTable().find((s) => s.id === id)!;
    out[token] = {
      id,
      email: staff.email as string,
      email_confirmed_at: '2026-09-01T00:00:00.000Z',
    };
  }
  return out;
}
