import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createMongoClient } from '../_lib/mongodb.js';
import { proposedMigrationCoreValidators } from '../_lib/migration-validators.mongo.js';
import { purchaseFingerprint } from '../_lib/purchase-fingerprint.js';

let stage = 'arguments';
try {
  if (process.argv.length !== 3 || process.argv[2] !== '--plan') throw new Error();
  stage = 'configuration';
  const env = parseEnv(await readFile(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8'));
  const { client, database } = createMongoClient(env);
  if (database !== 'afhomes_dev') throw new Error();
  try {
    stage = 'connection';
    await client.connect();
    const db = client.db(database), name = 'points_ledger';
    stage = 'read-only-review';
    const metadata = (await db.listCollections({ name }, { nameOnly: false }).toArray())[0];
    if (!metadata) throw new Error();
    const proposed = proposedMigrationCoreValidators()[name]!;
    const [documents, rejected] = await Promise.all([
      db.collection(name).countDocuments(),
      db.collection(name).countDocuments({ $nor: [proposed] }),
    ]);
    const current = { validator: metadata.options?.validator ?? {}, validationLevel: metadata.options?.validationLevel ?? 'strict', validationAction: metadata.options?.validationAction ?? 'error' };
    const plan = { database, collection: name, current, proposed: { validator: proposed, validationLevel: 'strict', validationAction: 'error' } };
    const report = { reviewedAt: new Date().toISOString(), ...plan, currentDocuments: documents, rejectedByProposal: rejected, readyForOwnerReview: rejected === 0, planDigest: purchaseFingerprint(plan), approved: false, databaseWrites: false, sourceDataImported: false };
    await writeFile(fileURLToPath(new URL('../../docs/mongodb/POINTS-LEDGER-VALIDATOR-PROPOSAL-2026-11-02.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ database, collection: name, currentDocuments: documents, rejectedByProposal: rejected, readyForOwnerReview: rejected === 0, planDigest: report.planDigest, databaseWrites: false }));
    if (rejected) process.exitCode = 1;
  } finally { await client.close(); }
} catch {
  console.error(`Ledger validator review failed at ${stage}; credentials and raw errors withheld.`);
  process.exitCode = 1;
}
