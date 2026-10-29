import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import type { MongoRow } from './customer-activation.mongo.js';
import { pointInteger, splitPointAllowance } from './point-allowances.mongo.js';

/** Operator-only plan; never mounted in a request or startup path. */
export async function planMongoPointAllowanceRepair(
  db: Db,
  accountId: string,
  session?: ClientSession,
) {
  const account = await db
    .collection<MongoRow>('points_accounts')
    .findOne({ _id: accountId }, { session });
  if (!account) throw new Error('Points account required');
  const ledger = await db
    .collection<MongoRow>('points_ledger')
    .find({ account_id: accountId }, { session })
    .toArray();
  const missing = ledger.filter((row) => row.weekday_delta == null || row.weekend_delta == null);
  if (
    missing.some(
      (row) =>
        row.entry_type !== 'adjustment' || row.weekday_delta != null || row.weekend_delta != null,
    )
  )
    throw new Error('Unattributed history requires separate review');
  const entries = missing.map((row) => ({
    id: row._id,
    ...splitPointAllowance(pointInteger(row.amount)),
  }));
  const weekday = entries.reduce(
    (sum, row) => sum + row.weekday,
    pointInteger(account.weekday_balance),
  );
  const weekend = entries.reduce(
    (sum, row) => sum + row.weekend,
    pointInteger(account.weekend_balance),
  );
  if (weekday + weekend !== pointInteger(account.balance) - pointInteger(account.reversal_debt))
    throw new Error('Adjustment history does not explain the account discrepancy');
  return {
    account,
    entries,
    weekday: Number(pointInteger(weekday)),
    weekend: Number(pointInteger(weekend)),
  };
}

export async function repairMongoPointAllowances(
  db: Db,
  client: MongoClient,
  actorId: string,
  accountId: string,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    session = client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        const owner = await col('admin_bootstrap').findOne(
          { _id: 'initial-super-admin', user_id: actorId },
          { session },
        );
        const staff = await col('staff_users').findOne(
          { _id: actorId, status: 'active' },
          { session },
        );
        const assignment = await col('staff_role_assignments').findOne(
          { staff_id: actorId },
          { session },
        );
        const role =
          assignment &&
          (await col('roles').findOne(
            { _id: String(assignment.role_id), slug: 'super_admin', is_active: true },
            { session },
          ));
        if (!owner || !staff || !role) throw new Error('Existing active bootstrap owner required');
        const account = await col('points_accounts').findOne({ _id: accountId }, { session });
        if (!account) throw new Error('Points account required');
        const member = await col('memberships').updateOne(
          { _id: String(account.membership_id) },
          { $set: { points_guard: randomUUID() } },
          { session },
        );
        if (member.matchedCount !== 1) throw new Error('Membership required');
        const plan = await planMongoPointAllowanceRepair(db, accountId, session);
        if (!plan.entries.length) return { repairedEntries: 0 };
        const timestamp = new Date().toISOString();
        for (const row of plan.entries) {
          const updated = await col('points_ledger').updateOne(
            { _id: row.id, weekday_delta: null, weekend_delta: null },
            {
              $set: {
                weekday_delta: Number(row.weekday),
                weekend_delta: Number(row.weekend),
                allowance_repaired_at: timestamp,
              },
            },
            { session },
          );
          if (updated.matchedCount !== 1) throw new Error('Adjustment changed; review again');
        }
        await col('points_accounts').updateOne(
          { _id: accountId },
          { $set: { weekday_balance: plan.weekday, weekend_balance: plan.weekend } },
          { session },
        );
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: actorId,
            action: 'POINT_ALLOWANCES_REPAIRED',
            entity_type: 'points_account',
            entity_id: accountId,
            before_data: {
              weekday: plan.account.weekday_balance ?? 0,
              weekend: plan.account.weekend_balance ?? 0,
            },
            after_data: {
              weekday: plan.weekday,
              weekend: plan.weekend,
              ledgerIds: plan.entries.map((row) => row.id),
            },
            reason:
              'Restore missing attribution from native manual adjustments using original 70/30 policy; total unchanged',
            created_at: timestamp,
          },
          { session },
        );
        return { repairedEntries: plan.entries.length };
      },
      { timeoutMS: 45000 },
    );
  } finally {
    await session.endSession();
  }
}
