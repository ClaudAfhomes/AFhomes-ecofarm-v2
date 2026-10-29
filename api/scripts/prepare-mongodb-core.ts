import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import { inspectMongoCoreSetup, installMongoCoreSetup } from '../_lib/mongo-core-setup.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';
import { createS3PrivateObjectStore } from '../_lib/private-object-store.js';

const root = fileURLToPath(new URL('../../', import.meta.url)),
  args = process.argv.slice(2);
let stage = 'configuration';
try {
  const apply = args.includes('--apply');
  if (
    args.some((arg) => !['--plan', '--apply', '--approve-core-setup=afhomes_dev'].includes(arg)) ||
    (apply && !args.includes('--approve-core-setup=afhomes_dev'))
  )
    throw new Error('Explicit target approval is required for apply');
  loadEnvFile(path.join(root, '.env.local'));
  const { client, database } = createMongoClient();
  try {
    stage = 'connection';
    await client.connect();
    const db = client.db(database);
    if (apply) {
      stage = 'existing administrator';
      const owner = await db
        .collection<MongoRow>('admin_bootstrap')
        .findOne({ _id: 'initial-super-admin' });
      if (!owner || typeof owner.user_id !== 'string')
        throw new Error('Existing administrator marker is required');
      stage = 'additive core setup';
      await installMongoCoreSetup(db, client, owner.user_id);
    }
    let privateStorageConfigured = false;
    try {
      privateStorageConfigured = !!createS3PrivateObjectStore(process.env);
    } catch {
      /* Report configuration readiness without exposing secret values. */
    }
    console.log(
      JSON.stringify({ ...(await inspectMongoCoreSetup(db)), privateStorageConfigured }, null, 2),
    );
    console.log(
      apply
        ? 'Core setup completed. Existing users, passwords, assignments, permissions and business data were preserved.'
        : 'Read-only plan. No collections, indexes, reference rows or identities were written.',
    );
  } finally {
    await client.close();
  }
} catch (error) {
  const safeNames = [
    'MongoOperationTimeoutError',
    'MongoServerSelectionError',
    'MongoNetworkTimeoutError',
    'MongoInvalidArgumentError',
    'MongoServerError',
  ];
  const name =
    error instanceof Error && safeNames.includes(error.name) ? error.name : 'SETUP_FAILED';
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
      ? error.code
      : undefined;
  console.error(
    'MongoDB core preparation failed. No credentials or raw database errors are printed.',
    JSON.stringify({ stage, category: name, code }),
  );
  process.exitCode = 1;
}
