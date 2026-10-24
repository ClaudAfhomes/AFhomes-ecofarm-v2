import {
  isIstRole,
  istPortalQuerySchema,
  istPortalReportSchema,
  istTeamCommissionQuerySchema,
  MEMBER_POSITIONS,
  MEMBER_POSITION_LABELS,
  memberPositionSchema,
  type MemberPosition,
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { deny, fail, method, subPath, type Db } from '../_lib/handler-kit.js';
import { matchesSearch, readSearchRows } from '../_lib/list-search.js';
import { sumMoney } from '../_lib/report-scope.js';
import { getSalesDownlineContext } from '../_lib/genealogy-visibility.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { importedSales } from './_imported-sales.js';

type Row = Record<string, unknown>;
const SALE_COLUMNS =
  'id,sale_number,seller_staff_id,seller_ost_id,customer_id,plan_id,cash_price_snapshot,status,created_at';
const COMMISSION_COLUMNS =
  'id,commission_number,sale_id,beneficiary_staff_id,beneficiary_ost_id,amount,status,created_at,earned_at,paid_at';

async function byIds(
  db: Db,
  table: string,
  columns: string,
  key: string,
  ids: string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 100)
    rows.push(
      ...(await readSearchRows(
        db
          .from(table)
          .select(columns)
          .in(key, ids.slice(i, i + 100))
          .order('id'),
      )),
    );
  return rows;
}

