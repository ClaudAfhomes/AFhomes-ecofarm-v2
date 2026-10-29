import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  createReferralSchema,
  correctReferralSchema,
  hierarchyAllowsUpline,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { deny, fail, isoOrNull, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

export async function setupMongoReferrals(db: Db) {
  await db
    .collection('referral_relationships')
    .createIndex(
      { subject_staff_id: 1 },
      { unique: true, partialFilterExpression: { is_active: true } },
    );
}
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
export function createMongoReferralsHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function role(id: string, session: ClientSession) {
    const assignment = await col('staff_role_assignments').findOne({ staff_id: id }, { session });
    return assignment
      ? String(
          (await col('roles').findOne({ _id: String(assignment.role_id) }, { session }))?.slug ??
            '',
        )
      : '';
  }
  async function view(row: MongoRow, session?: ClientSession) {
    const subject = await col('staff_users').findOne(
      { _id: String(row.subject_staff_id) },
      { session, projection: { full_name: 1 } },
    );
    const upline = await col('staff_users').findOne(
      { _id: String(row.upline_staff_id) },
      { session, projection: { full_name: 1 } },
    );
    return {
      id: row._id,
      subjectStaffId: row.subject_staff_id,
      subjectName: String(subject?.full_name ?? ''),
      subjectRole: '',
      uplineStaffId: row.upline_staff_id,
      uplineName: String(upline?.full_name ?? ''),
      hierarchyRole: row.hierarchy_role,
      isAuthoritative: row.is_authoritative === true,
      isActive: row.is_active === true,
      assignedAt: isoOrNull(row.assigned_at) ?? '',
    };
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req),
        verb = method(req);
      if (!(
        (path === '' && ['GET', 'POST'].includes(verb)) ||
        (/^[a-f0-9-]{36}$/.test(path) && verb === 'PATCH')
      ))
        return fail(res, 'NOT_FOUND', 'Referral endpoint not found', 404);
      const module = verb === 'GET' ? 'network.referrals' : 'sales.uplines',
        action = verb === 'GET' ? 'view' : verb === 'POST' ? 'create' : 'update';
      const auth = await authorize(req, module, action);
      if ('error' in auth) return deny(res, auth);
      if (verb === 'GET') {
        const rows = await col('referral_relationships').find().sort({ assigned_at: -1 }).toArray();
        let visibleRows = rows;
        if (
          ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(auth.roleSlug)
        ) {
          const parent = new Map(
            rows
              .filter((row) => row.is_active === true)
              .map((row) => [String(row.subject_staff_id), String(row.upline_staff_id)]),
          );
          const children = new Map<string, string[]>();
          for (const [child, head] of parent)
            children.set(head, [...(children.get(head) ?? []), child]);
          const visible = new Set([auth.userId]);
          let head = parent.get(auth.userId),
            depth = 0;
          while (head && depth++ < 4 && !visible.has(head)) {
            visible.add(head);
            head = parent.get(head);
          }
          if (auth.roleSlug !== 'ost') {
            const queue = [...(children.get(auth.userId) ?? [])];
            while (queue.length && visible.size < 10000) {
              const id = queue.shift()!;
              if (visible.has(id)) continue;
              visible.add(id);
              queue.push(...(children.get(id) ?? []));
            }
          }
          visibleRows = rows.filter(
            (row) =>
              visible.has(String(row.subject_staff_id)) || visible.has(String(row.upline_staff_id)),
          );
        }
        return list(res, await Promise.all(visibleRows.map((row) => view(row))));
      }
      const input =
        verb === 'POST'
          ? createReferralSchema.parse(req.body)
          : correctReferralSchema.parse(req.body);
      const session = client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          // Share the organization lock with role/deactivation changes; snapshots of old sales stay untouched.
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne(
              { _id: 'organization-write' },
              { $inc: { seq: 1 } },
              { session, upsert: true },
            );
          const fresh = await authorize(req, module, action);
          if ('error' in fresh) refuse(fresh.error.status, fresh.error.error.message);
          const previous = path
            ? await col('referral_relationships').findOne({ _id: path }, { session })
            : null;
          if (path && !previous) refuse(404, 'Relationship not found');
          if (previous && previous.is_active !== true) refuse(409, 'Relationship is not active');
          const subjectId = previous
            ? String(previous.subject_staff_id)
            : createReferralSchema.parse(input).subjectStaffId;
          const uplineId = input.uplineStaffId;
          if (subjectId === uplineId) refuse(400, 'A person cannot be their own upline');
          if (previous?.upline_staff_id === uplineId)
            refuse(409, 'That is already the assigned upline');
          const subject = await col('staff_users').findOne({ _id: subjectId }, { session }),
            upline = await col('staff_users').findOne({ _id: uplineId }, { session });
          if (!subject || !upline) refuse(404, !subject ? 'Subject not found' : 'Upline not found');
          if (subject!.status !== 'active' || upline!.status !== 'active')
            refuse(409, 'Subject and upline must be active');
          const subjectRole = await role(subjectId, session),
            uplineRole = await role(uplineId, session);
          const ost = subjectRole === 'ost'
            ? await col('ost_members').findOne({ _id: subjectId }, { session }) : null;
          if (ost && ost.sponsor_staff_id !== uplineId)
            refuse(403, 'OST team changes require an approved transfer or renewal');
          const level = previous
            ? String(previous.hierarchy_role)
            : createReferralSchema.parse(input).hierarchyRole;
          if (level !== subjectRole || !hierarchyAllowsUpline(level as never, uplineRole as never))
            refuse(400, 'Invalid hierarchy direction or declared role');
          let cursor: string | null = uplineId;
          const seen = new Set([subjectId]);
          while (cursor) {
            if (seen.has(cursor)) refuse(400, 'Genealogy cycle');
            seen.add(cursor);
            const edge: MongoRow | null = await col('referral_relationships').findOne(
              { subject_staff_id: cursor, is_active: true },
              { session },
            );
            cursor = edge ? String(edge.upline_staff_id) : null;
          }
          if (
            !previous &&
            (await col('referral_relationships').findOne(
              { subject_staff_id: subjectId, is_active: true },
              { session },
            ))
          )
            refuse(409, 'That person already has an active upline');
          const now = new Date().toISOString(),
            id = randomUUID();
          if (previous)
            await col('referral_relationships').updateOne(
              { _id: path },
              { $set: { is_active: false, updated_at: now } },
              { session },
            );
          const row: MongoRow = {
            _id: id,
            subject_staff_id: subjectId,
            upline_staff_id: uplineId,
            hierarchy_role: level,
            is_authoritative: true,
            is_active: true,
            assigned_by: auth.userId,
            assigned_at: now,
            updated_at: now,
          };
          await col('referral_relationships').insertOne(row, { session });
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: auth.userId,
              action: previous ? 'UPLINE_CORRECTED' : 'UPLINE_ASSIGNED',
              entity_type: 'referral_relationship',
              entity_id: id,
              before_data: previous
                ? { relationshipId: path, uplineStaffId: previous.upline_staff_id }
                : null,
              after_data: previous
                ? { uplineStaffId: uplineId, supersededRelationshipId: path }
                : { subjectStaffId: subjectId, uplineStaffId: uplineId, hierarchyRole: level },
              reason: previous ? correctReferralSchema.parse(input).reason.trim() : null,
              created_at: now,
            },
            { session },
          );
          return view(row, session);
        });
        return res.status(verb === 'POST' ? 201 : 200).json(result);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid upline assignment or correction', 400);
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 404
            ? 'NOT_FOUND'
            : error.status === 409
              ? 'CONFLICT'
              : error.status === 403
                ? 'FORBIDDEN'
                : 'VALIDATION_ERROR',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(res, 'CONFLICT', 'That person already has an active upline', 409);
      return fail(res, 'INTERNAL', 'Referral service is unavailable', 503);
    }
  };
}
