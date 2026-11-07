import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Long, type ClientSession, type Db, type MongoClient } from 'mongodb';
import { customerLedgerCursorSchema } from '@afhomes/contracts';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { pointAllowanceChange } from './point-allowances.mongo.js';

const number = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) throw new Error('Invalid persisted points');
  return parsed;
};
const date = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value ?? '');
const manilaDay = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
const anniversary = (anchor: string, years: number) => {
  const [year, month, day] = anchor.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year! + years, month!, 0)).getUTCDate();
  return `${year! + years}-${String(month).padStart(2, '0')}-${String(Math.min(day!, lastDay)).padStart(2, '0')}`;
};
export async function ledgerId(db: Db, session: ClientSession) {
  const counter = await db
    .collection<{ _id: string; seq: Long | number }>('counters')
    .findOneAndUpdate(
      { _id: 'points-ledger' },
      { $inc: { seq: Long.fromNumber(1) } },
      { upsert: true, returnDocument: 'after', session },
    );
  if (!counter) throw new Error('Ledger allocation failed');
  return String(counter.seq);
}
export async function setupMongoCustomerPoints(db: Db) {
  await db.collection('points_accounts').createIndex({ membership_id: 1 }, { unique: true });
  await db
    .collection('points_periods')
    .createIndex({ account_id: 1, period_start: 1 }, { unique: true });
  await db
    .collection('points_ledger')
    .createIndex(
      { account_id: 1, created_at: -1, _id: -1 },
      { collation: { locale: 'en', numericOrdering: true } },
    );
}

