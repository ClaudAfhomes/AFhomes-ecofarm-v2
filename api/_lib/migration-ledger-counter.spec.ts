import { expect, it } from 'vitest';
import { Long } from 'mongodb';
import { planMigrationLedgerCounter } from './migration-ledger-counter.js';
import { ledgerId } from './customer-points.mongo.js';
import { createTestReplica } from './testing/mongo-replica.js';

it('preserves exact int64 history and never lowers an existing native high-water mark', () => {
  expect(planMigrationLedgerCounter(['9007199254740993'], ['2'], '9007199254740994')).toMatchObject({ ready: true, counter: { seq: '9007199254740994' }, nextId: '9007199254740995' });
  expect(planMigrationLedgerCounter([], [], null)).toMatchObject({ ready: true, nextId: '1' });
  for (const value of ['01', '-1', '1.5', '9223372036854775808', '9223372036854775807']) expect(planMigrationLedgerCounter([value], [], null).ready).toBe(false);
});

it('allows the native allocator to append after imported IDs without modifying history', async () => {
  const replica = await createTestReplica(), session = replica.client.startSession();
  try {
    const imported = { _id: '9007199254740993', amount: 10, account_id: 'synthetic', balance_after: 10 };
    await replica.db.collection<typeof imported>('points_ledger').insertOne(imported);
    const plan = planMigrationLedgerCounter([imported._id], [], null);
    await replica.db.collection<{ _id: string; seq: Long }>('counters').updateOne({ _id: 'points-ledger' }, { $max: { seq: Long.fromString(plan.counter!.seq) } }, { upsert: true });
    const next = await session.withTransaction(() => ledgerId(replica.db, session));
    expect(next).toBe('9007199254740994');
    expect(await replica.db.collection<typeof imported>('points_ledger').findOne({ _id: imported._id })).toEqual(imported);
  } finally { await session.endSession(); await replica.stop(); }
}, 15_000);
