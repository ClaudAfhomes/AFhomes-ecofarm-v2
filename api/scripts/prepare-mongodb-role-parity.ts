import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import {
  inspectMongoRoleGrantParity,
  installMongoRoleGrantParity,
} from '../_lib/role-grant-parity.mongo.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';
try {
  const args = process.argv.slice(2),
    apply = args.includes('--apply'),
    digest = args.find((arg) => /^--approve-plan=[a-f0-9]{64}$/.test(arg))?.split('=')[1];
  if (
    args.some(
      (arg) =>
        !['--plan', '--apply', '--approve-role-parity=afhomes_dev'].includes(arg) &&
        !/^--approve-plan=[a-f0-9]{64}$/.test(arg),
    ) ||
    (apply && (!digest || !args.includes('--approve-role-parity=afhomes_dev')))
  )
    throw new Error('Exact target and plan approval required');
  loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
  const { client, database } = createMongoClient();
  try {
    await client.connect();
    const db = client.db(database);
    if (apply) {
      const owner = await db
        .collection<MongoRow>('admin_bootstrap')
        .findOne({ _id: 'initial-super-admin' });
      if (typeof owner?.user_id !== 'string') throw new Error('Existing owner required');
      console.log(
        JSON.stringify(await installMongoRoleGrantParity(db, client, owner.user_id, digest!)),
      );
    }
    console.log(JSON.stringify(await inspectMongoRoleGrantParity(db), null, 2));
    console.log(
      apply
        ? 'Reviewed absent grants added; saved grants/restrictions and accounts preserved.'
        : 'Read-only plan; no permissions, identities or configuration were changed.',
    );
  } finally {
    await client.close();
  }
} catch {
  console.error('Role grant plan/apply failed; credentials and raw database errors withheld.');
  process.exitCode = 1;
}