export function createMongoCustomerPoints(db: Db, client: MongoClient, now = () => new Date()) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const tx = async <T>(work: (session: ClientSession) => Promise<T>) => {
    const session = client.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  };
  const ownMembership = async (userId: string, customerId: string, session: ClientSession) => {
    const owner = await col('customers').findOne(
      { _id: customerId, auth_user_id: userId, status: 'active' },
      { session },
    );
    if (!owner) throw new CustomerActivationError(403, 'Active customer access required');
    await col('customers').updateOne(
      { _id: customerId },
      { $set: { points_guard: randomUUID() } },
      { session },
    );
    const membership = await col('memberships').findOne(
      { customer_id: customerId, status: 'active' },
      { session, sort: { activated_at: -1 } },
    );
    if (!membership) throw new CustomerActivationError(404, 'No active membership found');
    await col('memberships').updateOne(
      { _id: membership._id },
      { $set: { points_guard: randomUUID() } },
      { session },
    );
    return membership;
  };
  return {
    async position(userId: string, customerId: string) {
      return tx(async (session) => {
        const membership = await ownMembership(userId, customerId, session);
        const account = await col('points_accounts').findOne(
          { membership_id: membership._id },
          { session },
        );
        if (!account)
          return {
            membershipId: membership._id,
            balance: 0,
            annualCap: 0,
            remainingEarningCapacity: 0,
            spendable: 0,
            reversalDebt: 0,
            periodStart: '',
            periodEnd: '',
            tier: 'BRONZE',
            earnedThisPeriod: 0,
            redeemedThisPeriod: 0,
          };
        await col('points_accounts').updateOne(
          { _id: account._id },
          { $set: { points_guard: randomUUID() } },
          { session },
        );
        const { period, balance } = await ensureMongoPointsPeriod(db, account, membership, session, now);
        const ledger = await col('points_ledger')
          .find({ account_id: account._id, origin_period_id: period._id }, { session })
          .toArray();
        let earned = 0n,
          redeemed = 0n;
        for (const entry of ledger) {
          const amount = BigInt(number(entry.amount));
          if (entry.counts_toward_cap && amount > 0n) earned += amount;
          if (['redemption', 'reversal', 'expiration'].includes(String(entry.entry_type)))
            redeemed -= amount;
        }
        const quotes = await col('redemption_quotes')
          .find(
            {
              account_id: account._id,
              status: 'open',
              reserved_at: { $ne: null },
              $expr: { $gt: [{ $toDate: '$expires_at' }, now()] },
            },
            { session },
          )
          .toArray();
        const reserved = quotes.reduce(
          (total, quote) => total + BigInt(number(quote.points_requested)),
          0n,
        );
        const max = (value: bigint) => number(value < 0n ? 0n : value);
        const debt = number(account.reversal_debt),
          spendable = max(BigInt(balance) - BigInt(debt) - reserved);
        const plan = await col('card_plans').findOne(
          { _id: String(membership.product_id) },
          { session },
        );
        const cap = number(period.annual_points_cap);
        const weekday = quotes.reduce(
          (total, quote) => total + BigInt(number(quote.weekday_points)),
          0n,
        );
        const weekend = quotes.reduce(
          (total, quote) => total + BigInt(number(quote.weekend_points)),
          0n,
        );
        const allowance = (value: unknown, reserved: bigint) =>
          Math.min(max(BigInt(number(value)) - reserved), spendable);
        return {
          membershipId: membership._id,
          balance,
          annualCap: cap,
          remainingEarningCapacity: max(BigInt(cap) - earned),
          spendable,
          reversalDebt: debt,
          periodStart: period.period_start,
          periodEnd: period.period_end,
          tier: plan?.code ?? 'BRONZE',
          earnedThisPeriod: number(earned),
          redeemedThisPeriod: number(redeemed),
          weekdaySpendable: allowance(account.weekday_balance, weekday),
          weekendSpendable: allowance(account.weekend_balance, weekend),
        };
      });
    },
    async ledger(membershipId: string, query: Record<string, unknown>) {
      const account = await col('points_accounts').findOne(
        { membership_id: membershipId },
        { projection: { _id: 1 } },
      );
      if (!account) return { data: [], meta: { nextCursor: null } };
      if (query.entryType !== undefined && query.entryType !== 'redemption')
        throw new CustomerActivationError(400, 'Invalid history filter.');
      let cursor: { occurredAt: string; id: string } | undefined;
      if (query.cursor !== undefined) {
        try {
          if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor))
            throw new Error();
          cursor = customerLedgerCursorSchema.parse(
            JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
          );
          if (BigInt(cursor.id) > 9223372036854775807n) throw new Error();
        } catch {
          throw new CustomerActivationError(400, 'Invalid history cursor.');
        }
      }
      const entries = await col('points_ledger')
        .find(
          {
            account_id: account._id,
            ...(query.entryType ? { entry_type: 'redemption' } : {}),
            ...(cursor
              ? {
                  $or: [
                    { created_at: { $lt: cursor.occurredAt } },
                    { created_at: cursor.occurredAt, _id: { $lt: cursor.id } },
                  ],
                }
              : {}),
          },
          {
            projection: {
              _id: 1,
              entry_type: 1,
              amount: 1,
              balance_after: 1,
              reason: 1,
              created_at: 1,
              reference_type: 1,
              reference_id: 1,
            },
          },
        )
        .collation({ locale: 'en', numericOrdering: true })
        .sort({ created_at: -1, _id: -1 })
        .limit(101)
        .toArray();
      const page = entries.slice(0, 100),
        last = page.at(-1);
      return {
        data: page.map((entry) => ({
          id: entry._id,
          entryType: entry.entry_type,
          amount: number(entry.amount),
          balanceAfter: number(entry.balance_after),
          reason: entry.reason ?? null,
          occurredAt: date(entry.created_at),
          ...(entry.reference_type === 'point_refund' && typeof entry.reference_id === 'string'
            ? { referenceNumber: entry.reference_id }
            : {}),
        })),
        meta: {
          nextCursor:
            entries.length > 100 && last
              ? Buffer.from(
                  JSON.stringify({ occurredAt: date(last.created_at), id: last._id }),
                ).toString('base64url')
              : null,
        },
      };
    },
    async rotate(userId: string, customerId: string) {
      const raw = randomBytes(4).toString('hex').toUpperCase();
      const fallbackCode = `AFH-${raw.slice(0, 4)}-${raw.slice(4)}`,
        qrToken = randomBytes(32).toString('base64');
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      return tx(async (session) => {
        const membership = await ownMembership(userId, customerId, session);
        await col('memberships').updateOne(
          { _id: membership._id, customer_id: customerId, status: 'active' },
          { $set: { fallback_code_hash: hash(fallbackCode), qr_token_hash: hash(qrToken) } },
          { session },
        );
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: userId,
            action: 'CUSTOMER_CREDENTIALS_REISSUED',
            entity_type: 'membership',
            entity_id: membership._id,
            before_data: { previousCodesInvalidated: true },
            after_data: { membershipNumber: membership.membership_number, selfService: true },
            created_at: now().toISOString(),
          },
          { session },
        );
        return {
          membershipId: membership._id,
          membershipNumber: membership.membership_number,
          fallbackCode,
          qrToken,
          issuedAt: now().toISOString(),
          previousCodesInvalidated: true,
        };
      });
    },
  };
}

