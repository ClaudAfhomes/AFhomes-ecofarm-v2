import type { Db, Document } from 'mongodb';
import { z } from 'zod';
import type { authorizeAfHomes } from './afhomes-access.js';
import { projectGenealogy, type GenealogyInput } from './genealogy-model.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { deny, fail, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { findRelationshipTraversalIndexes } from './performance-indexes.mongo.js';

const STAFF = z.array(
  z.object({
    _id: z.string(),
    full_name: z.string(),
    status: z.enum(['invited', 'active', 'inactive', 'suspended']),
  }),
);
const ASSIGNMENTS = z.array(z.object({ staff_id: z.string(), role_id: z.string() }));
const ROLES = z.array(z.object({ _id: z.string(), slug: z.string() }));
const RELATIONSHIPS = z.array(
  z.object({ subject_staff_id: z.string(), upline_staff_id: z.string(), is_active: z.boolean() }),
);
const OST = z.array(
  z.object({ _id: z.string(), status: z.enum(['active', 'inactive', 'suspended']) }),
);
const link = (map: Map<string, string[]>, from: string, to: string) => {
  const list = map.get(from);
  if (list) list.push(to);
  else map.set(from, [to]);
};
/** Largest scoped read (about 5 MB of ids per $in query); bigger scopes use the full read. */
const MAX_SCOPED_MEMBERS = 100_000;
/**
 * Indexed traversal limits. Display chains are a few levels deep (VD -> SSM -> SM -> OST plus
 * departed members); a deeper chain, or one needing more queries, uses the all-edges read instead.
 */
const MAX_TRAVERSAL_DEPTH = 32;
const MAX_TRAVERSAL_QUERIES = 64;
/** Members per traversal $in query (about 1 MB of ids). */
const TRAVERSAL_BATCH = 20_000;
/** How long one index check (confirmed or not) is reused before the indexes are listed again. */
const INDEX_RECHECK_MS = 60_000;
const SELLER_ROLES = new Set(['vice_director', 'senior_sales_manager', 'sales_manager', 'ost']);
const isString = (field: string) => ({ $eq: [{ $type: field }, 'string'] });
/** Row is accepted by the Zod schema above ($in on a scalar status: arrays never match). */
const VALIDITY: Record<string, Document> = {
  staff_users: {
    $and: [
      isString('$_id'),
      isString('$full_name'),
      { $in: ['$status', ['invited', 'active', 'inactive', 'suspended']] },
    ],
  },
  staff_role_assignments: { $and: [isString('$staff_id'), isString('$role_id')] },
  ost_members: {
    $and: [isString('$_id'), { $in: ['$status', ['active', 'inactive', 'suspended']] }],
  },
};
/** A referral_relationships row RELATIONSHIPS accepts (probed when not every edge is read). */
const EDGE_VALIDITY: Document = {
  $and: [
    isString('$subject_staff_id'),
    isString('$upline_staff_id'),
    { $eq: [{ $type: '$is_active' }, 'bool'] },
  ],
};

