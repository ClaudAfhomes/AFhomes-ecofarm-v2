/**
 * `pnpm test:db:local` - run the Phase 2 database integration suite against a
 * disposable local PostgreSQL.
 *
 * Boots a real server, applies every migration, runs the suite, tears the
 * server down and removes its data directory. The process exit code is the
 * suite's exit code, so CI can gate on it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDisposablePostgres } from './lib/local-postgres.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let postgres;
try {
  console.log('[db-test] booting disposable local PostgreSQL…');
  postgres = await startDisposablePostgres();
  console.log(`[db-test] applied ${postgres.applied.length} migrations:`);
  for (const file of postgres.applied) console.log(`[db-test]   - ${file}`);
  console.log('[db-test]   (no remote host, no production, loopback only)');
} catch (error) {
  console.error(`[db-test] could not start the disposable database: ${error.message}`);
  process.exit(1);
}

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'supabase/db-integration.ts'],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, AFHOMES_TEST_DATABASE_URL: postgres.url },
  },
);

// A hard ceiling on the whole suite. A database suite that hangs reports
// nothing at all, which is worse than a failure: it is indistinguishable from a
// slow machine. Past this budget the child is killed, the disposable server is
// still torn down, and the run exits non-zero so the hang is recorded as a
// failure rather than swallowed.
const SUITE_TIMEOUT_MS = Number(process.env.AFHOMES_DB_SUITE_TIMEOUT_MS ?? 15 * 60_000);
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`[db-test] suite exceeded ${SUITE_TIMEOUT_MS}ms; terminating`);
  child.kill('SIGKILL');
}, SUITE_TIMEOUT_MS);
timer.unref?.();

const code = await new Promise((resolve) => {
  child.on('close', resolve);
  // If the child dies without ever emitting close, settle rather than hang.
  child.on('error', () => resolve(1));
});

clearTimeout(timer);
await postgres.stop();
process.exit(timedOut ? 124 : (code ?? 1));
