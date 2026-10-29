import { salesTrendReportSchema, type AnalyticsPeriod } from '@afhomes/contracts';
import type { AfHomesPrincipal } from './afhomes-access.js';
export type Row = Record<string, unknown>;
export type ScopeKind = 'global' | 'finance' | 'organization' | 'team' | 'self' | 'redemption';
export const SELLER_ROLES = new Set([
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
]);
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

export function inWindow(value: unknown, from: Date, to: Date) {
  const time = new Date(String(value ?? '')).valueOf();
  return Number.isFinite(time) && time >= from.valueOf() && time < to.valueOf();
}

export function decimalCents(values: unknown[]) {
  let total = 0n;
  for (const value of values) {
    const match = String(value ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (match) total += BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

export function roleScope(principal: AfHomesPrincipal): ScopeKind {
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

function bucketKey(value: unknown, period: AnalyticsPeriod) {
  const date = new Date(String(value));
  if (period === 'day') return date.toISOString().slice(0, 13) + ':00';
  if (period === 'year') return date.toISOString().slice(0, 7);
  return date.toISOString().slice(0, 10);
}

export interface AnalyticsInput {
  principal: AfHomesPrincipal;
  period: AnalyticsPeriod;
  from: Date;
  to: Date;
  kind: ScopeKind;
  scoped: { sales: Row[]; attributed: number; legacy: Row[] };
  canCommissions: boolean;
  canRedemption: boolean;
  allCustomers: Row[];
  plans: Row[];
  paymentsAll: Row[];
  membershipsAll: Row[];
  commissionsAll: Row[];
  redemptionsAll: Row[];
  sellers: unknown;
  organizationStaff: Row[];
  organizationDepartments: Row[];
  networkContext: unknown;
}
export function projectAnalytics(input: AnalyticsInput) {
  const {
    principal,
    period,
    from,
    to,
    kind,
    scoped,
    canCommissions,
    canRedemption,
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
  } = input;
  const saleIds = scoped.sales.map((row) => String(row.id));
  const operationalSaleIds = new Set(saleIds);
  const payments = (paymentsAll as Row[]).filter((row) =>
    operationalSaleIds.has(String(row.sale_id)),
  );
  const memberships = membershipsAll as Row[];
  const commissions = (commissionsAll as Row[]).filter(
    (row) => operationalSaleIds.has(String(row.sale_id)) && row.settled_before_system !== true,
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

  return {
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
          pointsRedeemed: redemptions.reduce((sum, row) => sum + Number(row.total_points ?? 0), 0),
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
  };
}
export const QUALIFYING_SALE_STATUS = 'active';

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

export function projectSalesTrend(sales: Row[], granularity: 'month' | 'year') {
  const scoped = { sales };
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
  return salesTrendReportSchema.parse({
    granularity,
    generatedAt: new Date().toISOString(),
    periods,
  });
}
export function projectCurrentTeam(
  principal: AfHomesPrincipal,
  kind: ScopeKind,
  relationships: Row[],
  staff: Row[],
  assignments: Row[],
  roles: Row[],
) {
  if (kind !== 'team' && kind !== 'global') return null;
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