export function createMongoGenealogyHandler(db: Db, authorize: typeof authorizeAfHomes) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const readStaff = (filter: Document) =>
    col('staff_users')
      .find(filter, { projection: { full_name: 1, status: 1 } })
      .sort({ _id: 1 })
      .toArray();
  const readAssignments = (filter: Document) =>
    col('staff_role_assignments')
      .find(filter, { projection: { _id: 0, staff_id: 1, role_id: 1 } })
      .sort({ staff_id: 1, role_id: 1 })
      .toArray();
  const readOst = (filter: Document) =>
    col('ost_members').find(filter, { projection: { status: 1 } }).sort({ _id: 1 }).toArray();
  const readRoles = () =>
    col('roles').find({ is_active: true }, { projection: { slug: 1 } }).sort({ _id: 1 }).toArray();
  const readRelationships = () =>
    col('referral_relationships')
      .find({}, { projection: { _id: 0, subject_staff_id: 1, upline_staff_id: 1, is_active: 1 } })
      .sort({ subject_staff_id: 1, upline_staff_id: 1 })
      .toArray();
  /** Every staff, assignment, role, relationship and OST row (unused _id fields omitted). */
  async function readAll(already?: { rels?: MongoRow[]; roles: MongoRow[] }) {
    const [staff, assign, roles, rels, ost] = await Promise.all([
      readStaff({}),
      readAssignments({}),
      already?.roles ?? readRoles(),
      already?.rels ?? readRelationships(),
      readOst({}),
    ]);
    return { staff, assign, roles, rels, ost };
  }
  const readScopeMembers = (ids: string[]) =>
    Promise.all([
      readStaff({ _id: { $in: ids } }),
      readAssignments({ staff_id: { $in: ids } }),
      readOst({ _id: { $in: ids } }),
    ]);
  /** Usable traversal index names; listed again after a minute or after any failed traversal. */
  let indexCheck: {
    at: number;
    names: ReturnType<typeof findRelationshipTraversalIndexes>;
  } | null = null;
  const traversalIndexes = () => {
    if (!indexCheck || Date.now() - indexCheck.at >= INDEX_RECHECK_MS)
      indexCheck = {
        at: Date.now(),
        names: findRelationshipTraversalIndexes(db).catch(() => null),
      };
    return indexCheck.names;
  };
  /**
   * The scope readScoped computes, built from the edges of in-scope members only: up the caller's
   * walk chain one member at a time, then down one level at a time through any edge into the
   * newest members, keeping a candidate once its own walk edge points into the scope. Every query
   * names its index as a hint, so it fails (and the all-edges read answers) instead of scanning if
   * an index has gone. Returns null when a depth, query or size limit is reached.
   */
  async function traverse(userId: string, names: { subject: string; upline: string }) {
    const relationships = col('referral_relationships');
    const edgesOf = new Map<string, MongoRow[]>();
    let queries = 0;
    /** Every edge of these members, in the subject/upline order of the all-edges read. */
    const load = async (ids: string[]) => {
      const missing = ids.filter((id) => !edgesOf.has(id));
      for (const id of missing) edgesOf.set(id, []);
      for (let start = 0; start < missing.length; start += TRAVERSAL_BATCH) {
        if (++queries > MAX_TRAVERSAL_QUERIES) return false;
        const rows = await relationships
          .find(
            { subject_staff_id: { $in: missing.slice(start, start + TRAVERSAL_BATCH) } },
            {
              projection: { _id: 0, subject_staff_id: 1, upline_staff_id: 1, is_active: 1 },
              hint: names.subject,
            },
          )
          .sort({ subject_staff_id: 1, upline_staff_id: 1 })
          .toArray();
        for (const row of rows) edgesOf.get(row.subject_staff_id as string)?.push(row);
      }
      return true;
    };
    // The walk edge of a loaded member, by the same rule readScoped applies to every edge.
    const nextOf = (id: string) => {
      const edges = edgesOf.get(id) ?? [];
      const next = (edges.find((edge) => edge.is_active === true) ?? edges[0])?.upline_staff_id;
      return typeof next === 'string' && next ? next : null;
    };
    const scope = new Set([userId]);
    if (!(await load([userId]))) return null;
    let depth = 0;
    for (let cursor = nextOf(userId); cursor && !scope.has(cursor); cursor = nextOf(cursor)) {
      if (++depth > MAX_TRAVERSAL_DEPTH) return null;
      scope.add(cursor);
      if (!(await load([cursor]))) return null;
    }
    for (let frontier = [...scope], level = 0; frontier.length; level++) {
      if (level >= MAX_TRAVERSAL_DEPTH) return null;
      const candidates = new Set<string>();
      for (let start = 0; start < frontier.length; start += TRAVERSAL_BATCH) {
        if (++queries > MAX_TRAVERSAL_QUERIES) return null;
        for (const row of await relationships
          .find(
            { upline_staff_id: { $in: frontier.slice(start, start + TRAVERSAL_BATCH) } },
            { projection: { _id: 0, subject_staff_id: 1 }, hint: names.upline },
          )
          .toArray())
          if (typeof row.subject_staff_id === 'string' && !scope.has(row.subject_staff_id))
            candidates.add(row.subject_staff_id);
      }
      if (!(await load([...candidates]))) return null;
      // Judged against the scope before this level: a candidate whose walk edge points at a member
      // added on this level reaches that member through the same edge on the next level.
      frontier = [...candidates].filter((id) => {
        const next = nextOf(id);
        return next !== null && scope.has(next);
      });
      for (const id of frontier) scope.add(id);
      if (scope.size > MAX_SCOPED_MEMBERS) return null;
    }
    const ids = [...scope];
    return { ids, edges: ids.flatMap((id) => edgesOf.get(id) ?? []) };
  }
  /**
   * Seller callers: the same rows restricted to the members their projection can touch (see the
   * scope comment below). Rows outside the scope are not parsed, so their validity is checked in
   * MongoDB with the same rules as the Zod schemas; any invalid row falls back to the full read
   * (reusing what was already fetched), which then answers exactly as before, 400 included. While
   * both relationship indexes are confirmed usable, only in-scope edges are read (traverse).
   * Otherwise, or when a traversal limit is reached, every edge is read and the scope computed
   * here; a scope covering more than half the network then uses the full read.
   */
  async function readScoped(userId: string) {
    const names = await traversalIndexes();
    const rules = names ? { ...VALIDITY, referral_relationships: EDGE_VALIDITY } : VALIDITY;
    const [roles, invalid, traversed, everyEdge, confirmed] = await Promise.all([
      readRoles(),
      Promise.all(
        Object.entries(rules).map(([name, rule]) =>
          col(name)
            .aggregate([{ $match: { $expr: { $not: [rule] } } }, { $limit: 1 }])
            .hasNext(),
        ),
      ),
      names
        ? traverse(userId, names).catch(() => {
            indexCheck = null; // for example a hinted index was dropped: confirm again first
            return null;
          })
        : null,
      names ? undefined : readRelationships(),
      // Re-confirmed alongside every traversal: an index replaced (for example by a partial one
      // under the same name) since the cached check discards the traversal result.
      names ? findRelationshipTraversalIndexes(db).catch(() => null) : null,
    ]);
    if (invalid.some(Boolean)) return { scoped: null, already: { rels: everyEdge, roles } };
    const stillUsable =
      confirmed?.subject === names?.subject && confirmed?.upline === names?.upline;
    if (names && !stillUsable) indexCheck = null;
    if (traversed && stillUsable) {
      const [staff, assign, ost] = await readScopeMembers(traversed.ids);
      return { scoped: { staff, assign, roles, rels: traversed.edges, ost }, already: { roles } };
    }
    const rawRels = everyEdge ?? (await readRelationships());
    const already = { rels: rawRels, roles };
    const rels = RELATIONSHIPS.parse(rawRels);
    // The single edge a display-parent walk follows from each member, exactly as projectGenealogy
    // picks it: its first active edge, otherwise its first stored edge (rows are in the same
    // subject/upline order). Falsy uplines end a walk there too.
    const active = new Map<string, string>(),
      stored = new Map<string, string>();
    for (const edge of rels) {
      if (!stored.has(edge.subject_staff_id)) stored.set(edge.subject_staff_id, edge.upline_staff_id);
      if (edge.is_active === true && !active.has(edge.subject_staff_id))
        active.set(edge.subject_staff_id, edge.upline_staff_id);
    }
    const nextOf = (id: string) => (active.has(id) ? active.get(id) : stored.get(id)) || null;
    const below = new Map<string, string[]>();
    for (const id of stored.keys()) {
      const next = nextOf(id);
      if (next) link(below, next, id);
    }
    // Every display ancestor of the caller lies on its walk chain; every member whose walk chain
    // reaches that chain is in scope, and walks from those members never leave the scope. All
    // subtrees whose counts are shown, and every walk projectGenealogy performs for them, are
    // therefore complete.
    const scope = new Set([userId]);
    for (let cursor = nextOf(userId); cursor && !scope.has(cursor); cursor = nextOf(cursor))
      scope.add(cursor);
    const queue = [...scope];
    for (let head = 0; head < queue.length; head++)
      for (const id of below.get(queue[head]!) ?? [])
        if (!scope.has(id)) {
          scope.add(id);
          queue.push(id);
        }
    // Too large to help (or to send as one $in list under the 16 MB command limit): full read.
    if (scope.size * 2 > stored.size + 1 || scope.size > MAX_SCOPED_MEMBERS)
      return { scoped: null, already };
    const [staff, assign, ost] = await readScopeMembers([...scope]);
    return { scoped: { staff, assign, roles, rels: rawRels, ost }, already };
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Genealogy endpoint not found', 404);
    const auth = await authorize(req, 'network.genealogy');
    if ('error' in auth) return deny(res, auth);
    try {
      const path = subPath(req);
      const contactIds =
        path === 'ost-contacts'
          ? z
              .string()
              .max(40000)
              .parse(req.query.staffIds)
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : null;
      // Seller views depend only on the caller's own branch; other roles see every seller. The
      // scoped read returns null whenever it cannot prove the same result (see readScoped).
      const attempt = SELLER_ROLES.has(auth.roleSlug) ? await readScoped(auth.userId) : null;
      const raw = attempt?.scoped ?? (await readAll(attempt?.already));
      const input: GenealogyInput = {
        staff: STAFF.parse(raw.staff).map((row) => ({ ...row, id: row._id })),
        assign: ASSIGNMENTS.parse(raw.assign),
        roles: ROLES.parse(raw.roles).map((row) => ({ ...row, id: row._id })),
        rels: RELATIONSHIPS.parse(raw.rels),
        ost: OST.parse(raw.ost).map((row) => ({ ...row, id: row._id })),
      };
      const graph = projectGenealogy(input, auth);
      if (contactIds) {
        // Contacts only for sellers in the caller's own server-computed genealogy view (the same
        // nodes GET /genealogy returns: self, uplines and downline for VD/SSM/SM; self and uplines
        // for OST; every seller for non-seller roles). Requested ids prove nothing: any other id -
        // unauthorized or unknown - gets the identical empty entry, so existence is not revealed.
        const permitted = new Set(graph.nodes.map((node) => node.staffId));
        const allowed = [...new Set(contactIds.filter((id) => permitted.has(id)))];
        const [staffContacts, ostContacts] = allowed.length
          ? await Promise.all([
              col('staff_users')
                .find({ _id: { $in: allowed } }, { projection: { email: 1 } })
                .toArray(),
              col('ost_members')
                .find({ _id: { $in: allowed } }, { projection: { phone: 1, email: 1 } })
                .toArray(),
            ])
          : [[], []];
        return res.status(200).json(
          Object.fromEntries(
            contactIds.map((id) => [
              id,
              permitted.has(id)
                ? {
                    phone: ostContacts.find((row) => row._id === id)?.phone ?? null,
                    email:
                      staffContacts.find((row) => row._id === id)?.email ??
                      ostContacts.find((row) => row._id === id)?.email ??
                      '',
                  }
                : { phone: null, email: '' },
            ]),
          ),
        );
      }
      if (!path) return list(res, graph.nodes);
      const match = /^([a-f0-9-]{36})(?:\/(upline|downline|summary))?$/.exec(path);
      if (!match) return fail(res, 'NOT_FOUND', 'Genealogy endpoint not found', 404);
      const id = match[1]!,
        sellers = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
      // Node ids are unique staff ids, so a map lookup returns what nodes.filter() returned.
      const nodeById = new Map(graph.nodes.map((row) => [row.staffId, row]));
      const nodesFor = (key: string) => {
        const node = nodeById.get(key);
        return node ? [node] : [];
      };
      const target = nodeById.get(id);
      const permitted =
        !sellers.includes(auth.roleSlug) ||
        id === auth.userId ||
        (['vice_director', 'senior_sales_manager', 'sales_manager'].includes(auth.roleSlug) &&
          graph.descendants(auth.userId).includes(id) &&
          !!target &&
          (auth.roleSlug !== 'sales_manager' || input.ost.some((row) => row.id === id)));
      if (!permitted)
        return fail(res, 'FORBIDDEN', 'Genealogy record is outside your authorized scope', 403);
      if (!target) return fail(res, 'NOT_FOUND', 'Seller not found', 404);
      if (match[2] === 'upline') return list(res, graph.ancestors(id).flatMap(nodesFor));
      if (!match[2]) return res.status(200).json(target);
      const members = graph
        .descendants(id)
        .filter((key) => graph.visible.has(key))
        .flatMap(nodesFor);
      if (match[2] === 'downline') return list(res, members);
      if (match[2] === 'summary') {
        const counts = { vice_director: 0, senior_sales_manager: 0, sales_manager: 0, ost: 0 };
        for (const row of members) counts[row.role]++;
        const active = members.filter(
          (row) =>
            row.status === 'active' && (row.ostStatus === null || row.ostStatus === 'active'),
        ).length;
        return res
          .status(200)
          .json({
            staffId: id,
            totalDirectDownline: target.directDownlineCount,
            totalDescendants: members.length,
            activeSellerCount: active,
            inactiveSellerCount: members.length - active,
            roleCounts: counts,
          });
      }
      return res.status(200).json(target);
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid genealogy query or record', 400);
      return fail(res, 'INTERNAL', 'Genealogy service is unavailable', 503);
    }
  };
}
