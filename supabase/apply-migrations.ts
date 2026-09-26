/**
 * AF Homes-only migration runner.
 *
 * Safety properties (do not weaken):
 *  - Refuses to run unless AFHOMES_TARGET_PROJECT_REF equals the expected ref
 *    AND the DATABASE_URL actually points at that project. A matching env var
 *    with a foreign connection string is refused, not trusted.
 *  - Applies ONLY files in supabase/migrations, and refuses the whole run if
 *    any of them is not an AF Homes migration. The retired JAD migrations under
 *    legacy/ can never reach this path.
 *  - Each migration runs in its own transaction together with its history row,
 *    so a failure leaves no partial schema and no phantom history entry.
 *  - Connection strings, passwords and Supabase secrets are never logged.
 *  - No password, key or connection string is ever printed on any code path,
 *    including failures.
 *
 * Usage:
 *   npx pnpm db:migrate                # apply pending migrations
 *   npx pnpm db:migrate -- --check     # preflight only, no connection
 *
 * RUNTIME NOTE - why there is no top-level `await` in this file:
 * the repository root `package.json` declares no `"type"` field, so a `.ts` file
 * under `supabase/` (which has no package.json of its own) is treated as
 * CommonJS by Node's resolver. esbuild/tsx therefore targets the CJS output
 * format, where a top-level `await` is a syntax error, even though `tsc`
 * accepts it (`tsconfig.base.json` sets `"module": "ESNext"`). The `api/`
 * workspace avoids this by declaring `"type": "module"`. All async work
 * therefore lives in `main()`, which runs correctly under BOTH the CJS and the
 * ESM resolution, so the script stays valid if the root `"type"` ever changes.
 *
 * This runner resolves supabase/migrations relative to the current working
 * directory, so it must be invoked from the repository root. `--check` prints
 * the resolved directory so a wrong CWD is immediately visible.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { Client } from 'pg';

if (fs.existsSync('.env.local')) loadEnvFile('.env.local');

/** The one project this runner will ever touch. */
const EXPECTED_PROJECT_REF = 'ikaevepedpqygdlipsei';

const CHECK_ONLY = process.argv.includes('--check');

type Target = { connectionString: string; migrationsDir: string; files: string[] };

/* ---------------------------------------------------------------- */
/* Configuration and fail-closed guards                              */
/* ---------------------------------------------------------------- */

/**
 * Validate the operator environment and resolve the migration set. No network
 * call, no client, no write. Throws with an operator-facing message on any
 * problem, so the process fails closed before a connection is attempted.
 */
function readTarget(): Target {
  if (process.env.AFHOMES_TARGET_PROJECT_REF !== EXPECTED_PROJECT_REF) {
    throw new Error(
      `Refusing migration: AFHOMES_TARGET_PROJECT_REF must equal ${EXPECTED_PROJECT_REF}.`,
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  // The env var alone is not proof of target: DATABASE_URL decides where the
  // connection actually lands. Verify it, and never echo it when refusing.
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Refusing migration: DATABASE_URL is not a valid connection string.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Refusing migration: DATABASE_URL is not a postgres connection string.');
  }

  // Both documented connection styles are supported:
  //   direct   db.<ref>.supabase.co
  //   pooler   <region>.pooler.supabase.com, where the username carries the ref
  const isDirect = parsed.hostname === `db.${EXPECTED_PROJECT_REF}.supabase.co`;
  const isPooler =
    parsed.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(parsed.username) === `postgres.${EXPECTED_PROJECT_REF}`;
  if (!isDirect && !isPooler) {
    throw new Error(
      `Refusing migration: DATABASE_URL does not point at project ${EXPECTED_PROJECT_REF}. ` +
        `Set AFHOMES_TARGET_PROJECT_REF=${EXPECTED_PROJECT_REF} only when the connection string targets that same project.`,
    );
  }

  const migrationsDir = path.resolve('supabase/migrations');
  if (!fs.existsSync(migrationsDir) || !fs.statSync(migrationsDir).isDirectory()) {
    throw new Error(
      `Refusing migration: ${migrationsDir} is not a directory. Run this from the repository root.`,
    );
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.some((file) => !file.includes('afhomes_')))
    throw new Error('Non-AF Homes migration found in active path.');

  return { connectionString, migrationsDir, files };
}

/* ---------------------------------------------------------------- */
/* Migration run                                                     */
/* ---------------------------------------------------------------- */

async function main(): Promise<void> {
  // 1. Every guard runs before a client exists.
  const { connectionString, migrationsDir, files } = readTarget();

  if (CHECK_ONLY) {
    // Preflight only. No Client is constructed, so no socket is opened and no
    // migration can be applied.
    console.log('[afhomes:migrate] --check: configuration is valid. No connection was made.');
    console.log(`[afhomes:migrate] target project : ${EXPECTED_PROJECT_REF}`);
    console.log(`[afhomes:migrate] migrations dir  : ${migrationsDir}`);
    console.log(`[afhomes:migrate] migrations found: ${files.length}`);
    for (const file of files) console.log(`  - ${file}`);
    console.log(
      '[afhomes:migrate] No migration was applied. Re-run without --check to apply pending migrations.',
    );
    return;
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '28P01') {
      throw new Error(
        'Supabase rejected DATABASE_URL credentials. Copy a fresh Session pooler URI from ' +
          'Dashboard > Connect, keep username postgres.ikaevepedpqygdlipsei, replace only ' +
          '[YOUR-PASSWORD] with the database password (not the service-role key), and percent-encode ' +
          'reserved password characters. The already-live foundation does not need to be reapplied ' +
          'before running bootstrap:superadmin.',
      );
    }
    throw error;
  }
  try {
    await client.query('create schema if not exists supabase_migrations');
    await client.query(
      'create table if not exists supabase_migrations.schema_migrations (version text primary key)',
    );
    let appliedCount = 0;
    for (const file of files) {
      const version = file.split('_', 1)[0]!;
      const applied = await client.query(
        'select 1 from supabase_migrations.schema_migrations where version=$1',
        [version],
      );
      if (applied.rowCount) continue;
      await client.query('begin');
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
        await client.query(
          'insert into supabase_migrations.schema_migrations(version) values ($1)',
          [version],
        );
        await client.query('commit');
        appliedCount += 1;
        console.log(`[afhomes:migrate] applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    if (appliedCount === 0) {
      console.log(
        `[afhomes:migrate] no pending migrations (${files.length} known, all already recorded).`,
      );
    } else {
      console.log(`[afhomes:migrate] done. ${appliedCount} migration(s) applied.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Migration runner failed.',
  );
  process.exitCode = 1;
});
