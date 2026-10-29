import { randomUUID } from 'node:crypto';
import type { Db, ClientSession, MongoClient } from 'mongodb';
import { z } from 'zod';
import { aaNumberSchema, manageSaleTeamSchema, saleTeamLookupSchema, saleTeamHistoricalAccreditationSchema } from '@afhomes/contracts';
import type { resolveAfHomesPrincipal, authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { createMongoPublicSearchStore } from './sale-team-search.mongo.js';
import { handlePublicSaleTeamSearchWithStore } from './sale-team-public-search.js';

const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
export const manilaToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
/** Explicit operator setup, never invoked by ordinary application requests. */
export async function setupMongoSaleTeam(db: Db) {
  for (const field of ['staff_id', 'aa_number'])
    await db.collection('sale_team_accreditations').createIndex({ [field]: 1 }, { unique: true });
  await db
    .collection('sale_team_accreditation_history')
    .createIndex({ aa_number: 1 }, { unique: true });
}
export async function readMongoSaleTeam(db: Db, staffId: string, session?: ClientSession) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const row = await col('sale_team_accreditations').findOne({ staff_id: staffId }, { session });
  if (!row) return null;
  const staff = await col('staff_users').findOne({ _id: staffId }, { session });
  const assignment = await col('staff_role_assignments').findOne(
    {
      staff_id: staffId,
    },
    { session },
  );
  const role =
    assignment && (await col('roles').findOne({ _id: String(assignment.role_id) }, { session }));
  if (!role || !staff) return null;
  const ost =
    row.kind === 'OST' ? await col('ost_members').findOne({ _id: staffId }, { session }) : null;
  const term =
    row.kind === 'OST'
      ? await col('ost_accreditation_terms').findOne(
          { ost_id: staffId, status: { $in: ['active', 'revoked'] } },
          { session, sort: { approved_at: -1, _id: -1 } },
        )
      : null;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const inactive =
    staff.status !== 'active' ||
    role.is_active !== true ||
    (row.kind === 'IST' &&
      !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(String(role.slug))) ||
    (row.kind === 'OST' && (role.slug !== 'ost' || ost?.status !== 'active' || !term));
  const status =
    row.status === 'revoked' || term?.status === 'revoked'
      ? 'revoked'
      : inactive
        ? 'inactive'
        : row.kind === 'OST' && String(term?.starts_on) > today
          ? 'not_started'
          : row.kind === 'OST' && String(term?.expires_on) < today
            ? 'expired'
            : 'accredited';
  return saleTeamLookupSchema.parse({
    aaNumber: row.aa_number,
    kind: row.kind,
    fullName: row.public_name,
    status,
    startsOn: (row.kind === 'OST' ? (term?.starts_on ?? row.starts_on) : row.starts_on) ?? null,
    expiresOn: (row.kind === 'OST' ? (term?.expires_on ?? row.expires_on) : row.expires_on) ?? null,
    photoUrl: null,
  });
}
/** Transaction-scoped identity allocation and lifecycle; callers must serialize organization writes. */
export function createMongoSaleTeamRecords(db: Db) {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function allocate(kind: 'IST' | 'OST', date: string, session: ClientSession) {
    const stamp = date.slice(2, 4) + date.slice(5, 7);
    const pattern = new RegExp('^AA[IO]' + stamp + '[0-9]{4}$');
    let high = 0;
    for (const table of ['sale_team_accreditations', 'sale_team_accreditation_history']) {
      const rows = await col(table)
        .find({ aa_number: pattern }, { session, projection: { aa_number: 1 } })
        .toArray();
      for (const row of rows) high = Math.max(high, Number(String(row.aa_number).slice(-4)));
    }
    const key = 'sale-team-aa:' + stamp;
    await db
      .collection<{ _id: string; seq: number }>('counters')
      .updateOne({ _id: key }, { $max: { seq: high } }, { upsert: true, session });
    const next = await db
      .collection<{ _id: string; seq: number }>('counters')
      .findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { session, returnDocument: 'after' });
    if (!next || next.seq > 9999) refuse(409, 'AA sequence exhausted');
    return (kind === 'IST' ? 'AAI' : 'AAO') + stamp + String(next!.seq).padStart(4, '0');
  }
  async function manage(
    staffId: string,
    actorId: string,
    input: z.infer<typeof manageSaleTeamSchema> & { aaNumber?: string },
    session: ClientSession,
  ) {
    const existing = await col('sale_team_accreditations').findOne(
      { staff_id: staffId },
      { session },
    );
    if (existing && existing.kind !== input.kind) refuse(409, 'Accreditation kind conflict');
    if (existing && input.aaNumber && existing.aa_number !== input.aaNumber)
      refuse(409, 'Accreditation number is immutable');
    const staff = await col('staff_users').findOne({ _id: staffId }, { session });
    const assignment = await col('staff_role_assignments').findOne(
      { staff_id: staffId },
      { session },
    );
    const role =
      assignment &&
      (await col('roles').findOne(
        { _id: String(assignment.role_id), is_active: true },
        { session },
      ));
    const now = new Date().toISOString();
    let action = 'SALE_TEAM_ACCREDITATION_APPROVED';
    if (input.action === 'revoke') {
      if (input.kind === 'IST') refuse(400, 'Use the employee access/deactivation workflow');
      if (!existing) refuse(409, 'Accreditation required');
      if (existing!.status === 'revoked') return readMongoSaleTeam(db, staffId, session);
      await col('sale_team_accreditations').updateOne(
        { _id: existing!._id },
        { $set: { status: 'revoked', revoked_by: actorId, revoked_at: now } },
        { session },
      );
      action = 'SALE_TEAM_ACCREDITATION_REVOKED';
    } else {
      const eligible =
        staff &&
        role &&
        (staff.status === 'active' || (input.kind === 'OST' && staff.status === 'invited')) &&
        (input.kind === 'IST'
          ? ['vice_director', 'senior_sales_manager', 'sales_manager'].includes(String(role.slug))
          : role.slug === 'ost');
      if (!eligible) refuse(409, 'Invalid accreditation target');
      let start: string | null = null,
        end: string | null = null;
      if (input.kind === 'IST') {
        if (existing) return readMongoSaleTeam(db, staffId, session);
        action = 'IST_EMPLOYEE_IDENTITY_ISSUED';
      } else {
        const member = await col('ost_members').findOne(
          { _id: staffId, status: 'active' },
          { session },
        );
        const term =
          member &&
          (await col('ost_accreditation_terms').findOne(
            { ost_id: staffId, status: 'active' },
            { session },
          ));
        if (
          !term ||
          typeof term.starts_on !== 'string' ||
          typeof term.expires_on !== 'string' ||
          term.expires_on < term.starts_on
        )
          refuse(409, 'Approved accreditation dates required');
        start = String(term!.starts_on);
        end = String(term!.expires_on);
        if (
          existing?.status === 'active' &&
          existing.starts_on === start &&
          existing.expires_on === end &&
          existing.public_name === staff!.full_name
        )
          return readMongoSaleTeam(db, staffId, session);
      }
      if (input.aaNumber) {
        if (
          !aaNumberSchema.safeParse(input.aaNumber).success ||
          (input.aaNumber.startsWith('AAI') && input.kind !== 'IST') ||
          (input.aaNumber.startsWith('AAO') && input.kind !== 'OST')
        )
          refuse(400, 'Invalid accreditation number');
        for (const table of ['sale_team_accreditations', 'sale_team_accreditation_history'])
          if (
            await col(table).findOne(
              {
                aa_number: input.aaNumber,
                ...(table === 'sale_team_accreditations' ? { staff_id: { $ne: staffId } } : {}),
              },
              { session },
            )
          )
            refuse(409, 'Accreditation number already used');
      }
      const number =
        existing?.aa_number ??
        input.aaNumber ??
        (await allocate(input.kind, start ?? manilaToday(), session));
      await col('sale_team_accreditations').updateOne(
        { staff_id: staffId },
        {
          $set: {
            aa_number: number,
            public_name: staff!.full_name,
            kind: input.kind,
            status: 'active',
            starts_on: start,
            expires_on: end,
            approved_by: actorId,
            approved_at: now,
            revoked_by: null,
            revoked_at: null,
          },
          $setOnInsert: { _id: randomUUID(), staff_id: staffId },
        },
        { upsert: true, session },
      );
    }
    const current = await readMongoSaleTeam(db, staffId, session);
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actorId,
        action,
        entity_type: 'staff_user',
        entity_id: staffId,
        after_data:
          action === 'IST_EMPLOYEE_IDENTITY_ISSUED'
            ? { aaNumber: current!.aaNumber }
            : { kind: input.kind, aaNumber: current!.aaNumber },
        created_at: now,
      },
      { session },
    );
    return current;
  }
  return { manage, allocate };
}
export function createMongoSaleTeamHandler(
  db: Db,
  client: MongoClient,
  resolve: typeof resolveAfHomesPrincipal,
  authorize: typeof authorizeAfHomes,
  objects?: PrivateObjectStore,
  env: NodeJS.ProcessEnv = process.env,
) {
  const records = createMongoSaleTeamRecords(db);
  const publicSearch = createMongoPublicSearchStore(
    db,
    client,
    (id, session) => readMongoSaleTeam(db, id, session),
    objects,
  );
  async function withPhoto<T extends {photoUrl:string|null}>(value: T | null, staffId: string): Promise<T|null> {
    if (!value || !objects) return value;
    try {
      const photo = await db.collection<MongoRow>('profile_photos').findOne({ owner_id: staffId });
      if (photo && (await objects.exists(String(photo.object_key)))) {
        const signed = await objects.downloadURL(String(photo.object_key), 300);
        return { ...value, photoUrl: signed.url };
      }
    } catch {
      // Photo delivery must not prevent the authorized accreditation read.
    }
    return value;
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req),
      verb = method(req);
    if (path.startsWith('search/'))
      return handlePublicSaleTeamSearchWithStore(req, res, publicSearch, path, env);
    if (path === 'search' && verb === 'GET') {
      const access = await authorize(req, 'network.members');
      if ('error' in access) return deny(res, access);
      const aa = aaNumberSchema.safeParse(req.query.aaNumber);
      if (!aa.success) return fail(res, 'VALIDATION_ERROR', 'Enter a valid AA number', 400);
      const record = await db
        .collection<MongoRow>('sale_team_accreditations')
        .findOne({ aa_number: aa.data });
      if (!record) {
        const history = await db.collection<MongoRow>('sale_team_accreditation_history').findOne({aa_number:aa.data},{sort:{recorded_at:-1,_id:-1}});
        if (history) return res.status(200).json(await withPhoto(saleTeamHistoricalAccreditationSchema.parse({
          aaNumber:history.aa_number,kind:history.kind,fullName:history.public_name,status:'superseded',
          startsOn:history.starts_on??null,expiresOn:history.expires_on??null,photoUrl:null,
          successorAaNumber:history.successor_aa_number??null,
        }),String(history.staff_id)));
      }
      const result = record ? await readMongoSaleTeam(db, String(record.staff_id)) : null;
      return res
        .status(200)
        .json(
          result?.status === 'accredited'
            ? await withPhoto(result, String(record!.staff_id))
            : null,
        );
    }
    if (path === 'me' && verb === 'GET') {
      const principal = await resolve(req);
      if ('error' in principal) return deny(res, principal);
      try {
        return res
          .status(200)
          .json(await withPhoto(await readMongoSaleTeam(db, principal.userId), principal.userId));
      } catch {
        return fail(res, 'INTERNAL', 'Verification is unavailable. Please retry.', 503);
      }
    }
    const id = z.string().uuid().safeParse(path);
    if (!id.success || !['GET', 'POST'].includes(verb))
      return fail(res, 'NOT_IMPLEMENTED', 'Native public verification is not enabled', 501);
    const principal = await resolve(req);
    if ('error' in principal) return deny(res, principal);
    if (!['admin', 'super_admin'].includes(principal.roleSlug))
      return fail(res, 'FORBIDDEN', 'Administrator approval is required', 403);
    const parsed = verb === 'POST' ? manageSaleTeamSchema.safeParse(jsonBody(req)) : null;
    if (parsed && !parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Check accreditation details', 400);
    const kind = parsed?.success ? parsed.data.kind : req.query.kind;
    if (kind !== 'IST' && kind !== 'OST')
      return fail(res, 'VALIDATION_ERROR', 'Choose IST or OST', 400);
    const module = kind === 'IST' ? 'organization.staff' : 'network.ost_registrations',
      action = verb === 'POST' ? 'update' : 'view';
    const access = await authorize(req, module, action);
    if ('error' in access) return deny(res, access);
    const session = client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (verb === 'GET') return readMongoSaleTeam(db, id.data, session);
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
        const fresh = await authorize(req, module, action);
        if ('error' in fresh) refuse(fresh.error.status, 'Accreditation approval is not permitted');
        if (!('error' in fresh) && !['admin', 'super_admin'].includes(fresh.roleSlug))
          refuse(403, 'Administrator approval is required');
        return records.manage(id.data, principal.userId, parsed!.data!, session);
      });
      return res.status(200).json(await withPhoto(result, id.data));
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 400
              ? 'VALIDATION_ERROR'
              : 'CONFLICT',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(res, 'CONFLICT', 'Accreditation number already used', 409);
      return fail(res, 'INTERNAL', 'Verification is unavailable. Please retry.', 503);
    } finally {
      await session.endSession();
    }
  };
}
