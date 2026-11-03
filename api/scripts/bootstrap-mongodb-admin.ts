import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { verifyPassword } from 'better-auth/crypto';
import { createMongoClient } from '../_lib/mongodb.js';
import {
  AdminBootstrapError,
  bootstrapMongoAdmin,
  inspectMongoAdminBootstrap,
  mongoAdminBootstrapInput,
} from '../_lib/admin-bootstrap.mongo.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
let credentialsPath: string | undefined;
try {
  loadEnvFile(path.join(root, '.env.local'));
  const input = mongoAdminBootstrapInput.parse({
    email: value('--email'),
    fullName: value('--name'),
    temporaryPassword: `Tmp${randomBytes(24).toString('base64url')}9!`,
  });
  const { client, database } = createMongoClient();
  try {
    await client.connect();
    const db = client.db(database);
    const prior = await inspectMongoAdminBootstrap(db, input.email);
    if (prior.status === 'already_exists') {
      console.log(
        'MongoDB Super Admin already exists. No password, assignment or account was changed.',
      );
    } else if (!args.includes('--apply')) {
      console.log(
        'READY: afhomes_dev bootstrap preflight passed. No database writes. Use --apply to create the separate Super Admin.',
      );
    } else {
      const relative = `.tmp-bin/mongodb-bootstrap-${randomUUID()}/credentials.json`;
      execFileSync('git', ['check-ignore', '--quiet', relative], { cwd: root, stdio: 'pipe' });
      const folder = path.join(root, path.dirname(relative));
      fs.mkdirSync(folder, { mode: 0o700 });
      if (process.platform === 'win32') {
        if (!process.env.USERDOMAIN || !process.env.USERNAME)
          throw new Error('Local credential owner unavailable');
        execFileSync(
          'icacls.exe',
          [
            folder,
            '/inheritance:r',
            '/grant:r',
            `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,
          ],
          { stdio: 'pipe', windowsHide: true },
        );
      }
      credentialsPath = path.join(root, relative);
      fs.writeFileSync(
        credentialsPath,
        JSON.stringify(
          {
            database,
            email: input.email,
            temporaryPassword: input.temporaryPassword,
            mustChangePassword: true,
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
      const result = await bootstrapMongoAdmin(db, client, input);
      if (result.status === 'created') {
        const verified = await inspectMongoAdminBootstrap(db, input.email);
        const account = await db
          .collection<MongoRow>('auth_accounts')
          .findOne({ userId: result.userId, providerId: 'credential' });
        if (
          verified.status !== 'already_exists' ||
          !account ||
          !(await verifyPassword({
            hash: String(account.password),
            password: input.temporaryPassword,
          }))
        )
          throw new Error('Bootstrap verification failed');
        console.log(
          'PASS: Separate MongoDB Super Admin created and persisted credentials verified. Password change required. No invitations or Supabase changes.',
        );
        console.log(`Temporary password saved locally: ${credentialsPath}`);
      } else {
        fs.unlinkSync(credentialsPath);
        credentialsPath = undefined;
        console.log('MongoDB Super Admin already exists. No existing credentials were changed.');
      }
    }
  } finally {
    await client.close();
  }
} catch (error) {
  const serverCode =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
      ? error.code
      : undefined;
  console.error(
    error instanceof AdminBootstrapError
      ? error.message
      : 'MongoDB admin bootstrap did not complete verification. Check local configuration and target state; credentials and raw errors are suppressed.',
  );
  if (serverCode !== undefined)
    console.error(`Database operation failed with server code ${serverCode}.`);
  if (error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name))
    console.error(`Failure category: ${error.name}.`);
  if (credentialsPath)
    console.error(
      `Retain this private local credential file while reviewing the result: ${credentialsPath}`,
    );
  process.exitCode = 1;
}
