import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  membershipSchema,
  membershipCardSchema,
  markedPrintedSchema,
  reissueMembershipCardSchema,
  reissuedMembershipCardSchema,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { toMembership, toCard } from './membership-model.js';
import { extractMembershipNumber } from './identifier.js';
import { mongoCustomerDirectory } from './customer-directory.mongo.js';
import { memberLookupFromDirectory, gsdActiveVipLookupFromDirectory } from './member-lookup.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { currentMongoCustomerIdentityPaths } from './documents.mongo.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { deny, fail, isoOrNull, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
export function createMongoMembershipsHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  objects?: PrivateObjectStore,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function cardStaff(req: VercelRequest) {
    const redemption = await authorize(req, 'operations.redemption');
    if (!('error' in redemption)) return redemption;
    const activation = await authorize(req, 'finance.card_activation');
    if (!('error' in activation)) return activation;
    return authorize(req, 'sales.customers');
  }
  async function view(row: MongoRow, card = false) {
    const customer = await col('customers').findOne(
      { _id: String(row.customer_id) },
      { projection: { first_name: 1, middle_name: 1, last_name: 1, suffix: 1, status: 1 } },
    );
    const product = await col('card_plans').findOne(
      { _id: String(row.product_id) },
      { projection: { name: 1, code: 1, category_id: 1 } },
    );
    const category = await col('card_categories').findOne(
      { _id: String(product?.category_id) },
      { projection: { name: 1 } },
    );
    const issuer = await col('staff_users').findOne(
      { _id: String(row.card_issued_by) },
      { projection: { full_name: 1 } },
    );
    const sale = await col('card_sales').findOne(
      { _id: String(row.sale_id) },
      { projection: { payment_scheme: 1, validity_months_snapshot: 1 } },
    );
    const categories = new Map([
        [
          String(product?.category_id),
          { name: typeof category?.name === 'string' ? category.name : null },
        ],
      ]),
      issuers = new Map([
        [
          String(row.card_issued_by),
          { name: typeof issuer?.full_name === 'string' ? issuer.full_name : null },
        ],
      ]),
      schemes = new Map([
        [
          String(row.sale_id),
          {
            paymentScheme: typeof sale?.payment_scheme === 'string' ? sale.payment_scheme : null,
            validityMonths:
              sale?.validity_months_snapshot == null ? null : Number(sale.validity_months_snapshot),
          },
        ],
      ]);
    const data = { ...row, id: row._id, customers: customer, card_plans: product };
    return card
      ? membershipCardSchema.parse(toCard(data, categories, issuers, schemes))
      : membershipSchema.parse(toMembership(data, categories, issuers, schemes));
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req),
        verb = method(req),
        match = /^([a-f0-9-]{36})(?:\/(card|reissue|mark-printed))?$/.exec(path),
        account = /^(accounts|ledger)\/([a-f0-9-]{36})$/.exec(path);
      if (!(
        (verb === 'GET' &&
          (['', 'resolve', 'lookup', 'customer-lookup'].includes(path) ||
            account ||
            (match && (!match[2] || match[2] === 'card')))) ||
        (verb === 'POST' && match && ['reissue', 'mark-printed'].includes(match[2] ?? ''))
      ))
        return fail(res, 'NOT_FOUND', 'Membership endpoint not found', 404);
      const auth =
        path === 'customer-lookup'
          ? await authorize(req, 'operations.customer_lookup')
          : path === 'lookup'
            ? await authorize(req, 'operations.redemption')
            : account
              ? await authorize(req, 'finance.points')
              : match?.[2] === 'reissue'
                ? await authorize(req, 'finance.card_activation', 'update')
                : await cardStaff(req);
      if ('error' in auth) return deny(res, auth);
      if (path === 'lookup' || path === 'customer-lookup') {
        const search = String(req.query.search ?? '').trim();
        if (search.length < 2 || search.length > 120)
          refuse(400, 'Enter at least two search characters');
        const directory = await mongoCustomerDirectory(db, {
          search,
          membersOnly: true,
          ...(path === 'customer-lookup' ? { status: 'active', activeVipOnly: true } : {}),
          limit: 50,
          sort: 'name',
        });
        const identityPaths = path === 'customer-lookup' && objects
          ? await currentMongoCustomerIdentityPaths(db,directory.rows.map((row)=>row.id))
          : new Map<string,string>();
        const mapped = await Promise.all(
          directory.rows.map(async (row) => {
            if (path === 'lookup') return memberLookupFromDirectory(row);
            const result = await gsdActiveVipLookupFromDirectory(row);
            if (result && objects) {
              const identityPath = identityPaths.get(row.id);
              if (identityPath) result.governmentIdImageUrl = (await objects.downloadURL(identityPath,300)).url;
            }
            return result;
          }),
        );
        return res.status(200).json({
          data: mapped.filter((row) => row !== null),
          meta: { total: directory.total, limit: 50, offset: 0 },
        });
      }
      if (account) {
        if (account[1] === 'accounts') {
          const row = await col('points_accounts').findOne({ membership_id: account[2] });
          if (!row) refuse(404, 'Points account not found');
          return res.status(200).json({
            id: row!._id,
            membershipId: row!.membership_id,
            balance: Number(row!.balance),
            lifetimeAllocated: Number(row!.lifetime_allocated ?? 0),
            lifetimeRedeemed: Number(row!.lifetime_redeemed ?? 0),
            updatedAt: isoOrNull(row!.updated_at) ?? '',
          });
        }
        const rows = await col('points_ledger')
          .find({ account_id: account[2] }, { collation: { locale: 'en', numericOrdering: true } })
          .sort({ _id: -1 })
          .limit(200)
          .toArray();
        return list(
          res,
          rows.map((row) => ({
            id: String(row._id),
            accountId: row.account_id,
            entryType: row.entry_type,
            amount: Number(row.amount),
            balanceAfter: Number(row.balance_after),
            referenceType: isoOrNull(row.reference_type),
            referenceId: isoOrNull(row.reference_id),
            reason: isoOrNull(row.reason),
            createdAt: isoOrNull(row.created_at) ?? '',
          })),
        );
      }
      if (path === 'resolve') {
        const identifier = String(req.query.identifier ?? '').trim();
        if (identifier.length < 4 || identifier.length > 200)
          refuse(400, 'Enter a valid identifier');
        let row = await col('memberships').findOne(
          { $or: [{ qr_token_hash: hash(identifier) }, { fallback_code_hash: hash(identifier) }] },
          { projection: { membership_number: 1, status: 1, points_balance: 1, expires_at: 1 } },
        );
        const code = extractMembershipNumber(identifier);
        if (!row && code)
          row = await col('memberships').findOne(
            { membership_number: code },
            { projection: { membership_number: 1, status: 1, points_balance: 1, expires_at: 1 } },
          );
        if (!row) refuse(404, 'No membership matches that identifier');
        const expires = isoOrNull(row!.expires_at);
        return res.status(200).json({
          membershipId: row!._id,
          membershipNumber: row!.membership_number,
          status: row!.status,
          pointsBalance: Number(row!.points_balance ?? 0),
          expiresAt: expires,
          expired: expires !== null && new Date(expires).valueOf() <= Date.now(),
        });
      }
      if (verb === 'GET') {
        const query = z
          .object({
            status: z.string().trim().max(30).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .parse(req.query);
        const filter = {
          ...(match ? { _id: match[1] } : {}),
          ...(query.status ? { status: query.status } : {}),
        };
        const rows = await col('memberships')
          .find(filter)
          .sort({ activated_at: -1, _id: -1 })
          .skip(match ? 0 : query.offset)
          .limit(match ? 1 : query.limit)
          .toArray();
        if (match)
          return rows[0]
            ? res.status(200).json(await view(rows[0], match[2] === 'card'))
            : fail(res, 'NOT_FOUND', 'Membership not found', 404);
        const result = [];
        for (const row of rows) result.push(await view(row));
        return res.status(200).json({
          data: result,
          meta: {
            total: await col('memberships').countDocuments(filter),
            limit: query.limit,
            offset: query.offset,
          },
        });
      }
      const session = client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          const fresh =
            match![2] === 'reissue'
              ? await authorize(req, 'finance.card_activation', 'update')
              : await cardStaff(req);
          if ('error' in fresh) refuse(fresh.error.status, fresh.error.error.message);
          const membership = await col('memberships').findOne({ _id: match![1] }, { session });
          if (!membership) refuse(404, 'Membership not found');
          const now = new Date().toISOString();
          if (match![2] === 'mark-printed') {
            const count = Number(membership!.print_count ?? 0) + 1;
            await col('memberships').updateOne(
              { _id: membership!._id },
              { $set: { print_count: count, last_printed_at: now } },
              { session },
            );
            await col('audit_events').insertOne(
              {
                _id: randomUUID(),
                actor_id: auth.userId,
                action: count > 1 ? 'MEMBERSHIP_CARD_REPRINTED' : 'MEMBERSHIP_CARD_PRINTED',
                entity_type: 'membership',
                entity_id: membership!._id,
                before_data: null,
                after_data: { membershipNumber: membership!.membership_number, printCount: count },
                created_at: now,
              },
              { session },
            );
            return markedPrintedSchema.parse({
              membershipId: membership!._id,
              printCount: count,
              lastPrintedAt: now,
              reprint: count > 1,
            });
          }
          const input = reissueMembershipCardSchema.parse(req.body),
            customer = await col('customers').findOne(
              { _id: String(membership!.customer_id), status: 'active' },
              { session },
            );
          if (!customer || membership!.status !== 'active')
            refuse(409, 'Active customer and membership required');
          await col('customers').updateOne(
            { _id: customer!._id },
            { $set: { card_guard: randomUUID() } },
            { session },
          );
          const raw = randomBytes(4).toString('hex').toUpperCase(),
            fallback = `AFH-${raw.slice(0, 4)}-${raw.slice(4)}`,
            qr = randomBytes(32).toString('base64');
          await col('memberships').updateOne(
            { _id: membership!._id },
            { $set: { fallback_code_hash: hash(fallback), qr_token_hash: hash(qr) } },
            { session },
          );
          await col('audit_events').insertMany(
            [
              {
                _id: randomUUID(),
                actor_id: auth.userId,
                action: 'CUSTOMER_CREDENTIALS_REISSUED',
                entity_type: 'membership',
                entity_id: membership!._id,
                before_data: { previousCodesInvalidated: true },
                after_data: { membershipNumber: membership!.membership_number, selfService: false },
                created_at: now,
              },
              {
                _id: randomUUID(),
                actor_id: auth.userId,
                action: 'MEMBERSHIP_CREDENTIALS_REISSUED',
                entity_type: 'membership',
                entity_id: membership!._id,
                before_data: { previousCodesInvalidated: true },
                after_data: {
                  membershipNumber: membership!.membership_number,
                  reason: input.reason,
                  pointsBalanceUnchanged: Number(membership!.points_balance ?? 0),
                },
                created_at: now,
              },
            ],
            { session },
          );
          return reissuedMembershipCardSchema.parse({
            membershipId: membership!._id,
            membershipNumber: membership!.membership_number,
            fallbackCode: fallback,
            qrToken: qr,
            issuedAt: now,
            previousCodesInvalidated: true,
          });
        });
        return res.status(match![2] === 'reissue' ? 201 : 200).json(result);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid membership request', 400);
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
      return fail(res, 'INTERNAL', 'Membership service is unavailable', 503);
    }
  };
}
