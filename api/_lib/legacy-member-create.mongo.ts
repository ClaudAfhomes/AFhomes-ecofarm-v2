import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Db } from 'mongodb';
import { addMoney, compareMoney } from '@afhomes/shared';
import type { NormalizedImportRow } from './customer-import.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { allocatePurchaseId } from './purchase-records.mongo.js';
import { ensureMongoPointsPeriod, ledgerId } from './customer-points.mongo.js';
import { pointAllowanceChange, pointInteger } from './point-allowances.mongo.js';
import { ensureMongoCustomerVipNumber } from './customers.mongo.js';

const refuse = (message: string): never => {
  throw new CustomerActivationError(409, message);
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Reviewed flat legacy CREATE only. Caller revalidates the row and holds the write transaction. */
export async function createMongoLegacyPurchase(
  db: Db,
  row: MongoRow,
  n: NormalizedImportRow,
  customerId: string,
  actor: string,
  seller: string | null,
  session: ClientSession,
) {
  const col = (table: string) => db.collection<MongoRow>(table),
    now = new Date().toISOString();
  const plan = await col('card_plans').findOne({ code: n.tier, is_active: true }, { session });
  if (!plan || !n.payment || (n.requireMember && !n.historicalSaleTotal))
    refuse('Legacy purchase requires a registered plan and historical payment facts');
  const payment = n.payment!,
    total = addMoney(n.historicalSaleTotal || String(plan!.cash_price), '0.00'),
    fullyPaid = compareMoney(payment.amount, total) === 0;
  if (
    compareMoney(total, '0.00') <= 0 ||
    compareMoney(payment.amount, '0.00') <= 0 ||
    compareMoney(payment.amount, total) > 0 ||
    (n.requireMember && !fullyPaid)
  )
    refuse('Legacy settlement must match its frozen total; membership requires full payment');
  const recorded = new Date(`${payment.date}T00:00:00.000Z`);
  if (!Number.isFinite(recorded.valueOf()) || recorded.valueOf() > Date.now() || !payment.method)
    refuse('Actual historical payment date and method are required');
  const saleId = randomUUID(),
    membershipId = randomUUID(),
    accountId = randomUUID();
  const reservation = addMoney(n.historicalReservationFee || '0', '0.00'),
    initial = addMoney(n.historicalRequiredInitial || '0', '0.00');
  await col('card_sales').insertOne(
    {
      _id: saleId,
      sale_number: await allocatePurchaseId(db, 'AF-CSALE', 'card_sales', 'sale_number', session),
      customer_id: customerId,
      plan_id: plan!._id,
      seller_type: 'staff',
      seller_staff_id: seller,
      cash_price: total,
      cash_price_snapshot: total,
      minimum_down_payment_snapshot: initial,
      yearly_points_snapshot: plan!.yearly_points,
      payment_scheme: n.paymentScheme,
      reservation_fee_snapshot: reservation,
      required_initial_snapshot: initial,
      validity_months_snapshot: Number(plan!.validity_years) * 12,
      commission_rate_snapshot: '0',
      expected_commission_snapshot: '0.00',
      status: n.requireMember ? 'active' : fullyPaid ? 'payment_verified' : 'payment_in_progress',
      submitted_at: now,
      payment_verified_at: fullyPaid ? now : null,
      activated_at: n.requireMember ? now : null,
      balance_due_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      created_by: actor,
      origin: 'legacy_import',
      import_job_id: row.import_job_id,
      import_row_id: row._id,
      created_at: now,
      updated_at: now,
    },
    { session },
  );
  await col('payments').insertOne(
    {
      _id: randomUUID(),
      payment_number: await allocatePurchaseId(db, 'AF-PAY', 'payments', 'payment_number', session),
      sale_id: saleId,
      customer_id: customerId,
      origin: 'sale',
      amount: addMoney(payment.amount, '0.00'),
      method: payment.method,
      reference: payment.reference,
      payment_type: 'full',
      status: 'verified',
      recorded_by: actor,
      verified_by: actor,
      recorded_at: recorded.toISOString(),
      verified_at: now,
      notes: 'Legacy import',
      created_at: now,
    },
    { session },
  );
  if (!n.requireMember) return { saleId, membershipId: null };
  const activation = n.activationDate
    ? new Date(`${n.activationDate}T00:00:00.000Z`)
    : new Date(now);
  const expiry = n.expiresAt ? new Date(`${n.expiresAt}T00:00:00.000Z`) : new Date(activation);
  if (!n.expiresAt) {
    const day = expiry.getUTCDate(),
      years = Number(plan!.validity_years);
    if (!Number.isSafeInteger(years) || years <= 0) refuse('Legacy plan validity requires review');
    expiry.setUTCDate(1);
    expiry.setUTCFullYear(expiry.getUTCFullYear() + years);
    const last = new Date(
      Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
    ).getUTCDate();
    expiry.setUTCDate(Math.min(day, last));
  }
  if (
    !Number.isFinite(activation.valueOf()) ||
    activation.valueOf() > Date.now() ||
    !Number.isFinite(expiry.valueOf()) ||
    expiry <= activation
  )
    refuse('Legacy membership dates require review');
  if (!['active', 'suspended', 'expired'].includes(n.memberStatus))
    refuse('Legacy member status requires review');
  let number = n.membershipNumber;
  for (let attempt = 0; !number && attempt < 64; attempt++) {
    const candidate = `MBS-${randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g)!.join('-')}`;
    if (!(await col('memberships').findOne({ membership_number: candidate }, { session })))
      number = candidate;
  }
  if (
    !number ||
    (await col('memberships').findOne(
      { $or: [{ membership_number: number }, { customer_id: customerId }] },
      { session },
    ))
  )
    refuse('Legacy member identity is already in use');
  const points = pointInteger(n.openingBalance);
  if (points < 0n || points > 1_000_000_000n) refuse('Legacy opening points require review');
  const member: MongoRow = {
    _id: membershipId,
    customer_id: customerId,
    sale_id: saleId,
    membership_number: number,
    product_id: plan!._id,
    fallback_code_hash: hash(randomBytes(4)),
    qr_token_hash: hash(randomBytes(32)),
    status: n.memberStatus,
    points_balance: Number(points),
    yearly_points_allocated: plan!.yearly_points,
    sale_status_at_activation: 'payment_verified',
    activated_by: actor,
    activated_at: activation.toISOString(),
    expires_at: expiry.toISOString(),
    renewal_due_at: expiry.toISOString(),
    issued_at: now,
    points_anniversary: activation.toISOString().slice(0, 10),
    created_at: now,
  };
  await col('memberships').insertOne(member, { session });
  const account: MongoRow = {
    _id: accountId,
    membership_id: membershipId,
    balance: 0,
    lifetime_allocated: Number(points),
    reversal_debt: 0,
    weekday_balance: 0,
    weekend_balance: 0,
    created_at: now,
  };
  await col('points_accounts').insertOne(account, { session });
  const { period } = await ensureMongoPointsPeriod(db, account, member, session);
  const allowance = pointAllowanceChange(account, points);
  await col('points_accounts').updateOne(
    { _id: accountId },
    {
      $set: {
        balance: Number(points),
        weekday_balance: allowance.weekday_balance,
        weekend_balance: allowance.weekend_balance,
      },
    },
    { session },
  );
  if (points > 0n)
    await col('points_ledger').insertOne(
      {
        _id: await ledgerId(db, session),
        account_id: accountId,
        entry_type: 'adjustment',
        amount: Number(points),
        balance_before: 0,
        balance_after: Number(points),
        weekday_delta: allowance.weekday_delta,
        weekend_delta: allowance.weekend_delta,
        origin_period_id: period._id,
        counts_toward_cap: false,
        reference_type: 'customer_import',
        reference_id: row.import_job_id,
        actor_id: actor,
        reason: 'Imported opening balance',
        created_at: now,
      },
      { session },
    );
  await ensureMongoCustomerVipNumber(
    db,
    customerId,
    String(n.tier),
    String(n.paymentScheme),
    session,
  );
  return { saleId, membershipId };
}
