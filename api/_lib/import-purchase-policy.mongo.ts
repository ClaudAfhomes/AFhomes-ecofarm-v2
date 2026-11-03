import type { ClientSession, Db } from 'mongodb';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';

const refuse = (): never => {
  throw new CustomerActivationError(409, 'Historical commission provenance requires review');
};

export async function mongoImportPurchasePolicy(
  db: Db,
  applicationId: string,
  customerId: string,
  session: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const sources = await col('customer_import_purchase_sources')
    .find({ application_id: applicationId }, { session })
    .toArray();
  if (!sources.length) return null;
  if (sources.length !== 1) return refuse();
  const source = sources[0]!;
  if (source.customer_id !== customerId || source.superseded_by) return refuse();
  const row = await col('customer_import_rows').findOne(
    { _id: String(source.original_row_id) },
    { session },
  );
  if (!row || row.customer_id !== customerId || !row.committed_at) return refuse();
  const normalized = (row.normalized_data ?? {}) as Record<string, unknown>;
  if (normalized.externalVerified !== true) return null;
  const summary = (normalized.externalSummary ?? {}) as Record<string, unknown>;
  const stage = String(summary.stage ?? '');
  if (
    !['application', 'reservation', 'finance', 'activation', 'active', 'inactive'].includes(stage)
  )
    return refuse();
  const policy = await col('customer_import_commission_policies').findOne(
    { source_id: source._id },
    { session },
  );
  if (
    !policy ||
    typeof policy.settled_before_system !== 'boolean' ||
    policy.settled_before_system !== ['activation', 'active', 'inactive'].includes(stage)
  )
    return refuse();
  if (policy.original_summary_hash && policy.original_summary_hash !== purchaseFingerprint(summary))
    return refuse();
  const link = await col('customer_import_source_rows').findOne(
    { row_id: row._id, source_id: source._id },
    { session },
  );
  if (!link || !row.import_job_id) return refuse();
  return {
    sourceId: source._id,
    importJobId: String(row.import_job_id),
    importRowId: row._id,
    settledBeforeSystem: policy.settled_before_system,
  };
}
