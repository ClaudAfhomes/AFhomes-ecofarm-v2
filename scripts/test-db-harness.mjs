/**
 * `pnpm test:db:harness` - prove the database suite's own failure handling.
 *
 * The suite is the thing that decides whether the database is correct, so its
 * own control flow has to be testable too. One property in particular is
 * impossible to check from inside a normal green run:
 *
 *   an unexpected exception must be REPORTED, must still run `finally` cleanup,
 *   and must produce a NON-ZERO exit.
 *
 * That is not hypothetical. The suite once carried a `catch` that swallowed an
 * abort, which produced a short, entirely green run and exit code 0. Nothing in
 * the 493-check suite could see it, because the only symptom was the absence of
 * a check.
 *
 * This script runs the real suite twice against a disposable loopback
 * PostgreSQL:
 *
 *   1. normally                    -> must exit 0, must run section 37, and
 *                                     must leave every table at its pre-run count
 *   2. with fault injection armed  -> must exit non-zero, must report the abort,
 *                                     and must STILL leave every table at its
 *                                     pre-run count
 *
 * It is loopback-only by construction: it boots its own disposable server and
 * never reads a remote connection string.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDisposablePostgres } from './lib/local-postgres.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = ['tsx', 'supabase/db-integration.ts'];

/** Run the suite once, streaming its output, and return code + captured text. */
const runSuite = (env) =>
  new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', SUITE, {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      env,
      // Piped rather than inherited: the assertions below have to read the
      // suite's own report, and the operator still sees it streamed.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
      process.stderr.write(d);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });

const results = [];
const expect = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};

let postgres;
try {
  console.log('[harness] booting disposable local PostgreSQL…');
  postgres = await startDisposablePostgres();
  console.log(`[harness] applied ${postgres.applied.length} migrations`);
} catch (error) {
  console.error(`[harness] could not start the disposable database: ${error.message}`);
  process.exit(1);
}

const baseEnv = { ...process.env, AFHOMES_TEST_DATABASE_URL: postgres.url };

try {
  /* ------------------------------------------------------------------ */
  console.log('\n[harness] run 1 of 2: a normal run must be green and must clean up');
  /* ------------------------------------------------------------------ */
  const normal = await runSuite(baseEnv);
  expect('a normal run exits 0', normal.code === 0, `exit code ${normal.code}`);
  expect(
    'section 37 EXECUTES on the successful path',
    normal.out.includes('--- 37. Phase 5 reconciliation'),
    'the reconciliation section header never appeared',
  );
  expect(
    'the reconciliation is proven by execution (Case A)',
    normal.out.includes('CASE A: applying the reconciliation restores exact money formatting'),
    'no Case A repair assertion was reported',
  );
  expect(
    'and is a no-op on an already-correct database (Case B)',
    normal.out.includes('CASE B: re-applying the reconciliation leaves money exact'),
    'no Case B idempotence assertion was reported',
  );
  expect(
    'cleanup restores every table the suite writes',
    normal.out.includes('every table the suite writes is back to its pre-run row count'),
    'the cleanup verification check never ran',
  );
  expect(
    'no unexpected-error failure is reported on a clean run',
    !normal.out.includes('FAIL  suite completed without an unexpected error'),
    'an unexpected error was reported on a clean run',
  );

  /* ------------------------------------------------------------------ */
  console.log('\n[harness] run 2 of 2: an injected fault must be reported and must exit non-zero');
  /* ------------------------------------------------------------------ */
  const injected = await runSuite({
    ...baseEnv,
    AFHOMES_DB_TEST_INJECT_FAILURE: 'after-section-36',
  });
  expect(
    'an injected unexpected exception exits NON-ZERO',
    injected.code !== 0,
    `exit code ${injected.code}`,
  );
  expect(
    'the injected exception is reported as a failed check',
    injected.out.includes('FAIL  suite completed without an unexpected error'),
    'the abort was swallowed: no failed check was recorded',
  );
  expect(
    'the report names the deliberate fault',
    injected.out.includes('AFHOMES_DB_TEST_INJECT_FAILURE'),
    'the failure detail did not identify the injected fault',
  );
  expect(
    'cleanup STILL runs after the failure (finally, not best-effort)',
    injected.out.includes('--- 21. cleanup ---'),
    'the cleanup section never ran after the injected failure',
  );
  expect(
    'and every table is still back to its pre-run row count',
    injected.out.includes('every table the suite writes is back to its pre-run row count') &&
      !injected.out.includes('FAIL  every table the suite writes is back to its pre-run row count'),
    'cleanup did not fully restore the database after the injected failure',
  );
  expect(
    'a cleanup failure would also fail the suite',
    injected.out.includes('PASS  synthetic customers removed') ||
      injected.out.includes('FAIL  synthetic customers removed'),
    'the customers cleanup check was never evaluated',
  );
} finally {
  await postgres.stop();
}

const failed = results.filter((r) => !r.ok);
console.log('\n================ HARNESS SUMMARY ================');
console.log(
  `  total: ${results.length} harness checks, ${results.length - failed.length} passed, ${failed.length} failed`,
);
if (failed.length) {
  console.log('\n  failures:');
  for (const f of failed) console.log(`   - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
console.log('==================================================\n');
process.exit(failed.length === 0 ? 0 : 1);
