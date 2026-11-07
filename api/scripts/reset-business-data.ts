import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createMongoClient } from '../_lib/mongodb.js';
import { openLocalBackup } from '../_lib/local-mongo-backup.js';
import {
  RESET_DATABASE,
  ResetRefused,
  applyBusinessDataReset,
  planBusinessDataReset,
  verifyBackupRestorable,
} from '../_lib/business-data-reset.mongo.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';

/**
 * One-time business-data reset for afhomes_dev. See docs/mongodb/BUSINESS-DATA-RESET.md.
 *   --plan                                     read-only inventory and fingerprint
 *   --apply --confirm-target afhomes_dev --fingerprint <hex> --backup <archive.afhb>
 */
const repository = fileURLToPath(new URL('../../', import.meta.url));
const backupRoot = path.join(homedir(), '.afhomes', 'backups', 'afhomes_dev');
const initializer = fileURLToPath(new URL('./Initialize-MongoLocalBackup.ps1', import.meta.url));
const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const usage =
  'Usage: --plan | --apply --confirm-target afhomes_dev --fingerprint <hex> --backup <archive.afhb>';

let stage = 'arguments';
let key: Buffer | undefined;
try {
  const args = process.argv.slice(2);
  const mode = args[0];
  const options = new Map<string, string>();
  for (let at = 1; at < args.length; at += 2) {
    const [name, value] = [args[at]!, args[at + 1]];
    if (!['--confirm-target', '--fingerprint', '--backup'].includes(name) || !value)
      throw new ResetRefused(usage);
    if (options.has(name)) throw new ResetRefused(usage);
    options.set(name, value);
  }
  if (mode === '--plan' ? options.size !== 0 : mode !== '--apply' || options.size !== 3)
    throw new ResetRefused(usage);

  stage = 'environment';
  const env = parseEnv(await readFile(path.join(repository, '.env.local'), 'utf8'));
  for (const source of [env, process.env]) {
    if (
      (source.AFHOMES_MONGODB_SCOPE ?? 'development') !== 'development' ||
      source.NODE_ENV === 'production' ||
      source.AFHOMES_HOSTED_RUNTIME_ENABLED === 'true' ||
      ![undefined, '', RESET_DATABASE].includes(source.MONGODB_DB?.trim())
    )
      throw new ResetRefused('Production or non-afhomes_dev configuration refused.');
  }

  let backup;
  if (mode === '--apply') {
    if (options.get('--confirm-target') !== RESET_DATABASE)
      throw new ResetRefused('Confirm the target with --confirm-target afhomes_dev.');
    stage = 'backup-name';
    const name = options.get('--backup')!;
    const stamp =
      /^afhomes_dev-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})-[a-f0-9]{32}\.afhb$/.exec(
        name,
      );
    if (!stamp) throw new ResetRefused('Backup must be an afhomes_dev .afhb archive name.');
    const [, y, mo, d, h, mi, s, ms] = stamp.map(Number);
    const age = Date.now() - Date.UTC(y!, mo! - 1, d!, h!, mi!, s!, ms!);
    if (!(age >= -5 * 60 * 1000 && age <= BACKUP_MAX_AGE_MS))
      throw new ResetRefused('Backup is older than 60 minutes. Capture a new backup.');

    stage = 'backup-key';
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', initializer], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const secret = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', initializer, '-ExportKeyForProcess'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    key = Buffer.from(secret.toString('utf8').trim(), 'base64');
    secret.fill(0);
    if (key.length !== 32) throw new Error();

    stage = 'backup-authentication';
    backup = openLocalBackup(await readFile(path.join(backupRoot, name)), key);

    stage = 'independent-restore';
    const target = await createTestReplica();
    try {
      await target.client.db('admin').command({ setParameter: 1, ttlMonitorEnabled: false });
      await verifyBackupRestorable(backup, target.client, path.join(backupRoot, 'restore-checks'));
    } finally {
      await target.stop();
    }
  }

  stage = 'database';
  const { client, database } = createMongoClient(env);
  if (database !== RESET_DATABASE) throw new ResetRefused('Reset target must be afhomes_dev.');
  try {
    await client.connect();
    const db = client.db(database);
    const result =
      mode === '--plan'
        ? await planBusinessDataReset(db)
        : await applyBusinessDataReset(db, {
            fingerprint: options.get('--fingerprint')!,
            confirmTarget: options.get('--confirm-target')!,
            backup: backup!,
          });
    console.log(JSON.stringify(result, null, 2));
    if (mode === '--plan' && !('applied' in result) && !result.ready) process.exitCode = 2;
  } finally {
    await client.close();
  }
} catch (error) {
  console.error(
    error instanceof ResetRefused
      ? `Reset refused: ${error.message}`
      : `Reset stopped at ${stage}; credentials, private records, keys and raw errors withheld.`,
  );
  process.exitCode = 1;
} finally {
  key?.fill(0);
}
