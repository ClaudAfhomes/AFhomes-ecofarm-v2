/**
 * `pnpm db:migrate` - apply pending Supabase migrations in filename order and
 * self-verify the result.
 *
 * Connects via `DATABASE_URL` (transaction pooler connection string from the
 * Dashboard - `db.<ref>.supabase.co` no longer resolves). Records applied
 * versions in `supabase_migrations.schema_migrations` (the Supabase CLI
 * convention) so `supabase db push` and this runner agree, and re-applying is
 * a no-op. Idempotent: each `.sql` file is written with `if not exists` /
 * `on conflict` guards, and this runner skips versions already recorded.
 *
 * Pure bookkeeping lives in api/_lib/migrations.ts (unit-tested); this file
 * only wires I/O. After applying it probes `to_regclass` for the messaging
 * tables and reminds about the RLS invariants audit.
 *
 * Run from the repo root: `pnpm db:migrate`
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

import { parseMigrationVersion, resolvePendingMigrations } from '../api/_lib/migrations.js';

function loadEnvFile(p: string) {
  try {
    const content = fs.readFileSync(p, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env) && value) process.env[key] = value;
    }
  } catch {}
}
loadEnvFile('.env');
loadEnvFile('apps/web/.env.local');
loadEnvFile('apps/admin/.env.local');

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const INVARIANTS_PATH = path.resolve('supabase/security/rls_invariants.sql');

async function appliedVersions(client: Client): Promise<string[]> {
  await client.query('create schema if not exists supabase_migrations');
  await client.query(
    'create table if not exists supabase_migrations.schema_migrations (version text primary key)',
  );
  const { rows } = await client.query('select version from supabase_migrations.schema_migrations');
  return rows.map((r: { version: string }) => r.version);
}

async function run(client: Client): Promise<void> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = await appliedVersions(client);

  // `--mark-existing`: an out-of-band database (migrations applied manually
  // via the SQL editor, never recorded) must not re-run every historical
  // file. Record every current migration version as applied first, then the
  // pending resolver only picks up genuinely new files.
  if (process.argv.includes('--mark-existing')) {
    let marked = 0;
    for (const file of files) {
      const version = parseMigrationVersion(file);
      if (version && !applied.includes(version)) {
        await client.query(
          'insert into supabase_migrations.schema_migrations (version) values ($1) on conflict do nothing',
          [version],
        );
        marked += 1;
      }
    }
    console.log(
      `[db:migrate] --mark-existing: recorded ${marked} existing migration(s) as applied.`,
    );
  }

  // Re-read after --mark-existing so only genuinely new files are pending.
  const pending = resolvePendingMigrations(files, await appliedVersions(client));

  if (pending.length === 0) {
    console.log(`[db:migrate] No pending migrations (${applied.length} recorded).`);
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const version = parseMigrationVersion(file);
    console.log(`[db:migrate] applying ${file}`);
    await client.query(sql);
    await client.query(
      'insert into supabase_migrations.schema_migrations (version) values ($1) on conflict do nothing',
      [version],
    );
    console.log(`[db:migrate] applied ${file}`);
  }

  // Self-verify: messaging tables resolvable by Postgres (PostgREST schema
  // cache follows the live catalog; a reload may still be needed in the
  // dashboard if it caches stale).
  const { rows } = await client.query(
    `select to_regclass('public."Conversation"') as conversation,
            to_regclass('public."Message"') as message`,
  );
  const { conversation, message } = rows[0] as {
    conversation: string | null;
    message: string | null;
  };
  if (conversation && message) {
    console.log('[db:migrate] OK: Conversation + Message tables present.');
  } else {
    console.error('[db:migrate] FAIL: messaging tables missing after apply:');
    console.error('  Conversation:', conversation ?? 'MISSING');
    console.error('  Message:', message ?? 'MISSING');
    process.exitCode = 1;
  }

  console.log(
    `[db:migrate] Run supabase/security/rls_invariants.sql in the SQL editor; expect only the documented is_staff_user exception row.`,
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      '[db:migrate] Missing DATABASE_URL. Add the current transaction-pooler connection string (Dashboard → Settings → Database → Connect) to root .env.',
    );
    process.exit(1);
  }
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[db:migrate] failed:', (e as Error).message);
  process.exit(1);
});
