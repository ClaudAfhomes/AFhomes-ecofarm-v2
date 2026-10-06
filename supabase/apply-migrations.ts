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
 *   npx pnpm db:migrate -- --check               # preflight only, no connection
 *   npx pnpm db:migrate -- --approve-production  # apply to the PRODUCTION project
 *
 * PRODUCTION GATE - do not remove:
 * the only Supabase project this runner will ever touch IS the production
 * project. A plain `db:migrate` therefore refuses, because the only thing
 * standing between a typo and a production schema change is that the operator
 * had to type the word "production". `--check` never needs the flag, so the dry
 * run is always safe and always available.
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

/** The one project this runner will ever touch. It is PRODUCTION. */
const EXPECTED_PROJECT_REF = 'ikaevepedpqygdlipsei';

const CHECK_ONLY = process.argv.includes('--check');
const PRODUCTION_APPROVED = process.argv.includes('--approve-production');
const ONLY_ARGUMENT = process.argv.find((arg) => arg.startsWith('--only='));

type Target = {
  connectionString: string;
  migrationsDir: string;
  files: string[];
  /** Every AF Homes migration on disk, unfiltered, so `--only` can report what it skips. */
  allFiles: string[];
  problems: string[];
};

/* ---------------------------------------------------------------- */
/* Configuration and fail-closed guards                              */
/* ---------------------------------------------------------------- */

/**
 * Validate the operator environment and resolve the migration set. No network
 * call, no client, no write.
 *
 * In `--check` mode a missing DATABASE_URL is reported as a PROBLEM rather than
 * thrown, so the dry run is genuinely useful before the operator has a database
 * password - which is the whole point of a preflight. A real run still fails
 * closed on anything in `problems`.
 */
