import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createMongoClient } from '../_lib/mongodb.js';
import { inspectMongoVipIssuances, installMongoVipIssuances } from '../_lib/vip-issuance.mongo.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';

let stage = 'arguments';
try {
  const args = process.argv.slice(2),
    apply = args.includes('--apply');
  const digest = args.find((arg) => /^--approve-plan=[a-f0-9]{64}$/.test(arg))?.split('=')[1];
  if (
    args.some(
      (arg) =>
        !['--plan', '--apply', '--approve-vip-ledger=afhomes_dev'].includes(arg) &&
        !/^--approve-plan=[a-f0-9]{64}$/.test(arg),
    ) ||
    (apply
      ? !digest || !args.includes('--approve-vip-ledger=afhomes_dev') || args.includes('--plan')
      : args.length !== 1 || args[0] !== '--plan')
  )
    throw new Error();
  stage = 'configuration';
  const env = parseEnv(
    await readFile(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8'),
  );
  const { client, database } = createMongoClient(env);
  if (database !== 'afhomes_dev') throw new Error();
  try {
    stage = 'connection';
    await client.connect();
    const db = client.db(database);
    stage = 'read-only-plan';
    const plan = await inspectMongoVipIssuances(db);
    if (!apply) {
      const report = {
        reviewedAt: new Date().toISOString(),
        database,
        ready: plan.ready,
        issues: plan.issues,
        currentCustomersWithVip: plan.customers,
        existingIssuances: plan.existingIssuances,
        nativeBackfillRecords: plan.missing.length,
        minimumSequence: plan.minimumSequence,
        indexReady: plan.indexReady,
        enabled: plan.enabled,
        approvedDigest: plan.digest,
        sourceRecordsImported: 0,
        identityChanges: false,
        databaseWrites: false,
      };
      await writeFile(
        fileURLToPath(
          new URL('../../docs/mongodb/VIP-ISSUANCE-SETUP-PLAN-2026-11-02.json', import.meta.url),
        ),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(JSON.stringify(report));
      if (!plan.ready) process.exitCode = 1;
    } else {
      stage = 'approved-setup';
      const owner = await db
        .collection<MongoRow>('admin_bootstrap')
        .findOne({ _id: 'initial-super-admin' });
      if (typeof owner?.user_id !== 'string') { stage = 'existing-administrator-marker'; throw new Error(); }
      const result = await installMongoVipIssuances(db, client, owner.user_id, digest!, (value) => { stage = value; });
      const report = {
        ...result,
        appliedAt: new Date().toISOString(),
        database,
        approvedDigest: digest,
      };
      await writeFile(
        fileURLToPath(
          new URL('../../docs/mongodb/VIP-ISSUANCE-SETUP-APPLY-2026-11-02.json', import.meta.url),
        ),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(JSON.stringify(report));
    }
  } finally {
    await client.close();
  }
} catch (error) {
  if (error instanceof Error && ['Reviewed VIP issuance setup required', 'VIP records changed; review a fresh setup plan'].includes(error.message)) stage = error.message;
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
    ? error.code : undefined;
  const kind = error instanceof Error && /^[A-Za-z]{1,80}$/.test(error.name) ? error.name : 'Error';
  console.error(
    `VIP ledger setup failed at ${stage} (${kind}${code === undefined ? '' : `, database code ${code}`}). No credentials or raw database errors are printed.`,
  );
  process.exitCode = 1;
}
