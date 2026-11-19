import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startDisposablePostgres } from './lib/local-postgres.mjs';

// Disposable loopback only; never loads repository credentials or a hosted project.
const postgres = await startDisposablePostgres({ beforeMigration: '20261226000001_afhomes_supabase_review_reason_reconciliation.sql' });
const db = postgres.client;
try {
  const original = readFileSync('supabase/migrations/20261210000003_afhomes_mirror_government_id_from_application.sql', 'utf8');
  assert(original.includes('government_id_number = case'));
  await db.query(original.replace('government_id_number = case',
    "government_id_type = coalesce(nullif(p_header->>'governmentIdType',''), c.government_id_type), government_id_number = case"));
  await db.query('grant execute on function public.purge_customer(uuid) to anon,authenticated');
  const id = randomUUID();
  const number = (await db.query('select customer_number from public.next_customer_number()')).rows[0].customer_number;
  await db.query("insert into public.customers(id,customer_number,first_name,last_name,email,phone,status,government_id_type,government_id_number) values($1,$2,'ANA','REYES',$3,'09175550001','prospect','passport',$4)",
    [id,number,`${id}@example.invalid`,randomUUID()]);
  const mirror = () => db.query("select private.mirror_application_onto_customer($1,'{\"governmentIdType\":\"drivers_license\"}','{}',null)",[id]);
  const customer = async () => (await db.query('select government_id_type,government_id_number from public.customers where id=$1',[id])).rows[0];
  const privileges = async () => (await db.query("select has_function_privilege('anon','public.purge_customer(uuid)','execute') anon,has_function_privilege('authenticated','public.purge_customer(uuid)','execute') authenticated,has_function_privilege('service_role','public.purge_customer(uuid)','execute') service")).rows[0];
  assert.deepEqual(await privileges(),{anon:true,authenticated:true,service:true});
  await mirror();
  assert.equal((await customer()).government_id_type,'drivers_license','Reproduces the observed relabeling drift');
  await db.query("update public.customers set government_id_type='passport' where id=$1",[id]);
  const before=await customer();
  const counts=async ()=>(await db.query('select (select count(*) from public.customers)::int customers,(select count(*) from public.card_sales)::int sales,(select count(*) from public.payments)::int payments,(select count(*) from public.audit_events)::int audit')).rows[0];
  const beforeCounts=await counts();
  for(let attempt=0;attempt<2;attempt++) {
    for(const file of ['20261226000001_afhomes_supabase_review_reason_reconciliation.sql','20261227000001_afhomes_develop_catalog_reconciliation.sql'])
      await db.query(readFileSync(`supabase/migrations/${file}`,'utf8'));
    assert.deepEqual(await privileges(),{anon:false,authenticated:false,service:true});
    assert.deepEqual(await customer(),before,'DDL changes no existing customer fields');
    assert.deepEqual(await counts(),beforeCounts,'Replaying reconciliation changes no business row counts');
  }
  await mirror();
  assert.deepEqual(await customer(),before,'Application input cannot relabel an existing government ID');
  for(const role of ['anon','authenticated']) {
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      await assert.rejects(db.query('select public.purge_customer($1)',[id]),e=>e.code==='42501');
    } finally {await db.query('rollback');}
  }
  assert.deepEqual(await customer(),before,'Denied browser purge leaves the customer intact');
  const reasons=(await db.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.customer_application_purchase_terms'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reason%'")).rows;
  assert.equal(reasons.length,1);
  assert.match(reasons[0].definition,/reason IS NULL/);
  const audit=await db.query(readFileSync('supabase/security/rls_invariants.sql','utf8'));
  for(const result of Array.isArray(audit)?audit:[audit])assert.equal(result.rows.length,0);
  console.log('Catalog reconciliation: PASS (drift reproduced, browser purge denied, ID type preserved, reason constraint repaired, replay stable, RLS invariants clean).');
} finally {await postgres.stop();}
