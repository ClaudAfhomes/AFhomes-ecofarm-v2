import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { MongoServerError } from 'mongodb';
import { createMongoClient } from '../_lib/mongodb.js';
import { inspectMongoCoreValidators } from '../_lib/core-validators.mongo.js';

let stage = 'configuration';
try {
  if (process.argv.length > 2) throw new Error('This command accepts no write/apply options');
  loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
  const { client, database } = createMongoClient();
  try {
    stage = 'connection';
    await client.connect();
    stage = 'inspection';
    const review = await inspectMongoCoreValidators(client.db(database));
    console.log(JSON.stringify(review, null, 2));
    console.log('Read-only preflight only. No validators or records were created or changed.');
    if (!review.readyForReview) process.exitCode = 2;
  } finally {
    await client.close();
  }
} catch (error) {
  const code =
    error instanceof MongoServerError && typeof error.code === 'number' ? error.code : null;
  console.error(
    `Validator preflight failed at ${stage}${code === null ? '' : ` (server code ${code})`}; credentials, private records and raw errors withheld.`,
  );
  process.exitCode = 1;
}
