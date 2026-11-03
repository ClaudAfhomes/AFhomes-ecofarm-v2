import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  createCommissionRuleSchema,
  updateCommissionRuleSchema,
  qualifyCommissionSchema,
  markCommissionPaidSchema,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { toCommission, toRule, commissionListQuerySchema } from './commission-model.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { deny, fail, list, method, subPath, isoOrNull } from './handler-kit.js';
import { matchesSearch } from './list-search.js';
import type { VercelRequest, VercelResponse } from './http.js';
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
export function createMongoCommissionsHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function view(row: MongoRow, session?: ClientSession) {
    const sale = await col('card_sales').findOne(
      { _id: String(row.sale_id) },
      { session, projection: { sale_number: 1 } },
    );
    const staff = await col('staff_users').findOne(
      { _id: String(row.beneficiary_staff_id) },
      { session, projection: { full_name: 1 } },
    );
    const ost = await col('ost_members').findOne(
      { _id: String(row.beneficiary_ost_id) },
      { session, projection: { full_name: 1 } },
    );
    return toCommission({
      ...row,
      id: row._id,
      card_sales: sale,
      beneficiary_staff: staff,
      beneficiary_ost: ost,
    });
  }
  async function audit(
    actor: string,
    action: string,
    type: string,
    id: string,
    before: unknown,
    after: unknown,
    session: ClientSession,
    reason?: string,
  ) {
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actor,
        action,
        entity_type: type,
        entity_id: id,
        before_data: before ?? null,
        after_data: after ?? null,
        reason: reason ?? null,
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req),
        verb = method(req),
        rule = /^rules(?:\/([a-f0-9-]{36}))?(?:\/(history))?$/.exec(path),
        commission = /^([a-f0-9-]{36})(?:\/(qualify|pay))?$/.exec(path);
      if (!(
        (rule &&
          ((verb === 'GET' && (!rule[1] || rule[2] === 'history')) ||
            (verb === 'POST' && !rule[1]) ||
            (verb === 'PATCH' && rule[1] && !rule[2]))) ||
        (verb === 'GET' && (path === '' || (commission && !commission[2]))) ||
        (verb === 'POST' && commission?.[2])
      ))
        return fail(res, 'NOT_FOUND', 'Commission endpoint not found', 404);
      const auth = await authorize(
        req,
        'network.commissions',
        rule || verb !== 'GET' ? 'update' : 'view',
      );
      if ('error' in auth) return deny(res, auth);
      if (verb === 'GET') {
        if (rule) {
          if (rule[2] === 'history') {
            const rows = await col('audit_events')
              .find({ entity_type: 'commission_rule', entity_id: rule[1] })
              .sort({ created_at: -1, _id: -1 })
              .toArray();
            return list(
              res,
              rows.map((row) => ({
                id: row._id,
                action: row.action,
                actorId: row.actor_id,
                before: row.before_data ?? null,
                after: row.after_data ?? null,
                reason: row.reason ?? null,
                createdAt: isoOrNull(row.created_at) ?? '',
              })),
            );
          }
          return list(
            res,
            (
              await col('commission_rules').find().sort({ effective_from: -1, _id: -1 }).toArray()
            ).map((row) => toRule({ ...row, id: row._id })),
          );
        }
        const finance = await authorize(req, 'finance.payment_verification'),
          activate = await authorize(req, 'finance.card_activation'),
          updater = await authorize(req, 'network.commissions', 'update'),
          all = !('error' in finance) || !('error' in activate) || !('error' in updater);
        const query = commissionListQuerySchema.parse(req.query);
        if (!all && query.seller && query.seller !== auth.userId)
          return res
            .status(200)
            .json({ data: [], meta: { total: 0, limit: query.limit, offset: query.offset } });
        const seller = all ? query.seller : auth.userId;
        const filter = {
          ...(commission ? { _id: commission[1] } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(!all ? { settled_before_system: { $ne: true } } : {}),
          ...(seller
            ? { $or: [{ beneficiary_staff_id: seller }, { beneficiary_ost_id: seller }] }
            : {}),
        };
        const rows = await col('commissions')
            .find(filter)
            .sort({ created_at: -1, _id: -1 })
            .toArray(),
          shaped = [];
        for (const row of rows) shaped.push(await view(row));
        if (commission)
          return shaped[0]
            ? res.status(200).json(shaped[0])
            : fail(res, 'NOT_FOUND', 'Commission not found', 404);
        const filtered = shaped.filter((row) =>
          matchesSearch(query.search, [
            row.commissionNumber,
            row.saleNumber,
            row.beneficiaryName,
            row.status,
            row.id,
          ]),
        );
        return res
          .status(200)
          .json({
            data: filtered.slice(query.offset, query.offset + query.limit),
            meta: { total: filtered.length, limit: query.limit, offset: query.offset },
          });
      }
      const session = client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          // Same lock as sale creation: prospective rate edits cannot split a sale's snapshots.
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne({ _id: 'sales-write' }, { $inc: { seq: 1 } }, { upsert: true, session });
          const fresh = await authorize(req, 'network.commissions', 'update');
          if ('error' in fresh) refuse(fresh.error.status, fresh.error.error.message);
          const now = new Date().toISOString();
          if (rule) {
            const id = rule[1] ?? randomUUID(),
              before = rule[1]
                ? await col('commission_rules').findOne({ _id: id }, { session })
                : null;
            if (rule[1] && !before) refuse(404, 'Commission rule not found');
            let row: MongoRow;
            if (!rule[1]) {
              const input = createCommissionRuleSchema.parse(req.body),
                table = { role: 'roles', staff: 'staff_users', ost: 'ost_members' }[
                  input.targetType
                ];
              if (!(await col(table).findOne({ _id: input.targetId }, { session })))
                refuse(400, 'Commission rule target does not exist');
              row = {
                _id: id,
                target_type: input.targetType,
                target_id: input.targetId,
                rate: input.rate,
                effective_from: input.effectiveFrom,
                effective_until: input.effectiveUntil ?? null,
                accredited_on_or_after: input.accreditedOnOrAfter ?? null,
                is_active: true,
                created_by: auth.userId,
                updated_by: auth.userId,
                created_at: now,
                updated_at: now,
              };
            } else {
              const input = updateCommissionRuleSchema.parse(req.body);
              row = { ...before!, updated_by: auth.userId, updated_at: now };
              for (const [inputKey, field] of [
                ['rate', 'rate'],
                ['effectiveFrom', 'effective_from'],
                ['effectiveUntil', 'effective_until'],
                ['accreditedOnOrAfter', 'accredited_on_or_after'],
                ['isActive', 'is_active'],
              ] as const)
                if (input[inputKey] !== undefined) row[field] = input[inputKey];
            }
            for (const field of ['effective_from', 'effective_until', 'accredited_on_or_after']) {
              const value = row[field];
              if (value !== null && value !== undefined) {
                const date = new Date(`${String(value)}T00:00:00Z`);
                if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
                  refuse(400, 'Invalid commission rule date');
              }
            }
            if (row.effective_until && String(row.effective_until) < String(row.effective_from))
              refuse(400, 'Effective until cannot precede effective from');
            if (row.is_active) {
              const others = await col('commission_rules')
                .find(
                  {
                    _id: { $ne: id },
                    target_type: row.target_type,
                    target_id: row.target_id,
                    is_active: true,
                  },
                  { session },
                )
                .toArray();
              if (
                others.some(
                  (other) =>
                    String(other.effective_from) <= String(row.effective_until ?? '9999-12-31') &&
                    String(row.effective_from) <= String(other.effective_until ?? '9999-12-31'),
                )
              )
                refuse(409, 'An active rule already overlaps this target and date range');
            }
            if (before) await col('commission_rules').replaceOne({ _id: id }, row, { session });
            else await col('commission_rules').insertOne(row, { session });
            await audit(
              auth.userId,
              !before
                ? 'COMMISSION_RULE_CREATED'
                : before.is_active && !row.is_active
                  ? 'COMMISSION_RULE_DISABLED'
                  : 'COMMISSION_RULE_UPDATED',
              'commission_rule',
              id,
              before ? toRule({ ...before, id }) : null,
              toRule({ ...row, id }),
              session,
            );
            return toRule({ ...row, id });
          }
          const id = commission![1]!,
            operation = commission![2]!,
            before = await col('commissions').findOne({ _id: id }, { session });
          if (!before) refuse(404, 'Commission not found');
          if (before!.settled_before_system === true)
            refuse(
              409,
              'This commission was settled before the system and cannot be decided again.',
            );
          if (operation === 'qualify') {
            const input = qualifyCommissionSchema.parse(req.body);
            if (before!.status !== 'final_qualification_pending')
              refuse(409, 'Only a commission awaiting final qualification can be decided');
            const patch = {
              status: input.decision,
              qualification_notes: input.notes,
              qualified_by: auth.userId,
              qualified_at: now,
              ...(input.decision === 'earned'
                ? { earned_at: now }
                : { cancelled_at: now, cancellation_reason: input.notes }),
            };
            await col('commissions').updateOne({ _id: id }, { $set: patch }, { session });
            await audit(
              auth.userId,
              'COMMISSION_QUALIFIED',
              'commission',
              id,
              { status: before!.status },
              { status: input.decision, amount: before!.amount },
              session,
              input.notes,
            );
            return view({ ...before!, ...patch }, session);
          }
          const input = markCommissionPaidSchema.parse(req.body ?? {});
          if (before!.status === 'paid') return view(before!, session);
          if (before!.status !== 'earned')
            refuse(409, 'Only an earned commission can be marked paid');
          const reference = input.reference?.trim() || null,
            patch = {
              status: 'paid',
              paid_at: now,
              paid_by: auth.userId,
              paid_reference: reference,
            };
          await col('commissions').updateOne({ _id: id }, { $set: patch }, { session });
          await audit(
            auth.userId,
            'COMMISSION_PAID',
            'commission',
            id,
            { status: before!.status, amount: before!.amount },
            { status: 'paid', amount: before!.amount, reference },
            session,
          );
          return view({ ...before!, ...patch }, session);
        });
        return res.status(rule && !rule[1] ? 201 : 200).json(result);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid commission request', 400);
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : error.status === 409
                ? 'CONFLICT'
                : 'VALIDATION_ERROR',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Commission service is unavailable', 503);
    }
  };
}
