import { randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { AF_ID_ALPHABET, createCustomerSchema, updateCustomerSchema } from '@afhomes/contracts';
import { isSellingRole } from './commerce.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import {
  customerCreateRow,
  customerUpdatePatch,
  fullName,
  listQuerySchema,
  toCustomer,
} from './customer-model.js';
import { mongoCustomerDirectory } from './customer-directory.mongo.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

export async function setupMongoCustomers(db: Db) {
  const customers = db.collection('customers');
  for (const field of [
    'customer_number',
    'customer_code',
    'ra_number',
    'government_id_number',
    'vip_card_number',
  ])
    await customers.createIndex(
      { [field]: 1 },
      { unique: true, partialFilterExpression: { [field]: { $type: 'string' } } },
    );
  await customers.createIndex(
    { email: 1 },
    { unique: true, collation: { locale: 'en', strength: 2 } },
  );
  await customers.createIndex({ status: 1, created_at: -1 });
  for (const name of [
    'memberships',
    'card_sales',
    'reservation_agreements',
    'customer_applications',
  ])
    await db.collection(name).createIndex({ customer_id: 1 });
  await db.collection('payments').createIndex({ sale_id: 1, status: 1 });
  await db.collection('payments').createIndex({ reservation_id: 1, status: 1 });
}

const businessId = (prefix: string, length: number) =>
  `${prefix}-${Array.from(randomBytes(length), (byte) => AF_ID_ALPHABET[byte & 31]).join('')}`;
const manilaDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
async function nextSequence(db: Db, key: string, session: ClientSession) {
  const row = await db
    .collection<{ _id: string; seq: number }>('counters')
    .findOneAndUpdate(
      { _id: key },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', session },
    );
  if (!row || !Number.isSafeInteger(row.seq)) throw new Error('Identifier range exhausted');
  return row.seq;
}
export async function companyId(db: Db, value: unknown, session: ClientSession, create: boolean) {
  const year = manilaDate().slice(0, 4);
  if (create && !value)
    return `${year}-${String(await nextSequence(db, `company-customer:${year}`, session)).padStart(4, '0')}`;
  const text = typeof value === 'string' ? value.trim() : '';
  const match =
    text.match(/^(\d{4})-(\d{4,})$/) ?? text.toUpperCase().match(/^AF-CUS-(\d{4})-(\d{6})$/);
  if (match) {
    const seq = Number(match[2]);
    if (!Number.isSafeInteger(seq) || seq > 2147483647)
      throw new CustomerActivationError(400, 'Company Customer ID range exhausted');
    await db
      .collection<{ _id: string; seq: number }>('counters')
      .updateOne(
        { _id: `company-customer:${match[1]}` },
        { $max: { seq } },
        { upsert: true, session },
      );
  }
  return value;
}
export async function allocateMongoVipCardNumber(db: Db, tier: string, scheme: 'CASH' | 'INSTALLMENT', months: number, session: ClientSession) {
  if (!['BRONZE','SILVER','GOLD'].includes(tier) || !Number.isInteger(months) || months < 1 || months > 99 || (scheme === 'CASH' && months !== 1))
    throw new CustomerActivationError(409,'VIP card terms require review');
  for (let attempt=0;attempt<1000;attempt++) {
    const seq = await nextSequence(db, 'vip-card-number', session);
    if (seq > 99999) throw new CustomerActivationError(409, 'VIP card number range exhausted');
    const prefix = manilaDate().replaceAll('-', '').slice(2);
    const tierCode = tier === 'GOLD' ? 'G1' : tier === 'SILVER' ? 'S1' : 'B1';
    const number = `${prefix}${String(seq).padStart(5, '0')}${tierCode}${scheme === 'CASH' ? 'C' : 'T'}${String(months).padStart(2,'0')}S`;
    if (!(await db.collection<MongoRow>('customers').findOne({vip_card_number:number},{session}))) return number;
  }
  throw new CustomerActivationError(409,'VIP card number allocation exhausted');
}
const vipNumber = (db: Db, tier: unknown, session: ClientSession) => allocateMongoVipCardNumber(db,tier === 'GOLD' ? 'GOLD' : tier === 'SILVER' ? 'SILVER' : 'BRONZE','CASH',1,session);

