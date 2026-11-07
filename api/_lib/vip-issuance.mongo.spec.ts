import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  inspectMongoVipIssuances,
  installMongoVipIssuances,
  recordMongoVipIssuance,
  VIP_ISSUANCE_SETUP,
} from './vip-issuance.mongo.js';
import { allocateMongoVipCardNumber } from './customers.mongo.js';
import { manilaToday } from './sale-team.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
const number = (seq: number) =>
  `${manilaToday().replaceAll('-', '').slice(2)}${String(seq).padStart(5, '0')}G1C01S`;

it('plans read-only and backfills native numbers without changing administrators, then replays without duplicate audit', async () => {
  const replica = await createTestReplica({ timeoutMS: 15_000 });
  try {
    const customer = randomUUID(),
      actor = randomUUID(),
      owner = { _id: actor, email: 'synthetic-owner@example.invalid', protected: true };
    await replica.db.collection<MongoRow>('staff_users').insertOne(owner);
    await replica.db
      .collection<MongoRow>('customers')
      .insertOne({ _id: customer, vip_card_number: number(17) });
    await replica.db
      .collection<{ _id: string; seq: number }>('counters')
      .insertOne({ _id: 'vip-card-number', seq: 50 });
    const plan = await inspectMongoVipIssuances(replica.db);
    expect(plan).toMatchObject({
      ready: true,
      indexReady: false,
      enabled: false,
      minimumSequence: 50,
    });
    expect(
      (await replica.db.listCollections({ name: 'vip_card_number_issuances' }).toArray()).length,
    ).toBe(0);
    await expect(
      installMongoVipIssuances(replica.db, replica.client, actor, 'wrong'),
    ).rejects.toThrow('Reviewed');
    expect(
      await installMongoVipIssuances(replica.db, replica.client, actor, plan.digest),
    ).toMatchObject({ ready: true, backfilled: 1, sourceRecordsImported: 0 });
    expect(await replica.db.collection<MongoRow>('staff_users').findOne({ _id: actor })).toEqual(
      owner,
    );
    const replay = await inspectMongoVipIssuances(replica.db);
    expect(replay).toMatchObject({ enabled: true, indexReady: true, missing: [] });
    await installMongoVipIssuances(replica.db, replica.client, actor, replay.digest);
    expect(await replica.db.collection('audit_events').countDocuments()).toBe(1);
  } finally {
    await replica.stop();
  }
}, 15000);

it('never reallocates a retired number after customer deletion or counter reset, and rolls back reservations with the transaction', async () => {
  const replica = await createTestReplica(),
    session = replica.client.startSession();
  try {
    const retired = randomUUID(),
      next = randomUUID();
    await replica.db
      .collection<MongoRow>('vip_card_number_issuances')
      .insertOne({
        _id: 'historical',
        vip_card_number: number(1),
        source_customer_id: retired,
        recorded_at: new Date().toISOString(),
      });
    const plan = await inspectMongoVipIssuances(replica.db);
    await installMongoVipIssuances(replica.db, replica.client, randomUUID(), plan.digest);
    await replica.db
      .collection<MongoRow>('counters')
      .updateOne({ _id: 'vip-card-number' }, { $set: { seq: 0 } });
    const allocated = await session.withTransaction(() =>
      allocateMongoVipCardNumber(replica.db, 'GOLD', 'CASH', 1, session, next),
    );
    expect(allocated).toBe(number(2));
    expect(await replica.db.collection('vip_card_number_issuances').countDocuments()).toBe(2);
    await expect(
      session.withTransaction(() => recordMongoVipIssuance(replica.db, number(1), next, session)),
    ).rejects.toThrow('already issued');
    await expect(
      session.withTransaction(async () => {
        await allocateMongoVipCardNumber(replica.db, 'GOLD', 'CASH', 1, session, next);
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await replica.db.collection('vip_card_number_issuances').countDocuments()).toBe(2);
  } finally {
    await session.endSession();
    await replica.stop();
  }
}, 15000);

it('keeps the setup marker disabled and backfill empty if its audit fails, and never writes ledger rows before setup', async () => {
  const replica = await createTestReplica(),
    session = replica.client.startSession();
  try {
    await session.withTransaction(() =>
      recordMongoVipIssuance(replica.db, number(1), randomUUID(), session),
    );
    expect(
      (await replica.db.listCollections({ name: 'vip_card_number_issuances' }).toArray()).length,
    ).toBe(0);
    await replica.db
      .collection<MongoRow>('customers')
      .insertOne({ _id: randomUUID(), vip_card_number: number(8) });
    await replica.db.createCollection('audit_events', {
      validator: { action: { $ne: 'VIP_CARD_ISSUANCE_LEDGER_INITIALIZED' } },
    });
    const plan = await inspectMongoVipIssuances(replica.db);
    await expect(
      installMongoVipIssuances(replica.db, replica.client, randomUUID(), plan.digest),
    ).rejects.toThrow();
    expect(
      await replica.db.collection<MongoRow>('counters').findOne({ _id: VIP_ISSUANCE_SETUP }),
    ).toBeNull();
    expect(await replica.db.collection('vip_card_number_issuances').countDocuments()).toBe(0);
    expect((await inspectMongoVipIssuances(replica.db)).indexReady).toBe(true);
  } finally {
    await session.endSession();
    await replica.stop();
  }
}, 15000);
