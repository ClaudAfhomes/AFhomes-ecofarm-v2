/**
 * Communications recipient scope - the matrix proof.
 *
 * These are the only proofs of WHO may be messaged by whom, and every one of
 * them is a boundary that must fail closed: a caller with no department must
 * not match another caller with no department, an inactive account must not be
 * addressable, and an unknown custom role must get no implicit organization-wide
 * reach even when it holds communications grants (the grants are the CALLER's
 * permission to use the surface; the scope is who they may reach).
 *
 * The world is built by hand on the in-memory fake (no phase2 fixture rows are
 * reused) so every id in an assertion is a role in this file's matrix rather
 * than an inherited fixture id nobody can read.
 */
import { describe, expect, it } from 'vitest';

import type { AfHomesPrincipal } from './afhomes-access.js';
import {
  ancestorsStaffIds,
  canManageGroups,
  canPublishAnnouncements,
  eligibleRecipientIds,
  recipientScopeKind,
} from './communications-access.js';
import { FakeSupabase } from './testing/supabase-fake.js';

const DEPT = {
  sales: 'd0000000-0000-4000-8000-000000000001',
  operations: 'd0000000-0000-4000-8000-000000000002',
  archived: 'd0000000-0000-4000-8000-000000000003',
} as const;

const S = {
  superAdmin: 'a0000000-0000-4000-8000-000000000001',
  admin: 'a0000000-0000-4000-8000-000000000002',
  finance: 'a0000000-0000-4000-8000-000000000003',
  financePeer: 'a0000000-0000-4000-8000-000000000004',
  hr: 'a0000000-0000-4000-8000-000000000005',
  employee: 'a0000000-0000-4000-8000-000000000006',
  employeeOther: 'a0000000-0000-4000-8000-000000000007',
  noDept: 'a0000000-0000-4000-8000-000000000008',
  noDeptOther: 'a0000000-0000-4000-8000-000000000009',
  vd: 'a0000000-0000-4000-8000-00000000000a',
  ssm: 'a0000000-0000-4000-8000-00000000000b',
  sm: 'a0000000-0000-4000-8000-00000000000c',
  ost: 'a0000000-0000-4000-8000-00000000000d',
  ostChild: 'a0000000-0000-4000-8000-00000000000e',
  inactivePeer: 'a0000000-0000-4000-8000-00000000000f',
  archivedDept: 'a0000000-0000-4000-8000-000000000010',
  custom: 'a0000000-0000-4000-8000-000000000011',
} as const;

const ROLE = {
  super_admin: 'b0000000-0000-4000-8000-000000000001',
  admin: 'b0000000-0000-4000-8000-000000000002',
  finance: 'b0000000-0000-4000-8000-000000000003',
  hr: 'b0000000-0000-4000-8000-000000000004',
  vice_director: 'b0000000-0000-4000-8000-000000000005',
  senior_sales_manager: 'b0000000-0000-4000-8000-000000000006',
  sales_manager: 'b0000000-0000-4000-8000-000000000007',
  ost: 'b0000000-0000-4000-8000-000000000008',
  employee: 'b0000000-0000-4000-8000-000000000009',
  custom: 'b0000000-0000-4000-8000-00000000000a',
} as const;

const ROLE_BY_STAFF: Record<string, string> = {
  [S.superAdmin]: ROLE.super_admin,
  [S.admin]: ROLE.admin,
  [S.finance]: ROLE.finance,
  [S.financePeer]: ROLE.finance,
  [S.hr]: ROLE.hr,
  [S.employee]: ROLE.employee,
  [S.employeeOther]: ROLE.employee,
  [S.noDept]: ROLE.employee,
  [S.noDeptOther]: ROLE.employee,
  [S.vd]: ROLE.vice_director,
  [S.ssm]: ROLE.senior_sales_manager,
  [S.sm]: ROLE.sales_manager,
  [S.ost]: ROLE.ost,
  [S.ostChild]: ROLE.ost,
  [S.inactivePeer]: ROLE.sales_manager,
  [S.archivedDept]: ROLE.employee,
  [S.custom]: ROLE.custom,
};

const DEPT_BY_STAFF: Record<string, string | null> = {
  [S.superAdmin]: null,
  [S.admin]: null,
  [S.finance]: DEPT.sales,
  [S.financePeer]: DEPT.sales,
  [S.hr]: DEPT.sales,
  [S.employee]: DEPT.sales,
  [S.employeeOther]: DEPT.operations,
  [S.noDept]: null,
  [S.noDeptOther]: null,
  [S.vd]: DEPT.sales,
  [S.ssm]: DEPT.sales,
  [S.sm]: DEPT.sales,
  [S.ost]: DEPT.sales,
  [S.ostChild]: DEPT.sales,
  [S.inactivePeer]: DEPT.sales,
  [S.archivedDept]: DEPT.archived,
  [S.custom]: DEPT.sales,
};

