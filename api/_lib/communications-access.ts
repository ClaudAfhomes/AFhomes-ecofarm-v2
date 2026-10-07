/**
 * Communications recipient scope - who a caller is allowed to start or extend a
 * conversation with.
 *
 * This is a FILTER, not an authorization decision. The handler still requires
 * the `communications.*` permission (or 401/403s), and the SECURITY DEFINER
 * RPCs re-derive the actor, its standing, its role and its effective permission
 * server-side, because a handler is not the security boundary it appears to be.
 * Anything this module narrows is re-checked in SQL.
 *
 * Scope kinds (one per role slug; an unknown slug gets `none`, so a custom role
 * never inherits organization-wide reach from the grants it happens to hold):
 *   organization  super_admin, admin .... every active staff member
 *   department    finance, hr, employee .. the caller's own ACTIVE department
 *   hierarchy     vice_director,          the caller's upline AND downline
 *                 senior_sales_manager,
 *                 sales_manager
 *   upline        ost ..................... the caller's upline only
 *   none          anything else .......... no staff chat reach at all
 *
 * Every kind except `organization` additionally reaches active admin and
 * super_admin staff, so an escalated announcement has an obvious landing place,
 * and NO kind ever reaches the caller themselves (no self-chat).
 */
import type { AfHomesPrincipal } from './afhomes-access.js';
import type { Db } from './handler-kit.js';
import { readSearchRows } from './list-search.js';
import { teamStaffIds } from './report-scope.js';

type Row = Record<string, unknown>;

/** Bound on any genealogy walk, mirroring `teamStaffIds`. */
const WALK_LIMIT = 10_000;

export type RecipientScopeKind = 'organization' | 'department' | 'hierarchy' | 'upline' | 'none';

export function recipientScopeKind(principal: AfHomesPrincipal): RecipientScopeKind {
  switch (principal.roleSlug) {
    case 'super_admin':
    case 'admin':
      return 'organization';
    case 'finance':
    case 'hr':
    case 'employee':
      return 'department';
    case 'vice_director':
    case 'senior_sales_manager':
    case 'sales_manager':
      return 'hierarchy';
    case 'ost':
      return 'upline';
    default:
      return 'none';
  }
}

/**
 * Staff ids on the caller's upline, nearest first in insertion order, INCLUDING
 * the caller (same convention as `teamStaffIds`, so a caller id is never a
 * surprise in either direction).
 *
 * The reverse of the downline walk: active `referral_relationships` edges are
 * read once, indexed child -> parent, then drained breadth-first. The `out.has`
 * guard terminates a cyclic or self-referential edge instead of looping, and the
 * size bound caps a pathological graph. Both properties are load-bearing: a
 * malformed genealogy must not hang a request.
 */
export async function ancestorsStaffIds(db: Db, staffId: string): Promise<string[]> {
  const data = await readSearchRows(
    db
      .from('referral_relationships')
      .select('subject_staff_id,upline_staff_id')
      .eq('is_active', true)
      .order('subject_staff_id')
      .order('upline_staff_id'),
  );
  const parents = new Map<string, string[]>();
  for (const edge of ((data ?? []) as Row[]).filter((row) => row.upline_staff_id)) {
    const child = String(edge.subject_staff_id);
    parents.set(child, [...(parents.get(child) ?? []), String(edge.upline_staff_id)]);
  }
  const out = new Set<string>([staffId]);
  const queue = [staffId];
  while (queue.length && out.size < WALK_LIMIT) {
    const id = queue.shift()!;
    for (const parent of parents.get(id) ?? []) {
      if (out.has(parent)) continue;
      out.add(parent);
      queue.push(parent);
    }
  }
  return [...out];
}

/** Active staff holding an active admin/super_admin role. */
async function administratorStaffIds(db: Db): Promise<string[]> {
  const roleRows = await readSearchRows(
    db.from('roles').select('id,slug').in('slug', ['admin', 'super_admin']).eq('is_active', true),
  );
  const roleIds = (roleRows as Row[]).map((row) => String(row.id));
  if (!roleIds.length) return [];
  const assignments = await readSearchRows(
    db.from('staff_role_assignments').select('staff_id').in('role_id', roleIds),
  );
  return (assignments as Row[]).map((row) => String(row.staff_id));
}

/**
 * The caller's own department, but only when that department is ACTIVE. A null
 * department returns null: two nulls are NOT the same department, so a
 * department-less caller reaches nobody that way.
 */
async function activeDepartmentId(db: Db, staffId: string): Promise<string | null> {
  const { data } = await db
    .from('staff_users')
    .select('id,department_id')
    .eq('id', staffId)
    .maybeSingle();
  const departmentId = (data as { department_id?: unknown } | null)?.department_id;
  if (typeof departmentId !== 'string' || !departmentId) return null;
  const { data: department } = await db
    .from('departments')
    .select('id,is_active')
    .eq('id', departmentId)
    .maybeSingle();
  return department && (department as { is_active?: unknown }).is_active === true ? departmentId : null;
}

/**
 * Every staff id the caller may currently start a conversation with.
 *
 * Inactive staff are never eligible (they cannot authenticate, so a thread they
 * cannot read is a dead thread), and the caller is never eligible (no self-chat).
 */
export async function eligibleRecipientIds(db: Db, principal: AfHomesPrincipal): Promise<string[]> {
  const kind = recipientScopeKind(principal);
  if (kind === 'none') return [];

  const staff = await readSearchRows(
    db.from('staff_users').select('id,department_id,status').eq('status', 'active').order('id'),
  );
  const activeRows = staff as Row[];
  const out = new Set<string>();

  if (kind === 'organization') {
    for (const row of activeRows) out.add(String(row.id));
  } else {
    if (kind === 'department') {
      const departmentId = await activeDepartmentId(db, principal.userId);
      // `departmentId === null` intentionally matches nothing: the only
      // recipients left are the administrators added below.
      if (departmentId !== null)
        for (const row of activeRows)
          if (row.department_id === departmentId) out.add(String(row.id));
    } else {
      for (const id of await ancestorsStaffIds(db, principal.userId)) out.add(id);
      // Hierarchy is the downline as well as the upline; `upline` is not.
      if (kind === 'hierarchy') for (const id of await teamStaffIds(db, principal)) out.add(id);
    }
    const administrators = await administratorStaffIds(db);
    for (const id of administrators) out.add(id);
  }

  // Status and self-exclusion are applied LAST, to whatever the walks produced,
  // so no path can reintroduce an inactive account or the caller.
  const active = new Set(activeRows.map((row) => String(row.id)));
  out.delete(principal.userId);
  return [...out].filter((id) => active.has(id));
}

/**
 * May the caller manage a group's membership? A role gate only: the caller must
 * additionally hold `communications.messages` update, must be a member of the
 * group being managed, and every added member must already be inside
 * `eligibleRecipientIds`. Deliberately excludes finance, hr, ost and employee.
 */
export function canManageGroups(principal: AfHomesPrincipal): boolean {
  return ['super_admin', 'admin', 'vice_director', 'senior_sales_manager', 'sales_manager'].includes(
    principal.roleSlug,
  );
}

/**
 * May the caller publish an organization-wide announcement? Admin and
 * super_admin only. Narrower audience targeting is separate and does not widen
 * this.
 */
export function canPublishAnnouncements(principal: AfHomesPrincipal): boolean {
  return principal.roleSlug === 'super_admin' || principal.roleSlug === 'admin';
}