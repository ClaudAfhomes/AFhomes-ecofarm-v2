import { testSearch } from './sale-team-search-cases.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { listMigrations } from './lib/local-postgres.mjs';

// Disposable loopback only. No environment credentials or shared project access.
const port = 55450;
const directory = path.resolve('.tmp-bin/sale-team-search-test');
assert.equal(path.dirname(directory), path.resolve('.tmp-bin'));
const portCheck = net.createServer();
await new Promise((resolve, reject) => {
  portCheck.once('error', reject);
  portCheck.listen(port, '127.0.0.1', resolve);
});
await new Promise((resolve) => portCheck.close(resolve));
fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const server = new EmbeddedPostgres({
  databaseDir: directory,
  user: 'afhomes',
  password: 'local-aa-test',
  port,
  persistent: true,
  initdbFlags: process.platform === 'win32' ? ['-c', 'io_method=sync', '-E', 'UTF8'] : [],
  onLog: () => {},
  onError: () => {},
});
const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`PostgreSQL control exited ${code}`)),
    );
  });
const require = createRequire(import.meta.url);
const ctl = path.resolve(
  path.dirname(require.resolve('embedded-postgres')),
  '../../@embedded-postgres/windows-x64/native/bin/pg_ctl.exe',
);
const clients = [];
let started = false;
let checks = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
try {
  await server.initialise();
  if (process.platform === 'win32')
    await run(ctl, [
      '-D',
      directory,
      '-o',
      `-p ${port} -h 127.0.0.1 -c io_method=sync`,
      '-l',
      path.join(directory, 'startup.log'),
      'start',
    ]);
  else await server.start();
  started = true;
  const connect = async () => {
    const db = new pg.Client({
      host: '127.0.0.1',
      port,
      user: 'afhomes',
      password: 'local-aa-test',
      database: 'postgres',
    });
    await db.connect();
    clients.push(db);
    return db;
  };
  const db = await connect();
  check((await db.query('select host(inet_server_addr()) host')).rows[0].host, '127.0.0.1');
  await db.query(fs.readFileSync('supabase/db-testing/supabase-shim.sql', 'utf8'));
  // Exercise the normalization migration's orphan preflight below before applying it.
  for (const file of listMigrations().filter(
    (name) => !name.endsWith('_afhomes_normalization_integrity.sql'),
  ))
    await db.query(fs.readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/^\uFEFF/, ''));
  // Reproduce recorded-but-absent search objects only inside this disposable loopback database.
  await db.query(`
    drop function public.begin_sale_team_search(text,text),
      public.reveal_sale_team_search(text,uuid,text,text,uuid),
      public.save_sale_team_search_contact(text,text,text,text),
      public.sale_team_search_contact_exists(uuid),
      public.cleanup_sale_team_search(integer);
    drop table private.sale_team_search_contacts,private.sale_team_search_disclosures,
      private.sale_team_search_attempts;
  `);
  const repair = fs.readFileSync(
    'supabase/migrations/20261212000002_afhomes_reconcile_public_sale_team_search.sql',
    'utf8',
  );
  await db.query(repair);
  await db.query(repair);
  check(
    Number((await db.query(`select count(*) from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('begin_sale_team_search','reveal_sale_team_search',
      'save_sale_team_search_contact','sale_team_search_contact_exists',
      'cleanup_sale_team_search')`)).rows[0].count),
    5,
    'Forward repair restores missing search functions and is safe to replay',
  );
  check(
    (
      await db.query(
        "select public,file_size_limit::int,allowed_mime_types from storage.buckets where id='afhomes-profile-photos'",
      )
    ).rows,
    [{ public: false, file_size_limit: 500000, allowed_mime_types: ['image/jpeg'] }],
    'Private profile-photo bucket cap and MIME',
  );
  checks += await testSearch(db, connect);
} finally {
  await Promise.all(clients.map((db) => db.end().catch(() => {})));
  if (started) {
    if (process.platform === 'win32') await run(ctl, ['-D', directory, 'stop', '-m', 'fast']);
    else await server.stop();
  }
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(
  `PASS: ${checks} real PostgreSQL AA/accreditation and normalization checks; all migrations applied locally; synthetic fixtures cleaned up.`,
);
