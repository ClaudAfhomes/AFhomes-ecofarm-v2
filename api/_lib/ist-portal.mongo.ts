import {
  isIstRole,
  istPortalQuerySchema,
  istPortalReportSchema,
  istTeamCommissionQuerySchema,
  MEMBER_POSITIONS,
  MEMBER_POSITION_LABELS,
  importedSalesQuerySchema,
  memberPositionSchema,
  type MemberPosition,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { Db } from 'mongodb';
import type { MongoRow } from './customer-activation.mongo.js';
import { projectGenealogy, type GenealogyInput } from './genealogy-model.js';
import { deny, fail, method, subPath } from './handler-kit.js';
import { matchesSearch } from './list-search.js';
import { sumMoney } from './report-scope.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { attributedSellers, mergeAccountSales } from './account-sales.js';
import {
  mongoImportedAccountSales,
  mongoImportedSalesList,
  mongoImportedCommissionSaleIds,
  hasUnmappedMongoImportedSales,
} from './account-sales.mongo.js';
import { CustomerActivationError } from './customer-activation.mongo.js';

type Row = Record<string, unknown>;
async function byIds(
  db: Db,
  table: string,
  columns: string,
  key: string,
  ids: string[],
): Promise<Row[]> {
  if (!ids.length) return [];
  const projection = Object.fromEntries(
    columns.split(',').map((field) => [field === 'id' ? '_id' : field, 1]),
  );
  const rows = await db
    .collection<MongoRow>(table)
    .find({ [key === 'id' ? '_id' : key]: { $in: ids } }, { projection })
    .toArray();
  return rows.map((row) => ({ ...row, id: row._id }));
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

export function createMongoIstPortalHandler(db: Db, authorize: typeof authorizeAfHomes) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    if (method(req) !== 'GET')
      return fail(res, 'METHOD_NOT_ALLOWED', 'This portal is read-only.', 405);
    if (subPath(req) && subPath(req) !== 'imported-sales')
      return fail(res, 'NOT_FOUND', 'Route not found.', 404);
    const principal = await authorize(req, 'dashboard.view');
    if ('error' in principal) return deny(res, principal);
    const leader = isIstRole(principal.roleSlug);
    if (!leader && principal.roleSlug !== 'ost')
      return fail(res, 'FORBIDDEN', 'Sales account required.', 403);
    if (subPath(req) === 'imported-sales') {
      const query = importedSalesQuerySchema.safeParse(req.query);
      if (!query.success)
        return fail(res, 'VALIDATION_ERROR', 'Choose a valid imported sales period and page.', 400);
      try {
        return res.status(200).json(await mongoImportedSalesList(db, principal, query.data));
      } catch (error) {
        if (error instanceof CustomerActivationError)
          return fail(
            res,
            error.status === 403 ? 'FORBIDDEN' : 'CONFLICT',
            error.message,
            error.status,
          );
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
    try {
      const col = (name: string) => db.collection<MongoRow>(name);
      const [staff, assignments, roles, relationships, ost] = await Promise.all([
        col('staff_users')
          .find({}, { projection: { full_name: 1, status: 1, employee_number: 1 } })
          .sort({ _id: 1 })
          .toArray(),
        col('staff_role_assignments').find({}).sort({ staff_id: 1, role_id: 1 }).toArray(),
        col('roles').find({ is_active: true }).sort({ _id: 1 }).toArray(),
        col('referral_relationships')
          .find({})
          .sort({ subject_staff_id: 1, upline_staff_id: 1 })
          .toArray(),
        col('ost_members')
          .find({}, { projection: { status: 1 } })
          .sort({ _id: 1 })
          .toArray(),
      ]);
      const input: GenealogyInput = {
        staff: staff.map((row) => ({
          id: row._id,
          full_name: String(row.full_name),
          status: row.status as GenealogyInput['staff'][number]['status'],
        })),
        assign: assignments.map((row) => ({
          staff_id: String(row.staff_id),
          role_id: String(row.role_id),
        })),
        roles: roles.map((row) => ({ id: row._id, slug: String(row.slug) })),
        rels: relationships.map((row) => ({
          subject_staff_id: String(row.subject_staff_id),
          upline_staff_id: String(row.upline_staff_id),
          is_active: row.is_active === true,
        })),
        ost: ost.map((row) => ({
          id: row._id,
          status: row.status as GenealogyInput['ost'][number]['status'],
        })),
      };
      const graph = projectGenealogy(input, principal);
      const roleById = new Map(input.roles.map((row) => [row.id, row.slug]));
      const rolesForStaff = new Map(
        input.assign.map((row) => [row.staff_id, roleById.get(row.role_id)]),
      );
      const ostMembers = new Set(ost.map((row) => row._id));
      const ids = (leader ? graph.descendants(principal.userId) : []).filter(
        (id) =>
          MEMBER_POSITIONS.includes(rolesForStaff.get(id) as MemberPosition) &&
          (principal.roleSlug !== 'sales_manager' || ostMembers.has(id)),
      );
      const headId = graph.ancestors(principal.userId)[0] ?? null;
      let ostIds = ids.filter((id) => ostMembers.has(id) && rolesForStaff.get(id) === 'ost');
      if (teamView && principal.roleSlug === 'sales_manager') {
        const direct = new Set(
          relationships
            .filter(
              (row) =>
                row.upline_staff_id === principal.userId &&
                row.is_active === true &&
                row.is_authoritative === true,
            )
            .map((row) => String(row.subject_staff_id)),
        );
        ostIds = ostIds.filter((id) => direct.has(id));
      }
      const ostSet = new Set(ostIds);
      const roleByStaff = new Map<string, MemberPosition>([[principal.userId, ownRole]]);
      for (const id of ids) {
        const role = memberPositionSchema.safeParse(rolesForStaff.get(id));
        if (role.success) roleByStaff.set(id, role.data);
      }
      const allowedDownline = new Set(
        teamView && principal.roleSlug === 'vice_director'
          ? ids.filter((id) =>
              ['senior_sales_manager', 'sales_manager', 'ost'].includes(roleByStaff.get(id) ?? ''),
            )
          : ostIds,
      );
      const people: Row[] = staff
        .filter((row) => row._id === principal.userId || ids.includes(row._id))
        .map((row) => ({ ...row, id: row._id }));
      const snapshots =
        leader && (canSales || canCommissions)
          ? await col('card_sale_hierarchy_snapshots')
              .find({ ancestor_staff_id: principal.userId }, { projection: { sale_id: 1 } })
              .toArray()
          : [];
      const importedCommissionIds =
        leader && canCommissions ? await mongoImportedCommissionSaleIds(db, principal) : [];
      const snapshotIds = [
        ...new Set([...snapshots.map((row) => String(row.sale_id)), ...importedCommissionIds]),
      ];
      const importedOwn = canSales
        ? await mongoImportedAccountSales(db, principal, false, from, to)
        : [];
      const importedTeam =
        leader && canSales ? await mongoImportedAccountSales(db, principal, true, from, to) : [];
      if (
        await hasUnmappedMongoImportedSales(db, {
          origin: { $ne: 'normal' },
          _id: { $nin: [...importedOwn, ...importedTeam].map((sale) => String(sale.id)) },
          $or: [
            { seller_staff_id: principal.userId },
            { seller_ost_id: principal.userId },
            { _id: { $in: snapshotIds } },
          ],
        })
      )
        return fail(
          res,
          'NOT_IMPLEMENTED',
          'Native imported sales attribution is not enabled',
          501,
        );
      const period = { created_at: { $gte: `${from}T00:00:00.000Z`, $lte: `${to}T23:59:59.999Z` } };
      const map = (rows: MongoRow[]): Row[] => rows.map((row) => ({ ...row, id: row._id }));
      const normalOwnSales = canSales
        ? map(
            await col('card_sales')
              .find({
                ...period,
                origin: 'normal',
                $or: [{ seller_staff_id: principal.userId }, { seller_ost_id: principal.userId }],
              })
              .toArray(),
          )
        : [];
      const normalTeamSales = canSales
        ? map(
            await col('card_sales')
              .find({ ...period, origin: 'normal', _id: { $in: snapshotIds } })
              .toArray(),
          ).filter((sale) => ids.includes(String(sale.seller_staff_id ?? sale.seller_ost_id)))
        : [];
      const ownSales = mergeAccountSales(normalOwnSales, importedOwn);
      const teamSales = mergeAccountSales(normalTeamSales, importedTeam);
      const ostSales = teamSales.filter((sale) =>
        attributedSellers(sale).some((id) => ostSet.has(id)),
      );
      const ownCommissions = canCommissions
        ? map(
            await col('commissions')
              .find({
                ...period,
                settled_before_system: { $ne: true },
                $or: [
                  { beneficiary_staff_id: principal.userId },
                  { beneficiary_ost_id: principal.userId },
                ],
              })
              .toArray(),
          )
        : [];
      const downlineCommissions = canCommissions
        ? map(
            await col('commissions')
              .find({
                ...period,
                settled_before_system: { $ne: true },
                sale_id: { $in: snapshotIds },
              })
              .toArray(),
          ).filter((row) =>
            allowedDownline.has(String(row.beneficiary_staff_id ?? row.beneficiary_ost_id)),
          )
        : [];
      const beneficiary = (row: Row) => String(row.beneficiary_staff_id ?? row.beneficiary_ost_id);
      const unique = (rows: Row[]) => [
        ...new Map(rows.map((row) => [String(row.id), row])).values(),
      ];
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
      const sellers = (sales: Row[], allowed: string[]) =>
        new Set(sales.flatMap(attributedSellers).filter((id) => allowed.includes(id))).size;
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
            withSales: canSales ? sellers(ostSales, ostIds) : null,
            withoutSales: canSales ? ostIds.length - sellers(ostSales, ostIds) : null,
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
                  return {
                    role,
                    recordCount: records.length,
                    ...earnings(records, canCommissions),
                  };
                }),
              }
            : null,
          team: {
            total: ids.length,
            active: people.filter((p) => p.id !== principal.userId && p.status === 'active').length,
            salesCount: canSales ? teamSales.length : null,
            qualifyingSales: canSales
              ? teamSales.filter((s) => s.status === 'active').length
              : null,
            salesAmount: canSales ? sumMoney(teamSales.map((s) => s.cash_price_snapshot)) : null,
            withSales: canSales ? sellers(teamSales, ids) : null,
            withoutSales: canSales ? ids.length - sellers(teamSales, ids) : null,
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
  };
}
