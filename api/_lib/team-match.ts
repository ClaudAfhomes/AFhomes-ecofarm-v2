import type { Db } from './handler-kit.js';

/**
 * AA number -> staffId, read the same defensive way `genealogy.ts`'s
 * `resolve` endpoint does: the RPC exposes `staffId` for server-side use even
 * though the public search handler strips it before responding to a browser.
 */
async function resolveAaNumberToStaffId(db: Db, aaNumber: string): Promise<string | null> {
  const { data, error } = await db.rpc('search_sale_team_accreditation', { p_aa_number: aaNumber });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const staffId = row && typeof row === 'object' ? row.staffId : null;
  return typeof staffId === 'string' ? staffId : null;
}

/**
 * Walk `referral_relationships` to the top of a staff member's upline,
 * preferring the active edge at each level (same "nearest real link" rule
 * `genealogy-model.ts` uses) and falling back to any retired one so a
 * reassignment in progress still resolves to a root. Depth-capped and
 * cycle-guarded like every other genealogy walk in this codebase.
 */
async function teamRoot(db: Db, staffId: string): Promise<string | null> {
  const seen = new Set<string>([staffId]);
  let current = staffId;
  for (let depth = 0; depth < 8; depth += 1) {
    const { data, error } = await db
      .from('referral_relationships')
      .select('upline_staff_id,is_active')
      .eq('subject_staff_id', current);
    if (error) throw error;
    const rows = (data ?? []) as { upline_staff_id: string; is_active: boolean }[];
    if (!rows.length) return current;
    const next = rows.find((row) => row.is_active)?.upline_staff_id ?? rows[0]!.upline_staff_id;
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
  return current;
}

/**
 * Two staff ids share a sales team when their upline chains meet at the same
 * root (ultimately the SVD). Never trust a client's claim of a shared team -
 * this is the authoritative, server-only check.
 */
export async function sameSalesTeam(db: Db, staffIdA: string, staffIdB: string): Promise<boolean> {
  if (staffIdA === staffIdB) return true;
  const [rootA, rootB] = await Promise.all([teamRoot(db, staffIdA), teamRoot(db, staffIdB)]);
  return Boolean(rootA) && rootA === rootB;
}

export type TeamMatchResult =
  | { ok: true }
  | { ok: false; reason: 'RECOMMENDER_NOT_FOUND' | 'TEAM_MISMATCH' };

/**
 * The one check the New Customer Application's Network step exists to
 * enforce: a referrer and a VIP recommender may each be named, but only when
 * they belong to the SAME authorized sales team. Called with whatever the
 * client submitted; resolves the recommender itself server-side rather than
 * trusting `vipRecommenderName` or any client-computed match. A no-op (never
 * a failure) when either side is absent - there is nothing to cross-check.
 */
export async function verifyReferrerRecommenderTeam(
  db: Db,
  referrerStaffId: string | undefined,
  recommenderAaNumber: string | undefined,
): Promise<TeamMatchResult> {
  if (!referrerStaffId || !recommenderAaNumber) return { ok: true };
  const recommenderStaffId = await resolveAaNumberToStaffId(db, recommenderAaNumber);
  if (!recommenderStaffId) return { ok: false, reason: 'RECOMMENDER_NOT_FOUND' };
  const same = await sameSalesTeam(db, referrerStaffId, recommenderStaffId);
  return same ? { ok: true } : { ok: false, reason: 'TEAM_MISMATCH' };
}