/** Transaction-scoped issuance: keep an issued identity stable across application retries. */
export async function ensureMongoCustomerVipNumber(db: Db, customerId: string, tier: string, paymentScheme: string, session: ClientSession) {
  const customers = db.collection<MongoRow>('customers');
  const customer = await customers.findOne({_id:customerId},{session});
  if (!customer) throw new CustomerActivationError(404,'Customer not found');
  if (customer.vip_card_number) return String(customer.vip_card_number);
  if (!['spot_cash','move_a','installment_4_month','move_b1_40_12','move_b2_25_12'].includes(paymentScheme))
    throw new CustomerActivationError(409,'VIP card terms require review');
  const cash = ['spot_cash','move_a'].includes(paymentScheme);
  const number = await allocateMongoVipCardNumber(db,tier,cash?'CASH':'INSTALLMENT',cash?1:paymentScheme==='installment_4_month'?4:12,session);
  const update = await customers.updateOne({_id:customerId,vip_card_number:customer.vip_card_number??null},{$set:{vip_card_number:number}},{session});
  if (update.matchedCount!==1) throw new CustomerActivationError(409,'Customer identity changed; reload before continuing');
  return number;
}

export function createMongoCustomersHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const collection = db.collection<MongoRow>('customers');
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req),
        verb = method(req),
        deactivate = /^([a-f0-9-]{36})\/deactivate$/.exec(path);
      if (!(
        (['', 'filter-options'].includes(path) && verb === 'GET') ||
        (path === '' && verb === 'POST') ||
        (/^[a-f0-9-]{36}$/.test(path) && ['GET', 'PATCH'].includes(verb)) ||
        (deactivate && verb === 'POST')
      ))
        return fail(res, 'NOT_FOUND', 'Customer endpoint not found', 404);
      const auth = await authorize(
        req,
        'sales.customers',
        deactivate || verb === 'PATCH' ? 'update' : verb === 'POST' ? 'create' : 'view',
      );
      if ('error' in auth) return deny(res, auth);
      if (deactivate) {
        const session = client.startSession();
        try {
          const result = await session.withTransaction(async () => {
            const fresh = await authorize(req, 'sales.customers', 'update');
            if ('error' in fresh)
              throw new CustomerActivationError(fresh.error.status, fresh.error.error.message);
            const id = deactivate[1]!,
              before = await collection.findOne({ _id: id }, { session });
            if (!before) throw new CustomerActivationError(404, 'Customer not found');
            const identityId = typeof before.auth_user_id === 'string' ? before.auth_user_id : null;
            if (
              identityId &&
              ((await db
                .collection<MongoRow>('staff_users')
                .findOne({ _id: identityId }, { session })) ||
                (await collection.findOne(
                  { _id: { $ne: id }, auth_user_id: identityId },
                  { session },
                )))
            )
              throw new CustomerActivationError(
                409,
                'Shared identity requires review before removing customer login',
              );
            const now = new Date().toISOString();
            await collection.updateOne(
              { _id: id },
              { $set: { status: 'suspended', auth_user_id: null, updated_at: now } },
              { session },
            );
            await db
              .collection<MongoRow>('customer_onboarding_tokens')
              .deleteMany({ customer_id: id }, { session });
            if (identityId) {
              for (const [name, field] of [
                ['auth_sessions', 'userId'],
                ['auth_accounts', 'userId'],
                ['auth_two_factors', 'userId'],
                ['auth_session_assurance', 'user_id'],
              ])
                await db
                  .collection<MongoRow>(name!)
                  .deleteMany({ [field!]: identityId }, { session });
              await db
                .collection<MongoRow>('auth_users')
                .deleteOne({ _id: identityId }, { session });
            }
            await db
              .collection<MongoRow>('audit_events')
              .insertOne(
                {
                  _id: randomUUID(),
                  actor_id: fresh.userId,
                  action: 'CUSTOMER_DEACTIVATED',
                  entity_type: 'customer',
                  entity_id: id,
                  before_data: { status: before.status },
                  after_data: { status: 'suspended', loginRemoved: true },
                  created_at: now,
                },
                { session },
              );
            return { deactivated: true };
          });
          return res.status(200).json(result);
        } finally {
          await session.endSession();
        }
      }
      if (path === 'filter-options') {
        const staff = await db
          .collection<MongoRow>('staff_users')
          .find({ status: 'active' }, { projection: { _id: 1, full_name: 1 } })
          .sort({ full_name: 1 })
          .toArray();
        return res.status(200).json({
          data: staff.map((row) => ({ id: row._id, name: row.full_name })),
          meta: { total: staff.length },
        });
      }
      if (verb === 'GET') {
        const parsed = listQuerySchema.safeParse(req.query);
        if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
        const directory = await mongoCustomerDirectory(db, path ? { id: path } : parsed.data);
        if (path)
          return directory.rows[0]
            ? res.status(200).json(toCustomer(directory.rows[0], { includeTin: true }))
            : fail(res, 'NOT_FOUND', 'Customer not found', 404);
        return res.status(200).json({
          data: directory.rows.map((row) => toCustomer(row)),
          meta: { total: directory.total, limit: parsed.data.limit, offset: parsed.data.offset },
        });
      }
      if (verb === 'POST' && !isSellingRole(auth.roleSlug))
        return fail(res, 'FORBIDDEN', 'Only selling roles may register customers', 403);
      const parsed =
        verb === 'POST'
          ? createCustomerSchema.safeParse(jsonBody(req))
          : updateCustomerSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid customer details', 400);
      const session = client.startSession();
      try {
        const after = await session.withTransaction(async () => {
          const before = path ? await collection.findOne({ _id: path }, { session }) : null;
          if (path && !before) throw new CustomerActivationError(404, 'Customer not found');
          const input = parsed.data;
          if (
            'vipCardNumber' in input &&
            input.vipCardNumber !== undefined &&
            input.vipCardNumber !== (before?.vip_card_number ?? null)
          )
            throw new CustomerActivationError(
              409,
              'VIP card numbers are server-issued and cannot be edited. Use certified import to preserve an existing historical number.',
            );
          const id = path || randomUUID(),
            now = new Date().toISOString();
          let row: MongoRow;
          if (verb === 'POST') {
            // Lock allocation namespace; preserve readable random AF IDs, not a new sequential format.
            await nextSequence(db, 'allocation:AF-CUS', session);
            let number = '';
            for (let attempt = 0; attempt < 64; attempt++) {
              const candidate = businessId('AF-CUS', 5);
              if (!(await collection.findOne({ customer_number: candidate }, { session }))) {
                number = candidate;
                break;
              }
            }
            if (!number) throw new Error('Customer number allocation failed');
            let code = '';
            for (let attempt = 0; attempt < 64; attempt++) {
              const candidate = businessId('AF-CC', 8);
              if (!(await collection.findOne({ customer_code: candidate }, { session }))) {
                code = candidate;
                break;
              }
            }
            if (!code) throw new Error('Customer code allocation failed');
            row = {
              _id: id,
              ...customerCreateRow(createCustomerSchema.parse(input), auth.userId, number),
              customer_code: code,
              auth_user_id: null,
              created_at: now,
              updated_at: now,
            };
            row.ra_number = await companyId(db, row.ra_number, session, true);
            await collection.insertOne(row, { session });
          } else {
            const update = updateCustomerSchema.parse(input),
              patch = customerUpdatePatch(update);
            if (update.raNumber !== undefined)
              patch.ra_number = await companyId(db, update.raNumber, session, false);
            if (update.vipCardNumber === undefined && !before?.vip_card_number)
              patch.vip_card_number = await vipNumber(
                db,
                String(before?.stated_vip_package ?? before?.tier ?? 'BRONZE').toUpperCase(),
                session,
              );
            await collection.updateOne({ _id: id }, { $set: patch }, { session });
            row = { ...before!, ...patch };
          }
          await db.collection<MongoRow>('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: auth.userId,
              action: verb === 'POST' ? 'CUSTOMER_CREATED' : 'CUSTOMER_EDITED',
              entity_type: 'customer',
              entity_id: id,
              before_data: before ? { fullName: fullName(before), status: before.status } : null,
              after_data:
                verb === 'POST'
                  ? {
                      customerNumber: row.customer_number,
                      email: row.email,
                      createdBy: auth.userId,
                    }
                  : { fields: Object.keys(input), fullName: fullName(row), status: row.status },
              created_at: now,
            },
            { session },
          );
          return row;
        });
        return res
          .status(verb === 'POST' ? 201 : 200)
          .json(toCustomer({ ...after, id: after._id }));
      } finally {
        await session.endSession();
      }
    } catch (error) {
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
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(
          res,
          'CONFLICT',
          'That customer email, government ID or company identifier already exists',
          409,
        );
      return fail(res, 'INTERNAL', 'Customer service is unavailable', 503);
    }
  };
}
