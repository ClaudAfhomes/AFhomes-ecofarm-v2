import type { Db, Filter } from 'mongodb';
import {
  analyticsOverviewSchema,
  analyticsPeriodSchema,
  teamSalesAnalyticsSchema,
  teamSalesOverviewSchema,
  type AnalyticsPeriod,
} from '@afhomes/contracts';
import type { authorizeAfHomes, AfHomesPrincipal } from './afhomes-access.js';
import type { MongoRow } from './handler-kit.mongo.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { deny, fail } from './handler-kit.js';
import {
  calendarWindow,
  roleScope,
  SELLER_ROLES,
  projectAnalytics,
  projectSalesTrend,
  projectCurrentTeam,
  type ScopeKind,
  type Row,
  inWindow,
  QUALIFYING_SALE_STATUS,
} from './analytics-projection.js';
import { attributedSellers, mergeAccountSales } from './account-sales.js';
import {
  canReadMongoSales,
  mongoImportedAccountSales,
  hasUnmappedMongoImportedSales,
} from './account-sales.mongo.js';

export function createMongoAnalyticsHandler(db: Db, authorize: typeof authorizeAfHomes) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const rows = async (name: string, filter: Filter<MongoRow> = {}): Promise<Row[]> =>
    (await col(name).find(filter).toArray()).map((row) => ({ ...row, id: row._id }));
  async function scopedSales(principal: AfHomesPrincipal, kind: ScopeKind) {
    if (kind === 'global' || kind === 'finance')
      return {
        sales: await rows('card_sales', { origin: 'normal' }),
        attributed: 0,
        legacy: [] as Row[],
      };
    if (kind !== 'team' && kind !== 'self')
      return { sales: [], attributed: 0, legacy: [] as Row[] };
    const snapshots =
      kind === 'team'
        ? await rows('card_sale_hierarchy_snapshots', { ancestor_staff_id: principal.userId })
        : [];
    const ids = [...new Set(snapshots.map((row) => String(row.sale_id)))];
    const scope: Filter<MongoRow> =
      kind === 'team'
        ? { _id: { $in: ids } }
        : { $or: [{ seller_staff_id: principal.userId }, { seller_ost_id: principal.userId }] };
    const imported = canReadMongoSales(principal)
      ? await mongoImportedAccountSales(db, principal, kind === 'team')
      : [];
    if (
      await col('customer_import_purchase_sources').findOne({
        superseded_by: null,
        original_row_id: { $exists: false },
      })
    )
      return null;
    if (
      await hasUnmappedMongoImportedSales(db, {
        origin: { $ne: 'normal' },
        _id: { $nin: imported.map((sale) => String(sale.id)) },
        $or: [
          { seller_staff_id: principal.userId },
          { seller_ost_id: principal.userId },
          { _id: { $in: ids } },
        ],
      })
    )
      return null;
    const sales = mergeAccountSales(
      await rows('card_sales', { ...scope, origin: 'normal' }),
      imported,
    );
    const relationships =
      kind === 'team'
        ? await rows('referral_relationships', { upline_staff_id: principal.userId })
        : [];
    const legacy =
      kind === 'team'
        ? await rows('card_sales', {
            origin: 'normal',
            _id: { $nin: ids },
            referral_relationship_id: { $in: relationships.map((row) => row.id) },
          })
        : [];
    return { sales, attributed: sales.length, legacy };
  }
  async function networkContext(principal: AfHomesPrincipal, kind: ScopeKind) {
    if (kind !== 'team' && kind !== 'self') return null;
    const relationships = await rows('referral_relationships', {
      subject_staff_id: principal.userId,
      is_active: true,
    });
    if (relationships.length > 1) throw new Error('Ambiguous current upline');
    const id = relationships[0]?.upline_staff_id;
    if (!id) return { upperline: null };
    const person = await col('staff_users').findOne({ _id: String(id) });
    const assignment = await col('staff_role_assignments').findOne({ staff_id: String(id) });
    const role = assignment
      ? await col('roles').findOne({ _id: String(assignment.role_id) })
      : null;
    return {
      upperline: person
        ? { id: person._id, name: String(person.full_name), role: String(role?.name ?? 'Staff') }
        : null,
    };
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    const path = String(req.query.familyPath ?? '');
    if (
      req.method !== 'GET' ||
      !['', 'sales-trend', 'team-sales', 'team-sales/overview'].includes(path)
    )
      return fail(res, 'NOT_FOUND', 'Analytics route not found', 404);
    const principal = await authorize(req, 'dashboard.view');
    if ('error' in principal) return deny(res, principal);
    const period = analyticsPeriodSchema.safeParse(req.query.period ?? 'month');
    const raw = Array.isArray(req.query.granularity)
      ? req.query.granularity[0]
      : req.query.granularity;
    if (path !== 'sales-trend' && !period.success)
      return fail(res, 'VALIDATION_ERROR', 'period must be day, week, month, or year', 400);
    if (path === 'sales-trend' && raw !== undefined && raw !== 'month' && raw !== 'year')
      return fail(res, 'VALIDATION_ERROR', 'granularity must be month or year', 400);
    try {
      if (path === 'team-sales' || path === 'team-sales/overview') {
        const overview = path === 'team-sales/overview';
        const permission = await authorize(req, 'sales.card_sales');
        if ('error' in permission) return deny(res, permission);
        const kind = roleScope(principal),
          target = String(req.query.staffId ?? principal.userId);
        if (overview && !['global', 'finance'].includes(kind))
          return fail(res, 'FORBIDDEN', 'Overview requires global or finance scope', 403);
        if (
          !['team', 'self', 'global', 'finance'].includes(kind) ||
          (!['global', 'finance'].includes(kind) && target !== principal.userId)
        )
          return fail(res, 'FORBIDDEN', 'Team sales are outside your scope', 403);
        let effective = principal;
        if (!overview && (kind === 'global' || kind === 'finance')) {
          const person = await col('staff_users').findOne({ _id: target, status: 'active' });
          const assignment = await col('staff_role_assignments').findOne({ staff_id: target });
          const role =
            assignment &&
            (await col('roles').findOne({ _id: String(assignment.role_id), is_active: true }));
          if (
            !person ||
            !role ||
            !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(String(role.slug))
          )
            return fail(
              res,
              'FORBIDDEN',
              'Target must be an active genealogy root (VD/SSM/SM)',
              403,
            );
          effective = { ...principal, userId: target, roleSlug: String(role.slug) };
        }
        const range = calendarWindow(period.data as AnalyticsPeriod);
        const parse = (value: unknown) =>
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? new Date(value + 'T00:00:00.000Z')
            : null;
        const from = parse(req.query.from),
          to = parse(req.query.to);
        if (from && to && Number.isFinite(from.valueOf()) && Number.isFinite(to.valueOf())) {
          if (from > to)
            return fail(res, 'VALIDATION_ERROR', 'End date must be on or after start date', 400);
          range.from = from;
          range.to = new Date(to);
          range.to.setUTCDate(range.to.getUTCDate() + 1);
        }
        const [staff, assignments, roles, edges, ost, scoped] = await Promise.all([
          rows('staff_users'),
          rows('staff_role_assignments'),
          rows('roles'),
          rows('referral_relationships', { is_active: true }),
          rows('ost_members'),
          scopedSales(effective, roleScope(effective)),
        ]);
        if (!scoped)
          return fail(
            res,
            'NOT_IMPLEMENTED',
            'Native imported sales attribution is not enabled',
            501,
          );
        const roleIds = new Map(roles.map((row) => [String(row.id), String(row.slug)]));
        const staffRoles = new Map(
          assignments.map((row) => [
            String(row.staff_id),
            roleIds.get(String(row.role_id)) ?? 'unknown',
          ]),
        );
        const children = new Map<string, string[]>();
        for (const edge of edges) {
          const id = String(edge.upline_staff_id);
          children.set(id, [...(children.get(id) ?? []), String(edge.subject_staff_id)]);
        }
        const ostIds = new Set(ost.map((row) => String(row.id)));
        const descendants = (root: string, role: string) => {
          const seen = new Set([root]),
            queue = role === 'ost' ? [] : [...(children.get(root) ?? [])],
            ids: string[] = [];
          while (queue.length && seen.size < 10000) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            queue.push(...(children.get(id) ?? []));
            if (
              SELLER_ROLES.has(staffRoles.get(id) ?? '') &&
              (role !== 'sales_manager' || ostIds.has(id))
            )
              ids.push(id);
          }
          return ids;
        };
        if (overview) {
          const periodSales = scoped.sales.filter(
            (s) =>
              s.status === QUALIFYING_SALE_STATUS && inWindow(s.created_at, range.from, range.to),
          );
          const roots = staff.filter(
            (person) => staffRoles.get(String(person.id)) === 'vice_director',
          );
          const snapshots = await rows('card_sale_hierarchy_snapshots', {
            ancestor_staff_id: { $in: roots.map((root) => String(root.id)) },
          });
          const teams = roots
            .map((root) => {
              const ids = descendants(String(root.id), 'vice_director');
              const saleIds = new Set(
                snapshots
                  .filter((row) => row.ancestor_staff_id === root.id)
                  .map((row) => String(row.sale_id)),
              );
              // Current teams may filter visibility, but never assign history without a frozen snapshot.
              const sales = periodSales.filter(
                (s) =>
                  saleIds.has(String(s.id)) && attributedSellers(s).some((id) => ids.includes(id)),
              );
              const withSales = ids.filter((id) =>
                sales.some((s) => attributedSellers(s).includes(id)),
              ).length;
              return {
                teamHead: {
                  staffId: root.id,
                  fullName: String(root.full_name ?? 'Unknown'),
                  role: 'vice_director',
                },
                memberCount: ids.length,
                totalSales: sales.length,
                membersWithSales: withSales,
                membersNoSales: ids.length - withSales,
              };
            })
            .sort((a, b) => b.totalSales - a.totalSales);
          return res.status(200).json(
            teamSalesOverviewSchema.parse({
              period: period.data,
              window: {
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                timezone: 'UTC',
              },
              totalSales: periodSales.length,
              totalEligibleSellers: teams.reduce((sum, t) => sum + t.memberCount, 0),
              sellersWithSales: teams.reduce((sum, t) => sum + t.membersWithSales, 0),
              sellersNoSales: teams.reduce((sum, t) => sum + t.membersNoSales, 0),
              topTeam: teams[0] ?? null,
              teams,
            }),
          );
        }
        const ids = descendants(target, effective.roleSlug);
        const sales = scoped.sales.filter(
          (s) =>
            s.status === QUALIFYING_SALE_STATUS &&
            inWindow(s.created_at, range.from, range.to) &&
            attributedSellers(s).some((id) => ids.includes(id)),
        );
        const members = ids.map((id) => ({
          staffId: id,
          fullName: String(staff.find((s) => s.id === id)?.full_name ?? 'Unknown'),
          role: staffRoles.get(id) ?? 'unknown',
          status: String(staff.find((s) => s.id === id)?.status ?? 'unknown'),
          salesCount: sales.filter((s) => attributedSellers(s).includes(id)).length,
          salesActivity: 'No Sales',
        }));
        const withSales = members.filter((m) => m.salesCount > 0),
          top = Math.max(0, ...members.map((m) => m.salesCount));
        for (const member of members)
          member.salesActivity =
            member.salesCount === 0
              ? 'No Sales'
              : member.salesCount === top
                ? 'Top Seller'
                : 'Low Sales';
        return res.status(200).json(
          teamSalesAnalyticsSchema.parse({
            period: period.data,
            window: {
              from: range.from.toISOString(),
              to: range.to.toISOString(),
              timezone: 'UTC',
            },
            viewerStaffId: target,
            viewerRole: principal.roleSlug,
            kpis: {
              totalTeamSales: sales.length,
              membersWithSales: withSales.length,
              membersNoSales: members.length - withSales.length,
              topSellerCount: top,
              participationRate: members.length ? (withSales.length / members.length) * 100 : 0,
            },
            members,
          }),
        );
      }
      const kind = roleScope(principal),
        scoped = await scopedSales(principal, kind);
      if (!scoped)
        return fail(
          res,
          'NOT_IMPLEMENTED',
          'Native imported sales attribution is not enabled',
          501,
        );
      if (path === 'sales-trend')
        return res
          .status(200)
          .json(projectSalesTrend(scoped.sales, raw === 'year' ? 'year' : 'month'));
      if (!period.success) throw new Error('Invalid period');
      const { from, to } = calendarWindow(period.data),
        saleIds = scoped.sales.map((row) => String(row.id)),
        customerIds = [...new Set(scoped.sales.map((row) => String(row.customer_id)))];
      const global = kind === 'global' || kind === 'finance';
      const canFinancial = global || SELLER_ROLES.has(principal.roleSlug);
      const canCommissions = principal.permissions.some(
        (p) =>
          p.canView && ['network.commissions', 'finance.commission_payouts'].includes(p.moduleKey),
      );
      const canRedemption =
        kind === 'global' ||
        (kind === 'redemption' &&
          principal.permissions.some((p) => p.moduleKey === 'operations.redemption' && p.canView));
      const [
        allCustomers,
        plans,
        paymentsAll,
        membershipsAll,
        commissionsAll,
        redemptionsAll,
        relationships,
        staff,
        assignments,
        roles,
        organizationDepartments,
        context,
      ] = await Promise.all([
        rows('customers', global ? {} : { _id: { $in: customerIds } }),
        rows('card_plans'),
        canCommissions ? rows('payments', global ? {} : { sale_id: { $in: saleIds } }) : [],
        rows('memberships', global ? {} : { sale_id: { $in: saleIds } }),
        canFinancial ? rows('commissions', global ? {} : { sale_id: { $in: saleIds } }) : [],
        canRedemption
          ? rows('redemptions', kind === 'global' ? {} : { redeemed_by: principal.userId })
          : [],
        kind === 'global' || kind === 'team' ? rows('referral_relationships') : [],
        kind === 'global' || kind === 'team' || kind === 'organization' ? rows('staff_users') : [],
        kind === 'global' || kind === 'team' ? rows('staff_role_assignments') : [],
        kind === 'global' || kind === 'team' ? rows('roles') : [],
        kind === 'global' || kind === 'organization' ? rows('departments') : [],
        networkContext(principal, kind),
      ]);
      return res.status(200).json(
        analyticsOverviewSchema.parse(
          projectAnalytics({
            principal,
            period: period.data,
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
            sellers: projectCurrentTeam(principal, kind, relationships, staff, assignments, roles),
            organizationStaff: staff,
            organizationDepartments,
            networkContext: context,
          }),
        ),
      );
    } catch {
      return fail(res, 'INTERNAL', 'Could not load analytics', 500);
    }
  };
}
