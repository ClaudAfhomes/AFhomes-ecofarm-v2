/**
 * Authorised genealogy visibility for sales-network members.
 *
 * Two distinct authorization layers:
 * 1. LIST VISIBILITY - which member IDs/names can appear in lists (includes upline names)
 * 2. DETAIL AUTHORIZATION - whose full profiles can be opened (excludes upline profiles)
 *
 * Rules per role:
 * - VD: list=self+descendants; detail=self+descendants
 * - SSM: list=self+descendants+VD upline; detail=self+descendants only
 * - SM: list=self+OST descendants+SSM/VD upline names; detail=self+OST descendants only
 * - OST: list=self+all upline names; detail=self only
 * - Super Admin: no restriction (null)
 */
import { z } from 'zod';
import { readSearchRows } from './list-search.js';
import type { Db } from './handler-kit.js';

const sellerRoles = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'] as const;
type SellerRole = (typeof sellerRoles)[number];

/** Role hierarchy order for determining upline relationships */
const ROLE_HIERARCHY: readonly SellerRole[] = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];

async function buildGenealogyMaps(db: Db) {
  const [
    staffRows,
    assignRows,
    roleRows,
    relRows,
    ostRows,
  ] = await Promise.all([
    readSearchRows(db.from('staff_users').select('id,full_name,status').order('id')),
    readSearchRows(
      db.from('staff_role_assignments').select('staff_id,role_id').order('staff_id').order('role_id'),
    ),
    readSearchRows(db.from('roles').select('id,slug').eq('is_active', true).order('id')),
    readSearchRows(
      db
        .from('referral_relationships')
        .select('subject_staff_id,upline_staff_id,is_active')
        .order('subject_staff_id')
        .order('upline_staff_id'),
    ),
    readSearchRows(db.from('ost_members').select('id,status').order('id')),
  ]);

  const staff = z
    .array(
      z.object({
        id: z.string(),
        full_name: z.string(),
        status: z.enum(['invited', 'active', 'inactive', 'suspended']),
      }),
    )
    .parse(staffRows);

  const assign = z.array(z.object({ staff_id: z.string(), role_id: z.string() })).parse(assignRows);
  const roles = z.array(z.object({ id: z.string(), slug: z.string() })).parse(roleRows);
  const rels = z
    .array(
      z.object({
        subject_staff_id: z.string(),
        upline_staff_id: z.string(),
        is_active: z.boolean(),
      }),
    )
    .parse(relRows);

  const roleById = new Map<string, string>(
    (roles ?? []).map((r: { id: string; slug: string }) => [r.id, r.slug]),
  );
  const roleByStaff = new Map<string, string | undefined>(
    (assign ?? []).map((a: { staff_id: string; role_id: string }) => [
      a.staff_id,
      roleById.get(a.role_id),
    ]),
  );

  const activeParent = new Map<string, string>();
  const storedUplines = new Map<string, string[]>();
  for (const r of rels ?? []) {
    const list = storedUplines.get(r.subject_staff_id) ?? [];
    list.push(r.upline_staff_id);
    storedUplines.set(r.subject_staff_id, list);
    if (r.is_active === true && !activeParent.has(r.subject_staff_id)) {
      activeParent.set(r.subject_staff_id, r.upline_staff_id);
    }
  }

  const statusByStaff = new Map<string, string>(
    (staff ?? []).map((s: { id: string; status: string }) => [s.id, s.status]),
  );

  const displayParent = (id: string): string | null => {
    const seen = new Set([id]);
    let cursor =
      (activeParent.has(id) ? activeParent.get(id) : storedUplines.get(id)?.[0]) ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (statusByStaff.get(cursor) === 'active') return cursor;
      cursor =
        (activeParent.has(cursor) ? activeParent.get(cursor) : storedUplines.get(cursor)?.[0]) ?? null;
    }
    return null;
  };

  const parent = new Map<string, string>();
  for (const s of staff ?? []) {
    const head = displayParent((s as { id: string }).id);
    if (head) parent.set((s as { id: string }).id, head);
  }

  const children = new Map<string, string[]>();
  for (const [child, p] of parent) {
    children.set(p, [...(children.get(p) ?? []), child]);
  }

  const ostById = new Map<string, string>(
    (ostRows ?? []).map((o) => [String(o.id), String(o.status)]),
  );

  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    const q = [...(children.get(id) ?? [])];
    while (q.length && out.length < 10000) {
      const x = q.shift()!;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      q.push(...(children.get(x) ?? []));
    }
    return out;
  };

  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    let x = parent.get(id);
    while (x && out.length < 4 && !seen.has(x)) {
      seen.add(x);
      out.push(x);
      x = parent.get(x);
    }
    return out;
  };

  const ostDescendants = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    const q = [...(children.get(id) ?? [])];
    while (q.length && out.length < 10000) {
      const x = q.shift()!;
      if (seen.has(x)) continue;
      seen.add(x);
      // Only include OST members in this traversal
      if (ostById.has(x)) out.push(x);
      q.push(...(children.get(x) ?? []));
    }
    return out;
  };

  return {
    parent,
    children,
    roleByStaff,
    ostById,
    descendants,
    ancestors,
    ostDescendants,
  };
}

