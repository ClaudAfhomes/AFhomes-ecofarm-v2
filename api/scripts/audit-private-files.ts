/**
 * Read-only audit of private-file references held in MongoDB.
 *
 * Usage: pnpm private-files:audit
 *
 * It never writes, deletes, or repairs anything. It reports how many referenced
 * objects are present or missing, grouped by collection and field. Keys are not
 * printed so the output is safe to share in a deployment ticket.
 */
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import {
  createProductionPrivateObjectStore,
  LocalPrivateObjectStore,
  type PrivateObjectStore,
} from '../_lib/private-object-store.js';

type Reference = {
  collection: string;
  field: string;
  prefix?: string;
};

const references: Reference[] = [
  { collection: 'profile_photos', field: 'object_key' },
  { collection: 'identity_documents', field: 'storage_path' },
  { collection: 'customer_import_payment_claims', field: 'proof_path', prefix: 'afhomes-payment-receipts/' },
  { collection: 'payments', field: 'receipt_storage_path' },
  { collection: 'reservation_agreements', field: 'receipt_storage_path' },
];

const root = fileURLToPath(new URL('../../', import.meta.url));

function storeFor(env: NodeJS.ProcessEnv): PrivateObjectStore {
  if (env.NODE_ENV === 'production') {
    const store = createProductionPrivateObjectStore(env);
    if (!store) throw new Error('Private storage is not configured');
    return store;
  }
  const storageRoot = env.AFHOMES_PRIVATE_STORAGE_ROOT?.trim();
  if (!storageRoot || !path.isAbsolute(storageRoot))
    throw new Error('AFHOMES_PRIVATE_STORAGE_ROOT must be absolute');
  return new LocalPrivateObjectStore({
    root: storageRoot,
    baseURL: 'http://127.0.0.1:3084',
    secret: env.BETTER_AUTH_SECRET ?? '',
  });
}

function keyFor(reference: Reference, value: string) {
  if (!reference.prefix || value.startsWith(reference.prefix)) return value;
  return reference.prefix + value;
}

async function main() {
  try {
    loadEnvFile(path.join(root, '.env.local'));
  } catch {
    // Production uses the process environment; a missing local file is fine.
  }
  const store = storeFor(process.env);
  const { client, database } = createMongoClient(process.env);
  try {
    await client.connect();
    const db = client.db(database);
    const report: Record<string, { total: number; present: number; missing: number; invalid: number }> = {};
    let missing = 0;
    for (const reference of references) {
      const rows = await db
        .collection(reference.collection)
        .find(
          { [reference.field]: { $type: 'string', $ne: '' } },
          { projection: { [reference.field]: 1 }, limit: 100_000 },
        )
        .toArray();
      const summary = { total: rows.length, present: 0, missing: 0, invalid: 0 };
      for (const row of rows) {
        const value = row[reference.field];
        if (typeof value !== 'string' || !value) continue;
        try {
          if (await store.exists(keyFor(reference, value))) summary.present += 1;
          else summary.missing += 1;
        } catch {
          summary.invalid += 1;
        }
      }
      missing += summary.missing + summary.invalid;
      report[`${reference.collection}.${reference.field}`] = summary;
    }
    const pendingCleanup = await db
      .collection('storage_cleanup_jobs')
      .countDocuments({ status: 'pending' });
    console.log(
      JSON.stringify(
        {
          provider: process.env.AFHOMES_PRIVATE_STORAGE_PROVIDER?.trim() || 'unset',
          database,
          references: report,
          pendingCleanupJobs: pendingCleanup,
          missingOrInvalid: missing,
        },
        null,
        2,
      ),
    );
    if (missing) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(() => {
  console.error('Private-file audit failed. No credentials or raw database errors are printed.');
  process.exitCode = 1;
});
