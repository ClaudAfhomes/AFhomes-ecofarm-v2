import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import type { MongoRow } from './customer-activation.mongo.js';
import {
  planMongoPointAllowanceRepair,
  repairMongoPointAllowances,
} from './point-allowances-repair.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>;
const actor = randomUUID(),
  role = randomUUID();
const col = (name: string) => test.db.collection<MongoRow>(name);
beforeAll(async () => {
  test = await createTestReplica();
  await col('admin_bootstrap').insertOne({ _id: 'initial-super-admin', user_id: actor });
  await col('staff_users').insertOne({
    _id: actor,
    status: 'active',
    private_fixture: 'unchanged',
  });
  await col('roles').insertOne({ _id: role, slug: 'super_admin', is_active: true });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: actor,
    role_id: role,
  });
}, 30000);
afterAll(async () => test?.stop());
async function fixture() {
  const id = randomUUID(),
    membership = randomUUID(),
    entry = randomUUID();
  await col('memberships').insertOne({ _id: membership, points_balance: 200 });
  await col('points_accounts').insertOne({
    _id: id,
    membership_id: membership,
    balance: 200,
    reversal_debt: 0,
    weekday_balance: 63,
    weekend_balance: 7,
  });
  await col('points_ledger').insertOne({
    _id: entry,
    account_id: id,
    entry_type: 'adjustment',
    amount: 130,
    balance_before: 70,
    balance_after: 200,
    created_at: '2026-10-28T00:00:00.000Z',
  });
  return { id, membership, entry };
}
it('plans without writing, repairs from individual adjustments, preserves totals/history/owner and replays once', async () => {
  const { id, entry, membership } = await fixture();
  const owner = await col('staff_users').findOne({ _id: actor });
  expect(await planMongoPointAllowanceRepair(test.db, id)).toMatchObject({
    weekday: 154,
    weekend: 46,
  });
  expect((await col('points_accounts').findOne({ _id: id }))?.weekday_balance).toBe(63);
  const replies = await Promise.all([
    repairMongoPointAllowances(test.db, test.client, actor, id),
    repairMongoPointAllowances(test.db, test.client, actor, id),
  ]);
  expect(replies.map((r) => r?.repairedEntries).sort()).toEqual([0, 1]);
  expect(await col('points_accounts').findOne({ _id: id })).toMatchObject({
    balance: 200,
    reversal_debt: 0,
    weekday_balance: 154,
    weekend_balance: 46,
  });
  expect(await col('points_ledger').findOne({ _id: entry })).toMatchObject({
    amount: 130,
    balance_before: 70,
    balance_after: 200,
    weekday_delta: 91,
    weekend_delta: 39,
    created_at: '2026-10-28T00:00:00.000Z',
  });
  expect((await col('memberships').findOne({ _id: membership }))?.points_balance).toBe(200);
  expect(await col('staff_users').findOne({ _id: actor })).toEqual(owner);
  expect(await col('audit_events').countDocuments({ entity_id: id })).toBe(1);
});
it('rejects unknown history and unauthorized operators, and rolls back if audit fails', async () => {
  const { id, entry } = await fixture();
  await expect(repairMongoPointAllowances(test.db, test.client, randomUUID(), id)).rejects.toThrow(
    'owner required',
  );
  await col('points_ledger').updateOne({ _id: entry }, { $set: { entry_type: 'redemption' } });
  await expect(planMongoPointAllowanceRepair(test.db, id)).rejects.toThrow('separate review');
  await col('points_ledger').updateOne({ _id: entry }, { $set: { entry_type: 'adjustment' } });
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'POINT_ALLOWANCES_REPAIRED' } },
  });
  try {
    await expect(repairMongoPointAllowances(test.db, test.client, actor, id)).rejects.toThrow();
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect((await col('points_accounts').findOne({ _id: id }))?.weekday_balance).toBe(63);
  expect((await col('points_ledger').findOne({ _id: entry }))?.weekday_delta).toBeUndefined();
  await col('points_accounts').updateOne({ _id: id }, { $set: { balance: 201 } });
  await expect(planMongoPointAllowanceRepair(test.db, id)).rejects.toThrow('does not explain');
});
