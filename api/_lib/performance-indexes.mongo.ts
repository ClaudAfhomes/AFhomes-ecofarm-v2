import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';

/** Additional read indexes only; existing unique/partial constraints are never replaced. */
export const MONGO_PERFORMANCE_INDEXES = [
  {
    collection: 'card_sale_hierarchy_snapshots',
    name: 'read_ancestor_sales',
    key: { ancestor_staff_id: 1, sale_id: 1 },
  },
  {
    collection: 'card_sales',
    name: 'read_staff_sales_period',
    key: { origin: 1, seller_staff_id: 1, created_at: -1, _id: 1 },
  },
  {
    collection: 'card_sales',
    name: 'read_ost_sales_period',
    key: { origin: 1, seller_ost_id: 1, created_at: -1, _id: 1 },
  },
  {
    collection: 'customer_import_rows',
    name: 'read_import_referrer',
    key: { 'raw_data.referrer_staff_id': 1, committed_at: 1 },
  },
  {
    collection: 'customer_import_rows',
    name: 'read_import_recommender',
    key: { 'raw_data.recommender_staff_id': 1, committed_at: 1 },
  },
  {
    collection: 'customer_import_purchase_sources',
    name: 'read_import_original_source',
    key: { original_row_id: 1, superseded_by: 1, created_at: 1, _id: 1 },
  },
] as const;
const sameKey = (left: object, right: object) => JSON.stringify(left) === JSON.stringify(right);
function usable(index: Record<string, unknown>) {
  return (
    !index.partialFilterExpression &&
    !index.sparse &&
    !index.hidden &&
    !index.collation &&
    index.expireAfterSeconds === undefined
  );
}
export async function inspectMongoPerformanceIndexes(db: Db) {
  const collections = new Map(
    (await db.listCollections({}, { nameOnly: false }).toArray()).map((entry) => [
      entry.name,
      entry,
    ]),
  );
  const entries = [];
  for (const candidate of MONGO_PERFORMANCE_INDEXES) {
    const collection = collections.get(candidate.collection);
    const indexes = collection
      ? await db.collection(candidate.collection).listIndexes().toArray()
      : [];
    const equivalent = indexes.find((index) => sameKey(index.key, candidate.key) && usable(index));
    const named = indexes.find((index) => index.name === candidate.name);
    const status = !collection
      ? 'missing-collection'
      : collection.options?.collation
        ? 'collection-collation-review'
        : named && (!sameKey(named.key, candidate.key) || !usable(named))
          ? 'index-name-conflict'
          : equivalent
            ? 'present'
            : 'missing';
    entries.push({ ...candidate, status, existingName: equivalent?.name ?? null });
  }
  return {
    database: db.databaseName,
    entries,
    digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}
/** Explicit digest-bound operator action. DDL can resume after interruption; it is not transactional. */
export async function installMongoPerformanceIndexes(db: Db, digest: string) {
  if (db.databaseName !== 'afhomes_dev') throw new Error('Performance indexes require afhomes_dev');
  const plan = await inspectMongoPerformanceIndexes(db);
  if (plan.digest !== digest) throw new Error('Index plan changed; review a fresh plan');
  if (
    plan.entries.some(
      (entry) => !['present', 'missing', 'missing-collection'].includes(entry.status),
    )
  )
    throw new Error('Index conflicts require review before any apply');
  const added: string[] = [];
  for (const entry of plan.entries.filter((entry) => entry.status === 'missing')) {
    await db.collection(entry.collection).createIndex(entry.key, { name: entry.name });
    added.push(`${entry.collection}/${entry.name}`);
  }
  return {
    added,
    deferred: plan.entries
      .filter((entry) => entry.status === 'missing-collection')
      .map((entry) => `${entry.collection}/${entry.name}`),
  };
}