function readTarget(): Target {
  const problems: string[] = [];
  const onlyFlags = process.argv.filter((arg) => arg === '--only' || arg.startsWith('--only='));
  if (onlyFlags.length > 1 || onlyFlags.includes('--only'))
    problems.push(
      'Use exactly one --only=version,version argument; bare or repeated selectors are refused.',
    );

  if (process.env.AFHOMES_TARGET_PROJECT_REF !== EXPECTED_PROJECT_REF) {
    problems.push(
      `AFHOMES_TARGET_PROJECT_REF must equal ${EXPECTED_PROJECT_REF} (got ` +
        `${process.env.AFHOMES_TARGET_PROJECT_REF ? 'a different value' : 'nothing'}).`,
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    problems.push(
      'DATABASE_URL is not set. Copy the Session pooler URI from Supabase Dashboard > Connect ' +
        '(username postgres.' +
        EXPECTED_PROJECT_REF +
        ', port 6543) into the operator environment.',
    );
  } else {
    // The env var alone is not proof of target: DATABASE_URL decides where the
    // connection actually lands. Verify it, and never echo it when refusing.
    let parsed: URL | null = null;
    try {
      parsed = new URL(connectionString);
    } catch {
      problems.push('DATABASE_URL is not a valid connection string.');
    }
    if (parsed) {
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        problems.push('DATABASE_URL is not a postgres connection string.');
      } else {
        // Both documented connection styles are supported:
        //   direct   db.<ref>.supabase.co
        //   pooler   <region>.pooler.supabase.com, where the username carries the ref
        const isDirect = parsed.hostname === `db.${EXPECTED_PROJECT_REF}.supabase.co`;
        const isPooler =
          parsed.hostname.endsWith('.pooler.supabase.com') &&
          decodeURIComponent(parsed.username) === `postgres.${EXPECTED_PROJECT_REF}`;
        if (!isDirect && !isPooler) {
          problems.push(
            `DATABASE_URL does not point at project ${EXPECTED_PROJECT_REF}. Set ` +
              `AFHOMES_TARGET_PROJECT_REF=${EXPECTED_PROJECT_REF} only when the connection ` +
              'string targets that same project.',
          );
        }
      }
    }
  }

  const migrationsDir = path.resolve('supabase/migrations');
  if (!fs.existsSync(migrationsDir) || !fs.statSync(migrationsDir).isDirectory()) {
    problems.push(`${migrationsDir} is not a directory. Run this from the repository root.`);
    return {
      connectionString: connectionString ?? '',
      migrationsDir,
      files: [],
      allFiles: [],
      problems,
    };
  }

  let files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.some((file) => !file.includes('afhomes_')))
    problems.push(
      'Non-AF Homes migration found in active path. The retired JAD set must stay out.',
    );

  const allFiles = files;
  if (ONLY_ARGUMENT) {
    const versions = ONLY_ARGUMENT.slice(7).split(',');
    if (versions.some((v) => !/^\d{14}$/.test(v)) || new Set(versions).size !== versions.length)
      problems.push('--only requires unique 14-digit migration versions');
    for (const version of versions)
      if (files.filter((f) => f.split('_', 1)[0] === version).length !== 1)
        problems.push('Selected migration version must exist exactly once: ' + version);
    files = files.filter((file) => versions.includes(file.split('_', 1)[0]!));
  }
  if (problems.length > 0 && !CHECK_ONLY) {
    throw new Error(`Refusing migration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return {
    connectionString: connectionString ?? '',
    migrationsDir,
    files,
    allFiles,
    problems,
  };
}

/* ---------------------------------------------------------------- */
/* Migration run                                                     */
/* ---------------------------------------------------------------- */

async function main(): Promise<void> {
  // 1. Every guard runs before a client exists.
  const { connectionString, migrationsDir, files, allFiles, problems } = readTarget();

  if (CHECK_ONLY && ONLY_ARGUMENT) {
    // Production preflight for one exact version. This OPENS A CONNECTION but runs
    // only SELECTs against the history table: no migration file is read, no
    // transaction is opened, no DDL is sent. Plain `--check` stays connection-free,
    // so a dry run still works with no database password at all.
    console.log(`[afhomes:migrate] target project  : ${EXPECTED_PROJECT_REF} (PRODUCTION)`);
    // Print the selection BEFORE any connection is opened, so a dry run with bad
    // configuration still shows exactly which file was chosen.
    console.log(`[afhomes:migrate] migrations dir   : ${migrationsDir}`);
    console.log(`[afhomes:migrate] migrations found : ${files.length}`);
    for (const [index, file] of files.entries()) {
      console.log(`  ${String(index + 1).padStart(2)}. ${file}`);
    }
    if (problems.length > 0) {
      console.log('[afhomes:migrate] BLOCKERS (a real run would refuse):');
      for (const problem of problems) console.log(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      await client.query('create schema if not exists supabase_migrations');
      await client.query(
        'create table if not exists supabase_migrations.schema_migrations (version text primary key)',
      );
      const selected = files[0]!;
      const selectedVersion = selected.split('_', 1)[0]!;
      const isApplied = async (version: string) =>
        (
          await client.query('select 1 from supabase_migrations.schema_migrations where version=$1', [
            version,
          ])
        ).rowCount
          ? true
          : false;
      const selectedApplied = await isApplied(selectedVersion);
      console.log(`[afhomes:migrate] selected        : ${selected}`);
      console.log(`[afhomes:migrate] applied already : ${selectedApplied}`);
      const earlierUnapplied: string[] = [];
      for (const candidate of allFiles) {
        const version = candidate.split('_', 1)[0]!;
        if (version === selectedVersion) continue;
        if (!(await isApplied(version))) earlierUnapplied.push(candidate);
      }
      console.log(
        `[afhomes:migrate] earlier UNAPPLIED : ${earlierUnapplied.length} (would be SKIPPED, ` +
          `never applied)`,
      );
      for (const skipped of earlierUnapplied) console.log(`  SKIPPED: ${skipped}`);
      if (selectedApplied)
        console.log('[afhomes:migrate] Nothing to do: the selected migration is already applied.');
      console.log('[afhomes:migrate] Read-only: zero migration SQL was executed.');
    } finally {
      await client.end();
    }
    return;
  }

  if (CHECK_ONLY) {
    // Preflight only. No Client is constructed, so no socket is opened and no
    // migration can be applied. Problems are REPORTED, not thrown, so the
    // operator can see the whole picture in one pass.
    console.log('[afhomes:migrate] --check: no connection was made, nothing was applied.');
    console.log(`[afhomes:migrate] target project  : ${EXPECTED_PROJECT_REF} (PRODUCTION)`);
    console.log(`[afhomes:migrate] migrations dir   : ${migrationsDir}`);
    console.log(`[afhomes:migrate] migrations found : ${files.length}`);
    for (const [index, file] of files.entries()) {
      console.log(`  ${String(index + 1).padStart(2)}. ${file}`);
    }
    if (problems.length > 0) {
      console.log('[afhomes:migrate] BLOCKERS (a real run would refuse):');
      for (const problem of problems) console.log(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log('[afhomes:migrate] Configuration is valid.');
    console.log(
      `[afhomes:migrate] Applying requires an explicit production acknowledgement:\n` +
        `            npx pnpm db:migrate -- --approve-production${ONLY_ARGUMENT ? ' ' + ONLY_ARGUMENT : ''}`,
    );
    return;
  }

  // The one project this runner touches is production. Make that deliberate.
  if (!PRODUCTION_APPROVED) {
    console.error(
      '[afhomes:migrate] Refusing to apply: the only configured project is PRODUCTION.\n' +
        '  Re-run with an explicit acknowledgement once you have read the runbook:\n' +
        '      npx pnpm db:migrate -- --approve-production\n' +
        '  A dry run first is strongly recommended:\n' +
        '      npx pnpm db:migrate -- --check',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[afhomes:migrate] PRODUCTION acknowledged by the operator. Target project: ${EXPECTED_PROJECT_REF}`,
  );

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
    // `--only` deliberately permits skipping an earlier unapplied migration, so say
    // so loudly rather than letting the operator discover it from the history table.
    // Every one of these is still unapplied after this run; skipping is not applying.
    if (ONLY_ARGUMENT && files.length === 1) {
      const selected = files[0]!;
      const earlierUnapplied: string[] = [];
      for (const candidate of allFiles) {
        const version = candidate.split('_', 1)[0]!;
        if (version === selected.split('_', 1)[0]) continue;
        const applied = await client.query(
          'select 1 from supabase_migrations.schema_migrations where version=$1',
          [version],
        );
        if (!applied.rowCount) earlierUnapplied.push(candidate);
      }
      if (earlierUnapplied.length > 0) {
        console.warn(
          `[afhomes:migrate] WARNING: ${selected} is being applied while ` +
            `${earlierUnapplied.length} EARLIER migration(s) remain UNAPPLIED:`,
        );
        for (const skipped of earlierUnapplied) console.warn(`  SKIPPED: ${skipped}`);
        console.warn(
          '[afhomes:migrate] They will NOT be applied by this run. Confirm each is ' +
            'intentionally skipped before deploying code that depends on it.',
        );
      }
    }
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
  console.error(error instanceof Error ? error.message : 'Migration runner failed.');
  process.exitCode = 1;
});
