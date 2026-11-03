import { captureMongoSaleHierarchy } from './sale-hierarchy.mongo.js';
import { createMongoPurchaseRecords } from './purchase-records.mongo.js';
import { ensureMongoCustomerVipNumber } from './customers.mongo.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  AF_ID_ALPHABET,
  createSaleSchema,
  recordPaymentSchema,
  verifyPaymentSchema,
  activateSaleSchema,
  type PaymentStatus,
} from '@afhomes/contracts';
import {
  calculateCommission,
  productSaleRejection,
  resolveSeller,
  resolveSchemeEconomics,
  snapshotSaleTerms,
  snapshotSchemeTerms,
  summarizePayments,
} from './commerce.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import {
  CustomerActivationError,
  createCustomerActivation,
  type MongoRow,
} from './customer-activation.mongo.js';
import { saleListQuerySchema, toSale } from './sale-model.js';
import { deny, fail, method, subPath, isoOrNull, list } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const clean = (value: string | undefined) => value?.trim() || null;
function addMonths(date: Date, months: number) {
  const value = new Date(date);
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  value.setUTCDate(
    Math.min(
      date.getUTCDate(),
      new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate(),
    ),
  );
  return value;
}
const manilaDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
export async function setupMongoSales(db: Db) {
  await db.collection('card_sales').createIndex({ sale_number: 1 }, { unique: true });
  await db.collection('card_sales').createIndex(
    { customer_id: 1, plan_id: 1 },
    {
      unique: true,
      partialFilterExpression: {
        status: {
          $in: [
            'draft',
            'submitted',
            'payment_pending',
            'payment_in_progress',
            'payment_verified',
            'activation_pending',
          ],
        },
      },
    },
  );
  await db
    .collection('payments')
    .createIndex(
      { sale_id: 1, reference: 1 },
      {
        unique: true,
        partialFilterExpression: { sale_id: { $type: 'string' }, reference: { $type: 'string' } },
      },
    );
  await db
    .collection('payments')
    .createIndex(
      { payment_number: 1 },
      { unique: true, partialFilterExpression: { payment_number: { $type: 'string' } } },
    );
  await db
    .collection('mutation_requests')
    .createIndex({ actor_id: 1, operation: 1, request_id: 1 }, { unique: true });
  for (const field of ['sale_id', 'customer_id', 'membership_number'])
    await db.collection('memberships').createIndex(
      { [field]: 1 },
      {
        name: `unique_membership_${field}`,
        unique: true,
        partialFilterExpression: { [field]: { $type: 'string' } },
      },
    );
  await db
    .collection('card_sale_hierarchy_snapshots')
    .createIndex({ sale_id: 1, ancestor_staff_id: 1 }, { unique: true });
  await db
    .collection('commissions')
    .createIndex(
      { commission_number: 1 },
      { unique: true, partialFilterExpression: { commission_number: { $type: 'string' } } },
    );
}