/**
 * LIST VISIBILITY: Which member IDs can appear in list responses.
 * Includes upline names for reference (but detail access is separate).
 */
export async function getVisibleGenealogyIds(
  db: Db,
  userId: string,
  roleSlug: string,
): Promise<Set<string> | null> {
  // Admin / super-admin and any non-seller role see all staff members.
  if (!sellerRoles.includes(roleSlug as SellerRole)) return null;

  const { ancestors, descendants, ostDescendants } = await buildGenealogyMaps(db);

  const ownRole = roleSlug as SellerRole;
  let visible: string[];

  switch (ownRole) {
    case 'vice_director':
      // VD sees self + all descendants
      visible = [userId, ...descendants(userId)];
      break;
    case 'senior_sales_manager':
      // SSM sees self + descendants + VD upline (for name reference)
      visible = [userId, ...ancestors(userId), ...descendants(userId)];
      break;
    case 'sales_manager':
      // SM sees self + OST descendants + SSM/VD upline names (for reference)
      visible = [userId, ...ancestors(userId), ...ostDescendants(userId)];
      break;
    case 'ost':
      // OST sees self + all upline names (for reference only)
      visible = [userId, ...ancestors(userId)];
      break;
    default:
      visible = [userId];
  }

  return new Set<string>(visible);
}

/**
 * DETAIL AUTHORIZATION: Whether a caller can open a member's full profile.
 * Strictly enforces: no upline profile access for any seller role.
 */
export async function canAccessMemberDetail(
  db: Db,
  callerId: string,
  callerRoleSlug: string,
  targetId: string,
): Promise<boolean> {
  // Admin / super-admin and any non-seller role: unrestricted
  if (!sellerRoles.includes(callerRoleSlug as SellerRole)) return true;

  // Self-access always allowed
  if (callerId === targetId) return true;

  const { ancestors, descendants, ostDescendants, roleByStaff } = await buildGenealogyMaps(db);

  const callerRole = callerRoleSlug as SellerRole;
  const targetRole = roleByStaff.get(targetId);

  // Target must be a seller role member
  if (!targetRole || !sellerRoles.includes(targetRole as SellerRole)) return false;

  switch (callerRole) {
    case 'vice_director':
      // VD: full details of own descendants only
      return descendants(callerId).includes(targetId);

    case 'senior_sales_manager':
      // SSM: full details of own descendants only (NOT VD upline)
      return descendants(callerId).includes(targetId);

    case 'sales_manager':
      // SM: full details of own OST descendants only (NOT SSM/VD upline, NOT SM siblings)
      return ostDescendants(callerId).includes(targetId);

    case 'ost':
      // OST: no access to another person's profile (upline names only in lists)
      return false;

    default:
      return false;
  }
}
