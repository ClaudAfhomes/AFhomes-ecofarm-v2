import type { authorizeAfHomes } from './afhomes-access.js';
type Principal = Exclude<Awaited<ReturnType<typeof authorizeAfHomes>>, { error: unknown }>;
const sellerRoles = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'] as const;
type SellerRole = (typeof sellerRoles)[number];
export type Node = {
  staffId: string;
  fullName: string;
  role: SellerRole;
  status: 'invited' | 'active' | 'inactive' | 'suspended';
  ostStatus: 'active' | 'inactive' | 'suspended' | null;
  uplineStaffId: string | null;
  directDownlineCount: number;
  totalDescendantCount: number;
};

export type GenealogyInput = {
  staff: { id: string; full_name: string; status: Node['status'] }[];
  assign: { staff_id: string; role_id: string }[];
  roles: { id: string; slug: string }[];
  rels: { subject_staff_id: string; upline_staff_id: string; is_active: boolean }[];
  ost: { id: string; status: NonNullable<Node['ostStatus']> }[];
};
export function projectGenealogy(
  { staff, assign, roles, rels, ost }: GenealogyInput,
  auth: Pick<Principal, 'userId' | 'roleSlug'>,
) {
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
  /**
   * Display head: the nearest ACTIVE ancestor. A departed head's retired
   * edge is walked through, never resurrected as an authority - the walk
   * only ever RETURNS an active head. Cycle-guarded.
   */
  const displayParent = (id: string): string | null => {
    const seen = new Set([id]);
    let cursor = (activeParent.has(id) ? activeParent.get(id) : storedUplines.get(id)?.[0]) ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (statusByStaff.get(cursor) === 'active') return cursor;
      cursor =
        (activeParent.has(cursor) ? activeParent.get(cursor) : storedUplines.get(cursor)?.[0]) ??
        null;
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
  const descendants = (id: string) => {
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
  const ancestors = (id: string) => {
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
  const ownRole = auth.roleSlug;
  const seller = sellerRoles.includes(ownRole as SellerRole);
  const visible = new Set<string>(
    seller
      ? ownRole === 'ost'
        ? [auth.userId, ...ancestors(auth.userId)]
        : [auth.userId, ...ancestors(auth.userId), ...descendants(auth.userId)]
      : (staff ?? []).map((s: { id: string }) => s.id),
  );
  const ostById = new Map(
    (ost ?? []).map((o: { id: string; status: Node['ostStatus'] }) => [o.id, o.status]),
  );
  const nodes: Node[] = (staff ?? []).flatMap(
    (s: { id: string; full_name: string; status: Node['status'] }) => {
      const role = roleByStaff.get(s.id);
      if (!visible.has(s.id) || !sellerRoles.includes(role as SellerRole)) return [];
      return [
        {
          staffId: s.id,
          fullName: s.full_name,
          role: role as SellerRole,
          status: s.status,
          ostStatus: ostById.get(s.id) ?? null,
          uplineStaffId: parent.get(s.id) ?? null,
          directDownlineCount: (children.get(s.id) ?? []).length,
          totalDescendantCount: descendants(s.id).length,
        },
      ];
    },
  );

  return { nodes, visible, ancestors, descendants };
}
