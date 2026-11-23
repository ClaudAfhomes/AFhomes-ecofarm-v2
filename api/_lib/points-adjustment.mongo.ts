import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { adjustPointsInputSchema, adjustedPointsSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { ledgerId } from './customer-points.mongo.js';
import { pointAllowanceChange } from './point-allowances.mongo.js';
import { deny, fail, jsonBody } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

/** Native equivalent of adjust_membership_points; no Services/Redemption workflow is mounted. */
export function createMongoPointsAdjustment(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const actor = await authorize(req, 'operations.redemption', 'update');
    if ('error' in actor) return deny(res, actor);
    const parsed = adjustPointsInputSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'A non-zero amount and a reason are required.', 400);
    const input = parsed.data,
      session = client.startSession();
    try {
      const result = await session.withTransaction(
        async () => {
          const member = await col('memberships').findOne({ _id: input.membershipId }, { session });
          if (!member) throw new CustomerActivationError(404, 'Membership not found');
          if (member.status !== 'active')
            throw new CustomerActivationError(409, 'Membership is not active');
          await col('memberships').updateOne(
            { _id: member._id },
            { $set: { points_guard: randomUUID() } },
            { session },
          );
          const fresh = await authorize(req, 'operations.redemption', 'update');
          if ('error' in fresh)
            throw new CustomerActivationError(
              fresh.error.status,
              'Points adjustment is not permitted',
            );
          const account = await col('points_accounts').findOne(
            { membership_id: member._id },
            { session },
          );
          if (!account)
            throw new CustomerActivationError(409, 'This member has no points account yet.');
          const before = BigInt(String(account.balance)),
            after = before + BigInt(input.amount);
          if (after < 0n)
            throw new CustomerActivationError(
              409,
              'That adjustment would take the balance below zero.',
            );
          if (after > BigInt(Number.MAX_SAFE_INTEGER) || before > BigInt(Number.MAX_SAFE_INTEGER))
            throw new CustomerActivationError(409, 'Points range requires review');
          const timestamp = new Date().toISOString();
          const allowances = pointAllowanceChange(account, BigInt(input.amount));
          await col('points_ledger').insertOne(
            {
              _id: await ledgerId(db, session),
              account_id: account._id,
              entry_type: 'adjustment',
              amount: input.amount,
              weekday_delta: allowances.weekday_delta,
              weekend_delta: allowances.weekend_delta,
              balance_before: Number(before),
              balance_after: Number(after),
              counts_toward_cap: false,
              origin_period_id: null,
              reference_type: 'membership',
              reference_id: member._id,
              actor_id: fresh.userId,
              reason: input.reason,
              created_at: timestamp,
            },
            { session },
          );
          await col('points_accounts').updateOne(
            { _id: account._id },
            {
              $set: {
                balance: Number(after),
                weekday_balance: allowances.weekday_balance,
                weekend_balance: allowances.weekend_balance,
                updated_at: timestamp,
              },
            },
            { session },
          );
          await col('memberships').updateOne(
            { _id: member._id },
            { $set: { points_balance: Number(after) } },
            { session },
          );
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: fresh.userId,
              action: 'POINTS_ADJUSTED',
              entity_type: 'membership',
              entity_id: member._id,
              after_data: {
                amount: input.amount,
                balanceBefore: Number(before),
                balanceAfter: Number(after),
              },
              reason: input.reason,
              created_at: timestamp,
            },
            { session },
          );
          return adjustedPointsSchema.parse({
            membershipId: member._id,
            amount: input.amount,
            balanceAfter: Number(after),
            reversalDebt: Number(account.reversal_debt ?? 0),
          });
        },
        { timeoutMS: 45000 },
      );
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 401
            ? 'UNAUTHORIZED'
            : error.status === 403
              ? 'FORBIDDEN'
              : error.status === 404
                ? 'NOT_FOUND'
                : 'CONFLICT',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Points adjustment is unavailable. Please retry.', 503);
    } finally {
      await session.endSession();
    }
  };
}
