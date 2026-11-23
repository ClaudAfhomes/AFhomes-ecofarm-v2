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
  // Phase 2 (2026-11-04): proposed, measured on disposable 10,000-customer data only. Like every
  // entry here they are never created by startup or core setup; only the digest-approved
  // `prepare-mongodb-performance.ts --apply` can add them, and only to afhomes_dev.
  { collection: 'memberships', name: 'read_card_fallback_hash', key: { fallback_code_hash: 1 } },
  { collection: 'memberships', name: 'read_card_qr_hash', key: { qr_token_hash: 1 } },
  { collection: 'customers', name: 'read_customers_created', key: { created_at: -1, _id: 1 } },
  {
    collection: 'customer_applications',
    name: 'read_applications_created',
    key: { created_at: -1 },
  },
  {
    collection: 'reservation_agreements',
    name: 'read_reservations_created',
    key: { created_at: -1 },
  },
  {
    collection: 'reservation_agreements',
    name: 'read_reservation_application_progress',
    key: { origin: 1, status: 1, customer_application_id: 1 },
  },
  {
    collection: 'audit_events',
    name: 'read_audit_entity_history',
    key: { entity_type: 1, entity_id: 1, created_at: -1 },
  },
  {
    collection: 'commissions',
    name: 'read_commission_staff_beneficiary',
    key: { beneficiary_staff_id: 1, created_at: -1 },
  },
  {
    collection: 'commissions',
    name: 'read_commission_ost_beneficiary',
    key: { beneficiary_ost_id: 1, created_at: -1 },
  },
  // Phase 6/7 (2026-11-04): Better Auth reads auth_sessions by token on every authenticated request
  // and the app revokes sessions by userId; only _id is indexed today. Proposed only - same
  // digest-approved, afhomes_dev-only apply as above; the unique token index needs that approval too.
  {
    collection: 'auth_sessions',
    name: 'unique_auth_session_token',
    key: { token: 1 },
    // Better Auth issues one random token per session and looks sessions up by it.
    options: { unique: true },
  },
  { collection: 'auth_sessions', name: 'read_auth_session_user', key: { userId: 1 } },
  // Phase 9 (2026-11-05): genealogy traversal for seller callers (who a member reports to, and who
  // reports to a set of members). Proposed only: same digest-approved, afhomes_dev-only apply. The
  // genealogy handler uses them only while findRelationshipTraversalIndexes confirms both.
  {
    collection: 'referral_relationships',
    name: 'read_relationship_subject_upline',
    key: { subject_staff_id: 1, upline_staff_id: 1 },
  },
  {
    collection: 'referral_relationships',
    name: 'read_relationship_upline_subject',
    key: { upline_staff_id: 1, subject_staff_id: 1 },
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
/**
 * Names of the two relationship indexes the genealogy traversal needs, or null unless both exist
 * with exactly the planned key and are usable (not partial, sparse, hidden, collated or TTL) on a
 * collection without a default collation. The traversal passes these names as query hints, so an
 * index dropped after this check makes its queries fail (and fall back) instead of scanning.
 */
export async function findRelationshipTraversalIndexes(db: Db) {
  const [collection] = await db.listCollections({ name: 'referral_relationships' }).toArray();
  if (!collection || (collection as { options?: { collation?: unknown } }).options?.collation)
    return null;
  const indexes = await db.collection('referral_relationships').listIndexes().toArray();
  const nameOf = (key: object) => {
    const index = indexes.find((entry) => sameKey(entry.key as object, key) && usable(entry));
    return typeof index?.name === 'string' ? index.name : null;
  };
  const subject = nameOf({ subject_staff_id: 1, upline_staff_id: 1 });
  const upline = nameOf({ upline_staff_id: 1, subject_staff_id: 1 });
  return subject && upline ? { subject, upline } : null;
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
    const unique = 'options' in candidate && candidate.options.unique === true;
    // A unique candidate is only satisfied by a unique index; any usable index serves a read one.
    const matches = (index: Record<string, unknown>) =>
      sameKey(index.key as object, candidate.key) &&
      usable(index) &&
      (!unique || index.unique === true);
    const equivalent = indexes.find(matches);
    const named = indexes.find((index) => index.name === candidate.name);
    // Same key with other options (e.g. an existing non-unique token index) cannot be created
    // alongside; it needs review instead of an apply.
    const optionClash =
      unique && !equivalent && indexes.some((index) => sameKey(index.key as object, candidate.key));
    const status = !collection
      ? 'missing-collection'
      : collection.options?.collation
        ? 'collection-collation-review'
        : named && !matches(named)
          ? 'index-name-conflict'
          : optionClash
            ? 'index-option-conflict'
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
    await db.collection(entry.collection).createIndex(entry.key, {
      name: entry.name,
      ...('options' in entry ? entry.options : {}),
    });
    added.push(`${entry.collection}/${entry.name}`);
  }
  return {
    added,
    deferred: plan.entries
      .filter((entry) => entry.status === 'missing-collection')
      .map((entry) => `${entry.collection}/${entry.name}`),
  };
}
