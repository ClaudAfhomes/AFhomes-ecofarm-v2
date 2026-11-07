import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { listMigrations } from './lib/local-postgres.mjs';

const require = createRequire(import.meta.url);
// The probe runs the entire fixture suite; identifier aliases survive a second suite's fixed legacy values.
assert(
  !(process.argv.includes('--audit-scan-probe') && process.argv.includes('--full')),
  'Run --audit-scan-probe and --full in separate disposable servers; the probe already runs the full suite.',
);
const execute = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`PostgreSQL control exited ${code}`)),
    );
  });
const dataDir = path.resolve('.tmp-bin/security-remediation');
assert.equal(path.dirname(dataDir), path.resolve('.tmp-bin'));
// Refuse before deleting a fixture directory if another run owns its fixed port.
const portCheck = net.createServer();
await new Promise((resolve, reject) => {
  portCheck.once('error', reject);
  portCheck.listen(55447, '127.0.0.1', resolve);
});
await new Promise((resolve) => portCheck.close(resolve));
fs.rmSync(dataDir, { recursive: true, force: true });
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'afhomes',
  password: 'afhomes-local-test',
  port: 55447,
  persistent: true,
  initdbFlags: process.platform === 'win32' ? ['-c', 'io_method=sync', '-E', 'UTF8'] : [],
  onLog: () => {},
  onError: () => {},
});
await server.initialise();
const ctl = path.resolve(
  path.dirname(require.resolve('embedded-postgres')),
  '../../@embedded-postgres/windows-x64/native/bin/pg_ctl.exe',
);
if (process.platform === 'win32')
  await execute(ctl, [
    '-D',
    dataDir,
    '-o',
    '-p 55447 -h 127.0.0.1 -c io_method=sync',
    '-l',
    path.join(dataDir, 'startup.log'),
    'start',
  ]);
else await server.start();
const client = new pg.Client({
  host: '127.0.0.1',
  port: 55447,
  user: 'afhomes',
  password: 'afhomes-local-test',
  database: 'postgres',
});
await client.connect();
assert.equal(
  (await client.query('select host(inet_server_addr()) host')).rows[0].host,
  '127.0.0.1',
);
const first = '20261129000001_afhomes_document_scope_security.sql';
const baseline = process.argv.includes('--baseline');
const applied = listMigrations().filter((file) => !baseline || file < first);
const localUrl = new URL('postgres://127.0.0.1:55447/postgres');
localUrl.username = 'afhomes';
localUrl.password = 'afhomes-local-test';
const postgres = { url: localUrl.href, applied };
const results = [];
try {
  await client.query(fs.readFileSync('supabase/db-testing/supabase-shim.sql', 'utf8'));
  for (const file of applied)
    await client.query(
      fs.readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/^\uFEFF/, ''),
    );
  const files = process.argv.includes('--release-preflight')
    ? ['docs/security/reproductions/release-catalog.mjs']
    : [
        'docs/security/reproductions/storage-scope.mjs',
        'docs/security/reproductions/rpc-password-gate.mjs',
      ];
  if (!baseline && !process.argv.includes('--release-preflight'))
    files.push('docs/security/reproductions/staff-security-gates.mjs');
  if (process.argv.includes('--performance')) files.push('docs/performance/benchmark.mjs');
  if (process.argv.includes('--index-gate')) files.push('docs/performance/verify-seller-index.mjs');
  if (process.argv.includes('--audit-scan-probe'))
    files.push('docs/security/reproductions/audit-reference-probe.mjs');
  if (process.argv.includes('--full')) files.push('supabase/db-integration.ts');
  for (const file of files) {
    const child = spawn(
      process.execPath,
      [...(file.endsWith('.ts') ? ['--import', 'tsx'] : []), file],
      {
        stdio: 'inherit',
        env: { ...process.env, AFHOMES_TEST_DATABASE_URL: postgres.url },
      },
    );
    const code = await new Promise((resolve) => {
      child.on('error', () => resolve(1));
      child.on('close', resolve);
    });
    results.push({ file, exit: code });
  }
  fs.writeFileSync(
    `docs/security/evidence/${process.argv.includes('--release-preflight') ? 'preflight-catalog-run' : 'security-remediation-' + (baseline ? 'red' : 'green')}.json`,
    JSON.stringify({ baseline, migrations: postgres.applied.length, results }, null, 2) + '\n',
  );
} finally {
  await client.end();
  if (process.platform === 'win32') await execute(ctl, ['-D', dataDir, 'stop', '-m', 'fast']);
  else await server.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
assert(
  !results.some((r) => (baseline ? r.exit === 0 : r.exit !== 0)),
  'Security regression child failed',
);
