import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createMongoClient } from '../_lib/mongodb.js';
import {
  captureLocalBackup,
  sealLocalBackup,
  openLocalBackup,
  restoreLocalBackup,
  backupChecksum,
} from '../_lib/local-mongo-backup.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const backupRoot = path.join(homedir(), '.afhomes', 'backups', 'afhomes_dev');
const privateRoot = path.join(homedir(), '.afhomes', 'private-storage', 'afhomes_dev');
const initializer = fileURLToPath(new URL('./Initialize-MongoLocalBackup.ps1', import.meta.url));
let stage = 'arguments';
let key: Buffer | undefined;
try {
  const [mode, name, ...extra] = process.argv.slice(2);
  if (
    !['plan', 'capture', 'verify'].includes(mode ?? '') ||
    extra.length ||
    (mode !== 'verify' && name) ||
    (mode === 'verify' && (!name || !/^[A-Za-z0-9_-]+\.afhb$/.test(name)))
  )
    throw new Error();
  stage = 'private-location';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', initializer], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (mode === 'plan') {
    console.log(
      JSON.stringify({
        mode,
        database: 'afhomes_dev',
        backupRoot,
        keyProtection: 'Windows DPAPI CurrentUser',
        offDeviceCopy: false,
        archiveLimitMiB: 64,
        capture: 'two matching snapshot/file passes; not an enforced write freeze',
      }),
    );
  } else {
    const secret = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', initializer, '-ExportKeyForProcess'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    key = Buffer.from(secret.toString('utf8').trim(), 'base64');
    secret.fill(0);
    if (key.length !== 32) throw new Error();
    if (mode === 'capture') {
      stage = 'source-snapshot';
      const env = parseEnv(await readFile(path.join(repository, '.env.local'), 'utf8'));
      const { client, database } = createMongoClient(env);
      try {
        await client.connect();
        const snapshot = await captureLocalBackup(client.db(database), privateRoot);
        stage = 'encrypt-and-store';
        const archive = sealLocalBackup(snapshot, key);
        const file = `afhomes_dev-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().replaceAll('-', '')}.afhb`;
        await writeFile(path.join(backupRoot, file), archive, { flag: 'wx', mode: 0o600 });
        const stored = await readFile(path.join(backupRoot, file));
        if (backupChecksum(stored) !== backupChecksum(archive)) throw new Error();
        openLocalBackup(stored, key);
        console.log(
          JSON.stringify({
            captured: true,
            file,
            backupRoot,
            encryptedBytes: stored.length,
            sha256: backupChecksum(stored),
            collections: snapshot.collections.length,
            documents: snapshot.collections.reduce(
              (sum, collection) => sum + collection.documents.length,
              0,
            ),
            files: snapshot.files.length,
            captureMethod: 'matching snapshot/file passes; no enforced write freeze',
            offDeviceCopy: false,
          }),
        );
      } finally {
        await client.close();
      }
    } else {
      stage = 'archive-authentication';
      const archive = await readFile(path.join(backupRoot, name!));
      const snapshot = openLocalBackup(archive, key);
      stage = 'independent-local-restore';
      const target = await createTestReplica();
      await mkdir(path.join(backupRoot, 'restore-checks'), { recursive: true });
      const scratch = await mkdtemp(path.join(backupRoot, 'restore-checks', 'verify-'));
      if (
        path.dirname(scratch) !== path.join(backupRoot, 'restore-checks') ||
        !path.basename(scratch).startsWith('verify-')
      ) {
        await target.stop();
        throw new Error();
      }
      try {
        await target.client.db('admin').command({ setParameter: 1, ttlMonitorEnabled: false });
        const summary = await restoreLocalBackup(
          target.client.db('afhomes_restore_' + randomUUID().replaceAll('-', '')),
          scratch,
          snapshot,
        );
        console.log(
          JSON.stringify({
            verifiedRestore: true,
            file: name,
            sha256: backupChecksum(archive),
            ...summary,
            sourceConnectionUsed: false,
            keyRecovery: 'current Windows user only',
            offDeviceCopy: false,
          }),
        );
      } finally {
        await target.stop();
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }
} catch {
  console.error(
    `Local backup stopped at ${stage}; credentials, private records, keys and raw errors withheld.`,
  );
  process.exitCode = 1;
} finally {
  key?.fill(0);
}
