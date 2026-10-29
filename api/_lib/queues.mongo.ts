import type { Db, Document } from 'mongodb';
import { z } from 'zod';
import {
  dashboardQueuesSchema,
  OST_REVIEWABLE_STATUSES,
  SALE_ACTIVATABLE,
  type PaymentStatus,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { summarizePayments } from './commerce.js';
import { shape, type QueueRow } from './queue-model.js';
import { matchesSearch } from './list-search.js';
import { deny, fail, isoOrNull, method, subPath } from './handler-kit.js';
import type { MongoRow } from './customer-activation.mongo.js';
import type { VercelRequest, VercelResponse } from './http.js';
const paymentStatuses = ['submitted', 'payment_pending', 'payment_in_progress', 'overdue'];
const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export function createMongoQueuesHandler(db: Db, authorize: typeof authorizeAfHomes) {
  const col = (name: string) => db.collection<MongoRow>(name);
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req);
      if (method(req) !== 'GET' || !['finance', 'activation', 'dashboard'].includes(path))
        return fail(res, 'NOT_FOUND', 'Queue endpoint not found', 404);
      const auth = await authorize(
        req,
        path === 'dashboard'
          ? 'dashboard.view'
          : path === 'finance'
            ? 'finance.payment_verification'
            : 'finance.card_activation',
      );
      if ('error' in auth) return deny(res, auth);
      if (path === 'dashboard') {
        const can = (key: string) =>
          auth.permissions.some((row) => row.moduleKey === key && row.canView);
        return res.status(200).json(
          dashboardQueuesSchema.parse({
            ostMembers: can('network.ost_members')
              ? await col('ost_members').countDocuments()
              : null,
            ostApplications: can('network.ost_registrations')
              ? await col('ost_applications').countDocuments({
                  status: { $in: [...OST_REVIEWABLE_STATUSES] },
                })
              : null,
            paymentVerification: can('finance.payment_verification')
              ? await col('card_sales').countDocuments({ status: { $in: paymentStatuses } })
              : null,
          }),
        );
      }
      const query = querySchema.parse(req.query),
        window = query.limit + query.offset;
      const customerLookup = {
        $lookup: {
          from: 'customers',
          localField: 'customer_id',
          foreignField: '_id',
          pipeline: [{ $project: { first_name: 1, middle_name: 1, last_name: 1, suffix: 1 } }],
          as: 'customers',
        },
      };
      const project = {
        _id: 1,
        sale_number: 1,
        reservation_number: 1,
        customer_application_id: 1,
        purchase_terms_id: 1,
        seller_staff_id: 1,
        status: 1,
        tier_snapshot: 1,
        payment_scheme_snapshot: 1,
        total_price_snapshot: 1,
        cash_price_snapshot: 1,
        minimum_down_payment_snapshot: 1,
        payment_scheme: 1,
        reservation_fee_snapshot: 1,
        required_initial_snapshot: 1,
        installment_months_snapshot: 1,
        monthly_amount_snapshot: 1,
        monthly_amortization_snapshot: 1,
        validity_months_snapshot: 1,
        spot_cash_started_at: 1,
        spot_cash_deadline: 1,
        customer_id: 1,
        plan_id: 1,
        customers: 1,
        card_plans: 1,
        customer_applications: 1,
      };
      async function sourceRows(table: string, filter: Document, kind: 'sale' | 'reservation') {
        const pipeline: Document[] = [
          { $match: filter },
          customerLookup,
          { $unwind: '$customers' },
        ];
        if (kind === 'sale')
          pipeline.push(
            {
              $lookup: {
                from: 'card_plans',
                localField: 'plan_id',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1 } }],
                as: 'card_plans',
              },
            },
            { $unwind: '$card_plans' },
          );
        else
          pipeline.push(
            {
              $lookup: {
                from: 'customer_applications',
                localField: 'customer_application_id',
                foreignField: '_id',
                pipeline: [{ $project: { application_number: 1, status: 1 } }],
                as: 'customer_applications',
              },
            },
            { $unwind: '$customer_applications' },
          );
        pipeline.push({ $sort: { spot_cash_started_at: 1, _id: 1 } }, { $project: project });
        const total = await col(table)
          .aggregate([...pipeline, { $count: 'total' }])
          .next();
        if (!query.search && path === 'finance') pipeline.push({ $limit: window });
        return {
          rows: await col(table).aggregate<MongoRow>(pipeline).toArray(),
          total: Number(total?.total ?? 0),
        };
      }
      const sales = await sourceRows(
        'card_sales',
        { status: { $in: path === 'finance' ? paymentStatuses : [...SALE_ACTIVATABLE] } },
        'sale',
      );
      const reservations =
        path === 'finance'
          ? await sourceRows(
              'reservation_agreements',
              { origin: 'application', status: 'executed', sale_id: null },
              'reservation',
            )
          : { rows: [], total: 0 };
      const saleIds = sales.rows.map((row) => row._id),
        reservationIds = reservations.rows.map((row) => row._id);
      const payments = await col('payments')
        .find(
          { $or: [{ sale_id: { $in: saleIds } }, { reservation_id: { $in: reservationIds } }] },
          { projection: { sale_id: 1, reservation_id: 1, amount: 1, status: 1 } },
        )
        .toArray();
      const result: Record<string, unknown>[] = [];
      const name = (row: Record<string, unknown>) =>
        [row.first_name, row.middle_name, row.last_name, row.suffix]
          .filter((value) => typeof value === 'string' && value)
          .join(' ');
      for (const row of sales.rows) {
        const customer = row.customers as Record<string, unknown>,
          product = row.card_plans as Record<string, unknown>;
        if (
          !matchesSearch(query.search, [row.sale_number, row.status, name(customer), product.name])
        )
          continue;
        result.push(
          shape({
            id: row._id,
            sale_number: String(row.sale_number),
            status: String(row.status),
            cash_price_snapshot: isoOrNull(row.cash_price_snapshot),
            minimum_down_payment_snapshot: isoOrNull(row.minimum_down_payment_snapshot),
            payment_scheme: isoOrNull(row.payment_scheme),
            reservation_fee_snapshot: isoOrNull(row.reservation_fee_snapshot),
            required_initial_snapshot: isoOrNull(row.required_initial_snapshot),
            spot_cash_started_at: isoOrNull(row.spot_cash_started_at),
            spot_cash_deadline: isoOrNull(row.spot_cash_deadline),
            customer_id: String(row.customer_id),
            customerName: name(customer) || 'Unknown customer',
            productName: String(product.name),
            payments: payments
              .filter((payment) => payment.sale_id === row._id)
              .map((payment) => ({
                amount: String(payment.amount),
                status: payment.status as PaymentStatus,
              })),
            installment_months_snapshot:
              row.installment_months_snapshot == null
                ? null
                : Number(row.installment_months_snapshot),
            monthly_amount_snapshot: isoOrNull(row.monthly_amount_snapshot),
            validity_months_snapshot:
              row.validity_months_snapshot == null ? null : Number(row.validity_months_snapshot),
          } satisfies QueueRow),
        );
      }
      for (const row of reservations.rows) {
        const customer = row.customers as Record<string, unknown>,
          application = row.customer_applications as Record<string, unknown>;
        if (
          !matchesSearch(query.search, [
            row.reservation_number,
            application.application_number,
            application.status,
            name(customer),
          ])
        )
          continue;
        const own = payments.filter((payment) => payment.reservation_id === row._id),
          seller = await col('staff_users').findOne(
            { _id: String(row.seller_staff_id) },
            { projection: { full_name: 1 } },
          );
        const totals = summarizePayments({
          cashPrice: String(row.total_price_snapshot ?? '0.00'),
          minimumDownPayment: String(row.total_price_snapshot ?? '0.00'),
          requiredInitial: String(row.required_initial_snapshot ?? null),
          payments: own.map((payment) => ({
            amount: String(payment.amount),
            status: payment.status as PaymentStatus,
          })),
          spotCashStartedAt: isoOrNull(row.spot_cash_started_at),
          spotCashDeadline: isoOrNull(row.spot_cash_deadline),
        });
        result.push({
          origin: 'reservation',
          reservationId: row._id,
          reservationNumber: String(row.reservation_number),
          customerApplicationId: String(row.customer_application_id),
          applicationNumber: String(application.application_number ?? ''),
          applicationStatus: String(application.status ?? ''),
          purchaseTermsId: String(row.purchase_terms_id ?? ''),
          sellerStaffId: String(row.seller_staff_id),
          sellerName: String(seller?.full_name ?? ''),
          tier: String(row.tier_snapshot ?? ''),
          customerId: String(row.customer_id),
          customerName: name(customer) || 'Unknown customer',
          productName: `VIP ${String(row.tier_snapshot ?? '')}`,
          status: String(row.status),
          paymentScheme: String(row.payment_scheme_snapshot ?? 'spot_cash'),
          totalPrice: String(row.total_price_snapshot ?? '0.00'),
          reservationFee: String(row.reservation_fee_snapshot ?? '0.00'),
          requiredInitial: String(row.required_initial_snapshot ?? '0.00'),
          installmentMonths: row.installment_months_snapshot ?? null,
          monthlyAmount: row.monthly_amortization_snapshot ?? null,
          validityMonths: Number(row.validity_months_snapshot ?? 0),
          verifiedTotal: totals.verifiedTotal,
          remainingBalance: totals.remainingBalance,
          overpaidAmount: totals.overpaidAmount,
          fullyPaid: totals.fullyPaid,
          recordedPaymentCount: own.filter((payment) => payment.status === 'recorded').length,
          firstVerifiedPayment: isoOrNull(row.spot_cash_started_at),
          spotCashDeadline: isoOrNull(row.spot_cash_deadline),
          saleId: null,
          activatable: false,
        });
      }
      result.sort(
        (left, right) =>
          String(left.firstVerifiedPayment ?? '').localeCompare(
            String(right.firstVerifiedPayment ?? ''),
          ) ||
          String(left.origin).localeCompare(String(right.origin)) ||
          String(left.saleId ?? left.reservationId ?? '').localeCompare(
            String(right.saleId ?? right.reservationId ?? ''),
          ),
      );
      return res
        .status(200)
        .json({
          data: result.slice(query.offset, query.offset + query.limit),
          meta: {
            total: query.search ? result.length : sales.total + reservations.total,
            limit: query.limit,
            offset: query.offset,
          },
        });
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid queue query', 400);
      return fail(res, 'INTERNAL', 'Queue service is unavailable', 503);
    }
  };
}