export async function ensureMongoPointsPeriod(
  db: Db,
  account: MongoRow,
  membership: MongoRow,
  session: ClientSession,
  now = () => new Date(),
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const today = manilaDay(now());
  const anchor =
    typeof membership.points_anniversary === 'string'
      ? membership.points_anniversary
      : membership.activated_at
        ? manilaDay(new Date(date(membership.activated_at)))
        : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error('Points anniversary is missing');
  let period = await col('points_periods').findOne(
    { account_id: account._id, period_start: { $lte: today }, period_end: { $gt: today } },
    { session },
  );
  let balance = number(account.balance);
  if (!period) {
    const elapsed = await col('points_periods')
      .find({ account_id: account._id, period_end: { $lte: today }, status: 'open' }, { session })
      .sort({ period_start: -1 })
      .toArray();
    for (const old of elapsed) {
      const allowances = pointAllowanceChange(account, -BigInt(balance), true);
      await col('points_periods').updateOne(
        { _id: old._id },
        {
          $set: {
            status: 'reset',
            closing_balance: balance,
            reset_at: now().toISOString(),
            reset_source: 'automatic',
            reset_actor_id: null,
          },
        },
        { session },
      );
      if (balance > 0)
        await col('points_ledger').insertOne(
          {
            _id: await ledgerId(db, session),
            account_id: account._id,
            entry_type: 'annual_reset',
            amount: -balance,
            weekday_delta: allowances.weekday_delta,
            weekend_delta: allowances.weekend_delta,
            balance_before: balance,
            balance_after: 0,
            origin_period_id: old._id,
            counts_toward_cap: false,
            reason: 'Annual reset: unused points do not roll over',
            created_at: now().toISOString(),
          },
          { session },
        );
      balance = 0;
      await col('points_accounts').updateOne(
        { _id: account._id },
        {
          $set: {
            balance: 0,
            weekday_balance: allowances.weekday_balance,
            weekend_balance: allowances.weekend_balance,
            updated_at: now().toISOString(),
          },
        },
        { session },
      );
      Object.assign(account, {
        balance: 0,
        weekday_balance: allowances.weekday_balance,
        weekend_balance: allowances.weekend_balance,
      });
      await col('memberships').updateOne(
        { _id: membership._id },
        { $set: { points_balance: 0 } },
        { session },
      );
    }
    let index = Number(today.slice(0, 4)) - Number(anchor.slice(0, 4));
    if (anniversary(anchor, index) > today) index--;
    const plan = await col('card_plans').findOne(
      { _id: String(membership.product_id) },
      { session },
    );
    const config = await col('tier_points_config').findOne({ tier: plan?.code }, { session });
    if (!plan || !config) throw new Error('Points tier configuration is unavailable');
    period = {
      _id: randomUUID(),
      account_id: account._id,
      period_start: anniversary(anchor, index),
      period_end: anniversary(anchor, index + 1),
      tier: plan.code,
      annual_points_cap: number(config.annual_points_cap),
      opening_balance: balance,
      status: 'open',
    };
    await col('points_periods').insertOne(period, { session });
  }

  return { period, balance };
}
