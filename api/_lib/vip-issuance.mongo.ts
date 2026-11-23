import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';

export const VIP_ISSUANCE_SETUP = 'setup:vip-card-issuances';
const validNumber = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{11}[BGS]1[CT]\d{2}[SN]$/.test(value);
async function snapshot(db: Db, session?: ClientSession) {
  const customers = await db
    .collection<MongoRow>('customers')
    .find(
      { vip_card_number: { $type: 'string' } },
      { session, projection: { _id: 1, vip_card_number: 1 } },
    )
    .sort({ _id: 1 })
    .toArray();
  const issued = await db
    .collection<MongoRow>('vip_card_number_issuances')
    .find({}, { session })
    .sort({ _id: 1 })
    .toArray();
  const setup = await db
    .collection<MongoRow>('counters')
    .findOne({ _id: VIP_ISSUANCE_SETUP }, { session });
  return { customers, issued, setup };
}

/** Read-only shared-database plan. No collection/index/counter is created here. */
export async function inspectMongoVipIssuances(db: Db) {
  if (db.databaseName !== 'afhomes_dev') throw new Error('VIP setup scope must be afhomes_dev');
  const data = await snapshot(db),
    issues: string[] = [],
    missing: { vip_card_number: string; customer_id: string }[] = [];
  const counter = await db
    .collection<{ _id: string; seq: number }>('counters')
    .findOne({ _id: 'vip-card-number' });
  let minimumSequence = counter?.seq ?? 0;
  if (!Number.isSafeInteger(minimumSequence) || minimumSequence < 0 || minimumSequence > 99999)
    issues.push('INVALID_VIP_COUNTER');
  if (data.setup && data.setup.seq !== 1) issues.push('UNREVIEWED_VIP_SETUP_MARKER');
  const owners = new Map<string, string>();
  for (const row of data.issued) {
    if (
      !validNumber(row.vip_card_number) ||
      (typeof row.customer_id !== 'string' && typeof row.source_customer_id !== 'string') ||
      owners.has(String(row.vip_card_number))
    ) {
      issues.push('INVALID_EXISTING_VIP_ISSUANCE');
      continue;
    }
    owners.set(row.vip_card_number, String(row.customer_id ?? row.source_customer_id));
    minimumSequence = Math.max(minimumSequence, Number(row.vip_card_number.slice(6, 11)));
  }
  const current = new Set<string>();
  for (const row of data.customers) {
    if (!validNumber(row.vip_card_number) || current.has(row.vip_card_number)) {
      issues.push('INVALID_CUSTOMER_VIP_IDENTIFIER');
      continue;
    }
    current.add(row.vip_card_number);
    minimumSequence = Math.max(minimumSequence, Number(row.vip_card_number.slice(6, 11)));
    if (owners.has(row.vip_card_number) && owners.get(row.vip_card_number) !== row._id)
      issues.push('VIP_ISSUANCE_OWNER_CONFLICT');
    else if (!owners.has(row.vip_card_number))
      missing.push({ vip_card_number: row.vip_card_number, customer_id: row._id });
  }
  const indexes = await db
    .collection('vip_card_number_issuances')
    .listIndexes()
    .toArray()
    .catch(() => []);
  const indexReady = indexes.some(
    (index) =>
      index.unique === true &&
      !index.sparse &&
      !index.partialFilterExpression &&
      purchaseFingerprint(index.key) === purchaseFingerprint({ vip_card_number: 1 }),
  );
  const dataDigest = purchaseFingerprint(data);
  return {
    ready: issues.length === 0,
    issues,
    customers: data.customers.length,
    existingIssuances: data.issued.length,
    missing,
    minimumSequence,
    indexReady,
    enabled: data.setup?.seq === 1,
    dataDigest,
    digest: purchaseFingerprint({ dataDigest, minimumSequence, indexReady, missing, issues }),
  };
}

/** Exact approved operator apply only; does not import source records or alter identities. */
export async function installMongoVipIssuances(
  db: Db,
  client: MongoClient,
  actor: string,
  approvedDigest: string,
  progress: (stage: string) => void = () => {},
) {
  progress('setup-plan');
  const plan = await inspectMongoVipIssuances(db);
  if (!plan.ready || plan.digest !== approvedDigest || !approvedDigest)
    throw new Error('Reviewed VIP issuance setup required');
  progress('setup-index');
  await db
    .collection('vip_card_number_issuances')
    .createIndex({ vip_card_number: 1 }, { unique: true });
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      progress('setup-counter');
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .updateOne(
          { _id: 'vip-card-number' },
          { $max: { seq: plan.minimumSequence } },
          { upsert: true, session },
        );
      progress('setup-snapshot');
      const current = await snapshot(db, session);
      if (purchaseFingerprint(current) !== plan.dataDigest)
        throw new Error('VIP records changed; review a fresh setup plan');
      if (plan.enabled && !plan.missing.length) return;
      const now = new Date().toISOString();
      progress('setup-ledger');
      // insertMany forwards the client's timeoutMS again inside withTransaction in driver 7.7.
      for (const row of plan.missing)
        await db.collection<MongoRow>('vip_card_number_issuances').insertOne(
          {
            _id: row.vip_card_number,
            ...row,
            recorded_at: now,
            origin: 'native-customer-backfill',
          },
          { session },
        );
      progress('setup-marker');
      await db
        .collection<MongoRow>('counters')
        .updateOne(
          { _id: VIP_ISSUANCE_SETUP },
          { $set: { seq: 1, initialized_at: now } },
          { upsert: true, session },
        );
      progress('setup-audit');
      await db
        .collection<MongoRow>('audit_events')
        .insertOne(
          {
            _id: randomUUID(),
            actor_id: actor,
            action: 'VIP_CARD_ISSUANCE_LEDGER_INITIALIZED',
            entity_type: 'system_configuration',
            entity_id: VIP_ISSUANCE_SETUP,
            after_data: { backfilled: plan.missing.length, minimumSequence: plan.minimumSequence },
            created_at: now,
          },
          { session },
        );
    });
  } finally {
    await session.endSession();
  }
  return {
    ready: true,
    backfilled: plan.missing.length,
    minimumSequence: plan.minimumSequence,
    nativeAccountsChanged: false,
    sourceRecordsImported: 0,
  };
}

/** Reads history immediately; new writes begin only after the separately approved setup marker exists. */
export async function recordMongoVipIssuance(
  db: Db,
  number: string,
  customerId: string,
  session: ClientSession,
  mode: 'restore' | 'allocate' = 'restore',
) {
  const ledger = db.collection<MongoRow>('vip_card_number_issuances');
  const prior = await ledger.findOne({ vip_card_number: number }, { session });
  if (prior) {
    if (mode === 'allocate') return false;
    if (prior.customer_id === customerId || prior.source_customer_id === customerId) return true;
    throw new CustomerActivationError(409, 'This VIP card number was already issued');
  }
  const enabled = await db
    .collection<MongoRow>('counters')
    .findOne({ _id: VIP_ISSUANCE_SETUP, seq: 1 }, { session });
  if (!enabled) return true;
  try {
    await ledger.insertOne(
      {
        _id: number,
        vip_card_number: number,
        customer_id: customerId,
        recorded_at: new Date().toISOString(),
        origin: 'native-issuance',
      },
      { session },
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
      throw new CustomerActivationError(409, 'This VIP card number was already issued');
    throw error;
  }
  return true;
}