function earnings(rows: Row[], allowed: boolean) {
  const total = (statuses: string[]) =>
    allowed
      ? sumMoney(rows.filter((r) => statuses.includes(String(r.status))).map((r) => r.amount))
      : null;
  return {
    toEarn: total(['pending', 'payment_verified', 'final_qualification_pending']),
    earned: total(['earned', 'paid']),
    paid: total(['paid']),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (method(req) !== 'GET')
    return fail(res, 'METHOD_NOT_ALLOWED', 'This portal is read-only.', 405);
  if (subPath(req) && subPath(req) !== 'imported-sales')
    return fail(res, 'NOT_FOUND', 'Route not found.', 404);
  const principal = await authorizeAfHomes(req, 'dashboard.view');
  if ('error' in principal) return deny(res, principal);
  const leader = isIstRole(principal.roleSlug);
  if (!leader && principal.roleSlug !== 'ost')
    return fail(res, 'FORBIDDEN', 'Sales account required.', 403);
  if (subPath(req) === 'imported-sales') {
    const db = serviceClient() as Db;
    if (!db) return fail(res, 'INTERNAL', 'Service unavailable.', 503);
    try {
      return await importedSales(req, res, principal, db);
    } catch {
      return fail(res, 'INTERNAL', 'Unable to load imported sales. Try again.', 500);
    }
  }
  const parsed = istPortalQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return fail(res, 'VALIDATION_ERROR', 'Choose a valid reporting period.', 400);
  const { from, to, view, page } = parsed.data;
  if (view.startsWith('team-') && !leader)
    return fail(res, 'FORBIDDEN', 'Team monitoring requires an IST account.', 403);
  const teamView = view === 'team-commissions';
  const teamQuery = teamView
    ? istTeamCommissionQuerySchema.safeParse(
        Object.fromEntries(
          Object.entries(req.query).filter(([key]) => !['familyPath', 'path'].includes(key)),
        ),
      )
    : null;
  if (teamQuery && !teamQuery.success)
    return fail(res, 'VALIDATION_ERROR', 'Invalid team commission filters.', 400);
  const filters = teamQuery?.success ? teamQuery.data : null;
  const ownRole = memberPositionSchema.parse(principal.roleSlug);
  const availableRoles: MemberPosition[] =
    principal.roleSlug === 'vice_director' ? [...MEMBER_POSITIONS] : [ownRole, 'ost'];
  if (filters?.role && !availableRoles.includes(filters.role))
    return fail(res, 'FORBIDDEN', 'That position is outside your commission scope.', 403);
  const canView = (key: string) =>
    principal.permissions.some((p) => p.moduleKey === key && p.canView);
  const canSales = canView('sales.card_sales');
  const canCommissions = canView('network.commissions');
  if ((view.endsWith('sales') && !canSales) || (view.endsWith('commissions') && !canCommissions))
    return fail(res, 'FORBIDDEN', 'This module is not permitted.', 403);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Service unavailable.', 503);
  try {
    const fromIso = `${from}T00:00:00.000Z`;
    const toIso = `${to}T23:59:59.999Z`;
    const period = (q: Db) =>
      q
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false })
        .order('id');
    const {
      ids,
      ostIds: genealogyOstIds,
      headId,
    } = await getSalesDownlineContext(db, principal.userId, principal.roleSlug);
    let ostIds = genealogyOstIds;
    if (teamView && principal.roleSlug === 'sales_manager') {
      const direct = await readSearchRows(
        db
          .from('referral_relationships')
          .select('subject_staff_id')
          .eq('upline_staff_id', principal.userId)
          .eq('is_active', true)
          .eq('is_authoritative', true)
          .order('subject_staff_id'),
      );
      const directIds = new Set(direct.map((r) => String(r.subject_staff_id)));
      ostIds = ostIds.filter((id) => directIds.has(id));
    }
    const ostSet = new Set(ostIds);
    const roleByStaff = new Map<string, MemberPosition>([[principal.userId, ownRole]]);
    if (teamView) {
      const roles = await readSearchRows(
        db
          .from('roles')
          .select('id,slug')
          .in('slug', MEMBER_POSITIONS)
          .eq('is_active', true)
          .order('id'),
      );
      const roleById = new Map(
        roles.map((r) => [String(r.id), memberPositionSchema.parse(r.slug)]),
      );
      for (let i = 0; i < ids.length; i += 100) {
        const assignments = await readSearchRows(
          db
            .from('staff_role_assignments')
            .select('staff_id,role_id')
            .in('staff_id', ids.slice(i, i + 100))
            .order('staff_id')
            .order('role_id'),
        );
        for (const row of assignments) {
          const role = roleById.get(String(row.role_id));
          if (role) roleByStaff.set(String(row.staff_id), role);
        }
      }
    }
    const allowedDownline = new Set(
      teamView && principal.roleSlug === 'vice_director'
        ? ids.filter((id) =>
            ['senior_sales_manager', 'sales_manager', 'ost'].includes(roleByStaff.get(id) ?? ''),
          )
        : ostIds,
    );
    const people = await byIds(db, 'staff_users', 'id,full_name,status,employee_number', 'id', [
      principal.userId,
      ...ids,
    ]);
    const snapshots =
      leader && (canSales || canCommissions)
        ? await readSearchRows(
            db
              .from('card_sale_hierarchy_snapshots')
              .select('sale_id')
              .eq('ancestor_staff_id', principal.userId)
              .order('sale_id'),
          )
        : [];
    const importedCommissionSales =
      leader && canCommissions
        ? await db.rpc('imported_commission_sale_ids_for_account', { p_actor_id: principal.userId })
        : { data: [], error: null };
    if (importedCommissionSales.error) throw importedCommissionSales.error;
    const snapshotIds = [
      ...new Set([
        ...snapshots.map((r) => String(r.sale_id)),
        ...((importedCommissionSales.data ?? []) as string[]),
      ]),
    ];
    const ownSales = canSales
      ? await readSearchRows(
          period(
            db
              .from('card_sales')
              .select(SALE_COLUMNS)
              .eq('origin', 'normal')
              .or(`seller_staff_id.eq.${principal.userId},seller_ost_id.eq.${principal.userId}`),
          ),
        )
      : [];
    // Current membership authorizes access; only the frozen snapshot attributes historical team sales.
    const teamSales: Row[] = [];
    if (canSales) {
      for (let i = 0; i < snapshotIds.length; i += 100) {
        const rows = await readSearchRows(
          period(
            db
              .from('card_sales')
              .select(SALE_COLUMNS)
              .eq('origin', 'normal')
              .in('id', snapshotIds.slice(i, i + 100)),
          ),
        );
        teamSales.push(
          ...rows.filter((s) => ids.includes(String(s.seller_staff_id ?? s.seller_ost_id))),
        );
      }
    }
    const ostSales = teamSales.filter((s) =>
      ostSet.has(String(s.seller_staff_id ?? s.seller_ost_id)),
    );
    const ownCommissions = canCommissions
      ? await readSearchRows(
          period(
            db
              .from('commissions')
              .select(COMMISSION_COLUMNS)
              .not('settled_before_system', 'is', true)
              .or(
                `beneficiary_staff_id.eq.${principal.userId},beneficiary_ost_id.eq.${principal.userId}`,
              ),
          ),
        )
      : [];
    const downlineCommissions: Row[] = [];
    if (canCommissions) {
      for (let i = 0; i < snapshotIds.length; i += 100) {
        const rows = await readSearchRows(
          period(
            db
              .from('commissions')
              .select(COMMISSION_COLUMNS)
              .not('settled_before_system', 'is', true)
              .in('sale_id', snapshotIds.slice(i, i + 100)),
          ),
        );
        downlineCommissions.push(
          ...rows.filter((r) =>
            allowedDownline.has(String(r.beneficiary_staff_id ?? r.beneficiary_ost_id)),
          ),
        );
      }
    }
    const beneficiary = (row: Row) => String(row.beneficiary_staff_id ?? row.beneficiary_ost_id);
    const unique = (rows: Row[]) => [...new Map(rows.map((row) => [String(row.id), row])).values()];
    const ostCommissions = downlineCommissions.filter((row) => ostSet.has(beneficiary(row)));
    const organizationCommissions = teamView
      ? unique([...ownCommissions, ...downlineCommissions])
      : [];
    const summary = (sales: Row[], commissions: Row[]) => ({
      salesCount: canSales ? sales.length : null,
      qualifyingSales: canSales ? sales.filter((s) => s.status === 'active').length : null,
      salesAmount: canSales ? sumMoney(sales.map((s) => s.cash_price_snapshot)) : null,
      ...earnings(commissions, canCommissions),
    });
    const sellers = (sales: Row[]) =>
      new Set(sales.map((s) => String(s.seller_staff_id ?? s.seller_ost_id))).size;
    const sales = view === 'my-sales' ? ownSales : view === 'team-sales' ? teamSales : [];
    let commissions =
      view === 'my-commissions'
        ? ownCommissions
        : view === 'team-commissions'
          ? organizationCommissions
          : [];
    const searchSaleRefs = filters?.search
      ? await byIds(db, 'card_sales', 'id,sale_number', 'id', [
          ...new Set(commissions.map((c) => String(c.sale_id))),
        ])
      : [];
    if (teamView)
      commissions = commissions.filter(
        (c) =>
          (!filters?.role || roleByStaff.get(beneficiary(c)) === filters.role) &&
          (!filters?.status || c.status === filters.status) &&
          matchesSearch(filters?.search, [
            c.commission_number,
            c.status,
            people.find((p) => p.id === beneficiary(c))?.full_name,
            MEMBER_POSITION_LABELS[roleByStaff.get(beneficiary(c))!],
            searchSaleRefs.find((s) => s.id === c.sale_id)?.sale_number,
          ]),
      );
    const sort = (rows: Row[]) =>
      rows.sort(
        (a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)) ||
          String(a.id).localeCompare(String(b.id)),
      );
    const pageSize = 25;
    const slice = (rows: Row[]) => sort(rows).slice((page - 1) * pageSize, page * pageSize);
    const salesPage = slice(sales);
    const commissionPage = slice(commissions);
    const customerNames = canView('sales.customers')
      ? await byIds(db, 'customers', 'id,first_name,middle_name,last_name,suffix', 'id', [
          ...new Set(
            salesPage.map((s) => String(s.customer_id)).filter((id) => id !== 'undefined'),
          ),
        ])
      : [];
    const plans = await byIds(db, 'card_plans', 'id,name', 'id', [
      ...new Set(salesPage.map((s) => String(s.plan_id)).filter((id) => id !== 'undefined')),
    ]);
    const saleRefs = filters?.search
      ? searchSaleRefs
      : await byIds(db, 'card_sales', 'id,sale_number', 'id', [
          ...new Set(commissionPage.map((c) => String(c.sale_id))),
        ]);
    const heads = headId ? await byIds(db, 'staff_users', 'id,full_name', 'id', [headId]) : [];
    const name = (rows: Row[], id: unknown, key: string) => rows.find((r) => r.id === id)?.[key];
    const customerName = (id: unknown) => {
      const customer = customerNames.find((r) => r.id === id);
      return customer
        ? [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
            .filter(Boolean)
            .join(' ')
        : null;
    };
    return res.status(200).json(
      istPortalReportSchema.parse({
        from,
        to,
        account: {
          name: principal.fullName,
          role: principal.roleName,
          status: principal.status,
          staffNumber: people.find((p) => p.id === principal.userId)?.employee_number ?? null,
          head: heads[0]?.full_name ?? null,
        },
        personal: summary(ownSales, ownCommissions),
        ost: {
          ...summary(ostSales, ostCommissions),
          withSales: canSales ? sellers(ostSales) : null,
          withoutSales: canSales ? ostIds.length - sellers(ostSales) : null,
        },
        teamCommissionOverview: teamView
          ? {
              role: ownRole,
              scopeLabel:
                principal.roleSlug === 'vice_director'
                  ? 'Your commissions and your authorized SSM, SM and OST organization'
                  : principal.roleSlug === 'senior_sales_manager'
                    ? 'Your commissions and authorized OST members, including OSTs through your SMs'
                    : 'Your commissions and OST members directly assigned to you',
              availableRoles,
              totals: summary(
                unique([
                  ...ownSales,
                  ...teamSales.filter((s) =>
                    allowedDownline.has(String(s.seller_staff_id ?? s.seller_ost_id)),
                  ),
                ]),
                organizationCommissions,
              ),
              breakdown: availableRoles.map((role) => {
                const records = organizationCommissions.filter(
                  (c) => roleByStaff.get(beneficiary(c)) === role,
                );
                return { role, recordCount: records.length, ...earnings(records, canCommissions) };
              }),
            }
          : null,
        team: {
          total: ids.length,
          active: people.filter((p) => p.id !== principal.userId && p.status === 'active').length,
          salesCount: canSales ? teamSales.length : null,
          salesAmount: canSales ? sumMoney(teamSales.map((s) => s.cash_price_snapshot)) : null,
          withSales: canSales ? sellers(teamSales) : null,
          withoutSales: canSales ? ids.length - sellers(teamSales) : null,
        },
        sales: salesPage.map((s) => ({
          id: s.id,
          saleNumber: s.sale_number,
          createdAt: s.created_at,
          customerName: customerName(s.customer_id),
          tier: name(plans, s.plan_id, 'name') ?? null,
          amount: s.cash_price_snapshot,
          status: s.status,
        })),
        commissions: commissionPage.map((c) => ({
          id: c.id,
          commissionNumber: c.commission_number ?? null,
          memberName:
            view === 'my-commissions'
              ? principal.fullName
              : (name(people, c.beneficiary_staff_id ?? c.beneficiary_ost_id, 'full_name') ??
                'Unknown salesperson'),
          memberRole: roleByStaff.get(beneficiary(c)) ?? null,
          saleNumber: name(saleRefs, c.sale_id, 'sale_number') ?? '',
          amount: c.amount,
          status: c.status,
          createdAt: c.created_at,
          earnedAt: c.earned_at ?? null,
          paidAt: c.paid_at ?? null,
        })),
        total: sales.length + commissions.length,
        page,
        pageSize,
      }),
    );
  } catch {
    return fail(res, 'INTERNAL', 'Unable to load sales performance. Try again.', 500);
  }
}
