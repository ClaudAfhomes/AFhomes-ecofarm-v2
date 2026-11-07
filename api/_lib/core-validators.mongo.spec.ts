import { Long, type Db } from 'mongodb';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mongoCoreValidators, inspectMongoCoreValidators } from './core-validators.mongo.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { installTestCoreValidators } from './testing/core-validators.js';
import type { MongoRow } from './customer-activation.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
const col = (name: string) => test.db.collection<MongoRow>(name);
beforeAll(async () => {
  test = await createTestReplica();
}, 30000);
afterAll(async () => {
  await test?.stop();
});

const valid = {
  card_sales: {
    _id: 'sale',
    customer_id: 'customer',
    plan_id: 'plan',
    status: 'active',
    cash_price_snapshot: '9007199254740993.01',
  },
  payments: { _id: 'payment', sale_id: 'sale', amount: '9007199254740993.01', status: 'verified' },
  memberships: {
    _id: 'member',
    customer_id: 'customer',
    sale_id: 'sale',
    status: 'active',
    points_balance: 100,
  },
  points_accounts: {
    _id: 'account',
    membership_id: 'member',
    balance: 100,
    weekday_balance: 70,
    weekend_balance: 30,
  },
  points_ledger: {
    _id: '1',
    account_id: 'account',
    amount: -30,
    weekday_delta: -21,
    weekend_delta: -9,
    balance_before: 130,
    balance_after: 100,
  },
  commissions: {
    _id: 'commission',
    sale_id: 'sale',
    status: 'pending',
    amount: '0.00',
    rate_snapshot: '0.0400',
  },
};

it('reports absent collections without initializing schema, and refuses another database scope', async () => {
  const before = await test.db.listCollections().toArray();
  const listing = vi.spyOn(test.db, 'listCollections');
  const plan = await inspectMongoCoreValidators(test.db);
  expect(listing).toHaveBeenCalledWith({}, { nameOnly: false });
  listing.mockRestore();
  expect(plan.readyForReview).toBe(false);
  expect(plan.collections).toHaveLength(6);
  expect(plan.collections.every((row) => row.state === 'absent')).toBe(true);
  expect(await test.db.listCollections().toArray()).toEqual(before);
  await expect(installTestCoreValidators(test.db)).rejects.toThrow('compatible');
  const remote = {
    client: { options: { hosts: [{ host: 'remote.example.invalid' }] } },
  } as unknown as Db;
  await expect(installTestCoreValidators(remote)).rejects.toThrow('loopback');
  await expect(inspectMongoCoreValidators(test.client.db('other'))).rejects.toThrow('afhomes_dev');
});

it('counts incompatible legacy records without returning values or changing documents or options', async () => {
  await col('payments').insertOne({ ...valid.payments, amount: 12.5, private_note: 'Synthetic private review note' });
  const before = await col('payments').find().toArray();
  const options = await test.db.listCollections({ name: 'payments' }).toArray();
  const plan = await inspectMongoCoreValidators(test.db);
  expect(plan.collections.find((row) => row.collection === 'payments')).toMatchObject({
    state: 'missing',
    invalidDocuments: 1,
    checkedDocuments: 1,
  });
  expect(plan.readyForReview).toBe(false);
  expect(JSON.stringify(plan)).not.toContain('Synthetic private review note');
  expect(await col('payments').find().toArray()).toEqual(before);
  expect(await test.db.listCollections({ name: 'payments' }).toArray()).toEqual(options);
  await col('payments').deleteMany({});
});

it('enforces exact money, canonical states and safe integer points while retaining historical fields', async () => {
  for (const [collection, validator] of Object.entries(mongoCoreValidators())) {
    if (!(await test.db.listCollections({ name: collection }).hasNext()))
      await test.db.createCollection(collection);
    await test.db.command({
      collMod: collection,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await col(collection).insertOne({
      ...valid[collection as keyof typeof valid],
      historical_snapshot: { source: 'Retained synthetic value' },
    });
  }
  const cases = [
    ['payments', { ...valid.payments, amount: 12.5 }],
    ['payments', { ...valid.payments, amount: '1e3' }],
    ['payments', { ...valid.payments, amount: '-1.00' }],
    ['payments', { ...valid.payments, amount: null }],
    ['payments', { ...valid.payments, status: 'approved' }],
    ['card_sales', { ...valid.card_sales, cash_price_snapshot: '1.001' }],
    ['memberships', { ...valid.memberships, points_balance: -1 }],
    ['points_accounts', { ...valid.points_accounts, balance: 0.5 }],
    ['points_accounts', { ...valid.points_accounts, balance: Long.fromString('9007199254740992') }],
    ['points_accounts', { ...valid.points_accounts, reversal_debt: -1 }],
    ['points_ledger', { ...valid.points_ledger, amount: 0.5 }],
    ['points_ledger', { ...valid.points_ledger, balance_after: -1 }],
    ['commissions', { ...valid.commissions, rate_snapshot: '0.00001' }],
  ] as const;
  for (const [collection, row] of cases)
    await expect(col(collection).insertOne({ ...row, _id: 'invalid' })).rejects.toMatchObject({
      code: 121,
    });
  await test.db.collection('points_accounts').updateOne(
    { _id: 'account' as never },
    {
      $set: {
        balance: Number.MAX_SAFE_INTEGER,
        weekday_balance: -10,
        weekend_balance: Number.MAX_SAFE_INTEGER,
      },
    },
  );
  await col('payments').insertOne({ ...valid.payments, _id: 'integer-money', amount: '0' });
  const plan = await inspectMongoCoreValidators(test.db);
  expect(plan.readyForReview).toBe(true);
  expect(
    plan.collections.every((row) => row.state === 'matching' && row.invalidDocuments === 0),
  ).toBe(true);
  expect((await inspectMongoCoreValidators(test.db)).digest).toBe(plan.digest);
});

it('does not treat warning/off validation or a different rule as equivalent protection', async () => {
  const validator = mongoCoreValidators().payments;
  for (const patch of [
    { validationAction: 'warn' },
    { validationLevel: 'off' },
    { validator: { amount: { $type: 'string' } } },
  ]) {
    await test.db.command({
      collMod: 'payments',
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
      ...patch,
    });
    const plan = await inspectMongoCoreValidators(test.db);
    expect(plan.collections.find((row) => row.collection === 'payments')?.state).toBe('conflict');
    expect(plan.readyForReview).toBe(false);
  }
  await test.db.command({
    collMod: 'payments',
    validator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
});

it('rejects invalid updates and rolls back the whole transaction, including earlier audit writes', async () => {
  await test.db.createCollection('validator_test_audit');
  const session = test.client.startSession();
  try {
    await expect(
      session.withTransaction(async () => {
        await test.db
          .collection('validator_test_audit')
          .insertOne({ action: 'Synthetic validation probe' }, { session });
        await test.db
          .collection('payments')
          .updateOne({ _id: 'payment' as never }, { $set: { amount: 1.25 } }, { session });
      }),
    ).rejects.toMatchObject({ code: 121 });
    expect(await test.db.collection('validator_test_audit').countDocuments()).toBe(0);
    expect((await col('payments').findOne({ _id: 'payment' as never }))?.amount).toBe(
      valid.payments.amount,
    );
  } finally {
    await session.endSession();
  }
});