export function createMongoSalesHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  env: NodeJS.ProcessEnv,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const activation = createCustomerActivation(db, client, env);
  async function view(row: MongoRow, session?: ClientSession) {
    const customer = await col('customers').findOne(
      { _id: String(row.customer_id) },
      { session, projection: { first_name: 1, middle_name: 1, last_name: 1, suffix: 1 } },
    );
    const product = await col('card_plans').findOne(
      { _id: String(row.plan_id) },
      { session, projection: { name: 1, code: 1 } },
    );
    const seller = await col('staff_users').findOne(
      { _id: String(row.seller_staff_id) },
      { session, projection: { full_name: 1 } },
    );
    const money = await summary(row, session);
    return toSale(
      { ...row, id: row._id, customers: customer, card_plans: product, staff_users: seller },
      { paidAmount: money.verifiedTotal, balance: money.remainingBalance },
    );
  }
  async function summary(sale: MongoRow, session?: ClientSession) {
    const payments = await col('payments')
      .find({ sale_id: sale._id }, { session, projection: { amount: 1, status: 1 } })
      .toArray();
    return summarizePayments({
      cashPrice: String(sale.cash_price_snapshot ?? '0.00'),
      minimumDownPayment: String(sale.minimum_down_payment_snapshot ?? '0.00'),
      requiredInitial: isoOrNull(sale.required_initial_snapshot),
      payments: payments.map((row) => ({
        amount: String(row.amount),
        status: row.status as PaymentStatus,
      })),
      spotCashStartedAt: isoOrNull(sale.spot_cash_started_at),
      spotCashDeadline: isoOrNull(sale.spot_cash_deadline),
    });
  }
  async function readScope(req: VercelRequest) {
    const finance = await authorize(req, 'finance.payment_verification'),
      activate = await authorize(req, 'finance.card_activation');
    const all = !('error' in finance) || !('error' in activate);
    const auth = all
      ? !('error' in finance)
        ? finance
        : activate
      : await authorize(req, 'sales.card_sales');
    return { all, auth };
  }
  async function allocate(prefix: string, table: string, field: string, session: ClientSession) {
    for (let i = 0; i < 64; i++) {
      const id = `${prefix}-${Array.from(randomBytes(5), (byte) => AF_ID_ALPHABET[byte & 31]).join('')}`;
      if (!(await col(table).findOne({ [field]: id }, { session }))) return id;
    }
    throw new Error('Business number allocation failed');
  }
  async function audit(
    actor: string,
    action: string,
    type: string,
    id: string,
    before: unknown,
    after: unknown,
    session: ClientSession,
  ) {
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actor,
        action,
        entity_type: type,
        entity_id: id,
        before_data: before ?? null,
        after_data: after ?? null,
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  async function roleOf(id: string, session: ClientSession) {
    const assignment = await col('staff_role_assignments').findOne({ staff_id: id }, { session });
    return assignment
      ? await col('roles').findOne({ _id: String(assignment.role_id) }, { session })
      : null;
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req),
        verb = method(req),
        match = /^([a-f0-9-]{36})(?:\/(summary|payments|verify|activate|cancel))?$/.exec(path),
        id = match?.[1],
        suffix = match?.[2];
      if (!(
        (verb === 'GET' &&
          (path === '' || (id && (!suffix || ['summary', 'payments'].includes(suffix))))) ||
        (verb === 'POST' &&
          (path === '' ||
            (id && ['payments', 'verify', 'activate', 'cancel'].includes(suffix ?? ''))))
      ))
        return fail(res, 'NOT_FOUND', 'Sales endpoint not found', 404);
      if (verb === 'GET') {
        const scope = await readScope(req);
        if ('error' in scope.auth) return deny(res, scope.auth);
        const query = saleListQuerySchema.parse(req.query),
          filter = {
            ...(id ? { _id: id } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.customerId ? { customer_id: query.customerId } : {}),
            ...(query.productId ? { plan_id: query.productId } : {}),
            ...(!scope.all
              ? id
                ? {
                    $or: [
                      { seller_staff_id: scope.auth.userId },
                      { seller_ost_id: scope.auth.userId },
                    ],
                  }
                : { seller_staff_id: scope.auth.userId }
              : {}),
          };
        const rows = await col('card_sales')
          .find(filter)
          .sort({ created_at: -1, _id: -1 })
          .skip(id ? 0 : query.offset)
          .limit(id ? 1 : query.limit)
          .toArray();
        if (id && !rows[0]) refuse(404, 'Sale not found');
        if (suffix === 'summary') {
          const row = rows[0]!;
          return res.status(200).json({
            saleId: row._id,
            status: row.status,
            cashPrice: row.cash_price_snapshot ?? '0.00',
            minimumDownPayment: row.minimum_down_payment_snapshot ?? '0.00',
            paymentScheme: row.payment_scheme ?? 'spot_cash',
            reservationFee: row.reservation_fee_snapshot ?? '0.00',
            requiredInitial:
              row.required_initial_snapshot ?? row.minimum_down_payment_snapshot ?? '0.00',
            installmentMonths: row.installment_months_snapshot ?? null,
            monthlyAmount: row.monthly_amount_snapshot ?? null,
            ...(await summary(row)),
          });
        }
        if (suffix === 'payments') {
          const payments = await col('payments')
              .find({ sale_id: id })
              .sort({ recorded_at: -1, _id: -1 })
              .toArray(),
            result = [];
          for (const row of payments) {
            const recorded = await col('staff_users').findOne(
                { _id: String(row.recorded_by) },
                { projection: { full_name: 1 } },
              ),
              verified = await col('staff_users').findOne(
                { _id: String(row.verified_by) },
                { projection: { full_name: 1 } },
              );
            result.push({
              id: row._id,
              paymentNumber: row.payment_number ?? null,
              saleId: row.sale_id,
              customerId: row.customer_id ?? null,
              amount: row.amount,
              paymentType: row.payment_type,
              method: row.method,
              reference: row.reference ?? null,
              notes: row.notes ?? null,
              status: row.status,
              rejectionReason: row.rejection_reason ?? null,
              recordedBy: row.recorded_by,
              verifiedBy: row.verified_by ?? null,
              recordedByName: recorded?.full_name ?? null,
              verifiedByName: verified?.full_name ?? null,
              recordedAt: isoOrNull(row.recorded_at) ?? '',
              verifiedAt: isoOrNull(row.verified_at),
            });
          }
          return list(res, result);
        }
        if (id) return res.status(200).json(await view(rows[0]!));
        const data = [];
        for (const row of rows) data.push(await view(row));
        return res.status(200).json({
          data,
          meta: {
            total: await col('card_sales').countDocuments(filter),
            limit: query.limit,
            offset: query.offset,
          },
        });
      }
      const module =
        suffix === 'activate'
          ? 'finance.card_activation'
          : ['payments', 'verify'].includes(suffix ?? '')
            ? 'finance.payment_verification'
            : 'sales.card_sales';
      const action = path === '' ? 'create' : 'update',
        auth = await authorize(req, module, action);
      if ('error' in auth) return deny(res, auth);
      const session = client.startSession();
      let activatedCustomer: string | undefined;
      try {
        const result = await session.withTransaction(async () => {
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne({ _id: 'sales-write' }, { $inc: { seq: 1 } }, { upsert: true, session });
          const fresh = await authorize(req, module, action);
          if ('error' in fresh) refuse(fresh.error.status, fresh.error.error.message);
          const now = new Date(),
            timestamp = now.toISOString();
          if (path === '') {
            const input = createSaleSchema.parse(req.body),
              product = await col('card_plans').findOne({ _id: input.productId }, { session });
            if (!product) refuse(404, 'Card product not found');
            const category = await col('card_categories').findOne(
              { _id: String(product!.category_id), is_active: true },
              { session },
            );
            const rejection = productSaleRejection(
              {
                isActive: product!.is_active === true,
                cashPrice: String(product!.cash_price),
                minimumDownPayment: String(product!.minimum_down_payment),
              },
              Boolean(category),
            );
            if (rejection) refuse(409, rejection);
            const customer = await col('customers').findOne({ _id: input.customerId }, { session });
            if (!customer) refuse(404, 'Customer not found');
            if (customer!.status === 'cancelled')
              refuse(409, 'A cancelled customer cannot buy a card');
            await col('customers').updateOne(
              { _id: input.customerId },
              { $set: { commerce_guard: randomUUID() } },
              { session },
            );
            if (await col('memberships').findOne({ customer_id: input.customerId }, { session }))
              refuse(
                409,
                'This customer already has a membership. Only one membership per customer is supported at launch.',
              );
            const edges = await col('referral_relationships')
                .find({ is_active: true }, { session })
                .toArray(),
              direct = edges
                .filter((row) => row.upline_staff_id === auth.userId)
                .map((row) => String(row.subject_staff_id)),
              downline = [
                auth.userId,
                ...direct,
                ...edges
                  .filter((row) => direct.includes(String(row.upline_staff_id)))
                  .map((row) => String(row.subject_staff_id)),
              ];
            const targetId = input.sellerStaffId ?? auth.userId,
              target = await col('staff_users').findOne({ _id: targetId }, { session }),
              role = await roleOf(targetId, session);
            const seller = resolveSeller({
              actorId: auth.userId,
              actorRole: auth.roleSlug,
              requestedSellerId: input.sellerStaffId,
              downlineIds: downline,
              target: target
                ? {
                    staffId: targetId,
                    roleSlug: String(role?.slug ?? ''),
                    status: String(target.status),
                  }
                : null,
            });
            if ('error' in seller) refuse(403, seller.error);
            const sellerId = 'staffId' in seller ? seller.staffId : refuse(403, 'Invalid seller');
            const scheme = resolveSchemeEconomics(
              {
                cashPrice: String(product!.cash_price),
                installmentPrice: product!.installment_price as string | null,
                reservationFee: product!.reservation_fee as string,
                spotCashDays: product!.spot_cash_days as number,
                standardInstallmentMonths: product!.standard_installment_months as number,
                validityYears: product!.validity_years as number,
                moveAEnabled: product!.move_a_enabled as boolean,
                moveB1Enabled: product!.move_b1_enabled as boolean,
                moveB2Enabled: product!.move_b2_enabled as boolean,
              },
              input.paymentScheme,
            );
            if ('error' in scheme) refuse(409, scheme.error);
            const date = timestamp.slice(0, 10),
              accredited = String(target?.activated_at ?? target?.created_at ?? '').slice(0, 10);
            const rules = await col('commission_rules')
              .find(
                {
                  is_active: true,
                  effective_from: { $lte: date },
                  $and: [
                    { $or: [{ effective_until: null }, { effective_until: { $gte: date } }] },
                    {
                      $or: [
                        { accredited_on_or_after: null },
                        { accredited_on_or_after: { $lte: accredited } },
                      ],
                    },
                    {
                      $or: [
                        { target_type: 'staff', target_id: sellerId },
                        { target_type: 'role', target_id: role?._id },
                      ],
                    },
                  ],
                },
                { session },
              )
              .toArray();
            const rule = rules.find((row) => row.target_type === 'staff') ?? rules[0],
              rate = String(rule?.rate ?? '0');
            const terms = snapshotSaleTerms({
              id: product!._id,
              isActive: true,
              cashPrice: String(product!.cash_price),
              minimumDownPayment: String(product!.minimum_down_payment),
              yearlyPoints: Number(product!.yearly_points),
              commissionRate: rate,
            });
            const schemeTerms = snapshotSchemeTerms(
                'economics' in scheme ? scheme.economics : refuse(409, 'Invalid scheme'),
              ),
              total = schemeTerms.schemeTotalSnapshot;
            const saleId = randomUUID(),
              saleNumber = await allocate('AF-CSALE', 'card_sales', 'sale_number', session),
              relationship = edges.find((row) => row.subject_staff_id === sellerId);
            const sale: MongoRow = {
              _id: saleId,
              sale_number: saleNumber,
              customer_id: input.customerId,
              plan_id: input.productId,
              seller_type: 'staff',
              seller_staff_id: sellerId,
              seller_ost_id: null,
              cash_price: total,
              cash_price_snapshot: total,
              minimum_down_payment_snapshot: terms.minimumDownPaymentSnapshot,
              payment_scheme: schemeTerms.paymentScheme,
              reservation_fee_snapshot: schemeTerms.reservationFeeSnapshot,
              required_initial_snapshot: schemeTerms.requiredInitialSnapshot,
              installment_months_snapshot: schemeTerms.installmentMonthsSnapshot,
              monthly_amount_snapshot: schemeTerms.monthlyAmountSnapshot,
              validity_months_snapshot: schemeTerms.validityMonthsSnapshot,
              yearly_points_snapshot: terms.yearlyPointsSnapshot,
              commission_rate_snapshot: rate,
              commission_rule_id: rule?._id ?? null,
              commission_base_snapshot: total,
              expected_commission_snapshot: calculateCommission(total, rate),
              status: 'submitted',
              submitted_at: timestamp,
              created_at: timestamp,
              updated_at: timestamp,
              balance_due_at: new Date(now.valueOf() + 365 * 86400000).toISOString(),
              referral_relationship_id: relationship?._id ?? null,
              created_by: auth.userId,
              origin: 'normal',
            };
            await col('card_sales').insertOne(sale, { session });
            await captureMongoSaleHierarchy(db, saleId, sellerId, timestamp, session);
            await col('commissions').insertOne(
              {
                _id: randomUUID(),
                commission_number: await allocate(
                  'AF-COM',
                  'commissions',
                  'commission_number',
                  session,
                ),
                sale_id: saleId,
                ost_id: null,
                beneficiary_type: 'staff',
                beneficiary_staff_id: sellerId,
                amount: sale.expected_commission_snapshot,
                rate_snapshot: rate,
                basis_amount_snapshot: total,
                commission_rule_id: rule?._id ?? null,
                status: 'pending',
                created_at: timestamp,
              },
              { session },
            );
            await audit(
              auth.userId,
              'APPLICATION_SUBMITTED',
              'card_sale',
              saleId,
              null,
              {
                saleNumber,
                customerId: input.customerId,
                productId: input.productId,
                sellerStaffId: sellerId,
                paymentScheme: schemeTerms.paymentScheme,
                frozenTotal: total,
                expectedCommission: sale.expected_commission_snapshot,
              },
              session,
            );
            return view(sale, session);
          }
          const payment =
            suffix === 'verify' ? await col('payments').findOne({ _id: id }, { session }) : null;
          if (suffix === 'verify' && !payment) refuse(404, 'Payment not found');
          const sale = await col('card_sales').findOne(
            { _id: String(payment?.sale_id ?? id) },
            { session },
          );
          if (!sale) refuse(404, 'Sale not found');
          await col('card_sales').updateOne(
            { _id: sale!._id },
            { $set: { commerce_guard: randomUUID() } },
            { session },
          );
          if (suffix === 'payments') {
            const input = recordPaymentSchema.parse(req.body),
              reference = clean(input.reference);
            if (!reference && !input.requestId)
              refuse(400, 'A request UUID is required for reference-less payments');
            const payload = {
                saleId: sale!._id,
                amount: input.amount,
                paymentType: input.paymentType,
                method: input.method.trim(),
                reference,
                notes: clean(input.notes),
                receiptStoragePath: clean(input.receiptStoragePath),
              },
              fingerprint = hash(JSON.stringify(payload));
            if (input.requestId) {
              const previous = await col('mutation_requests').findOne(
                { actor_id: auth.userId, operation: 'payment.create', request_id: input.requestId },
                { session },
              );
              if (previous) {
                if (previous.payload_hash !== fingerprint)
                  refuse(409, 'The request ID was already used with different details');
                return { id: previous.result_id };
              }
            }
            if (
              ['cancelled', 'active'].includes(String(sale!.status)) ||
              !sale!.cash_price_snapshot
            )
              refuse(409, 'Sale is not accepting payments');
            const paymentId = randomUUID();
            await col('payments').insertOne(
              {
                _id: paymentId,
                sale_id: sale!._id,
                customer_id: sale!.customer_id,
                amount: input.amount,
                payment_type: input.paymentType,
                method: input.method,
                reference,
                notes: clean(input.notes),
                receipt_storage_path: clean(input.receiptStoragePath),
                status: 'recorded',
                recorded_by: auth.userId,
                recorded_at: timestamp,
                verified_by: null,
                verified_at: null,
                rejection_reason: null,
                payment_number: await allocate('AF-PAY', 'payments', 'payment_number', session),
                origin: 'sale',
              },
              { session },
            );
            if (['draft', 'submitted', 'payment_pending', 'overdue'].includes(String(sale!.status)))
              await col('card_sales').updateOne(
                { _id: sale!._id },
                { $set: { status: 'payment_in_progress', updated_at: timestamp } },
                { session },
              );
            await audit(
              auth.userId,
              'PAYMENT_RECORDED',
              'payment',
              paymentId,
              null,
              {
                saleId: sale!._id,
                amount: input.amount,
                paymentType: input.paymentType,
                method: input.method,
                reference,
              },
              session,
            );
            if (input.requestId)
              await col('mutation_requests').insertOne(
                {
                  _id: randomUUID(),
                  actor_id: auth.userId,
                  operation: 'payment.create',
                  request_id: input.requestId,
                  payload_hash: fingerprint,
                  result_id: paymentId,
                  created_at: timestamp,
                },
                { session },
              );
            return { id: paymentId };
          }
          if (suffix === 'verify') {
            const input = verifyPaymentSchema.parse(req.body);
            if (payment!.status !== 'recorded' && payment!.status !== input.decision)
              refuse(409, 'Payment not pending');
            if (payment!.status === 'recorded') {
              await col('payments').updateOne(
                { _id: id },
                {
                  $set: {
                    status: input.decision,
                    verified_by: auth.userId,
                    verified_at: timestamp,
                    rejection_reason: input.decision === 'rejected' ? clean(input.reason) : null,
                  },
                },
                { session },
              );
              if (input.decision === 'verified' && !sale!.spot_cash_deadline) {
                sale!.spot_cash_started_at = sale!.spot_cash_started_at ?? timestamp;
                sale!.spot_cash_deadline = new Date(now.valueOf() + 7 * 86400000).toISOString();
                await col('card_sales').updateOne(
                  { _id: sale!._id },
                  {
                    $set: {
                      spot_cash_started_at: sale!.spot_cash_started_at,
                      spot_cash_deadline: sale!.spot_cash_deadline,
                      updated_at: timestamp,
                    },
                  },
                  { session },
                );
              }
              const totals = await summary(sale!, session);
              if (
                [
                  'draft',
                  'submitted',
                  'payment_pending',
                  'payment_in_progress',
                  'overdue',
                ].includes(String(sale!.status))
              ) {
                sale!.status = totals.fullyPaid ? 'payment_verified' : 'payment_in_progress';
                await col('card_sales').updateOne(
                  { _id: sale!._id },
                  {
                    $set: {
                      status: sale!.status,
                      ...(totals.fullyPaid
                        ? { payment_verified_at: timestamp, fully_paid_at: timestamp }
                        : {}),
                      updated_at: timestamp,
                    },
                  },
                  { session },
                );
              }
              if (totals.fullyPaid)
                await col('commissions').updateMany(
                  { sale_id: sale!._id, status: 'pending' },
                  { $set: { status: 'payment_verified' } },
                  { session },
                );
              await audit(
                auth.userId,
                input.decision === 'verified' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
                'payment',
                payment!._id,
                { status: 'recorded', amount: payment!.amount },
                { status: input.decision, reason: clean(input.reason) },
                session,
              );
              if (totals.fullyPaid)
                await audit(
                  auth.userId,
                  'SALE_FULLY_PAID',
                  'card_sale',
                  sale!._id,
                  null,
                  { verifiedTotal: totals.verifiedTotal, price: sale!.cash_price_snapshot },
                  session,
                );
            }
            const totals = await summary(sale!, session);
            return {
              saleId: sale!._id,
              status: sale!.status,
              verifiedTotal: totals.verifiedTotal,
              remainingBalance: totals.remainingBalance,
              fullyPaid: totals.fullyPaid,
              spotCashDeadline: sale!.spot_cash_deadline ?? null,
            };
          }
          if (suffix === 'activate') {
            const input = activateSaleSchema.parse(req.body ?? {}),
              existing = await col('memberships').findOne({ sale_id: sale!._id }, { session });
            if (existing)
              return {
                membershipId: existing._id,
                membershipNumber: existing.membership_number,
                fallbackCode: null,
                qrToken: null,
                pointsAllocated: Number(existing.yearly_points_allocated ?? 0),
                alreadyActive: true,
              };
            if (!['payment_verified', 'activation_pending'].includes(String(sale!.status)))
              refuse(409, 'Sale is not activatable from its current status');
            if (!sale!.cash_price_snapshot || !(await summary(sale!, session)).fullyPaid)
              refuse(409, 'Sale is not fully paid with verified payments');
            const applicationReservation = await col('reservation_agreements').findOne(
              { sale_id: sale!._id, origin: 'application' },
              { session },
            );
            if (applicationReservation) {
              const evidence = await col('purchase_document_evidence').findOne(
                { kind: 'purchase_finalized', source_id: sale!._id, revision: 1 },
                { session },
              );
              if (!applicationReservation.finalized_at || !evidence)
                refuse(409, 'Finalized application purchase evidence required');
            }
            const customer = await col('customers').findOne(
              { _id: String(sale!.customer_id) },
              { session },
            );
            if (!customer) refuse(404, 'Customer not found');
            await col('customers').updateOne(
              { _id: customer!._id },
              { $set: { commerce_guard: randomUUID() } },
              { session },
            );
            const plan = await col('card_plans').findOne(
                { _id: String(sale!.plan_id) },
                { session },
              ),
              config = await col('tier_points_config').findOne({ tier: plan?.code }, { session });
            if (!config || !Number.isSafeInteger(Number(config.annual_points_cap)))
              refuse(503, 'Points tier configuration is unavailable');
            await ensureMongoCustomerVipNumber(db, String(customer!._id), String(plan?.code), String(sale!.payment_scheme ?? 'spot_cash'), session);
            const months = Number(sale!.validity_months_snapshot ?? input.validityMonths);
            if (!Number.isInteger(months) || months <= 0) refuse(400, 'Invalid validity months');
            let number = '';
            for (let attempt = 0; attempt < 64; attempt++) {
              const text = randomBytes(16).toString('hex').toUpperCase(),
                candidate = `MBS-${text.match(/.{8}/g)!.join('-')}`;
              if (
                !(await col('memberships').findOne({ membership_number: candidate }, { session }))
              ) {
                number = candidate;
                break;
              }
            }
            if (!number) throw new Error('Membership number allocation failed');
            const fallback = `AFH-${randomBytes(4)
                .toString('hex')
                .toUpperCase()
                .replace(/^(.{4})(.{4})$/, '$1-$2')}`,
              qr = randomBytes(32).toString('base64'),
              membershipId = randomUUID(),
              accountId = randomUUID(),
              anchor = manilaDay(now),
              expires = addMonths(now, months).toISOString();
            await col('memberships').insertOne(
              {
                _id: membershipId,
                customer_id: sale!.customer_id,
                sale_id: sale!._id,
                membership_number: number,
                product_id: sale!.plan_id,
                fallback_code_hash: hash(fallback),
                qr_token_hash: hash(qr),
                status: 'active',
                points_balance: 0,
                yearly_points_allocated: 0,
                sale_status_at_activation: sale!.status,
                activated_by: auth.userId,
                activated_at: timestamp,
                expires_at: expires,
                renewal_due_at: expires,
                issued_at: timestamp,
                points_anniversary: anchor,
                card_issued_at: timestamp,
                card_issued_by: auth.userId,
                created_at: timestamp,
              },
              { session },
            );
            await col('points_accounts').insertOne(
              {
                _id: accountId,
                membership_id: membershipId,
                balance: 0,
                lifetime_allocated: 0,
                reversal_debt: 0,
                weekday_balance: 0,
                weekend_balance: 0,
                created_at: timestamp,
              },
              { session },
            );
            await col('points_periods').insertOne(
              {
                _id: randomUUID(),
                account_id: accountId,
                period_start: anchor,
                period_end: addMonths(new Date(`${anchor}T00:00:00Z`), 12)
                  .toISOString()
                  .slice(0, 10),
                tier: plan!.code,
                annual_points_cap: Number(config!.annual_points_cap),
                opening_balance: 0,
                status: 'open',
                created_at: timestamp,
              },
              { session },
            );
            await col('card_sales').updateOne(
              { _id: sale!._id },
              { $set: { status: 'active', activated_at: timestamp, updated_at: timestamp } },
              { session },
            );
            await col('customers').updateOne(
              { _id: customer!._id },
              { $set: { status: 'active', updated_at: timestamp } },
              { session },
            );
            await col('commissions').updateMany(
              { sale_id: sale!._id, status: 'payment_verified' },
              { $set: { status: 'final_qualification_pending' } },
              { session },
            );
            const documentEvidenceId = applicationReservation
              ? await createMongoPurchaseRecords(db).evidence(
                  'membership_activated',
                  membershipId,
                  auth.userId,
                  session,
                )
              : null;
            await audit(
              auth.userId,
              'MEMBERSHIP_ACTIVATED',
              'membership',
              membershipId,
              { saleStatus: sale!.status, customerStatus: 'prospect' },
              {
                saleId: sale!._id,
                membershipNumber: number,
                productId: sale!.plan_id,
                pointsAllocated: 0,
                expiresAt: expires,
                documentEvidenceId,
              },
              session,
            );
            activatedCustomer = customer!._id;
            return {
              membershipId,
              membershipNumber: number,
              fallbackCode: fallback,
              qrToken: qr,
              pointsAllocated: 0,
              alreadyActive: false,
            };
          }
          if (suffix === 'cancel') {
            const scope = await readScope(req);
            if (
              'error' in scope.auth ||
              (!scope.all && sale!.seller_staff_id !== scope.auth.userId)
            )
              refuse(404, 'Sale not found');
            if (
              sale!.status !== 'draft' ||
              (await col('payments').findOne(
                { sale_id: sale!._id, status: { $in: ['recorded', 'verified'] } },
                { session },
              )) ||
              (await col('memberships').findOne({ sale_id: sale!._id }, { session })) ||
              (await col('commissions').findOne(
                { sale_id: sale!._id, status: { $ne: 'cancelled' } },
                { session },
              ))
            )
              refuse(409, 'Sale cannot be cancelled');
            await col('card_sales').updateOne(
              { _id: sale!._id },
              { $set: { status: 'cancelled', updated_at: timestamp } },
              { session },
            );
            await audit(
              auth.userId,
              'SALE_CANCELLED',
              'sale',
              sale!._id,
              { status: 'draft' },
              { status: 'cancelled' },
              session,
            );
            return { cancelled: true };
          }
          throw new Error('Unsupported sale operation');
        });
        if (suffix === 'activate') {
          const base = result as { alreadyActive: boolean },
            onboarding: {
              status: string;
              emailStatus: string;
              token: string | null;
              activationUrl: string | null;
              expiresAt: string | null;
            } = {
              status: base.alreadyActive ? 'already_active' : 'not_issued',
              emailStatus: 'not_attempted',
              token: null,
              activationUrl: null,
              expiresAt: null,
            };
          if (!base.alreadyActive && activatedCustomer) {
            try {
              const issued = await activation.issue(activatedCustomer, auth.userId);
              Object.assign(onboarding, {
                status: 'manual_required',
                token: new URLSearchParams(new URL(issued.activationUrl).hash.slice(1)).get(
                  'token',
                ),
                activationUrl: issued.activationUrl,
                expiresAt: issued.expiresAt,
              });
            } catch {
              /* Financial activation is committed; token issuance may be retried through customer management. */
            }
          }
          return res.status(200).json({ ...result, onboarding });
        }
        return res.status(path === '' || suffix === 'payments' ? 201 : 200).json(result);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid sales request', 400);
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : error.status === 409
                ? 'CONFLICT'
                : 'VALIDATION_ERROR',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(
          res,
          'CONFLICT',
          'That sale, payment reference or membership already exists',
          409,
        );
      return fail(res, 'INTERNAL', 'Sales service is unavailable', 503);
    }
  };
}
