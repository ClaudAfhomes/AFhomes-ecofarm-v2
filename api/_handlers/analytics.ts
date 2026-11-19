/** Phase 14 role-scoped, database-backed analytics. */
import {
  analyticsPeriodSchema,
  teamSalesAnalyticsSchema,
  teamSalesOverviewSchema,
  teamSalesTeamSchema,
  type AnalyticsPeriod,
} from '@afhomes/contracts';

import { authorizeAfHomes, type AfHomesPrincipal } from '../_lib/afhomes-access.js';
import { deny, fail, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { serviceClient } from '../_lib/rest.js';
import {
  importedAccountSales,
  mergeAccountSales,
  attributedSellers,
} from '../_lib/account-sales.js';
import { getSalesDownlineContext } from '../_lib/genealogy-visibility.js';

import {
  QUALIFYING_SALE_STATUS,
  decimalCents,
  inWindow,
  calendarWindow,
  roleScope,
  SELLER_ROLES,
  projectAnalytics,
  projectSalesTrend,
  projectCurrentTeam,
  type Row,
  type ScopeKind,
} from '../_lib/analytics-projection.js';
export { calendarWindow } from '../_lib/analytics-projection.js';
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
    const sales = mergeAccountSales(
      (result.data ?? []) as Row[],
      await importedAccountSales(db, principal.userId),
    );
    return { sales, attributed: sales.length, legacy: [] as Row[] };
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
  sales = mergeAccountSales(sales, await importedAccountSales(db, principal.userId, true));
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
  return projectCurrentTeam(principal, kind, relationships, staff, assignments, roles);
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

async function getDescendantSellers(db: Db, principal: AfHomesPrincipal): Promise<string[]> {
  return getDescendantSellersForUser(db, principal.userId);
}

async function getDescendantSellersForUser(db: Db, userId: string): Promise<string[]> {
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
  const scoped = await scopedSales(db, { ...principal, userId: effectiveUserId }, kind);
  const descendantIds =
    targetUserId && targetUserId !== principal.userId
      ? await getDescendantSellersForUser(db, effectiveUserId)
      : (await getSalesDownlineContext(db, effectiveUserId, principal.roleSlug)).ids;

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
    (s) =>
      s.status === QUALIFYING_SALE_STATUS &&
      inWindow(s.created_at, from, to) &&
      attributedSellers(s).some((id) => descendantIds.includes(id)),
  );

  // Count sales per seller (seller_staff_id or seller_ost_id)
  const salesBySeller = new Map<string, number>();
  for (const sale of periodSales) {
    for (const sellerId of attributedSellers(sale).filter((id) => descendantIds.includes(id))) {
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
  const withSales = members
    .filter((m) => m.salesCount > 0)
    .sort((a, b) => b.salesCount - a.salesCount);
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
    (s) => s.status === QUALIFYING_SALE_STATUS && inWindow(s.created_at, from, to),
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

async function salesTrend(req: VercelRequest, res: VercelResponse) {
  const principal = await authorizeAfHomes(req, 'dashboard.view');
  if ('error' in principal) return deny(res, principal);
  const raw = Array.isArray(req.query.granularity)
    ? req.query.granularity[0]
    : req.query.granularity;
  if (raw !== undefined && raw !== 'month' && raw !== 'year')
    return fail(res, 'VALIDATION_ERROR', 'granularity must be month or year', 400);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  try {
    const scoped = await scopedSales(db, principal, roleScope(principal));
    return res.status(200).json(projectSalesTrend(scoped.sales, raw === 'year' ? 'year' : 'month'));
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
  now = new Date(),
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
      if (
        !targetRole ||
        !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(targetRole.slug)
      ) {
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
        return fail(
          res,
          'VALIDATION_ERROR',
          e instanceof Error ? e.message : 'Invalid date range',
          400,
        );
      }
      const result = await teamSalesAnalytics(
        db,
        principal,
        parsed.data,
        effectiveKind,
        dateRange,
        targetUserId,
      );
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
        return fail(
          res,
          'VALIDATION_ERROR',
          e instanceof Error ? e.message : 'Invalid date range',
          400,
        );
      }
      const result = await teamSalesOverview(db, principal, parsed.data, dateRange);
      return res.status(200).json(result);
    } catch (error) {
      console.error(
        '[api] analytics team-sales/overview:',
        error instanceof Error ? error.message : error,
      );
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
        ? rows(db, 'commissions', 'id,sale_id,status,settled_before_system')
        : canFinancial && saleIds.length
          ? (async () => {
              const q = await db
                .from('commissions')
                .select('id,sale_id,status,settled_before_system')
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
    return res
      .status(200)
      .json(
        projectAnalytics({
          principal,
          period,
          from,
          to,
          kind,
          scoped,
          canCommissions,
          canRedemption,
          allCustomers: allCustomers as Row[],
          plans: plans as Row[],
          paymentsAll: paymentsAll as Row[],
          membershipsAll: membershipsAll as Row[],
          commissionsAll: commissionsAll as Row[],
          redemptionsAll: redemptionsAll as Row[],
          sellers,
          organizationStaff: organizationStaff as Row[],
          organizationDepartments: organizationDepartments as Row[],
          networkContext,
        }),
      );
  } catch (error) {
    console.error('[api] analytics:', error instanceof Error ? error.message : error);
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}
