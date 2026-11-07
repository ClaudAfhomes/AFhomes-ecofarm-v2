import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  createReferralSchema,
  correctReferralSchema,
  hierarchyAllowsUpline,
  referralListQuerySchema,
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
/** Staff ids per name lookup (about 0.25 MB of ids per command). */
const NAME_BATCH = 5000;
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const SELLER_ROLES = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
type Caller = { userId?: unknown; roleSlug?: unknown };
/**
 * The rows GET /referrals returns to this caller, in the given order. Sellers (VD/SSM/SM/OST) see a
 * CURRENT relationship only when both ends are inside their own genealogy view (self, up to four
 * uplines, and - except OST - their downline), never sibling or unrelated branches (U8); a RETIRED
 * relationship only when they were a party to it, the one way historical authority can be proven.
 * Without a resolvable caller identity a seller gets no rows. Other roles see every row.
 */
function visibleTo(auth: Caller, rows: MongoRow[]) {
  if (!SELLER_ROLES.includes(String(auth.roleSlug))) return rows;
  if (typeof auth.userId !== 'string' || !auth.userId) return [];
  const userId = auth.userId;
  const parent = new Map(
    rows
      .filter((row) => row.is_active === true)
      .map((row) => [String(row.subject_staff_id), String(row.upline_staff_id)]),
  );
  const children = new Map<string, string[]>();
  for (const [child, head] of parent) {
    const list = children.get(head);
    if (list) list.push(child);
    else children.set(head, [child]);
  }
  const visible = new Set([userId]);
  let head = parent.get(userId),
    depth = 0;
  while (head && depth++ < 4 && !visible.has(head)) {
    visible.add(head);
    head = parent.get(head);
  }
  if (auth.roleSlug !== 'ost') {
    const queue = [...(children.get(userId) ?? [])];
    for (let head = 0; head < queue.length && visible.size < 10000; head++) {
      const id = queue[head]!;
      if (visible.has(id)) continue;
      visible.add(id);
      for (const child of children.get(id) ?? []) queue.push(child);
    }
  }
  return rows.filter((row) => {
    const subject = String(row.subject_staff_id),
      upline = String(row.upline_staff_id);
    return row.is_active === true
      ? visible.has(subject) && visible.has(upline)
      : subject === userId || upline === userId;
  });
}
/** Paged order: newest assignment first (the displayed assignedAt), then id; code-unit order. */
const pageKey = (row: MongoRow) => [isoOrNull(row.assigned_at) ?? '', String(row._id)];
const comparePageKeys = (a: string[], b: string[]) =>
  a[0]! > b[0]! ? -1 : a[0]! < b[0]! ? 1 : a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0;
export function createMongoReferralsHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  cursorSecret?: Buffer,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const cursorKey = cursorSecret ?? randomBytes(32);
  /** HMAC-signed position in this caller's referral list; it never grants or widens access. */
  function writeCursor(userId: string, key: string[]) {
    const body = Buffer.from(JSON.stringify({ v: 1, l: 'referrals', u: userId, k: key })).toString(
      'base64url',
    );
    return `${body}.${createHmac('sha256', cursorKey).update(body).digest('base64url')}`;
  }
  function readCursor(cursor: string, userId: string): string[] | null {
    const [body, mac, extra] = cursor.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = createHmac('sha256', cursorKey).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return payload?.v === 1 &&
        payload.l === 'referrals' &&
        payload.u === userId &&
        Array.isArray(payload.k) &&
        payload.k.length === 2 &&
        payload.k.every((part: unknown) => typeof part === 'string')
        ? payload.k
        : null;
    } catch {
      return null;
    }
  }
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
    return shape(row, subject?.full_name, upline?.full_name);
  }
  /** Same output as view() for many rows: one batched name read instead of two per row. */
  async function views(rows: MongoRow[]) {
    const ids = [
      ...new Set(
        rows.flatMap((row) => [String(row.subject_staff_id), String(row.upline_staff_id)]),
      ),
    ];
    // Chunked so the $in list never approaches the 16 MB command limit on very large networks.
    const names = new Map<unknown, unknown>();
    for (let start = 0; start < ids.length; start += NAME_BATCH)
      for (const staff of await col('staff_users')
        .find(
          { _id: { $in: ids.slice(start, start + NAME_BATCH) } },
          { projection: { full_name: 1 } },
        )
        .toArray())
        names.set(staff._id, staff.full_name);
    return rows.map((row) =>
      shape(row, names.get(String(row.subject_staff_id)), names.get(String(row.upline_staff_id))),
    );
  }
  function shape(row: MongoRow, subjectName: unknown, uplineName: unknown) {
    return {
      id: row._id,
      subjectStaffId: row.subject_staff_id,
      subjectName: String(subjectName ?? ''),
      subjectRole: '',
      uplineStaffId: row.upline_staff_id,
      uplineName: String(uplineName ?? ''),
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
        // Opt-in pagination (limit and/or cursor); without them the full list exactly as before.
        const paged =
          req.query.limit !== undefined || req.query.cursor !== undefined
            ? referralListQuerySchema.safeParse(req.query)
            : null;
        if (paged && !paged.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid referral page request', 400);
        const caller = typeof auth.userId === 'string' ? auth.userId : '';
        const after = paged?.data.cursor ? readCursor(paged.data.cursor, caller) : null;
        if (paged?.data.cursor && !after)
          return fail(res, 'VALIDATION_ERROR', 'The page cursor is invalid for this list', 400);
        const rows = await col('referral_relationships')
          .find(
            {},
            {
              projection: {
                subject_staff_id: 1,
                upline_staff_id: 1,
                hierarchy_role: 1,
                is_authoritative: 1,
                is_active: 1,
                assigned_at: 1,
              },
            },
          )
          .sort({ assigned_at: -1 })
          .toArray();
        // U8 visibility (see visibleTo); names are resolved for kept rows only.
        const visibleRows = visibleTo(auth, rows);
        if (!paged) return list(res, await views(visibleRows));
        // One page of the same authorized rows: exact total, deterministic order, and names
        // resolved for the page rows only.
        const limit = paged.data.limit ?? 50;
        const ordered = visibleRows
          .map((row) => ({ row, key: pageKey(row) }))
          .sort((a, b) => comparePageKeys(a.key, b.key));
        let start = 0;
        if (after) {
          start = ordered.findIndex((entry) => comparePageKeys(entry.key, after) > 0);
          if (start < 0) start = ordered.length;
        }
        const page = ordered.slice(start, start + limit);
        const last = page[page.length - 1];
        return res.status(200).json({
          data: await views(page.map((entry) => entry.row)),
          meta: {
            total: ordered.length,
            limit,
            nextCursor:
              last && start + page.length < ordered.length ? writeCursor(caller, last.key) : null,
          },
        });
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
