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

const code = await new Promise((resolve) => child.on('close', resolve));

await postgres.stop();
process.exit(code ?? 1);
