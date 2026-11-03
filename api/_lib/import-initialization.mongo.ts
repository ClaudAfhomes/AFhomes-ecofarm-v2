import type { Db, MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { setupMongoImportClaims } from './import-claim-records.mongo.js';
import { setupMongoImportJobs } from './customer-import-jobs.mongo.js';
import { MONGO_PERFORMANCE_INDEXES } from './performance-indexes.mongo.js';
import { purchaseFingerprint } from './purchase-records.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { setupMongoHistoricalImports } from './historical-import.mongo.js';

export const MONGO_HISTORICAL_IMPORT_COLLECTIONS = [
  'customer_external_import_receipts', 'customer_import_commission_policies', 'customer_import_points_baselines',
] as const;
type ImportSetupKind = 'core' | 'historical';

export const MONGO_IMPORT_COLLECTIONS = [
  'customer_import_jobs',
  'customer_import_payment_claims',
  'customer_import_purchase_sources',
  'customer_import_rows',
  'customer_import_source_rows',
] as const;
const signature = (index: Record<string, unknown>) =>
  purchaseFingerprint({
    key: Object.entries(index.key as object),
    unique: index.unique === true,
    partial: index.partialFilterExpression ?? null,
    sparse: index.sparse === true,
    hidden: index.hidden === true,
    collation: index.collation ?? null,
    ttl: index.expireAfterSeconds ?? null,
  });
const readIndexes = MONGO_PERFORMANCE_INDEXES.filter((index) =>
  index.collection.startsWith('customer_import_'),
);
export async function inspectMongoImportInitialization(db: Db, reference: Db, kind: ImportSetupKind = 'core') {
  if (
    db.databaseName !== 'afhomes_dev' ||
    reference.databaseName !== 'afhomes_dev' ||
    db.client === reference.client ||
      !reference.client.options.hosts.every((host) =>
        ['127.0.0.1', 'localhost', '::1'].includes(host.host ?? ''),
    )
  )
    throw new Error('Independent loopback reference required');
  const collections = [];
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (collection) => collection.name,
    ),
  );
  for (const name of kind === 'core' ? MONGO_IMPORT_COLLECTIONS : MONGO_HISTORICAL_IMPORT_COLLECTIONS) {
    const present = existing.has(name),
      saved = present ? await db.collection(name).listIndexes().toArray() : [];
    const expected = (await reference.collection(name).listIndexes().toArray())
      .filter((index) => index.name !== '_id_')
      .map((index) => ({
        key: index.key,
        unique: index.unique === true,
        ...(index.partialFilterExpression
          ? { partialFilterExpression: index.partialFilterExpression }
          : {}),
      }));
    expected.push(
      ...readIndexes
        .filter((index) => index.collection === name)
        .map((index) => ({ key: index.key, unique: false })),
    );
    collections.push({
      name,
      present,
      count: present ? await db.collection(name).countDocuments({}) : 0,
      missingIndexes: expected.filter(
        (index) => !saved.some((current) => signature(current) === signature(index)),
      ),
    });
  }
  return { database: db.databaseName, collections, digest: purchaseFingerprint(collections) };
}

/** Explicit operator action only. DDL is additive and may require a fresh plan after interruption. */
export async function installMongoImportInitialization(
  db: Db,
  client: MongoClient,
  reference: Db,
  actor: string,
  digest: string,
  kind: ImportSetupKind = 'core',
) {
  if (db.client !== client) throw new Error('Matching target client required');
  const col = (name: string) => db.collection<MongoRow>(name);
  const owner = await col('admin_bootstrap').findOne({
    _id: 'initial-super-admin',
    user_id: actor,
  });
  const staff = await col('staff_users').findOne({ _id: actor, status: 'active' });
  const assignment = await col('staff_role_assignments').findOne({ staff_id: actor });
  const role =
    assignment &&
    (await col('roles').findOne({
      _id: String(assignment.role_id),
      slug: 'super_admin',
      is_active: true,
    }));
  if (!owner || !staff || !role) throw new Error('Existing active bootstrap owner required');
  const plan = await inspectMongoImportInitialization(db, reference, kind);
  if (plan.digest !== digest) throw new Error('Import initialization plan changed');
  if (plan.collections.some((entry) => entry.count > 0 && entry.missingIndexes.length))
    throw new Error('Existing import records require a separately reviewed index plan');
  const changed = plan.collections.some((entry) => !entry.present || entry.missingIndexes.length);
  if (changed) {
    if (kind === 'historical') await setupMongoHistoricalImports(db);
    else {
    await setupMongoImportClaims(db);
    await setupMongoImportJobs(db);
    for (const index of readIndexes)
      await db.collection(index.collection).createIndex(index.key, { name: index.name });
    }
  }
  const verified = await inspectMongoImportInitialization(db, reference, kind);
  if (verified.collections.some((entry) => !entry.present || entry.missingIndexes.length))
    throw new Error('Import index verification failed');
  const session = client.startSession();
  const receiptId = kind === 'core' ? 'imports-v1' : 'historical-imports-v1';
  try {
    await session.withTransaction(
      async () => {
        const receipt = await col('mongo_conversion_setup').findOne(
          { _id: receiptId },
          { session },
        );
        if (receipt) return;
        await col('mongo_conversion_setup').insertOne(
          {
            _id: receiptId,
            actor_id: actor,
            plan_digest: digest,
            created_at: new Date().toISOString(),
          },
          { session },
        );
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: actor,
            action: kind === 'core' ? 'MONGO_IMPORT_SCHEMA_INITIALIZED' : 'MONGO_HISTORICAL_IMPORT_SCHEMA_INITIALIZED',
            entity_type: 'mongo_conversion_setup',
            entity_id: receiptId,
            after_data: {
              planDigest: digest,
              collections: kind === 'core' ? [...MONGO_IMPORT_COLLECTIONS] : [...MONGO_HISTORICAL_IMPORT_COLLECTIONS],
              canonicalIndexes: kind === 'core' ? 9 : 6,
              readIndexes: kind === 'core' ? 3 : 0,
            },
            created_at: new Date().toISOString(),
          },
          { session },
        );
      },
      { timeoutMS: 45000 },
    );
  } finally {
    await session.endSession();
  }
  return {
    initializedCollections: changed
      ? plan.collections.filter((entry) => !entry.present).map((entry) => entry.name)
      : [],
    current: verified,
  };
}
