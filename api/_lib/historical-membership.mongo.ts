import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Db } from 'mongodb';
import { addMoney, compareMoney } from '@afhomes/shared';
import { z } from 'zod';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoPurchaseRecords } from './purchase-records.mongo.js';
import { ensureMongoPointsPeriod, ledgerId } from './customer-points.mongo.js';
import { pointAllowanceChange, pointInteger } from './point-allowances.mongo.js';
import { manilaToday } from './sale-team.mongo.js';

const refuse = (message: string): never => {
  throw new CustomerActivationError(409, message);
};
const day = (value: unknown) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(String(value)));
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** The caller checks Finance activation permission and owns the source/sales write transaction. */
export async function restoreMongoHistoricalMembership(
  db: Db,
  row: MongoRow,
  saleId: string,
  actor: string,
  session: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    purchase = createMongoPurchaseRecords(db),
    raw = row.raw_data as Record<string, string>,
    sale = await purchase.required('card_sales', saleId, session);
  const link = await col('customer_import_source_rows').findOne({ row_id: row._id }, { session });
  const source =
    link &&
    (await col('customer_import_purchase_sources').findOne(
      { _id: String(link.source_id) },
      { session },
    ));
  if (
    sale.origin !== 'legacy_import' ||
    !source ||
    sale.import_row_id !== source.original_row_id ||
    sale.customer_id !== row.customer_id ||
    source.customer_id !== sale.customer_id
  )
    refuse('Historical membership purchase provenance conflicts');
  const payments = await col('payments')
    .find({ sale_id: saleId, status: 'verified' }, { session })
    .toArray();
  if (
    compareMoney(
      payments.reduce((sum, p) => addMoney(sum, String(p.amount)), '0.00'),
      String(sale.cash_price_snapshot),
    ) !== 0
  )
    refuse('Historical membership requires full verified settlement');
  const claimed =
      raw.existing_card_activation_status ||
      (raw.stated_status === 'Active VIP' ? 'Active' : raw.stated_status),
    status =
      claimed === 'Active'
        ? 'active'
        : claimed === 'Expired'
          ? 'expired'
          : claimed === 'Cancelled'
            ? 'cancelled'
            : 'suspended',
    activation = raw.existing_card_activation_date || null,
    expiry = raw.existing_card_valid_until || null,
    now = new Date().toISOString();
  const memberships = await col('memberships')
    .find({ customer_id: sale.customer_id }, { session })
    .toArray();
  if (memberships.length > 1) refuse('Multiple memberships require historical reconciliation');
  let membership = memberships[0];
  if (membership) {
    if (
      membership.sale_id !== saleId ||
      membership.status !== status ||
      (activation && activation !== day(membership.activated_at)) ||
      (expiry && expiry !== day(membership.expires_at))
    )
      refuse('Historical membership dates or status conflict');
  } else {
    if (
      !activation ||
      !expiry ||
      !z.iso.date().safeParse(activation).success ||
      !z.iso.date().safeParse(expiry).success
    )
      refuse('Historical activation and expiry dates are required');
    if (
      activation! > manilaToday() ||
      expiry! <= activation! ||
      (status === 'active' && expiry! <= manilaToday()) ||
      (status === 'expired' && expiry! > manilaToday())
    )
      refuse('Historical membership dates conflict');
    let number = '';
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = `MBS-${randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g)!.join('-')}`;
      if (!(await col('memberships').findOne({ membership_number: candidate }, { session }))) {
        number = candidate;
        break;
      }
    }
    if (!number) throw new Error('Membership identifier allocation failed');
    const activated = new Date(`${activation}T00:00:00+08:00`).toISOString(),
      expires = new Date(`${expiry}T00:00:00+08:00`).toISOString();
    membership = {
      _id: randomUUID(),
      customer_id: sale.customer_id,
      sale_id: saleId,
      membership_number: number,
      product_id: sale.plan_id,
      fallback_code_hash: hash(randomBytes(4)),
      qr_token_hash: hash(randomBytes(32)),
      status,
      points_balance: 0,
      yearly_points_allocated: 0,
      activated_by: actor,
      activated_at: activated,
      expires_at: expires,
      renewal_due_at: expires,
      issued_at: activated,
      points_anniversary: activation,
      sale_status_at_activation: sale.status,
      created_at: now,
    };
    await col('memberships').insertOne(membership, { session });
    await col('points_accounts').insertOne(
      {
        _id: randomUUID(),
        membership_id: membership._id,
        balance: 0,
        lifetime_allocated: 0,
        reversal_debt: 0,
        weekday_balance: 0,
        weekend_balance: 0,
        created_at: now,
      },
      { session },
    );
    await col('card_sales').updateOne(
      { _id: saleId },
      { $set: { status: 'active', activated_at: activated, updated_at: now } },
      { session },
    );
    await col('customers').updateOne(
      { _id: String(sale.customer_id) },
      {
        $set: {
          status: ['active', 'expired'].includes(status)
            ? 'active'
            : status === 'cancelled'
              ? 'cancelled'
              : 'suspended',
          updated_at: now,
        },
      },
      { session },
    );
  }
  const account = await col('points_accounts').findOne(
    { membership_id: membership!._id },
    { session },
  );
  if (!account) refuse('Historical points account is missing');
  if (status !== 'active' || !raw.existing_stay_points_total) return membership!._id;
  const points = pointInteger(raw.existing_stay_points_total);
  if (points < 0n || points > 1_000_000_000n) refuse('Historical remaining points are invalid');
  const baseline = await col('customer_import_points_baselines').findOne(
    { membership_id: membership!._id },
    { session },
  );
  if (baseline) {
    if (pointInteger(baseline.confirmed_points) !== points)
      refuse('Historical points baseline cannot change');
    return membership!._id;
  }
  const { period, balance } = await ensureMongoPointsPeriod(db, account!, membership!, session);
  pointAllowanceChange(account!, 0n);
  if (
    pointInteger(account!.reversal_debt) !== 0n ||
    (BigInt(balance) !== points &&
      (balance !== 0 ||
        (await col('points_ledger').findOne({ account_id: account!._id }, { session }))))
  )
    refuse('Existing points history requires reconciliation');
  await col('customer_import_points_baselines').insertOne(
    {
      _id: randomUUID(),
      membership_id: membership!._id,
      row_id: row._id,
      confirmed_points: Number(points),
      actor_id: actor,
      created_at: now,
    },
    { session },
  );
  if (balance === 0 && points > 0n) {
    const allowance = pointAllowanceChange(account!, points);
    await col('points_ledger').insertOne(
      {
        _id: await ledgerId(db, session),
        account_id: account!._id,
        entry_type: 'cutover_baseline',
        amount: Number(points),
        balance_before: 0,
        balance_after: Number(points),
        weekday_delta: allowance.weekday_delta,
        weekend_delta: allowance.weekend_delta,
        reference_type: 'customer_import',
        reference_id: row._id,
        actor_id: actor,
        reason: 'Confirmed remaining historical Stay Points',
        metadata: { importRowId: row._id, confirmedRemainingBalance: Number(points) },
        origin_period_id: period._id,
        counts_toward_cap: false,
        created_at: now,
      },
      { session },
    );
    await col('points_accounts').updateOne(
      { _id: account!._id },
      {
        $set: {
          balance: Number(points),
          weekday_balance: allowance.weekday_balance,
          weekend_balance: allowance.weekend_balance,
          updated_at: now,
          lifetime_allocated: Number(
            pointInteger(pointInteger(account!.lifetime_allocated) + points),
          ),
        },
      },
      { session },
    );
  }
  await col('memberships').updateOne(
    { _id: membership!._id },
    { $set: { points_balance: Number(points) } },
    { session },
  );
  await purchase.audit(
    actor,
    'HISTORICAL_MEMBERSHIP_RESTORED',
    'membership',
    membership!._id,
    null,
    { rowId: row._id, saleId, status, confirmedRemainingPoints: Number(points) },
    session,
  );
  return membership!._id;
}
