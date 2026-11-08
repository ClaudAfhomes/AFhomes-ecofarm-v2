import { projectGenealogy, type Node } from '../_lib/genealogy-model.js';
import { z } from 'zod';
import { readSearchRows } from '../_lib/list-search.js';
/** PHASE 7 authorized VD -> SSM -> SM -> OST genealogy reads. */
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { canAccessMemberDetail } from '../_lib/genealogy-visibility.js';
import { storedAccreditationNumbers } from '../_lib/accreditation-numbers.js';
import { deny, fail, list, method, subPath, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { serviceClient } from '../_lib/rest.js';
import { aaNumberSchema } from '@afhomes/contracts';

/**
 * Raw `search_sale_team_accreditation` row, read defensively like
 * `sale-team.ts` does: the RPC returns `staffId` so the service role can use
 * it, which the public search handler strips before responding. This path is
 * staff-authorized (same `network.genealogy` gate as the rest of this file),
 * so keeping `staffId` here is deliberate, not an oversight.
 */
function readAccreditationRow(data: unknown): {
  staffId: string;
  fullName: string;
  aaNumber: string;
  kind: 'IST' | 'OST';
  status: string;
} | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || typeof row !== 'object') return null;
  const { staffId, fullName, aaNumber, kind, status } = row as Record<string, unknown>;
  if (
    typeof staffId !== 'string' ||
    typeof fullName !== 'string' ||
    typeof aaNumber !== 'string' ||
    (kind !== 'IST' && kind !== 'OST') ||
    typeof status !== 'string'
  )
    return null;
  return { staffId, fullName, aaNumber, kind, status };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Genealogy endpoint not found', 404);
  const auth = await authorizeAfHomes(req, 'network.genealogy');
  if ('error' in auth) return deny(res, auth);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  const path = subPath(req);
  if (path === 'ost-contacts') {
    const staffIdsParam = req.query.staffIds as string | undefined;
    if (!staffIdsParam) return fail(res, 'VALIDATION_ERROR', 'staffIds parameter required', 400);
    const staffIds = staffIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (!staffIds.length) return res.status(200).json({});
    // Fetch email from staff_users for all selected staff (SVD, SSM, SM, Referrer, VIP Recommender)
    const { data: staffRows, error: staffError } = await db
      .from('staff_users')
      .select('id,email')
      .in('id', staffIds);
    if (staffError) throw staffError;
    const emailByStaff = new Map<string, string>(
      (staffRows ?? []).map((r: { id: string; email: string }) => [r.id, r.email]),
    );
    // Fetch phone and email from ost_members for OST members (Referrer, VIP Recommender)
    const { data: ostRows, error: ostError } = await db
      .from('ost_members')
      .select('id,phone,email')
      .in('id', staffIds);
    if (ostError) throw ostError;
    const ostByStaff = new Map<string, { phone: string; email: string }>(
      (ostRows ?? []).map((r: { id: string; phone: string; email: string }) => [r.id, { phone: r.phone, email: r.email }]),
    );
    // Combine: for each staff ID, return phone (from ost_members or null) and email (from staff_users or ost_members)
    const contacts: Record<string, { phone: string | null; email: string }> = {};
    for (const id of staffIds) {
      const ost = ostByStaff.get(id);
      const email = emailByStaff.get(id) ?? ost?.email ?? '';
      contacts[id] = { phone: ost?.phone ?? null, email };
    }
    return res.status(200).json(contacts);
  }

  try {
    const [staffRows, assignRows, roleRows, relRows, ostRows] = await Promise.all([
      readSearchRows(db.from('staff_users').select('id,full_name,status').order('id')),
      readSearchRows(
        db
          .from('staff_role_assignments')
          .select('staff_id,role_id')
          .order('staff_id')
          .order('role_id'),
      ),
      readSearchRows(db.from('roles').select('id,slug').eq('is_active', true).order('id')),
      // Every edge, active or retired: the display head walks THROUGH a
      // departed (non-active) head to the next higher active one, so a
      // resignation reads as OST -> SM -> SVD without rewriting history.
      // A manually reassigned seller keeps its active edge, which always wins.
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
    const assign = z
      .array(z.object({ staff_id: z.string(), role_id: z.string() }))
      .parse(assignRows);
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
    const ost = z
      .array(z.object({ id: z.string(), status: z.enum(['active', 'inactive', 'suspended']) }))
      .parse(ostRows);
    const { nodes, visible, ancestors, descendants } = projectGenealogy({ staff, assign, roles, rels, ost }, auth);
    const path = subPath(req);
    if (path === '') return list(res, nodes);
    // AA-number resolution for the New Customer Application's recommender/
    // referrer inputs. The full upline chain is NOT computed here: the client
    // already holds the same `nodes` list via `GET /genealogy` and walks it
    // with the existing pure `resolveApplicationNetwork` - this endpoint only
    // ever answers "which staff member holds this AA number", scoped to what
    // this caller may already see (an out-of-scope or unknown number are
    // intentionally the same answer: `member: null`, never a 403).
    if (path === 'resolve' && method(req) === 'GET') {
      const parsedAaNumber = aaNumberSchema.safeParse(req.query.aaNumber);
      if (!parsedAaNumber.success)
        return fail(res, 'VALIDATION_ERROR', 'Provide a valid AA number', 400);
      const { data, error } = await db.rpc('search_sale_team_accreditation', {
        p_aa_number: parsedAaNumber.data,
      });
      if (error) throw error;
      const row = readAccreditationRow(data);
      const node = row ? nodes.find((n) => n.staffId === row.staffId) : undefined;
      if (!row || !node) return res.status(200).json({ member: null });
      return res.status(200).json({
        member: {
          staffId: row.staffId,
          fullName: row.fullName,
          role: node.role,
          aaNumber: row.aaNumber,
          kind: row.kind,
          status: row.status,
        },
      });
    }
    // Batch staffId -> AA number for read-only upline display (SM/SSM/SVD).
    // Same scope as `ost-contacts` above: it answers for whatever ids the
    // caller already holds from an authorized `/genealogy` read, it does not
    // re-check each id against `visible`.
    if (path === 'aa-numbers' && method(req) === 'GET') {
      const staffIdsParam = req.query.staffIds as string | undefined;
      if (!staffIdsParam) return fail(res, 'VALIDATION_ERROR', 'staffIds parameter required', 400);
      const staffIds = staffIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (!staffIds.length) return res.status(200).json({});
      const numbers = await storedAccreditationNumbers(db, staffIds);
      return res.status(200).json(Object.fromEntries(numbers));
    }
    const match = path.match(/^([0-9a-f-]+)(?:\/(upline|downline|summary))?$/);
    if (!match) return fail(res, 'NOT_FOUND', 'Genealogy endpoint not found', 404);
    const id = match[1]!;
    // DETAIL AUTHORIZATION: strict check - no upline genealogy access for sellers
    const canAccess = await canAccessMemberDetail(db, auth.userId, auth.roleSlug, id);
    if (!canAccess)
      return fail(res, 'FORBIDDEN', 'Genealogy record is outside your authorized scope', 403);
    const node = nodes.find((n) => n.staffId === id);
    if (!node) return fail(res, 'NOT_FOUND', 'Seller not found', 404);
    if (match[2] === 'upline')
      return list(
        res,
        ancestors(id)
          .map((x) => nodes.find((n) => n.staffId === x))
          .filter(Boolean),
      );
    if (match[2] === 'downline')
      return list(
        res,
        descendants(id)
          .filter((x) => visible.has(x))
          .map((x) => nodes.find((n) => n.staffId === x))
          .filter(Boolean),
      );
    if (match[2] === 'summary') {
      const ids = descendants(id).filter((x) => visible.has(x));
      const members = ids
        .map((x) => nodes.find((n) => n.staffId === x))
        .filter((n): n is Node => !!n);
      const roleCounts = { vice_director: 0, senior_sales_manager: 0, sales_manager: 0, ost: 0 };
      for (const n of members) roleCounts[n.role]++;
      return res.status(200).json({
        staffId: id,
        totalDirectDownline: node.directDownlineCount,
        totalDescendants: members.length,
        activeSellerCount: members.filter(
          (n) => n.status === 'active' && (n.ostStatus === null || n.ostStatus === 'active'),
        ).length,
        inactiveSellerCount: members.filter(
          (n) => n.status !== 'active' || (n.ostStatus !== null && n.ostStatus !== 'active'),
        ).length,
        roleCounts,
      });
    }
    return res.status(200).json(node);
  } catch (error) {
    console.error('[api] genealogy:', error instanceof Error ? error.message : error);
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}
