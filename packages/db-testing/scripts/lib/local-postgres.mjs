/**
 * Disposable local PostgreSQL for the Phase 2 database integration suite.
 *
 * Boots a real PostgreSQL server (via `embedded-postgres`), applies the
 * Supabase platform shim and then every `afhomes_` migration in order, and
 * hands back a ready connection. Everything it creates lives in a throwaway
 * data directory that is deleted on exit.
 *
 * It is a TEST fixture only. It never reads `SUPABASE_URL`,
 * `AFHOMES_TARGET_PROJECT_REF`, or any other repository configuration, and it
 * cannot be pointed at a remote host: the connection is always loopback.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

/** Never collide with a developer's own PostgreSQL on 5432. */
const PORT = Number(process.env.AFHOMES_TEST_PG_PORT ?? 55432);
const DATA_DIR = path.join(REPO_ROOT, '.tmp-bin', 'pg-integration');
/** Throwaway credential for the disposable server only. Not a real secret. */
const LOCAL_PASSWORD = 'afhomes-local-test';

const SHIM = path.join(REPO_ROOT, 'supabase', 'db-testing', 'supabase-shim.sql');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

/** Migrations in application order. The runner is the single source of this list. */
export function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/**
 * Boot a disposable PostgreSQL, install the shim, and apply every migration.
 * @param {{ beforeMigration?: string }} [options] Exclusive baseline migration boundary.
 * @returns {{ url: string, applied: string[], client: import('pg').Client, stop: () => Promise<void> }}
 */
export async function startDisposablePostgres({ beforeMigration } = {}) {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'afhomes',
    password: LOCAL_PASSWORD,
    database: 'afhomes',
    port: PORT,
    persistent: true,
    // Windows I/O workers can outlive this disposable cluster and stall the next initdb.
    initdbFlags: process.platform === 'win32' ? ['-c', 'io_method=sync'] : [],
    postgresFlags: process.platform === 'win32' ? ['-c', 'io_method=sync'] : [],
    onLog: () => {},
    onError: () => {},
  });

  await server.initialise();
  await server.start();

  const client = server.getPgClient();
  client.on('error', () => {});
  await client.connect();

  // Do not assume a database name: ask the server which one it actually
  // created, so the URL handed to the suite can never point at a database that
  // does not exist.
  const { rows } = await client.query('select current_database() as name, current_user as usr');
  const database = rows[0].name;
  const user = rows[0].usr;

  console.log(
    '[db-test] target host=127.0.0.1 port=' +
      PORT +
      ' database=' +
      database +
      ' pid=' +
      fs.readFileSync(path.join(DATA_DIR, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0],
  );
  await client.query(fs.readFileSync(SHIM, 'utf8'));

  const migrations = listMigrations();
  if (beforeMigration && !migrations.includes(beforeMigration)) {
    await client.end();
    await server.stop();
    throw new Error('Unknown baseline migration boundary');
  }
  const applied = [];
  for (const file of migrations.filter((file) => !beforeMigration || file < beforeMigration)) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query(sql);
      applied.push(file);
    } catch (error) {
      await client.end();
      await server.stop().catch(() => {});
      throw new Error(
        `Migration ${file} failed on real PostgreSQL: ${
          error instanceof Error ? error.message.split('\n')[0] : String(error)
        }`,
      );
    }
  }

  return {
    // A throwaway loopback credential for a server this process just created and
    // will delete. It is passed by environment variable and never logged.
    url: `postgres://${user}:${LOCAL_PASSWORD}@127.0.0.1:${PORT}/${database}`,
    database,
    dataDir: DATA_DIR,
    pid: Number(fs.readFileSync(path.join(DATA_DIR, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]),
    applied,
    client,
    async stop() {
      await client.end().catch(() => {});
      await server.stop().catch(() => {});
      // Windows keeps a brief lock on the data directory after the server exits.
      // Removal is best-effort: the directory lives under .tmp-bin and is
      // recreated from scratch on the next run, so a leftover is harmless.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          fs.rmSync(DATA_DIR, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
      console.warn(
        '[db-test] note: the disposable data directory is still locked and was left behind.',
      );
    },
  };
}
