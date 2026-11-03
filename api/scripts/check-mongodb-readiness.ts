import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { setupMongoPhase5 } from '../_lib/mongo-runtime.js';
import { inspectMongoDatabaseReadiness } from '../_lib/database-readiness.mongo.js';

let reference: Awaited<ReturnType<typeof createTestReplica>> | undefined;
try {
  if (process.argv.length > 2) throw new Error('This command accepts no write/apply options');
  reference = await createTestReplica();
  await setupMongoPhase5(reference.db);
  loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
  const { client, database } = createMongoClient();
  try {
    await client.connect();
    console.log(
      JSON.stringify(
        await inspectMongoDatabaseReadiness(client.db(database), reference.db),
        null,
        2,
      ),
    );
    console.log(
      'Read-only target inspection; schema setup ran only on a new disposable loopback replica.',
    );
  } finally {
    await client.close();
  }
} catch {
  console.error(
    'Readiness inspection failed; credentials, private records and raw database errors withheld.',
  );
  process.exitCode = 1;
} finally {
  await reference?.stop();
}
