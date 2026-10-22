/** Phase 14 role-scoped, database-backed analytics. */
import {
  analyticsPeriodSchema,
  salesTrendReportSchema,
  teamSalesAnalyticsSchema,
  teamSalesOverviewSchema,
  teamSalesTeamSchema,
  type AnalyticsPeriod,
} from '@afhomes/contracts';

import { authorizeAfHomes, type AfHomesPrincipal } from '../_lib/afhomes-access.js';
import { deny, fail, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { serviceClient } from '../_lib/rest.js';

type Row = Record<string, unknown>;
type ScopeKind = 'global' | 'finance' | 'organization' | 'team' | 'self' | 'redemption';
const SELLER_ROLES = new Set(['vice_director', 'senior_sales_manager', 'sales_manager', 'ost']);
const COMMISSION_STATUSES = [
  'pending',
  'payment_verified',
  'final_qualification_pending',
  'earned',
  'paid',
  'cancelled',
] as const;

export function calendarWindow(period: AnalyticsPeriod, now = new Date()) {
  const from = new Date(now);
  if (period === 'day') from.setUTCHours(0, 0, 0, 0);
  if (period === 'week') {
    const mondayOffset = (from.getUTCDay() + 6) % 7;
    from.setUTCDate(from.getUTCDate() - mondayOffset);
    from.setUTCHours(0, 0, 0, 0);
  }
  if (period === 'month') {
    from.setUTCDate(1);
    from.setUTCHours(0, 0, 0, 0);
  }
  if (period === 'year') {
    from.setUTCMonth(0, 1);
    from.setUTCHours(0, 0, 0, 0);
  }
  const to = new Date(from);
  if (period === 'day') to.setUTCDate(from.getUTCDate() + 1);
  if (period === 'week') to.setUTCDate(from.getUTCDate() + 7);
  if (period === 'month') to.setUTCMonth(from.getUTCMonth() + 1, 1);
  if (period === 'year') to.setUTCFullYear(from.getUTCFullYear() + 1, 0, 1);
  to.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

function inWindow(value: unknown, from: Date, to: Date) {
  const time = new Date(String(value ?? '')).valueOf();
  return Number.isFinite(time) && time >= from.valueOf() && time < to.valueOf();
}

function decimalCents(values: unknown[]) {
  let total = 0n;
  for (const value of values) {
    const match = String(value ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (match) total += BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

function roleScope(principal: AfHomesPrincipal): ScopeKind {
  if (principal.roleSlug === 'super_admin' || principal.roleSlug === 'admin') return 'global';
  if (principal.roleSlug === 'finance') return 'finance';
  if (['vice_director', 'senior_sales_manager', 'sales_manager'].includes(principal.roleSlug))
    return 'team';
  if (principal.roleSlug === 'ost') return 'self';
  if (
    principal.permissions.some(
      (permission) =>
        permission.canView &&
        ['organization.staff', 'organization.departments'].includes(permission.moduleKey),
    )
  )
    return 'organization';
  return 'redemption';
}

async function rows(db: Db, table: string, columns: string): Promise<Row[]> {
  let query = db.from(table).select(columns);
  if (table === 'card_sales') query = query.eq('origin', 'normal');
  const result = await query;
  if (result.error) throw result.error;
  return (result.data ?? []) as Row[];
}

async function scopedSales(db: Db, principal: AfHomesPrincipal, kind: ScopeKind) {
  if (kind === 'global' || kind === 'finance') {
    return {
      sales: await rows(
        db,
        'card_sales',
        'id,customer_id,plan_id,seller_staff_id,seller_ost_id,cash_price_snapshot,payment_scheme,status,created_at,submitted_at,activated_at,fully_paid_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id',
      ),
      attributed: 0,
      legacy: [] as Row[],
    };
  }
  if (kind === 'self') {
    const result = await db
      .from('card_sales')
      .select(
        'id,customer_id,plan_id,seller_staff_id,seller_ost_id,cash_price_snapshot,payment_scheme,status,created_at,submitted_at,activated_at,fully_paid_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id',
      )
      .eq('origin', 'normal')
      .or(`seller_staff_id.eq.${principal.userId},seller_ost_id.eq.${principal.userId}`);
    if (result.error) throw result.error;
    return {
      sales: (result.data ?? []) as Row[],
      attributed: (result.data ?? []).length,
      legacy: [] as Row[],
    };
  }
  if (kind !== 'team') return { sales: [] as Row[], attributed: 0, legacy: [] as Row[] };

  const snapshotResult = await db
    .from('card_sale_hierarchy_snapshots')
    .select('sale_id')
    .eq('ancestor_staff_id', principal.userId);
  if (snapshotResult.error) throw snapshotResult.error;
  const saleIds = [
    ...new Set(((snapshotResult.data ?? []) as Row[]).map((row) => String(row.sale_id))),
  ];
  let sales: Row[] = [];
  if (saleIds.length) {
    const result = await db
      .from('card_sales')
      .select(
        'id,customer_id,plan_id,seller_staff_id,seller_ost_id,cash_price_snapshot,payment_scheme,status,created_at,submitted_at,activated_at,fully_paid_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id',
      )
      .eq('origin', 'normal')
      .in('id', saleIds);
    if (result.error) throw result.error;
    sales = (result.data ?? []) as Row[];
  }

  // A sale's frozen immediate relationship can prove relevance to its direct
  // manager, but an incomplete legacy chain is never promoted into team totals.
  const relationships = await rows(db, 'referral_relationships', 'id,upline_staff_id');
  const directRelationshipIds = new Set(
    relationships
      .filter((row) => row.upline_staff_id === principal.userId)
      .map((row) => String(row.id)),
  );
  const allLegacy = await rows(db, 'card_sales', 'id,cash_price_snapshot,referral_relationship_id');
  const snapshotted = new Set(saleIds);
  const legacy = allLegacy.filter(
    (sale) =>
      !snapshotted.has(String(sale.id)) &&
      directRelationshipIds.has(String(sale.referral_relationship_id)),
  );
  return { sales, attributed: sales.length, legacy };
}

async function currentTeam(db: Db, principal: AfHomesPrincipal, kind: ScopeKind) {
  if (kind !== 'team' && kind !== 'global') return null;
  const [relationships, staff, assignments, roles] = await Promise.all([
    rows(db, 'referral_relationships', 'subject_staff_id,upline_staff_id,is_active'),
    rows(db, 'staff_users', 'id,status'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,slug'),
  ]);
  const children = new Map<string, string[]>();
  for (const edge of relationships.filter((row) => row.is_active === true)) {
    const parent = String(edge.upline_staff_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.subject_staff_id)]);
  }
  const direct = children.get(principal.userId) ?? [];
  const descendants: string[] = [];
  const queue = [...direct];
  const seen = new Set([principal.userId]);
  while (queue.length && descendants.length < 10_000) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    descendants.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  const statusById = new Map(staff.map((row) => [String(row.id), String(row.status)]));
  const roleSlugById = new Map(roles.map((row) => [String(row.id), String(row.slug)]));
  const roleByStaff = new Map(
    assignments.map((row) => [
      String(row.staff_id),
      roleSlugById.get(String(row.role_id)) ?? 'unknown',
    ]),
  );
  if (kind === 'global') {
    const sellerIds = staff
      .filter((row) => SELLER_ROLES.has(roleByStaff.get(String(row.id)) ?? ''))
      .map((row) => String(row.id));
    const byRole: Record<string, number> = {};
    for (const id of sellerIds)
      byRole[roleByStaff.get(id) ?? 'unknown'] =
        (byRole[roleByStaff.get(id) ?? 'unknown'] ?? 0) + 1;
    return {
      directCount: 0,
      descendantCount: sellerIds.length,
      active: sellerIds.filter((id) => statusById.get(id) === 'active').length,
      inactive: sellerIds.filter((id) => statusById.get(id) !== 'active').length,
      byRole,
    };
  }
  const byRole: Record<string, number> = {};
  for (const id of descendants)
    byRole[roleByStaff.get(id) ?? 'unknown'] = (byRole[roleByStaff.get(id) ?? 'unknown'] ?? 0) + 1;
  return {
    directCount: direct.length,
    descendantCount: descendants.length,
    active: descendants.filter((id) => statusById.get(id) === 'active').length,
    inactive: descendants.filter((id) => statusById.get(id) !== 'active').length,
    byRole,
  };
}

async function currentNetworkContext(db: Db, principal: AfHomesPrincipal, kind: ScopeKind) {
  if (kind !== 'team' && kind !== 'self') return null;
  const relationshipResult = await db
    .from('referral_relationships')
    .select('upline_staff_id')
    .eq('subject_staff_id', principal.userId)
    .eq('is_active', true)
    .maybeSingle();
  if (relationshipResult.error) throw relationshipResult.error;
  const uplineId = (relationshipResult.data as Row | null)?.upline_staff_id;
  if (!uplineId) return { upperline: null };
  const [staff, assignments, roles] = await Promise.all([
    rows(db, 'staff_users', 'id,full_name'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,name'),
  ]);
  const upline = staff.find((row) => row.id === uplineId);
  const assignment = assignments.find((row) => row.staff_id === uplineId);
  const role = roles.find((row) => row.id === assignment?.role_id);
  return {
    upperline: upline
      ? {
          id: String(upline.id),
          name: String(upline.full_name),
          role: String(role?.name ?? 'Staff'),
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Team Sales Activity Analytics                                      */
/* ------------------------------------------------------------------ */

async function getDescendantSellers(
  db: Db,
  principal: AfHomesPrincipal,
): Promise<string[]> {
  return getDescendantSellersForUser(db, principal.userId);
}

async function getDescendantSellersForUser(
  db: Db,
  userId: string,
): Promise<string[]> {
  const [relationships, staff, assignments, roles] = await Promise.all([
    rows(db, 'referral_relationships', 'subject_staff_id,upline_staff_id,is_active'),
    rows(db, 'staff_users', 'id,full_name,status'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,slug'),
  ]);
  const children = new Map<string, string[]>();
  for (const edge of relationships.filter((row) => row.is_active === true)) {
    const parent = String(edge.upline_staff_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.subject_staff_id)]);
  }
  const descendants: string[] = [];
  const queue = [...(children.get(userId) ?? [])];
  const seen = new Set([userId]);
  const roleSlugById = new Map(roles.map((row) => [String(row.id), String(row.slug)]));
  const roleByStaff = new Map(
    assignments.map((row) => [
      String(row.staff_id),
      roleSlugById.get(String(row.role_id)) ?? 'unknown',
    ]),
  );
  while (queue.length && descendants.length < 10_000) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (SELLER_ROLES.has(roleByStaff.get(id) ?? '')) descendants.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return descendants;
}

async function teamSalesAnalytics(
  db: Db,
  principal: AfHomesPrincipal,
  period: AnalyticsPeriod,
  kind: ScopeKind,
  dateRange: { from: Date; to: Date },
  targetUserId?: string,
) {
  const { from, to } = dateRange;
  const effectiveUserId = targetUserId ?? principal.userId;
  const scoped = await scopedSales(db, principal, kind);
  const descendantIds = await getDescendantSellersForUser(db, effectiveUserId);

  const [staff, assignments, roles] = await Promise.all([
    rows(db, 'staff_users', 'id,full_name,status'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,slug'),
  ]);

  const roleSlugById = new Map(roles.map((row) => [String(row.id), String(row.slug)]));
  const roleByStaff = new Map(
    assignments.map((row) => [
      String(row.staff_id),
      roleSlugById.get(String(row.role_id)) ?? 'unknown',
    ]),
  );
  const statusById = new Map(staff.map((row) => [String(row.id), String(row.status)]));
  const nameById = new Map(staff.map((row) => [String(row.id), String(row.full_name)]));

  // Filter period qualifying sales
  const periodSales = scoped.sales.filter(
    (s) => s.status === QUALIFYING_SALE_STATUS && inWindow(s.created_at, from, to)
  );

  // Count sales per seller (seller_staff_id or seller_ost_id)
  const salesBySeller = new Map<string, number>();
  for (const sale of periodSales) {
    const sellerId = String(sale.seller_staff_id ?? sale.seller_ost_id ?? '');
    if (sellerId) {
      salesBySeller.set(sellerId, (salesBySeller.get(sellerId) ?? 0) + 1);
    }
  }

  // Build member list with sales counts
  const members = descendantIds
    .filter((id) => SELLER_ROLES.has(roleByStaff.get(id) ?? ''))
    .map((id) => {
      const count = salesBySeller.get(id) ?? 0;
      let activity: 'Top Seller' | 'With Sales' | 'Low Sales' | 'No Sales' = 'No Sales';
      if (count > 0) activity = 'With Sales';
      return {
        staffId: id,
        fullName: nameById.get(id) ?? 'Unknown',
        role: roleByStaff.get(id) ?? 'unknown',
        status: statusById.get(id) ?? 'unknown',
        salesCount: count,
        salesActivity: activity,
      };
    }) as {
      staffId: string;
      fullName: string;
      role: string;
      status: string;
      salesCount: number;
      salesActivity: 'Top Seller' | 'With Sales' | 'Low Sales' | 'No Sales';
    }[];

  // Determine Top Seller and Low Sales
  const withSales = members.filter((m) => m.salesCount > 0).sort((a, b) => b.salesCount - a.salesCount);
  const topCount = withSales[0]?.salesCount ?? 0;
  for (const m of members) {
    if (m.salesCount === topCount && topCount > 0) m.salesActivity = 'Top Seller';
    else if (m.salesCount > 0 && m.salesCount < topCount) m.salesActivity = 'Low Sales';
  }

  const kpis = {
    totalTeamSales: periodSales.length,
    membersWithSales: withSales.length,
    membersNoSales: members.filter((m) => m.salesCount === 0).length,
    topSellerCount: topCount,
    participationRate: members.length > 0 ? (withSales.length / members.length) * 100 : 0,
  };

  const parsed = teamSalesAnalyticsSchema.safeParse({
    period,
    window: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
    viewerStaffId: effectiveUserId,
    viewerRole: principal.roleSlug,
    kpis,
    members,
  });
  if (!parsed.success) throw new Error('Team sales analytics validation failed');
  return parsed.data;
}

async function teamSalesOverview(
  db: Db,
  principal: AfHomesPrincipal,
  period: AnalyticsPeriod,
  dateRange: { from: Date; to: Date },
) {
  const { from, to } = dateRange;
  const scoped = await scopedSales(db, principal, 'global');

  const [staff, assignments, roles, relationships] = await Promise.all([
    rows(db, 'staff_users', 'id,full_name,status'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,slug'),
    rows(db, 'referral_relationships', 'subject_staff_id,upline_staff_id,is_active'),
  ]);

  const roleSlugById = new Map(roles.map((r) => [String(r.id), String(r.slug)]));
  const roleByStaff = new Map(
    assignments.map((a) => [String(a.staff_id), roleSlugById.get(String(a.role_id)) ?? 'unknown']),
  );
  const statusById = new Map(staff.map((s) => [String(s.id), String(s.status)]));
  const nameById = new Map(staff.map((s) => [String(s.id), String(s.full_name)]));

  // Find VDs (vice_directors with no upline)
  const vdIds = staff
    .filter((s) => roleByStaff.get(String(s.id)) === 'vice_director')
    .map((s) => String(s.id));

  // Build descendant trees for each VD
  const children = new Map<string, string[]>();
  for (const edge of relationships.filter((r) => r.is_active === true)) {
    const parent = String(edge.upline_staff_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.subject_staff_id)]);
  }

  const periodSales = scoped.sales.filter(
    (s) => s.status === QUALIFYING_SALE_STATUS && inWindow(s.created_at, from, to)
  );

  const salesBySeller = new Map<string, number>();
  for (const sale of periodSales) {
    const sellerId = String(sale.seller_staff_id ?? sale.seller_ost_id ?? '');
    if (sellerId) salesBySeller.set(sellerId, (salesBySeller.get(sellerId) ?? 0) + 1);
  }

  const teams = [];
  for (const vdId of vdIds) {
    const descendants: string[] = [];
    const queue = [...(children.get(vdId) ?? [])];
    const seen = new Set([vdId]);
    while (queue.length && descendants.length < 10_000) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (SELLER_ROLES.has(roleByStaff.get(id) ?? '')) descendants.push(id);
      queue.push(...(children.get(id) ?? []));
    }

    const teamSales = descendants.reduce((sum, id) => sum + (salesBySeller.get(id) ?? 0), 0);
    const withSales = descendants.filter((id) => (salesBySeller.get(id) ?? 0) > 0).length;
    const noSales = descendants.length - withSales;

    teams.push({
      teamHead: { staffId: vdId, fullName: nameById.get(vdId) ?? 'Unknown', role: 'vice_director' },
      memberCount: descendants.length,
      totalSales: teamSales,
      membersWithSales: withSales,
      membersNoSales: noSales,
    });
  }

  teams.sort((a, b) => b.totalSales - a.totalSales);
  const totalEligible = teams.reduce((sum, t) => sum + t.memberCount, 0);
  const sellersWithSales = teams.reduce((sum, t) => sum + t.membersWithSales, 0);
  const sellersNoSales = teams.reduce((sum, t) => sum + t.membersNoSales, 0);

  const parsed = teamSalesOverviewSchema.safeParse({
    period,
    window: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
    totalSales: periodSales.length,
    totalEligibleSellers: totalEligible,
    sellersWithSales,
    sellersNoSales,
    topTeam: teams[0] ?? null,
    teams,
  });
  if (!parsed.success) throw new Error('Team sales overview validation failed');
  return parsed.data;
}

function bucketKey(value: unknown, period: AnalyticsPeriod) {
  const date = new Date(String(value));
  if (period === 'day') return date.toISOString().slice(0, 13) + ':00';
  if (period === 'year') return date.toISOString().slice(0, 7);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Sales Overview trend (AFHomes sales-trend pattern)                   */
/* ------------------------------------------------------------------ */

/**
 * The single AFHomes state that counts as a recognized sale for the Sales
 * Overview. Activation is the explicit, permission-gated recognition decision
 * after full verified payment - the same role the predecessor's `QUALIFYING_SALE`
 * transition plays after `PAYMENT_VERIFIED`. Pipeline states and cancelled
 * sales are working-pipeline items or invalid sales, never recognized sales.
 */
const QUALIFYING_SALE_STATUS = 'active';

/** Money the trend accepts: the `card_sales` CHECK form (1-2dp or whole). */
const TREND_MONEY_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

function trendMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Continuous `YYYY-MM` keys for the last 12 months ending now, oldest first. */
function lastTwelveMonths(now = new Date()): string[] {
  const keys: string[] = [];
  for (let back = 11; back >= 0; back -= 1) {
    const d = new Date(now);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - back);
    keys.push(trendMonthKey(d));
  }
  return keys;
}

async function salesTrend(req: VercelRequest, res: VercelResponse) {
  const principal = await authorizeAfHomes(req, 'dashboard.view');
  if ('error' in principal) return deny(res, principal);
  const granularityRaw = Array.isArray(req.query.granularity)
    ? req.query.granularity[0]
    : req.query.granularity;
  if (granularityRaw !== undefined && granularityRaw !== 'month' && granularityRaw !== 'year')
    return fail(res, 'VALIDATION_ERROR', 'granularity must be month or year', 400);
  const granularity = granularityRaw === 'year' ? 'year' : 'month';
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  try {
    const kind = roleScope(principal);
    const scoped = await scopedSales(db, principal, kind);
    // Only qualifying sales feed the chart. The submission instant buckets the
    // sale (predecessor `submittedAt` semantics); a corrupt row is skipped so one bad
    // row can never fail the whole dashboard read. The yearly range starts at
    // the earliest qualifying submission even when its money is unreadable.
    const qualified = scoped.sales.filter((sale) => sale.status === QUALIFYING_SALE_STATUS);
    const submittedDate = (sale: Row): Date | null => {
      const date = new Date(String(sale.submitted_at ?? sale.created_at ?? ''));
      return Number.isFinite(date.valueOf()) ? date : null;
    };
    const dated = qualified
      .map((sale) => {
        const date = submittedDate(sale);
        if (!date) return null;
        const money = String(sale.cash_price_snapshot ?? '');
        if (!TREND_MONEY_RE.test(money)) return null;
        return { date, money };
      })
      .filter((row): row is { date: Date; money: string } => row !== null);

    const keys =
      granularity === 'month'
        ? lastTwelveMonths()
        : (() => {
            const currentYear = new Date().getUTCFullYear();
            let firstYear: number | null = null;
            for (const sale of qualified) {
              const date = submittedDate(sale);
              if (!date) continue;
              const year = date.getUTCFullYear();
              if (firstYear === null || year < firstYear) firstYear = year;
            }
            const start = firstYear ?? currentYear;
            const out: string[] = [];
            for (let year = start; year <= currentYear; year += 1) out.push(String(year));
            return out;
          })();
    const keyOf = (date: Date) =>
      granularity === 'month' ? trendMonthKey(date) : String(date.getUTCFullYear());
    const buckets = new Map(keys.map((key) => [key, { count: 0, values: [] as unknown[] }]));
    for (const row of dated) {
      const bucket = buckets.get(keyOf(row.date));
      if (!bucket) continue;
      bucket.count += 1;
      bucket.values.push(row.money);
    }
    const periods = keys.map((key) => {
      const bucket = buckets.get(key) ?? { count: 0, values: [] as unknown[] };
      return { key, count: bucket.count, total: decimalCents(bucket.values) };
    });
    const parsed = salesTrendReportSchema.safeParse({
      granularity,
      generatedAt: new Date().toISOString(),
      periods,
    });
    if (!parsed.success) return fail(res, 'INTERNAL', 'Internal server error', 500);
    return res.status(200).json(parsed.data);
  } catch (error) {
    console.error('[api] analytics:', error instanceof Error ? error.message : error);
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}

function parseOptionalDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.valueOf()) ? date : null;
}

function getDateRange(
  period: AnalyticsPeriod,
  fromParam: unknown,
  toParam: unknown,
  now = new Date()
): { from: Date; to: Date } {
  const from = parseOptionalDate(fromParam);
  const to = parseOptionalDate(toParam);

  if (from && to) {
    if (from > to) throw new Error('End date must be on or after start date');
    // Include the full end day
    const toEnd = new Date(to);
    toEnd.setUTCHours(23, 59, 59, 999);
    return { from, to: toEnd };
  }

  // Fall back to period-based calendar window
  return calendarWindow(period, now);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if ((req.method ?? 'GET') !== 'GET')
    return fail(res, 'NOT_FOUND', 'Analytics route not found', 404);
  const familyPath = String(req.query.familyPath ?? '');
  if (familyPath === 'sales-trend') return salesTrend(req, res);
  if (familyPath === 'team-sales') {
    const parsed = analyticsPeriodSchema.safeParse(req.query.period ?? 'month');
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'period must be day, week, month, or year', 400);
    const principal = await authorizeAfHomes(req, 'dashboard.view');
    if ('error' in principal) return deny(res, principal);
    const kind = roleScope(principal);
    const db = serviceClient() as Db;
    if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

    // For Admin/Super Admin (global/finance scope), allow optional staffId parameter
    // to view analytics for a specific genealogy root
    const targetStaffId = String(req.query.staffId ?? '');
    let effectiveKind = kind;
    let targetUserId = principal.userId;

    if ((kind === 'global' || kind === 'finance') && targetStaffId) {
      // Admin/Super Admin requesting analytics for a specific genealogy root
      // Validate that the target staffId is a valid seller
      const { data: targetStaff } = await db
        .from('staff_users')
        .select('id,status')
        .eq('id', targetStaffId)
        .maybeSingle();
      if (!targetStaff || targetStaff.status !== 'active') {
        return fail(res, 'FORBIDDEN', 'Invalid or inactive genealogy root', 403);
      }
      // Verify the target is a seller role
      const { data: targetAssignment } = await db
        .from('staff_role_assignments')
        .select('role_id')
        .eq('staff_id', targetStaffId)
        .maybeSingle();
      const targetRoleResult = targetAssignment
        ? await db.from('roles').select('slug').eq('id', targetAssignment.role_id).maybeSingle()
        : { data: null, error: null };
      const targetRole = targetRoleResult.data;
      if (!targetRole || !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(targetRole.slug)) {
        return fail(res, 'FORBIDDEN', 'Target must be a genealogy root (VD/SSM/SM)', 403);
      }
      effectiveKind = 'team';
      targetUserId = targetStaffId;
    } else if (kind !== 'team' && kind !== 'self') {
      return fail(res, 'FORBIDDEN', 'Team sales view requires team or self scope', 403);
    }

    try {
      let dateRange: { from: Date; to: Date };
      try {
        dateRange = getDateRange(parsed.data, req.query.from, req.query.to);
      } catch (e) {
        return fail(res, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Invalid date range', 400);
      }
      const result = await teamSalesAnalytics(db, principal, parsed.data, effectiveKind, dateRange, targetUserId);
      return res.status(200).json(result);
    } catch (error) {
      console.error('[api] analytics team-sales:', error instanceof Error ? error.message : error);
      return fail(res, 'INTERNAL', 'Internal server error', 500);
    }
  }
  if (familyPath === 'team-sales/overview') {
    const parsed = analyticsPeriodSchema.safeParse(req.query.period ?? 'month');
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'period must be day, week, month, or year', 400);
    const principal = await authorizeAfHomes(req, 'dashboard.view');
    if ('error' in principal) return deny(res, principal);
    const kind = roleScope(principal);
    if (kind !== 'global' && kind !== 'finance')
      return fail(res, 'FORBIDDEN', 'Overview requires global or finance scope', 403);
    const db = serviceClient() as Db;
    if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
    try {
      let dateRange: { from: Date; to: Date };
      try {
        dateRange = getDateRange(parsed.data, req.query.from, req.query.to);
      } catch (e) {
        return fail(res, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Invalid date range', 400);
      }
      const result = await teamSalesOverview(db, principal, parsed.data, dateRange);
      return res.status(200).json(result);
    } catch (error) {
      console.error('[api] analytics team-sales/overview:', error instanceof Error ? error.message : error);
      return fail(res, 'INTERNAL', 'Internal server error', 500);
    }
  }
  if (familyPath !== '') return fail(res, 'NOT_FOUND', 'Analytics route not found', 404);
  const principal = await authorizeAfHomes(req, 'dashboard.view');
  if ('error' in principal) return deny(res, principal);
  const parsed = analyticsPeriodSchema.safeParse(req.query.period ?? 'month');
  if (!parsed.success)
    return fail(res, 'VALIDATION_ERROR', 'period must be day, week, month, or year', 400);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  try {
    const period = parsed.data;
    const { from, to } = calendarWindow(period);
    const kind = roleScope(principal);
    const scoped = await scopedSales(db, principal, kind);
    const saleIds = scoped.sales.map((sale) => String(sale.id));
    const customerIds = [...new Set(scoped.sales.map((sale) => String(sale.customer_id)))];
    const canFinancial =
      kind === 'global' || kind === 'finance' || SELLER_ROLES.has(principal.roleSlug);
    const canCommissions = principal.permissions.some(
      (permission) =>
        permission.canView &&
        ['network.commissions', 'finance.commission_payouts'].includes(permission.moduleKey),
    );
    const canRedemption =
      kind === 'global' ||
      (kind === 'redemption' &&
        principal.permissions.some(
          (permission) => permission.moduleKey === 'operations.redemption' && permission.canView,
        ));

    const [
      allCustomers,
      plans,
      paymentsAll,
      membershipsAll,
      commissionsAll,
      redemptionsAll,
      sellers,
      organizationStaff,
      organizationDepartments,
      networkContext,
    ] = await Promise.all([
      kind === 'global' || kind === 'finance'
        ? rows(db, 'customers', 'id,created_at')
        : customerIds.length
          ? (async () => {
              const q = await db.from('customers').select('id,created_at').in('id', customerIds);
              if (q.error) throw q.error;
              return (q.data ?? []) as Row[];
            })()
          : [],
      rows(db, 'card_plans', 'id,name'),
      canCommissions && (kind === 'global' || kind === 'finance')
        ? rows(db, 'payments', 'id,sale_id,status,amount,verified_at,recorded_at')
        : canCommissions && saleIds.length
          ? (async () => {
              const q = await db
                .from('payments')
                .select('id,sale_id,status,amount,verified_at,recorded_at')
                .in('sale_id', saleIds);
              if (q.error) throw q.error;
              return (q.data ?? []) as Row[];
            })()
          : [],
      kind === 'global' || kind === 'finance'
        ? rows(db, 'memberships', 'id,sale_id,status,activated_at')
        : saleIds.length
          ? (async () => {
              const q = await db
                .from('memberships')
                .select('id,sale_id,status,activated_at')
                .in('sale_id', saleIds);
              if (q.error) throw q.error;
              return (q.data ?? []) as Row[];
            })()
          : [],
      canFinancial && (kind === 'global' || kind === 'finance')
        ? rows(db, 'commissions', 'id,sale_id,status')
        : canFinancial && saleIds.length
          ? (async () => {
              const q = await db
                .from('commissions')
                .select('id,sale_id,status')
                .in('sale_id', saleIds);
              if (q.error) throw q.error;
              return (q.data ?? []) as Row[];
            })()
          : [],
      canRedemption && kind === 'global'
        ? rows(
            db,
            'redemptions',
            'id,redemption_number,item_name_snapshot,total_points,status,redeemed_by,created_at',
          )
        : canRedemption
          ? (async () => {
              const q = await db
                .from('redemptions')
                .select(
                  'id,redemption_number,item_name_snapshot,total_points,status,redeemed_by,created_at',
                )
                .eq('redeemed_by', principal.userId);
              if (q.error) throw q.error;
              return (q.data ?? []) as Row[];
            })()
          : [],
      currentTeam(db, principal, kind),
      kind === 'global' || kind === 'organization' ? rows(db, 'staff_users', 'id,status') : [],
      kind === 'global' || kind === 'organization' ? rows(db, 'departments', 'id,is_active') : [],
      currentNetworkContext(db, principal, kind),
    ]);
    const operationalSaleIds = new Set(saleIds);
    const payments = (paymentsAll as Row[]).filter((row) =>
      operationalSaleIds.has(String(row.sale_id)),
    );
    const memberships = membershipsAll as Row[];
    const commissions = (commissionsAll as Row[]).filter((row) =>
      operationalSaleIds.has(String(row.sale_id)),
    );
    const redemptions = (redemptionsAll as Row[]).filter((row) => row.status === 'completed');
    const verified = payments.filter((row) => row.status === 'verified');
    const now = new Date();
    const planNames = new Map((plans as Row[]).map((row) => [String(row.id), String(row.name)]));
    const periodSales = scoped.sales.filter((row) => inWindow(row.created_at, from, to));
    const grouped = new Map<string, Row[]>();
    for (const sale of periodSales)
      grouped.set(String(sale.plan_id), [...(grouped.get(String(sale.plan_id)) ?? []), sale]);
    // VIP Stage 1: partition the same period sales by frozen scheme. Every
    // sale carries exactly one frozen scheme, so the counts partition the
    // period sales; pre-scheme rows read as `spot_cash`.
    const byScheme = new Map<string, Row[]>();
    for (const sale of periodSales) {
      const scheme = String(sale.payment_scheme ?? 'spot_cash');
      byScheme.set(scheme, [...(byScheme.get(scheme) ?? []), sale]);
    }
    const commissionCounts = Object.fromEntries(
      COMMISSION_STATUSES.map((status) => [
        status,
        commissions.filter((row) => row.status === status).length,
      ]),
    );
    const trend = new Map<
      string,
      {
        period: string;
        sales: number;
        saleValue: unknown[];
        verifiedPayments: unknown[];
        activations: number;
        redemptions: number;
        pointsRedeemed: number;
      }
    >();
    const point = (date: unknown) => {
      if (!inWindow(date, from, to)) return null;
      const key = bucketKey(date, period);
      const existing = trend.get(key) ?? {
        period: key,
        sales: 0,
        saleValue: [],
        verifiedPayments: [],
        activations: 0,
        redemptions: 0,
        pointsRedeemed: 0,
      };
      trend.set(key, existing);
      return existing;
    };
    for (const sale of scoped.sales) {
      const p = point(sale.created_at);
      if (p) {
        p.sales += 1;
        p.saleValue.push(sale.cash_price_snapshot);
      }
    }
    for (const payment of verified) {
      const p = point(payment.verified_at);
      if (p) p.verifiedPayments.push(payment.amount);
    }
    for (const membership of memberships) {
      const p = point(membership.activated_at);
      if (p) p.activations += 1;
    }
    for (const redemption of redemptions) {
      const p = point(redemption.created_at);
      if (p) {
        p.redemptions += 1;
        p.pointsRedeemed += Number(redemption.total_points ?? 0);
      }
    }

    return res.status(200).json({
      period,
      window: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
      scope: {
        kind,
        viewerStaffId: principal.userId,
        viewerRole: principal.roleSlug,
        attributedSaleCount: scoped.attributed,
        unattributedLegacySaleCount: scoped.legacy.length,
        unattributedLegacySaleValue: decimalCents(
          scoped.legacy.map((sale) => sale.cash_price_snapshot),
        ),
      },
      headline: {
        totalCustomers: allCustomers.length,
        newCustomers: allCustomers.filter((row) => inWindow(row.created_at, from, to)).length,
        totalCardSales: scoped.sales.length,
        periodSales: periodSales.length,
        grossFrozenSaleValue: decimalCents(periodSales.map((row) => row.cash_price_snapshot)),
        periodVerifiedPayments: decimalCents(
          verified.filter((row) => inWindow(row.verified_at, from, to)).map((row) => row.amount),
        ),
        activatedMemberships: memberships.filter((row) => row.status === 'active').length,
      },
      queues: {
        pendingPaymentVerification: payments.filter((row) => row.status === 'recorded').length,
        activationReadySales: scoped.sales.filter((row) => row.status === 'activation_pending')
          .length,
        fullPaidSales: scoped.sales.filter((row) => row.fully_paid_at).length,
        rejectedPayments: payments.filter((row) => row.status === 'rejected').length,
        spotCashActive: scoped.sales.filter(
          (row) =>
            row.spot_cash_deadline &&
            new Date(String(row.spot_cash_deadline)) >= now &&
            !row.fully_paid_at,
        ).length,
        spotCashExpired: scoped.sales.filter(
          (row) =>
            row.spot_cash_deadline &&
            new Date(String(row.spot_cash_deadline)) < now &&
            !row.fully_paid_at,
        ).length,
      },
      sellers,
      organization:
        kind === 'global' || kind === 'organization'
          ? {
              totalStaff: organizationStaff.length,
              activeStaff: organizationStaff.filter((row) => row.status === 'active').length,
              inactiveStaff: organizationStaff.filter((row) => row.status === 'inactive').length,
              invitedStaff: organizationStaff.filter((row) => row.status === 'invited').length,
              suspendedStaff: organizationStaff.filter((row) => row.status === 'suspended').length,
              activeDepartments: organizationDepartments.filter((row) => row.is_active === true)
                .length,
            }
          : null,
      networkContext,
      commissions: canCommissions ? commissionCounts : null,
      redemptions: canRedemption
        ? {
            count: redemptions.length,
            pointsRedeemed: redemptions.reduce(
              (sum, row) => sum + Number(row.total_points ?? 0),
              0,
            ),
            recent: [...redemptions]
              .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
              .slice(0, 5)
              .map((row) => ({
                id: row.id,
                redemptionNumber: row.redemption_number,
                itemName: row.item_name_snapshot,
                points: Number(row.total_points),
                createdAt: row.created_at,
              })),
          }
        : null,
      salesByPlan: [...grouped.entries()].map(([planId, sales]) => ({
        planId,
        planName: planNames.get(planId) ?? 'Unknown plan',
        count: sales.length,
        value: decimalCents(sales.map((sale) => sale.cash_price_snapshot)),
      })),
      salesByScheme: [...byScheme.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([scheme, sales]) => ({
          scheme,
          count: sales.length,
          value: decimalCents(sales.map((sale) => sale.cash_price_snapshot)),
        })),
      trends: [...trend.values()]
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((item) => ({
          ...item,
          saleValue: decimalCents(item.saleValue),
          verifiedPayments: decimalCents(item.verifiedPayments),
        })),
    });
  } catch (error) {
    console.error('[api] analytics:', error instanceof Error ? error.message : error);
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}
