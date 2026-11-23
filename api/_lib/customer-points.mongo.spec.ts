import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  customerPointsLedgerSchema,
  pointsBalanceSummarySchema,
  customerCredentialsSchema,
} from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoCustomerPoints, setupMongoCustomerPoints } from './customer-points.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>;
let points: ReturnType<typeof createMongoCustomerPoints>;
const user = randomUUID(),
  customer = randomUUID(),
  membership = randomUUID(),
  account = randomUUID(),
  plan = randomUUID();
const clock = new Date('2026-10-25T12:00:00.000Z');
beforeAll(async () => {
  test = await createTestReplica();
  await setupMongoCustomerPoints(test.db);
  const col = (name: string) => test.db.collection<MongoRow>(name);
  await col('customers').insertOne({ _id: customer, auth_user_id: user, status: 'active' });
  await col('memberships').insertOne({
    _id: membership,
    customer_id: customer,
    status: 'active',
    product_id: plan,
    membership_number: 'SYNTHETIC-STABLE',
    activated_at: '2024-02-28T18:00:00.000Z',
    points_anniversary: '2024-02-29',
    points_balance: 500,
  });
  await col('card_plans').insertOne({ _id: plan, code: 'BRONZE' });
  await col('tier_points_config').insertOne({
    _id: randomUUID(),
    tier: 'BRONZE',
    annual_points_cap: 25000,
  });
  await col('points_accounts').insertOne({
    _id: account,
    membership_id: membership,
    balance: 500,
    reversal_debt: 30,
    weekday_balance: 370,
    weekend_balance: 100,
  });
  points = createMongoCustomerPoints(test.db, test.client, () => clock);
}, 120_000);
afterAll(async () => {
  await test?.stop();
});
it('opens the exact anniversary period once and separates cap, debt, reservation and stay allowances', async () => {
  const first = pointsBalanceSummarySchema.parse(await points.position(user, customer));
  expect(first).toMatchObject({
    balance: 500,
    annualCap: 25000,
    remainingEarningCapacity: 25000,
    spendable: 470,
    reversalDebt: 30,
    periodStart: '2026-02-28',
    periodEnd: '2027-02-28',
  });
  const period = await test.db.collection('points_periods').findOne({ account_id: account });
  await test.db.collection<MongoRow>('points_ledger').insertMany([
    {
      _id: '1000',
      account_id: account,
      origin_period_id: period!._id,
      amount: 20000,
      counts_toward_cap: true,
      entry_type: 'earned',
      balance_after: 500,
      created_at: clock.toISOString(),
    },
    {
      _id: '1001',
      account_id: account,
      origin_period_id: period!._id,
      amount: -100,
      entry_type: 'reversal',
      balance_after: 500,
      created_at: clock.toISOString(),
    },
  ]);
  await test.db
    .collection<{ _id: string; seq: number }>('counters')
    .updateOne({ _id: 'points-ledger' }, { $set: { seq: 1001 } }, { upsert: true });
  await test.db.collection<MongoRow>('redemption_quotes').insertMany([
    {
      _id: randomUUID(),
      account_id: account,
      status: 'open',
      reserved_at: clock.toISOString(),
      expires_at: '2027-01-01T00:00:00.000Z',
      points_requested: 50,
      weekday_points: 40,
      weekend_points: 10,
    },
    {
      _id: randomUUID(),
      account_id: account,
      status: 'open',
      reserved_at: clock.toISOString(),
      expires_at: '2025-01-01T00:00:00.000Z',
      points_requested: 999999,
    },
  ]);
  const [a, b] = await Promise.all([
    points.position(user, customer),
    points.position(user, customer),
  ]);
  expect(a).toMatchObject({
    spendable: 420,
    remainingEarningCapacity: 5000,
    earnedThisPeriod: 20000,
    redeemedThisPeriod: 100,
    weekdaySpendable: 330,
    weekendSpendable: 90,
  });
  expect(b).toEqual(a);
  expect(await test.db.collection('points_periods').countDocuments({ account_id: account })).toBe(
    1,
  );
});
it('pages numeric ledger IDs with tied timestamps without duplication or private fields', async () => {
  await test.db
    .collection<MongoRow>('points_ledger')
    .insertMany(
      Array.from({ length: 105 }, (_, index) => ({
        _id: String(index + 1),
        account_id: account,
        amount: 1,
        balance_after: 500,
        entry_type: 'earned',
        created_at: '2026-10-24T00:00:00.000Z',
        actor_id: 'PRIVATE',
        metadata: { private: true },
      })),
    );
  const first = customerPointsLedgerSchema.parse(await points.ledger(membership, {}));
  expect(first.data).toHaveLength(100);
  expect(first.meta?.nextCursor).toBeTruthy();
  const second = customerPointsLedgerSchema.parse(
    await points.ledger(membership, { cursor: first.meta!.nextCursor }),
  );
  expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(107);
  expect(JSON.stringify(first)).not.toContain('PRIVATE');
  await expect(points.ledger(membership, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
    status: 400,
  });
  await expect(points.ledger(membership, { entryType: { $ne: '' } })).rejects.toMatchObject({
    status: 400,
  });
});
it('rotates only hashes, preserves persistent identifiers, and denies other owners', async () => {
  const result = customerCredentialsSchema.parse(await points.rotate(user, customer));
  expect(result.fallbackCode).toMatch(/^AFH-[A-F0-9]{4}-[A-F0-9]{4}$/);
  const stored = await test.db.collection('memberships').findOne({ customer_id: customer });
  expect(stored?.membership_number).toBe('SYNTHETIC-STABLE');
  expect(stored?.qr_token_hash).toBe(createHash('sha256').update(result.qrToken).digest('hex'));
  expect(JSON.stringify(stored)).not.toContain(result.qrToken);
  await expect(points.rotate(randomUUID(), customer)).rejects.toMatchObject({ status: 403 });
  const next = await points.rotate(user, customer);
  expect(next.qrToken).not.toBe(result.qrToken);
});
it('resets an elapsed period atomically, preserves reversal debt, and never resets twice', async () => {
  clock.setUTCFullYear(2028);
  const first = await points.position(user, customer);
  expect(first).toMatchObject({
    balance: 0,
    spendable: 0,
    reversalDebt: 30,
    remainingEarningCapacity: 25000,
  });
  expect(await test.db.collection('points_accounts').findOne({ membership_id: membership })).toMatchObject({ balance: 0, weekday_balance: -21, weekend_balance: -9 });
  await points.position(user, customer);
  expect(
    await test.db
      .collection('points_ledger')
      .countDocuments({ account_id: account, entry_type: 'annual_reset' }),
  ).toBe(1);
  expect(
    (await test.db.collection('memberships').findOne({ customer_id: customer }))?.points_balance,
  ).toBe(0);
});