let seq = 0;
const edge = (subject: string, upline: string, isActive = true) => ({
  id: `e0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  subject_staff_id: subject,
  upline_staff_id: upline,
  hierarchy_role: 'sales_manager',
  is_authoritative: true,
  is_active: isActive,
});

function staffRow(id: string, status = 'active') {
  return {
    id,
    email: `${id.slice(0, 8)}@afhomes.test`,
    full_name: `Staff ${id.slice(-2)}`,
    department_id: DEPT_BY_STAFF[id] ?? null,
    status,
  };
}

function makeDb(edges = defaultEdges()) {
  return new FakeSupabase({
    tables: {
      departments: [
        { id: DEPT.sales, code: 'SALES', name: 'Sales', is_active: true },
        { id: DEPT.operations, code: 'OPERATIONS', name: 'Operations', is_active: true },
        { id: DEPT.archived, code: 'LEGACY', name: 'Legacy', is_active: false },
      ],
      roles: [
        { id: ROLE.super_admin, slug: 'super_admin', name: 'Super Admin', is_active: true },
        { id: ROLE.admin, slug: 'admin', name: 'Admin', is_active: true },
        { id: ROLE.finance, slug: 'finance', name: 'Finance', is_active: true },
        { id: ROLE.hr, slug: 'hr', name: 'HR', is_active: true },
        {
          id: ROLE.vice_director,
          slug: 'vice_director',
          name: 'Vice Director',
          is_active: true,
        },
        {
          id: ROLE.senior_sales_manager,
          slug: 'senior_sales_manager',
          name: 'Senior Sales Manager',
          is_active: true,
        },
        { id: ROLE.sales_manager, slug: 'sales_manager', name: 'Sales Manager', is_active: true },
        { id: ROLE.ost, slug: 'ost', name: 'OST', is_active: true },
        { id: ROLE.employee, slug: 'employee', name: 'Employee', is_active: true },
        { id: ROLE.custom, slug: 'area_chief', name: 'Area Chief', is_active: true },
      ],
      staff_users: Object.keys(ROLE_BY_STAFF).map((id) =>
        staffRow(id, id === S.inactivePeer ? 'inactive' : 'active'),
      ),
      staff_role_assignments: Object.entries(ROLE_BY_STAFF).map(([staff_id, role_id]) => ({
        staff_id,
        role_id,
      })),
      referral_relationships: edges,
    },
  });
}

/** super_admin -> admin -> vd -> ssm -> sm -> ost -> ostChild, one sales chain. */
function defaultEdges() {
  return [
    edge(S.admin, S.superAdmin),
    edge(S.vd, S.admin),
    edge(S.ssm, S.vd),
    edge(S.sm, S.ssm),
    edge(S.ost, S.sm),
    edge(S.ostChild, S.ost),
  ];
}

/** A principal as the session resolver builds it; identity is what matters here. */
function principal(staffId: string, roleSlug: string): AfHomesPrincipal {
  return {
    userId: staffId,
    email: `${staffId.slice(0, 8)}@afhomes.test`,
    fullName: 'Staff',
    status: 'active',
    roleId: ROLE_BY_STAFF[staffId] ?? 'unknown',
    roleSlug,
    roleName: roleSlug,
    mustChangePassword: false,
    permissions: [],
  };
}

const recipientsFor = (db: FakeSupabase, staffId: string, roleSlug: string) =>
  eligibleRecipientIds(db as never, principal(staffId, roleSlug));

describe('recipient scope kind', () => {
  it('resolves super_admin and admin to organization scope', () => {
    expect(recipientScopeKind(principal(S.superAdmin, 'super_admin'))).toBe('organization');
    expect(recipientScopeKind(principal(S.admin, 'admin'))).toBe('organization');
  });

  it('resolves finance, hr and employee to department scope', () => {
    expect(recipientScopeKind(principal(S.finance, 'finance'))).toBe('department');
    expect(recipientScopeKind(principal(S.hr, 'hr'))).toBe('department');
    expect(recipientScopeKind(principal(S.employee, 'employee'))).toBe('department');
  });

  it('resolves vice_director, senior_sales_manager and sales_manager to hierarchy scope', () => {
    expect(recipientScopeKind(principal(S.vd, 'vice_director'))).toBe('hierarchy');
    expect(recipientScopeKind(principal(S.ssm, 'senior_sales_manager'))).toBe('hierarchy');
    expect(recipientScopeKind(principal(S.sm, 'sales_manager'))).toBe('hierarchy');
  });

  it('resolves ost to upline scope', () => {
    expect(recipientScopeKind(principal(S.ost, 'ost'))).toBe('upline');
  });

  it('resolves an unknown custom role slug to none', () => {
    // A custom role holding communications grants still gets NO implicit
    // organization-wide reach: the grants say it may use the surface, not who
    // it may message.
    expect(recipientScopeKind(principal(S.custom, 'area_chief'))).toBe('none');
    expect(recipientScopeKind(principal(S.custom, ''))).toBe('none');
  });

  it('resolves a customer principal to none', () => {
    // Customers carry no staff role slug at all; they reach communications
    // through the customer portal, never the staff surface.
    expect(recipientScopeKind(principal(S.noDept, 'customer'))).toBe('none');
  });
});

describe('eligible recipients', () => {
  it('excludes the caller from their own eligible recipients', async () => {
    const db = makeDb();
    for (const [staffId, roleSlug] of [
      [S.superAdmin, 'super_admin'],
      [S.admin, 'admin'],
      [S.finance, 'finance'],
      [S.ost, 'ost'],
      [S.vd, 'vice_director'],
    ] as const) {
      const ids = await recipientsFor(db, staffId, roleSlug);
      expect(ids, staffId).not.toContain(staffId);
    }
  });

  it('treats two null departments as NOT equal', async () => {
    // THE boundary case: `department_id IS NULL` is not a shared department.
    // Matching the two by SQL null semantics would hand an unrelated
    // department-less account the whole unassigned population.
    const db = makeDb();
    const ids = await recipientsFor(db, S.noDept, 'employee');
    expect(ids).not.toContain(S.noDeptOther);
    expect(ids).not.toContain(S.inactivePeer);
    // Only the organization-level backstop survives a null department.
    expect(new Set(ids)).toEqual(new Set([S.superAdmin, S.admin]));
  });

  it('treats admin and super_admin as eligible for EVERY scope kind', async () => {
    const db = makeDb();
    const cases = [
      [S.finance, 'finance'],
      [S.ost, 'ost'],
      [S.vd, 'vice_director'],
      [S.employee, 'employee'],
    ] as const;
    for (const [staffId, roleSlug] of cases) {
      const ids = await recipientsFor(db, staffId, roleSlug);
      expect(ids, staffId).toContain(S.admin);
      expect(ids, staffId).toContain(S.superAdmin);
    }
    const org = await recipientsFor(db, S.superAdmin, 'super_admin');
    expect(org).toContain(S.admin);
  });

  it('excludes an inactive staff member from every scope', async () => {
    const db = makeDb();
    for (const [staffId, roleSlug] of [
      [S.superAdmin, 'super_admin'],
      [S.finance, 'finance'],
      [S.vd, 'vice_director'],
      [S.ost, 'ost'],
    ] as const) {
      const ids = await recipientsFor(db, staffId, roleSlug);
      expect(ids, `${staffId}/${roleSlug}`).not.toContain(S.inactivePeer);
    }
  });

  it('gives organization scope every other active staff member', async () => {
    const db = makeDb();
    const ids = await recipientsFor(db, S.admin, 'admin');
    expect(new Set(ids)).toEqual(
      new Set([
        S.superAdmin,
        S.finance,
        S.financePeer,
        S.hr,
        S.employee,
        S.employeeOther,
        S.noDept,
        S.noDeptOther,
        S.vd,
        S.ssm,
        S.sm,
        S.ost,
        S.ostChild,
        S.archivedDept,
        S.custom,
      ]),
    );
  });

  it('restricts department scope to the caller department and excludes other departments', async () => {
    const db = makeDb();
    const ids = await recipientsFor(db, S.finance, 'finance');
    // Same department, minus self.
    expect(ids).toContain(S.financePeer);
    expect(ids).toContain(S.employee);
    // A different department is not reachable.
    expect(ids).not.toContain(S.employeeOther);
    expect(ids).not.toContain(S.archivedDept);
  });

  it('drops an archived department from the reachable population', async () => {
    const db = makeDb();
    // The archived-department employee is not a valid group peer: the caller's
    // own department must be ACTIVE for department scope to reach anybody.
    const ids = await recipientsFor(db, S.archivedDept, 'employee');
    expect(ids).not.toContain(S.employee);
    expect(ids).not.toContain(S.finance);
    expect(new Set(ids)).toEqual(new Set([S.superAdmin, S.admin]));
  });

  it('returns ancestors only for the upline scope (no descendants)', async () => {
    const db = makeDb();
    const ids = await recipientsFor(db, S.ost, 'ost');
    // Upline: sm, ssm, vd, admin, super_admin.
    expect(new Set(ids)).toEqual(
      new Set([S.superAdmin, S.admin, S.vd, S.ssm, S.sm]),
    );
    // Downline and lateral peers are out of reach for an OST.
    expect(ids).not.toContain(S.ostChild);
    expect(ids).not.toContain(S.employee);
    expect(ids).not.toContain(S.custom);
  });

  it('returns ancestors AND descendants for the hierarchy scope', async () => {
    const db = makeDb();
    const ids = await recipientsFor(db, S.ssm, 'senior_sales_manager');
    // Up: vd, admin, super_admin.
    expect(ids).toContain(S.vd);
    expect(ids).toContain(S.admin);
    expect(ids).toContain(S.superAdmin);
    // Down: sm, ost, ostChild.
    expect(ids).toContain(S.sm);
    expect(ids).toContain(S.ost);
    expect(ids).toContain(S.ostChild);
    // A lateral branch is neither.
    expect(ids).not.toContain(S.employeeOther);
  });

  it('ignores an inactive referral edge', async () => {
    // The ost edge is retired, so an SM's upline stops at the ssm.
    const db = makeDb(defaultEdges().map((e) => (e.subject_staff_id === S.ost ? { ...e, is_active: false } : e)));
    const ids = await recipientsFor(db, S.sm, 'sales_manager');
    expect(ids).toContain(S.ssm);
    expect(ids).not.toContain(S.ost);
  });

  it('returns nothing for a principal with no scope', async () => {
    const db = makeDb();
    expect(await recipientsFor(db, S.custom, 'area_chief')).toEqual([]);
    expect(await recipientsFor(db, S.noDept, 'customer')).toEqual([]);
  });
});

describe('ancestorsStaffIds', () => {
  it('walks the upline only, from self up to the root', async () => {
    const db = makeDb();
    // Includes the caller itself, mirroring `teamStaffIds`. A DOWNLINE member is
    // never in an ancestor set: this is the proof the walk does not reverse.
    expect(new Set(await ancestorsStaffIds(db as never, S.ostChild))).toEqual(
      new Set([S.ostChild, S.ost, S.sm, S.ssm, S.vd, S.admin, S.superAdmin]),
    );
    expect(await ancestorsStaffIds(db as never, S.ostChild)).not.toContain(S.finance);
  });

  it('returns only self for a root with no upline', async () => {
    const db = makeDb();
    expect(await ancestorsStaffIds(db as never, S.superAdmin)).toEqual([S.superAdmin]);
  });

  it('terminates on a cyclic referral edge', async () => {
    seq = 0;
    const db = makeDb([
      edge(S.ost, S.sm),
      edge(S.sm, S.ost), // the cycle
      edge(S.ost, S.admin),
    ]);
    // Mirrors the downline guard: a malformed edge must not hang the request.
    expect(new Set(await ancestorsStaffIds(db as never, S.ost))).toEqual(
      new Set([S.ost, S.sm, S.admin]),
    );
  });
});

describe('communications capability gates', () => {
  it('confers group management only on the management roles', () => {
    for (const slug of [
      'super_admin',
      'admin',
      'vice_director',
      'senior_sales_manager',
      'sales_manager',
    ]) {
      expect(canManageGroups(principal(S.vd, slug)), slug).toBe(true);
    }
  });

  it('does not confer group management on finance, hr, employee or ost', () => {
    for (const slug of ['finance', 'hr', 'employee', 'ost', 'area_chief', '']) {
      expect(canManageGroups(principal(S.employee, slug)), slug).toBe(false);
    }
  });

  it('confers announcement publishing on admin and super_admin only', () => {
    expect(canPublishAnnouncements(principal(S.superAdmin, 'super_admin'))).toBe(true);
    expect(canPublishAnnouncements(principal(S.admin, 'admin'))).toBe(true);
  });

  it('does not confer announcement publishing on anyone else', () => {
    for (const slug of [
      'finance',
      'hr',
      'vice_director',
      'senior_sales_manager',
      'sales_manager',
      'ost',
      'employee',
      'area_chief',
      '',
    ]) {
      expect(canPublishAnnouncements(principal(S.admin, slug)), slug).toBe(false);
    }
  });
});