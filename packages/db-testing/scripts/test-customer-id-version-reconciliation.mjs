import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startDisposablePostgres, listMigrations } from './lib/local-postgres.mjs';

const repair = '20261215000002_afhomes_reconcile_customer_id_search_path.sql';
const sql = file => readFileSync(new URL('../../../supabase/migrations/' + file, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
for (const skipped of [
  '20261215000001_afhomes_company_customer_id_format.sql',
  '20261215000001_afhomes_search_path_canonical.sql',
]) {
  const server = await startDisposablePostgres({ beforeMigration: repair, excludedMigrations: [skipped] });
  try {
    const db = server.client;
    await db.query(sql(repair));
    const id = randomUUID();
    await db.query("insert into public.customers(id,customer_number,first_name,last_name,email,phone,status) values($1,'AF-CUS-RECONCILE','MARIA','SANTOS','maria@afhomes-local.test','+639178462992','prospect')", [id]);
    const snapshot = async () => (await db.query('select ra_number from public.customers where id=$1', [id])).rows[0].ra_number;
    const issued = await snapshot();
    assert.match(issued, /^\d{4}-\d{4,}$/);
    await db.query(sql(repair));
    assert.equal(await snapshot(), issued);
    const config = (await db.query("select proconfig from pg_proc where oid='private.reconcile_external_customer_import(uuid,uuid,text)'::regprocedure")).rows[0].proconfig;
    assert(config.includes('search_path=pg_catalog, extensions, private, public, pg_temp'));
    assert.equal((await db.query("select has_function_privilege('authenticated','private.assign_company_customer_id()','execute') allowed")).rows[0].allowed, false);
    for (const file of listMigrations().filter(file => file > repair)) await db.query(sql(file));
    assert.equal(await snapshot(), issued);
    const definition = (await db.query("select pg_get_functiondef('private.assign_company_customer_id()'::regprocedure) body")).rows[0].body;
    await db.query(sql(repair));
    assert.equal((await db.query("select pg_get_functiondef('private.assign_company_customer_id()'::regprocedure) body")).rows[0].body, definition);
    console.log('PASS: recovered ' + skipped + '; ID preserved and later migrations apply');
  } finally { await server.stop(); }
}
