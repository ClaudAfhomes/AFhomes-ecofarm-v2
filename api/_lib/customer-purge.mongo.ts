import { randomUUID } from 'node:crypto';
import type { Db, MongoClient, Filter } from 'mongodb';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { VercelRequest } from './http.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { checkKey, type PrivateObjectStore } from './private-object-store.js';

const OPERATION = 'customer.permanent-purge';
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
// Parent collections precede their children; never infer ownership from arbitrary matching UUIDs.
const LINKS: readonly [string, Record<string, string>][] = [
  ['card_sales', {}],
  ['customer_applications', {}],
  [
    'reservation_agreements',
    { customer_application_id: 'customer_applications', sale_id: 'card_sales' },
  ],
  ['memberships', { sale_id: 'card_sales' }],
  ['payments', { sale_id: 'card_sales', reservation_id: 'reservation_agreements' }],
  ['identity_documents', {}],
  ['customer_import_purchase_sources', { application_id: 'customer_applications' }],
  ['customer_import_rows', { sale_id: 'card_sales', membership_id: 'memberships' }],
  ['customer_import_payment_claims', { source_id: 'customer_import_purchase_sources' }],
  [
    'customer_import_source_rows',
    { source_id: 'customer_import_purchase_sources', row_id: 'customer_import_rows' },
  ],
  ['customer_external_import_receipts', { source_id: 'customer_import_purchase_sources' }],
  ['points_accounts', { membership_id: 'memberships' }],
  ['points_periods', { account_id: 'points_accounts' }],
  ['points_ledger', { account_id: 'points_accounts', membership_id: 'memberships' }],
  ['purchases', { membership_id: 'memberships' }],
  ['service_refunds', { purchase_id: 'purchases' }],
  ['service_refund_repayments', { refund_id: 'service_refunds' }],
  ['purchase_lines', { purchase_id: 'purchases' }],
  ['purchase_payments', { purchase_id: 'purchases' }],
  ['purchase_point_refunds', { purchase_id: 'purchases' }],
  ['earning_claims', { purchase_id: 'purchases', membership_id: 'memberships' }],
  ['redemptions', { membership_id: 'memberships' }],
  ['redemption_quotes', { approval_customer_id: 'customers', membership_id: 'memberships' }],
  ['commissions', { sale_id: 'card_sales' }],
  ['final_qualifications', { sale_id: 'card_sales' }],
  ['card_sale_hierarchy_snapshots', { sale_id: 'card_sales' }],
  ['customer_application_purchase_terms', { application_id: 'customer_applications' }],
  ['customer_application_holders', { application_id: 'customer_applications' }],
  [
    'customer_application_documents',
    { application_id: 'customer_applications', identity_document_id: 'identity_documents' },
  ],
  ['reservation_agreement_holders', { agreement_id: 'reservation_agreements' }],
  ['reservation_agreement_schedule', { agreement_id: 'reservation_agreements' }],
  [
    'reservation_agreement_documents',
    {
      agreement_id: 'reservation_agreements',
      payment_id: 'payments',
      identity_document_id: 'identity_documents',
    },
  ],
  [
    'purchase_document_evidence',
    {
      reservation_id: 'reservation_agreements',
      payment_id: 'payments',
      sale_id: 'card_sales',
      membership_id: 'memberships',
    },
  ],
  ['customer_onboarding_tokens', {}],
];
const FILE_FIELDS: readonly [string, string][] = [
  ['identity_documents', 'storage_path'],
  ['payments', 'receipt_storage_path'],
  ['customer_import_payment_claims', 'proof_path'],
  ['profile_photos', 'object_key'],
];

