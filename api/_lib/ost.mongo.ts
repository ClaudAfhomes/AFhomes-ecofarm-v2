import type { Db } from 'mongodb';
import { z } from 'zod';
import {
  ostMeSchema,
  ostMemberSchema,
  ostDashboardSchema,
  ostSalesListSchema,
  ostCommissionsListSchema,
  ostApplicationSchema,
} from '@afhomes/contracts';
import type { resolveAfHomesPrincipal } from './afhomes-access.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { sumMoney } from './report-scope.js';
import { matchesSearch } from './list-search.js';
import { deny, fail, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { mergeAccountSales } from './account-sales.js';
import { canReadMongoSales, mongoImportedAccountSales, hasUnmappedMongoImportedSales } from './account-sales.mongo.js';

const querySchema = z.object({
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const nullable = (value: unknown) => (typeof value === 'string' ? value : null);

/** Native self-owned OST portal and the existing permission-scoped member directory. */
export function createMongoOstHandler(db: Db, resolve: typeof resolveAfHomesPrincipal) {
  const col = (name: string) => db.collection<MongoRow>(name);
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req);
    if (method(req) !== 'GET')
      return fail(res, 'NOT_IMPLEMENTED', 'This native OST workflow is not yet enabled', 501);
    const principal = await resolve(req);
    if ('error' in principal) return deny(res, principal);
    if (principal.mustChangePassword || principal.mfaRequired)
      return fail(res, 'FORBIDDEN', 'Complete account security setup before continuing', 403);
    try {
      if (path === 'applications' || /^applications\/[a-f0-9-]{36}$/.test(path)) {
        const allowed = principal.roleSlug === 'super_admin' || principal.permissions.some(
          (grant) => grant.moduleKey === 'network.ost_registrations' && grant.canView,
        );
        if (!allowed) return fail(res, 'FORBIDDEN', 'Insufficient permission', 403);
        const single = path !== 'applications';
        const search = String(req.query.search ?? '').trim();
        if (search.length > 120) return fail(res, 'VALIDATION_ERROR', 'Search is too long', 400);
        const filter = {
          ...(single ? { _id: path.slice('applications/'.length) } : {}),
          ...(['vice_director','senior_sales_manager','sales_manager'].includes(principal.roleSlug) ? { sponsor_staff_id: principal.userId } : {}),
          ...(req.query.status ? { status: String(req.query.status) } : {}),
        };
        const rows = [];
        for (const row of await col('ost_applications').find(filter).sort({ submitted_at: -1, _id: -1 }).toArray()) {
          const sponsor = await col('staff_users').findOne({_id:String(row.sponsor_staff_id)}, {projection:{full_name:1}});
          const code = await col('referral_codes').findOne({_id:String(row.referral_code_id)}, {projection:{code_hint:1}});
          const value = ostApplicationSchema.parse({id:row._id,applicantName:[row.first_name,row.middle_name,row.last_name].filter(Boolean).join(' '),
            email:row.email,phone:row.phone,birthDate:row.birth_date,address:row.address ?? null,sponsorStaffId:row.sponsor_staff_id,
            sponsorName:sponsor?.full_name ?? '',referralCodeHint:code?.code_hint ?? '',status:row.status,reviewNotes:row.review_notes ?? null,
            reviewedBy:row.reviewed_by ?? null,submittedAt:row.submitted_at ?? '',reviewedAt:row.reviewed_at ?? null});
          if (matchesSearch(search,[value.applicantName,value.email,value.phone,value.sponsorName,value.referralCodeHint,value.status,value.id])) rows.push(value);
        }
        if (single) return rows[0] ? res.status(200).json(rows[0]) : fail(res,'NOT_FOUND','Application not found',404);
        return list(res,rows);
      }
      if (path === 'members' || /^members\/[a-f0-9-]{36}$/.test(path)) {
        const id = path.slice('members/'.length),
          single = path !== 'members';
        const canView = principal.permissions.some(
          (grant) => grant.moduleKey === 'network.ost_members' && grant.canView,
        );
        const ownOnly = !canView && principal.roleSlug === 'ost';
        if (!canView && !ownOnly) return fail(res, 'FORBIDDEN', 'Insufficient permission', 403);
        const filter: Record<string, unknown> = single ? { _id: id } : {};
        if (ownOnly) filter._id = principal.userId;
        if (single && ownOnly && id !== principal.userId)
          return fail(res, 'NOT_FOUND', 'OST member not found', 404);
        if (
          canView &&
          principal.roleSlug === 'sales_manager' &&
          (!single || id !== principal.userId)
        )
          filter.sponsor_staff_id = principal.userId;
        const search = String(req.query.search ?? '').trim();
        if (search.length > 120) return fail(res, 'VALIDATION_ERROR', 'Search is too long', 400);
        const members = await col('ost_members')
          .find(filter)
          .sort({ created_at: -1, _id: -1 })
          .toArray();
        const sponsorIds = [...new Set(members.map((row) => String(row.sponsor_staff_id)))];
        const sponsors = await col('staff_users')
          .find({ _id: { $in: sponsorIds } }, { projection: { full_name: 1 } })
          .toArray();
        const numbers =
          req.query.includeAccreditation === '1'
            ? await col('sale_team_accreditations')
                .find(
                  { staff_id: { $in: members.map((row) => row._id) } },
                  { projection: { staff_id: 1, aa_number: 1 } },
                )
                .toArray()
            : [];
        const rows = members.map((row) =>
          ostMemberSchema.parse({
            id: row._id,
            applicationId: row.application_id,
            sponsorStaffId: row.sponsor_staff_id,
            sponsorName:
              sponsors.find((item) => item._id === row.sponsor_staff_id)?.full_name ?? '',
            ostNumber: row.ost_number,
            fullName: row.full_name,
            email: row.email,
            phone: row.phone,
            status: row.status,
            approvedBy: row.approved_by,
            approvedAt: row.approved_at ?? '',
            createdAt: row.created_at ?? '',
            ...(req.query.includeAccreditation === '1'
              ? { aaNumber: numbers.find((item) => item.staff_id === row._id)?.aa_number ?? null }
              : {}),
          }),
        );
        if (single)
          return rows[0]
            ? res.status(200).json(rows[0])
            : fail(res, 'NOT_FOUND', 'OST member not found', 404);
        return list(
          res,
          rows.filter((row) =>
            matchesSearch(search, [
              row.fullName,
              row.email,
              row.phone,
              row.ostNumber,
              row.aaNumber,
              row.sponsorName,
              row.status,
            ]),
          ),
        );
      }
      if (!['me', 'me/dashboard', 'me/sales', 'me/commissions'].includes(path))
        return fail(res, 'NOT_IMPLEMENTED', 'This native OST workflow is not yet enabled', 501);
      const member = await col('ost_members').findOne({ _id: principal.userId });
      if (!member) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      const sponsor = await col('staff_users').findOne(
        { _id: String(member.sponsor_staff_id) },
        { projection: { full_name: 1, status: 1 } },
      );
      if (path === 'me')
        return res.status(200).json(
          ostMeSchema.parse({
            ostNumber: member.ost_number,
            fullName: member.full_name,
            status: member.status,
            sponsorName: sponsor?.full_name ?? '',
            approvedAt: member.approved_at ?? '',
          }),
        );
      if (member.status !== 'active')
        return fail(res, 'FORBIDDEN', 'OST account is not active', 403);
      const owner = {
        $or: [{ seller_staff_id: principal.userId }, { seller_ost_id: principal.userId }],
      };
      const imported = path !== 'me/commissions' && canReadMongoSales(principal)
        ? await mongoImportedAccountSales(db, principal) : [];
      if (
        path !== 'me/commissions' && await hasUnmappedMongoImportedSales(db,
          { ...owner, origin: { $ne: 'normal' }, _id: { $nin: imported.map((sale) => String(sale.id)) } },
        )
      )
        return fail(
          res,
          'NOT_IMPLEMENTED',
          'Native imported sales attribution is not enabled',
          501,
        );
      const normalSales =
        path !== 'me/commissions'
          ? await col('card_sales')
              .find({ ...owner, origin: 'normal' })
              .sort({ created_at: -1, _id: 1 })
              .toArray()
          : [];
      const sales = mergeAccountSales(normalSales.map((sale) => ({ ...sale, id: sale._id })), imported)
        .map<MongoRow>((sale) => ({ ...sale, _id: String(sale.id) }))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || a._id.localeCompare(b._id));
      const commissions =
        path !== 'me/sales'
          ? await col('commissions')
              .find({
                settled_before_system: { $ne: true },
                $or: [
                  { beneficiary_staff_id: principal.userId },
                  { beneficiary_ost_id: principal.userId },
                ],
              })
              .sort({ created_at: -1, _id: 1 })
              .toArray()
          : [];
      const saleRefs = commissions.length
        ? await col('card_sales')
            .find(
              { _id: { $in: commissions.map((row) => String(row.sale_id)) } },
              { projection: { sale_number: 1 } },
            )
            .toArray()
        : [];
      const commissionRows = commissions
        .filter((row) => saleRefs.some((sale) => sale._id === row.sale_id))
        .map((row) => ({
          id: row._id,
          commissionNumber: nullable(row.commission_number),
          saleNumber: String(saleRefs.find((sale) => sale._id === row.sale_id)!.sale_number),
          amount: String(row.amount),
          status: String(row.status),
          qualifiedAt: nullable(row.qualified_at),
          earnedAt: nullable(row.earned_at),
          paidAt: nullable(row.paid_at),
          createdAt: String(row.created_at),
        }));
      if (path === 'me/dashboard') {
        const assignment =
          sponsor &&
          (await col('staff_role_assignments').findOne(
            { staff_id: sponsor._id },
            { projection: { role_id: 1 } },
          ));
        const role =
          assignment &&
          (await col('roles').findOne(
            { _id: String(assignment.role_id) },
            { projection: { slug: 1 } },
          ));
        const bucket = (statuses: string[]) => {
          const rows = commissionRows.filter((row) => statuses.includes(row.status));
          return { count: rows.length, amount: sumMoney(rows.map((row) => row.amount)) };
        };
        return res.status(200).json(
          ostDashboardSchema.parse({
            head: {
              headId: sponsor?._id ?? '',
              headName: sponsor?.full_name ?? 'Unknown',
              headRole: role?.slug ?? 'Unknown',
              headStatus: sponsor?.status ?? 'unknown',
              relationship: 'Direct Sponsor',
            },
            sales: {
              totalSales: sales.length,
              periodSales: sales.filter((row) => row.status === 'active').length,
              qualifyingSaleStatus: 'active',
            },
            commissions: {
              toEarn: bucket(['pending', 'payment_verified', 'final_qualification_pending']),
              earned: bucket(['earned']),
              paid: bucket(['paid']),
              cancelled: bucket(['cancelled']),
            },
            commissionHistory: commissionRows,
          }),
        );
      }
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, search, limit, offset } = parsed.data;
      if (path === 'me/commissions') {
        const matching = commissionRows.filter(
          (row) =>
            (!status || row.status === status) &&
            matchesSearch(search, [row.commissionNumber, row.saleNumber]),
        );
        return res.status(200).json(
          ostCommissionsListSchema.parse({
            data: matching.slice(offset, offset + limit),
            meta: { total: matching.length, limit, offset },
          }),
        );
      }
      const matching = sales.filter(
        (row) =>
          (!status || row.status === status) &&
          matchesSearch(search, [row.sale_number, row.customer_id]),
      );
      const page = matching.slice(offset, offset + limit);
      const customers = await col('customers')
        .find(
          { _id: { $in: page.map((row) => String(row.customer_id)) } },
          { projection: { customer_number: 1, first_name: 1, last_name: 1 } },
        )
        .toArray();
      return res.status(200).json(
        ostSalesListSchema.parse({
          data: page.map((row) => {
            const customer = customers.find((item) => item._id === row.customer_id);
            return {
              id: row._id,
              saleNumber: row.sale_number,
              customerName: customer
                ? [customer.first_name, customer.last_name].filter(Boolean).join(' ')
                : null,
              customerNumber: customer?.customer_number ?? null,
              status: row.status,
              cashPriceSnapshot: row.cash_price_snapshot,
              createdAt: row.created_at,
            };
          }),
          meta: { total: matching.length, limit, offset },
          summary: { qualifyingSales: matching.filter((row) => row.status === 'active').length },
        }),
      );
    } catch {
      return fail(res, 'INTERNAL', 'OST information is unavailable. Please retry.', 503);
    }
  };
}
