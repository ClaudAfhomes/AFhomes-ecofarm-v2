/** Phase 14 role-scoped, database-backed analytics. */
import { analyticsPeriodSchema, type AnalyticsPeriod } from '@jad/contracts';

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
  const to = new Date(now);
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
  const result = await db.from(table).select(columns);
  if (result.error) throw result.error;
  return (result.data ?? []) as Row[];
}

async function scopedSales(db: Db, principal: AfHomesPrincipal, kind: ScopeKind) {
  if (kind === 'global' || kind === 'finance') {
    return {
      sales: await rows(
        db,
        'card_sales',
        'id,customer_id,plan_id,seller_staff_id,seller_ost_id,cash_price_snapshot,payment_scheme,status,created_at,activated_at,fully_paid_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id',
      ),
      attributed: 0,
      legacy: [] as Row[],
    };
  }
  if (kind === 'self') {
    const result = await db
      .from('card_sales')
      .select(
        'id,customer_id,plan_id,seller_staff_id,seller_ost_id,cash_price_snapshot,payment_scheme,status,created_at,activated_at,fully_paid_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id',
      )
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
        'id,customer_id,plan_id,seller_staff_id,seller_ost_id,cash_price_snapshot,payment_scheme,status,created_at,activated_at,fully_paid_at,spot_cash_started_at,spot_cash_deadline,referral_relationship_id',
      )
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

function bucketKey(value: unknown, period: AnalyticsPeriod) {
  const date = new Date(String(value));
  if (period === 'day') return date.toISOString().slice(0, 13) + ':00';
  if (period === 'year') return date.toISOString().slice(0, 7);
  return date.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if ((req.method ?? 'GET') !== 'GET' || String(req.query.familyPath ?? '') !== '')
    return fail(res, 'NOT_FOUND', 'Analytics route not found', 404);
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
    const payments = paymentsAll as Row[];
    const memberships = membershipsAll as Row[];
    const commissions = commissionsAll as Row[];
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