export async function purgeMongoCustomer(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  req: VercelRequest,
  id: string,
  objects?: PrivateObjectStore,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const session = client.startSession();
  let marker: MongoRow;
  try {
    marker = await session.withTransaction(
      async () => {
        for (const lock of ['organization-write', 'sales-write'])
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne({ _id: lock }, { $inc: { seq: 1 } }, { upsert: true, session });
        const fresh = await authorize(req, 'sales.customers', 'delete');
        if ('error' in fresh) return refuse(fresh.error.status, fresh.error.error.message);
        if (fresh.roleSlug !== 'super_admin')
          return refuse(403, 'Only Super Admin can permanently delete customers');
        const prior = await col('mutation_requests').findOne(
          { operation: OPERATION, request_id: id },
          { session },
        );
        if (prior) return prior;
        const customer = await col('customers').findOne({ _id: id }, { session });
        if (!customer) return refuse(404, 'Customer not found');
        const identity =
          typeof customer.auth_user_id === 'string' && customer.auth_user_id
            ? customer.auth_user_id
            : null;
        if (
          identity &&
          (identity === fresh.userId ||
            (await col('staff_users').findOne({ _id: identity }, { session })) ||
            (await col('customers').findOne(
              { _id: { $ne: id }, auth_user_id: identity },
              { session },
            )))
        )
          return refuse(409, 'Shared identity requires review before deleting customer login');

        const graph = new Map<string, MongoRow[]>([['customers', [customer]]]);
        const ids = (name: string) => (graph.get(name) ?? []).map((row) => row._id);
        async function collect(name: string, filter: Filter<MongoRow>) {
          // shortcut: unusually large purges need a reviewed maintenance operation, not an unbounded HTTP transaction.
          const rows = await col(name).find(filter, { session }).limit(10_001).toArray();
          if (rows.length > 10_000)
            return refuse(
              409,
              'Customer history is too large for online deletion; maintenance review is required',
            );
          if (rows.some((row) => row.customer_id != null && row.customer_id !== id))
            return refuse(
              409,
              'Cross-customer history links require review before permanent deletion',
            );
          graph.set(name, rows);
        }
        for (const [name, links] of LINKS) {
          await collect(name, {
            $or: [
              { customer_id: id },
              ...Object.entries(links).map(([field, parent]) => ({
                [field]: { $in: ids(parent) },
              })),
            ],
          });
          for (const [field, parent] of Object.entries(links)) {
            const parentIds = new Set(ids(parent));
            if (
              (graph.get(name) ?? []).some(
                (row) =>
                  row[field] != null && row[field] !== '' && !parentIds.has(row[field] as string),
              )
            )
              return refuse(
                409,
                'Cross-customer history links require review before permanent deletion',
              );
          }
        }
        if (identity) {
          await collect('profile_photos', { owner_id: identity });
          for (const [name, field] of [
            ['auth_users', '_id'],
            ['auth_sessions', 'userId'],
            ['auth_accounts', 'userId'],
            ['auth_two_factors', 'userId'],
            ['auth_session_assurance', 'user_id'],
          ])
            await collect(name!, { [field!]: identity });
        }
        const allIds = [...graph.values()].flatMap((rows) => rows.map((row) => row._id));
        if (allIds.length > 10_000)
          return refuse(
            409,
            'Customer history is too large for online deletion; maintenance review is required',
          );
        await collect('mutation_requests', {
          $or: [
            { result_id: { $in: allIds } },
            { 'result_receipt.customerId': id },
            { 'result_receipt.customer_id': id },
          ],
        });

        const keys = new Set<string>();
        for (const [name, field] of FILE_FIELDS) {
          for (const row of graph.get(name) ?? []) {
            const value = row[field];
            if (typeof value !== 'string' || !value) continue;
            const key =
              field === 'proof_path' && !value.startsWith('afhomes-payment-receipts/')
                ? `afhomes-payment-receipts/${value}`
                : value;
            checkKey(key);
            // Shared files remain for their other owners; remove only this customer's references.
            let shared = false;
            for (const [other, property] of FILE_FIELDS) {
              const values =
                property === 'proof_path'
                  ? [key, key.replace(/^afhomes-payment-receipts\//, '')]
                  : [key];
              if (
                await col(other).findOne(
                  { _id: { $nin: ids(other) }, [property]: { $in: values } },
                  { session, projection: { _id: 1 } },
                )
              ) {
                shared = true;
                break;
              }
            }
            if (!shared) keys.add(key);
          }
        }
        if (keys.size && !objects)
          return refuse(
            503,
            'Private storage is required before permanently deleting this customer',
          );
        const now = new Date().toISOString();
        for (const key of keys)
          await col('storage_cleanup_jobs').updateOne(
            { object_key: key },
            {
              $set: { status: 'pending' },
              $setOnInsert: { _id: randomUUID(), object_key: key, created_at: now },
            },
            { upsert: true, session },
          );
        // All database effects, including identity revocation and audit, commit or roll back together.
        for (const [name, rows] of [...graph.entries()].reverse())
          if (rows.length)
            await col(name).deleteMany({ _id: { $in: rows.map((row) => row._id) } }, { session });
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: fresh.userId,
            action: 'CUSTOMER_DELETED',
            entity_type: 'customer',
            entity_id: id,
            before_data: { customerNumber: customer.customer_number },
            after_data: {
              deleted: true,
              counts: Object.fromEntries([...graph].map(([name, rows]) => [name, rows.length])),
              privateFiles: keys.size,
            },
            created_at: now,
          },
          { session },
        );
        const completed: MongoRow = {
          _id: randomUUID(),
          actor_id: fresh.userId,
          operation: OPERATION,
          request_id: id,
          result_id: id,
          cleanup_keys: [...keys],
          created_at: now,
        };
        await col('mutation_requests').insertOne(completed, { session });
        return completed;
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
  } finally {
    await session.endSession();
  }

  // Storage is not transactional: retain a durable job and marker until every byte deletion succeeds.
  for (const key of marker.cleanup_keys as string[]) {
    const job = await col('storage_cleanup_jobs').findOne({ object_key: key });
    if (job?.status === 'completed') continue;
    if (!objects)
      return refuse(503, 'Customer removed; private file cleanup is pending. Retry to finish');
    try {
      await objects.remove(key);
      await col('storage_cleanup_jobs').updateOne(
        { object_key: key },
        { $set: { status: 'completed', completed_at: new Date().toISOString() } },
      );
    } catch {
      return refuse(503, 'Customer removed; private file cleanup is pending. Retry to finish');
    }
  }
  return { deleted: true as const };
}
