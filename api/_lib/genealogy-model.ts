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
  /**
   * Memoised displayParent: the first ACTIVE node at or after a cursor depends only on that
   * cursor while the upward chain has no cycle, so long inactive chains are walked once instead of
   * once per member. Any cycle (or a chain that returns to the starting member) falls back to the
   * original cycle-guarded walk, so results are identical.
   */
  const CYCLE = Symbol('cycle');
  const nextOf = (id: string) =>
    (activeParent.has(id) ? activeParent.get(id) : storedUplines.get(id)?.[0]) ?? null;
  const firstActive = new Map<string, string | null | typeof CYCLE>();
  const resolveFrom = (start: string) => {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cursor: string | null = start;
    let result: string | null | typeof CYCLE;
    while (true) {
      // Any falsy cursor ends the walk, exactly like the original `while (cursor && ...)`.
      if (!cursor) {
        result = null;
        break;
      }
      const known = firstActive.get(cursor);
      if (known !== undefined) {
        result = known;
        break;
      }
      if (onPath.has(cursor)) {
        result = CYCLE;
        break;
      }
      if (statusByStaff.get(cursor) === 'active') {
        result = cursor;
        break;
      }
      onPath.add(cursor);
      path.push(cursor);
      cursor = nextOf(cursor);
    }
    for (const node of path) firstActive.set(node, result);
    return result;
  };
  const headOf = (id: string): string | null => {
    const next = nextOf(id);
    if (!next) return null;
    const head = resolveFrom(next);
    return head === CYCLE || head === id ? displayParent(id) : head;
  };
  const parent = new Map<string, string>();
  for (const s of staff ?? []) {
    const head = headOf((s as { id: string }).id);
    if (head) parent.set((s as { id: string }).id, head);
  }
  const children = new Map<string, string[]>();
  for (const [child, p] of parent) {
    const list = children.get(p);
    if (list) list.push(child);
    else children.set(p, [child]);
  }
  const descendants = (id: string) => {
    const out: string[] = [];
    const seen = new Set([id]);
    const q = [...(children.get(id) ?? [])];
    // Index pointer instead of shift(): same breadth-first order without O(n) dequeues.
    for (let head = 0; head < q.length && out.length < 10000; head++) {
      const x = q[head]!;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      for (const c of children.get(x) ?? []) q.push(c);
    }
    return out;
  };
  /**
   * descendants(id).length for every id in one bottom-up pass. Each id has at most one display
   * parent, so without cycles the reachable set is exactly the subtree (count capped at 10,000 as
   * in descendants()). Any cycle -> null, and callers fall back to descendants(id).length.
   */
  let subtreeSizes: Map<string, number> | null | undefined;
  const computeSubtreeSizes = () => {
    const size = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const [p, list] of children) pending.set(p, list.length);
    const ready: string[] = [];
    for (const child of parent.keys()) if (!pending.has(child)) ready.push(child);
    let done = 0;
    for (let head = 0; head < ready.length; head++) {
      const x = ready[head]!;
      done++;
      const p = parent.get(x);
      if (p === undefined) continue;
      size.set(p, (size.get(p) ?? 0) + 1 + (size.get(x) ?? 0));
      const left = pending.get(p)! - 1;
      pending.set(p, left);
      if (left === 0) ready.push(p);
    }
    const nodes = new Set([...parent.keys(), ...children.keys()]);
    return done === nodes.size ? size : null;
  };
  const descendantCount = (id: string) => {
    if (subtreeSizes === undefined) subtreeSizes = computeSubtreeSizes();
    return subtreeSizes ? Math.min(subtreeSizes.get(id) ?? 0, 10000) : descendants(id).length;
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
          totalDescendantCount: descendantCount(s.id),
        },
      ];
    },
  );

  return { nodes, visible, ancestors, descendants };
}
