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
const port = 55449;
const directory = path.resolve('.tmp-bin/sale-team-test');
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
  for (const file of listMigrations())
    await db.query(fs.readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/^\uFEFF/, ''));
  const actor = randomUUID(),
    seller = randomUUID(),
    other = randomUUID(),
    outsider = randomUUID(),
    ost = randomUUID();
  for (const [id, role] of [
    [actor, 'super_admin'],
    [seller, 'sales_manager'],
    [other, 'vice_director'],
    [outsider, 'employee'],
    [ost, 'ost'],
  ]) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC AA SELLER','active')",
      [id, `${id}@example.invalid`],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
  }
  check(
    (await db.query('select count(*)::int n from private.sale_team_accreditations')).rows[0].n,
    0,
    'No automatic historical backfill',
  );
  const manage = async (
    connection,
    target,
    action = 'approve',
    kind = 'IST',
    by = actor,
    start = '2020-01-01',
    end = '2099-12-31',
  ) =>
    (
      await connection.query(
        'select public.manage_sale_team_accreditation($1,$2,$3,$4,$5,$6) result',
        [by, target, kind, action, start, end],
      )
    ).rows[0].result;
  const search = async (number) =>
    (await db.query('select public.search_sale_team_accreditation($1) result', [number])).rows[0]
      .result;
  const first = await manage(db, seller);
  assert.match(first.aaNumber, /^AA-[A-Z0-9]{12}$/);
  check((first.aaNumber.slice(3).match(/[A-Z]/g) ?? []).length, 6, 'Six letters');
  check((first.aaNumber.slice(3).match(/[0-9]/g) ?? []).length, 6, 'Six digits');
  const generated = (
    await db.query('select private.next_sale_team_aa_number() value from generate_series(1,1000)')
  ).rows.map((row) => row.value);
  check(new Set(generated).size, 1000, 'Random sample uniqueness');
  check(
    generated.every(
      (value) =>
        /^AA-[A-Z0-9]{12}$/.test(value) &&
        (value.slice(3).match(/[A-Z]/g) ?? []).length === 6 &&
        (value.slice(3).match(/[0-9]/g) ?? []).length === 6,
    ),
    true,
    'Random sample composition',
  );
  checks++;
  check(first.status, 'accredited');
  check(await search(first.aaNumber), first);
  check(
    Object.keys(first).sort(),
    ['aaNumber', 'kind', 'fullName', 'status', 'startsOn', 'expiresOn'].sort(),
    'Explicit public fields',
  );
  check((await manage(db, seller)).aaNumber, first.aaNumber, 'Idempotent approval');
  await db.query("update public.staff_users set full_name='SELF EDITED NAME' where id=$1", [
    seller,
  ]);
  check(
    (await search(first.aaNumber)).fullName,
    first.fullName,
    'Self-edit cannot change the approved public identity',
  );
  check(
    (await manage(db, seller)).fullName,
    'SELF EDITED NAME',
    'Explicit approval refreshes the public name',
  );
  check((await manage(db, seller)).aaNumber, first.aaNumber, 'Name review preserves AA');
  const a = await connect(),
    b = await connect();
  const same = await Promise.all([manage(a, other), manage(b, other)]);
  check(same[0].aaNumber, same[1].aaNumber, 'Concurrent same-seller issuance');
  check(same[0].aaNumber === first.aaNumber, false, 'Unique across sellers');
  await db.query('begin');
  await db.query(
    "update public.staff_role_assignments set role_id=(select id from public.roles where slug='sales_manager') where staff_id=$1",
    [outsider],
  );
  await db.query("select set_config('afhomes.aa_collision_existing',$1,true)", [first.aaNumber]);
  await db.query('create temporary sequence aa_collision_calls');
  await db.query(
    "create or replace function private.next_sale_team_aa_number() returns text language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$ declare calls integer; begin calls:=nextval('pg_temp.aa_collision_calls'); return case when calls=1 then current_setting('afhomes.aa_collision_existing') else 'AA-ABCDEF123456' end; end $$",
  );
  await db.query('savepoint collision');
  const retryIssued = await manage(db, outsider);
  check(retryIssued.aaNumber, 'AA-ABCDEF123456', 'Collision retries with a new number');
  check(
    Number((await db.query('select last_value from aa_collision_calls')).rows[0].last_value),
    2,
    'Single collision needs exactly two attempts',
  );
  await db.query('rollback to savepoint collision');
  await db.query(
    "create or replace function private.next_sale_team_aa_number() returns text language sql volatile security definer set search_path=pg_catalog,pg_temp as $$ select current_setting('afhomes.aa_collision_existing') $$",
  );
  await assert.rejects(manage(db, outsider), (error) => error.code === '23505');
  checks++;
  await db.query('rollback');
  check(
    (await db.query('select public.get_sale_team_accreditation($1) result', [outsider])).rows[0]
      .result,
    null,
    'Exhausted collisions leave no issuance',
  );
  await assert.rejects(manage(db, outsider), /INVALID_ACCREDITATION_TARGET/);
  checks++;
  await db.query("update public.staff_users set status='invited' where id=$1", [seller]);
  await assert.rejects(manage(db, seller), /INVALID_ACCREDITATION_TARGET/);
  checks++;
  await db.query("update public.staff_users set status='active' where id=$1", [seller]);
  await assert.rejects(manage(db, seller, 'approve', 'IST', seller), /FORBIDDEN/);
  checks++;
  await db.query('update public.staff_users set must_change_password=true where id=$1', [actor]);
  await assert.rejects(manage(db, seller), /FORBIDDEN/);
  checks++;
  await db.query('update public.staff_users set must_change_password=false where id=$1', [actor]);
  await manage(db, seller, 'revoke');
  check(await search(first.aaNumber), null, 'Revoked denied');
  check((await manage(db, seller)).aaNumber, first.aaNumber, 'Reapproval preserves number');
  await manage(db, seller, 'approve', 'IST', actor, '2020-01-01', '2020-12-31');
  check(await search(first.aaNumber), null, 'Expiry denied');
  await manage(db, seller, 'approve', 'IST', actor, '2090-01-01', '2099-12-31');
  check(await search(first.aaNumber), null, 'Future accreditation denied');
  await manage(db, seller);
  await db.query("update public.staff_users set status='suspended' where id=$1", [seller]);
  check(await search(first.aaNumber), null, 'Suspended denied');
  await db.query("update public.staff_users set status='active' where id=$1", [seller]);
  await db.query("update public.roles set is_active=false where slug='sales_manager'");
  check(await search(first.aaNumber), null, 'Inactive role denied');
  await db.query("update public.roles set is_active=true where slug='sales_manager'");
  const code = randomUUID(),
    application = randomUUID();
  await db.query(
    "insert into public.referral_codes(id,sponsor_staff_id,code_hash,code_hint,expires_at,created_by) values($1,$2,repeat('a',64),'AA TEST',now()+interval '1 day',$3)",
    [code, seller, actor],
  );
  await db.query(
    "insert into public.ost_applications(id,referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address,status) values($1,$2,$3,'aa-ost@example.invalid','+639171234567','SYNTHETIC','SELLER','1990-01-01','{}','approved')",
    [application, code, seller],
  );
  await db.query(
    "insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,approved_by) values($1,$2,$3,'OST-AA-TEST','SYNTHETIC SELLER','aa-ost@example.invalid','+639171234567',$4)",
    [ost, application, seller, actor],
  );
  const term = randomUUID();
  await db.query(
    "insert into private.ost_accreditation_terms(id,ost_id,application_id,starts_on,expires_on,approved_by) values($1,$2,$3,'2020-01-01','2099-12-31',$4)",
    [term, ost, application, actor],
  );
  const ostRecord = (await db.query('select public.get_sale_team_accreditation($1) result', [ost]))
    .rows[0].result;
  await db.query("update public.staff_users set status='suspended' where id=$1", [ost]);
  await assert.rejects(manage(db, ost, 'approve', 'OST'), /INVALID_ACCREDITATION_TARGET/);
  checks++;
  await db.query("update public.staff_users set status='active' where id=$1", [ost]);
  // Exercise real account installation: new staff are invited, not active yet.
  const newAuth = randomUUID(),
    newApplication = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    newAuth,
    `${newAuth}@example.invalid`,
  ]);
  await db.query(
    "insert into public.ost_applications(id,referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address,status) values($1,$2,$3,$4,'+639171234567','SYNTHETIC','NEW SELLER','1990-01-01','{}','under_review')",
    [newApplication, code, seller, `${newAuth}@example.invalid`],
  );
  await db.query(
    "insert into private.ost_registration_details(application_id,request_id,payload_hash,date_applied,form_number,program_category,official_details,referrer_snapshot,applicant_signature_status,referrer_signature_status,endorsed_by,endorsed_at,source) values($1,$2,repeat('c',64),'2026-01-01','AA-NEW-OST-TEST','non_vip','{}','{}','received','received',$3,now(),'manual')",
    [newApplication, randomUUID(), actor],
  );
  const install = (start, end) =>
    db.query('select public.install_ost_accreditation_identity($1,$2,$3,$4,$5)', [
      newApplication,
      actor,
      newAuth,
      start,
      end,
    ]);
  await assert.rejects(install('2099-01-01', '2020-01-01'), /VALIDITY_REQUIRED/);
  checks++;
  check(
    (await db.query('select count(*)::int n from public.staff_users where id=$1', [newAuth]))
      .rows[0].n,
    0,
    'Refused approval leaves no staff profile',
  );
  check(
    (await db.query('select public.get_sale_team_accreditation($1) result', [newAuth])).rows[0]
      .result,
    null,
    'Refused approval leaves no AA',
  );
  await install('2020-01-01', '2099-12-31');
  const newlyIssued = (
    await db.query('select public.get_sale_team_accreditation($1) result', [newAuth])
  ).rows[0].result;
  assert.match(newlyIssued.aaNumber, /^AA-[A-Z0-9]{12}$/);
  checks++;
  check(newlyIssued.status, 'inactive', 'Invited account has its AA but is not publicly verified');
  check(await search(newlyIssued.aaNumber), null, 'Invite acceptance is still required');
  await db.query("update public.staff_users set status='active' where id=$1", [newAuth]);
  check(
    (await search(newlyIssued.aaNumber)).aaNumber,
    newlyIssued.aaNumber,
    'Activation makes the approved AA verifiable',
  );
  await install('2020-01-01', '2099-12-31');
  check(
    (await search(newlyIssued.aaNumber)).aaNumber,
    newlyIssued.aaNumber,
    'Approval retry keeps the same AA',
  );
  check(ostRecord.kind, 'OST', 'Automatic approved OST issuance');
  check(await search(ostRecord.aaNumber), ostRecord);
  await db.query("update private.ost_accreditation_terms set status='superseded' where id=$1", [
    term,
  ]);
  const renewal = randomUUID();
  await db.query(
    "insert into private.ost_accreditation_renewals(id,renewal_number,request_id,payload_hash,ost_id,prior_term_id,date_of_renewal,requested_start,requested_end,status,applicant_snapshot,original_accreditation_date,last_expiry_date,old_sponsor_staff_id,referrer_snapshot,applicant_signature_status,referrer_signature_status,created_by,approved_by,approved_at) values($1,'AA-RENEWAL-TEST',$2,repeat('b',64),$3,$4,'2021-01-01','2021-01-01','2099-12-30','approved','{}','2020-01-01','2099-12-31',$5,'{}','received','received',$6,$6,now())",
    [renewal, randomUUID(), ost, term, seller, actor],
  );
  await db.query(
    "insert into private.ost_accreditation_terms(ost_id,renewal_id,starts_on,expires_on,approved_by) values($1,$3,'2021-01-01','2099-12-30',$2)",
    [ost, actor, renewal],
  );
  check((await search(ostRecord.aaNumber)).aaNumber, ostRecord.aaNumber, 'Renewal preserves AA');
  check(
    (await search(ostRecord.aaNumber)).expiresOn,
    '2099-12-30',
    'Renewal validity is authoritative',
  );
  await db.query(
    "update private.ost_accreditation_terms set status='revoked' where ost_id=$1 and status='active'",
    [ost],
  );
  check(await search(ostRecord.aaNumber), null, 'Revoked OST term denied');
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'select * from private.sale_team_accreditations',
      'select private.next_sale_team_aa_number()',
      `select public.get_sale_team_accreditation('${seller}')`,
      `select public.search_sale_team_accreditation('${first.aaNumber}')`,
      `select public.manage_sale_team_accreditation('${actor}','${seller}','IST','approve','2020-01-01','2099-01-01')`,
    ]) {
      await db.query('begin');
      await db.query(`set local role ${role}`);
      await assert.rejects(db.query(sql), (e) => e.code === '42501');
      checks++;
      await db.query('rollback');
    }
  }
  await db.query('begin');
  await db.query('set local role service_role');
  check(
    (await db.query('select public.search_sale_team_accreditation($1) result', [first.aaNumber]))
      .rows[0].result.aaNumber,
    first.aaNumber,
  );
  await db.query('rollback');
  check(
    (
      await db.query(
        "select count(*)::int n from public.audit_events where action='SALE_TEAM_ACCREDITATION_APPROVED'",
      )
    ).rows[0].n > 0,
    true,
    'Audited issuance',
  );
  const invariants = await db.query(
    fs.readFileSync('supabase/security/rls_invariants.sql', 'utf8'),
  );
  for (const result of Array.isArray(invariants) ? invariants : [invariants])
    check(result.rowCount, 0, 'RLS invariants');
  await db.query(
    fs.readFileSync(
      'supabase/migrations/20261130000001_afhomes_sale_team_accreditation.sql',
      'utf8',
    ),
  );
  check(
    (await search(first.aaNumber)).aaNumber,
    first.aaNumber,
    'Migration replay preserves issued numbers',
  );
  check(
    (await manage(db, other)).aaNumber,
    same[0].aaNumber,
    'Migration replay preserves other issued numbers',
  );
} finally {
  await Promise.all(clients.map((db) => db.end().catch(() => {})));
  if (started) {
    if (process.platform === 'win32') await run(ctl, ['-D', directory, 'stop', '-m', 'fast']);
    else await server.stop();
  }
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(
  `PASS: ${checks} real PostgreSQL AA/accreditation checks; all migrations applied locally; synthetic fixtures cleaned up.`,
);
