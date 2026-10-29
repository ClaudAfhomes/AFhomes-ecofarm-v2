import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { setupMongoImportClaims } from '../_lib/import-claim-records.mongo.js';
import { setupMongoImportJobs } from '../_lib/customer-import-jobs.mongo.js';
import {
  inspectMongoImportInitialization,
  installMongoImportInitialization,
} from '../_lib/import-initialization.mongo.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';
import { setupMongoHistoricalImports } from '../_lib/historical-import.mongo.js';
let reference: Awaited<ReturnType<typeof createTestReplica>> | undefined;
try {
  const args = process.argv.slice(2),
    apply = args.includes('--apply'),
    kind = args.includes('--historical') ? 'historical' : 'core',
    digest = args.find((arg) => /^--approve-plan=[a-f0-9]{64}$/.test(arg))?.split('=')[1];
  if (
    args.some(
      (arg) =>
        !['--plan', '--apply', '--historical', '--approve-import-setup=afhomes_dev', '--approve-historical-import-setup=afhomes_dev'].includes(arg) &&
        !/^--approve-plan=[a-f0-9]{64}$/.test(arg),
    ) ||
    (apply && (!digest || !args.includes(kind === 'core' ? '--approve-import-setup=afhomes_dev' : '--approve-historical-import-setup=afhomes_dev')))
  )
    throw new Error('Exact reviewed initialization approval required');
  reference = await createTestReplica();
  await setupMongoImportClaims(reference.db);
  await setupMongoImportJobs(reference.db);
  if (kind === 'historical') await setupMongoHistoricalImports(reference.db);
  loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
  const { client, database } = createMongoClient();
  try {
    await client.connect();
    const db = client.db(database);
    if (apply) {
      const owner = await db
        .collection<MongoRow>('admin_bootstrap')
        .findOne({ _id: 'initial-super-admin' });
      if (typeof owner?.user_id !== 'string') throw new Error('Existing bootstrap owner required');
      console.log(
        JSON.stringify(
          await installMongoImportInitialization(db, client, reference.db, owner.user_id, digest!, kind),
        ),
      );
    }
    console.log(JSON.stringify(await inspectMongoImportInitialization(db, reference.db, kind), null, 2));
    console.log(
      apply
        ? 'Import schema initialized; no people, financial data or source records migrated.'
        : 'Read-only target plan; canonical setup ran only on a fresh loopback replica.',
    );
  } finally {
    await client.close();
  }
} catch {
  console.error(
    'Import initialization plan/apply failed; credentials and raw database errors withheld.',
  );
  process.exitCode = 1;
} finally {
  await reference?.stop();
}
