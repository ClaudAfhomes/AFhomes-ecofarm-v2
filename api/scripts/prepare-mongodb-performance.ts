import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import {
  inspectMongoPerformanceIndexes,
  installMongoPerformanceIndexes,
} from '../_lib/performance-indexes.mongo.js';
try {
  const args = process.argv.slice(2),
    apply = args.includes('--apply');
  const digest = args.find((arg) => /^--approve-plan=[a-f0-9]{64}$/.test(arg))?.split('=')[1];
  if (
    args.some(
      (arg) =>
        !['--plan', '--apply', '--approve-indexes=afhomes_dev'].includes(arg) &&
        !/^--approve-plan=[a-f0-9]{64}$/.test(arg),
    ) ||
    (apply && (!digest || !args.includes('--approve-indexes=afhomes_dev')))
  )
    throw new Error('Exact index approval required');
  loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
  const { client, database } = createMongoClient();
  try {
    await client.connect();
    const db = client.db(database);
    if (apply) console.log(JSON.stringify(await installMongoPerformanceIndexes(db, digest!)));
    console.log(JSON.stringify(await inspectMongoPerformanceIndexes(db), null, 2));
    console.log(
      apply
        ? 'Reviewed read indexes added; no existing indexes or business records removed.'
        : 'Read-only index plan; no database changes.',
    );
  } finally {
    await client.close();
  }
} catch {
  console.error('Index plan/apply failed; credentials and raw database errors withheld.');
  process.exitCode = 1;
}
