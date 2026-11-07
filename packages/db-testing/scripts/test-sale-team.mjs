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
  // Exercise the normalization migration's orphan preflight below before applying it.
  for (const file of listMigrations().filter(
    (name) => !name.endsWith('_afhomes_normalization_integrity.sql'),
  ))
    await db.query(fs.readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/^\uFEFF/, ''));
  check(
    (
      await db.query(
        "select public,file_size_limit::int,allowed_mime_types from storage.buckets where id='afhomes-profile-photos'",
      )
    ).rows,
    [{ public: false, file_size_limit: 500000, allowed_mime_types: ['image/jpeg'] }],
    'Private profile-photo bucket cap and MIME',
  );
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
  assert.match(first.aaNumber, /^AAI\d{8}$/);
  check(first.aaNumber.startsWith('AAI'), true, 'IST prefix');
  check(first.aaNumber.slice(3).length, 8, 'Month and sequence');
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
    ['staffId', 'aaNumber', 'kind', 'fullName', 'status', 'startsOn', 'expiresOn'].sort(),
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
    first.fullName,
    'Employee reapproval preserves the approved public name',
  );
  check((await manage(db, seller)).aaNumber, first.aaNumber, 'Name review preserves AA');
  const a = await connect(),
    b = await connect();
  const same = await Promise.all([manage(a, other), manage(b, other)]);
  check(same[0].aaNumber, same[1].aaNumber, 'Concurrent same-seller issuance');
  check(same[0].aaNumber === first.aaNumber, false, 'Unique across sellers');
  await db.query('begin');
  await db.query("update public.staff_role_assignments set role_id=(select id from public.roles where slug='sales_manager') where staff_id=$1", [outsider]);
  await assert.rejects(db.query('select public.issue_ist_employee_identity($1,$2,$3)', [actor, outsider, first.aaNumber]), /ACCREDITATION_NUMBER_TAKEN/);
  checks++;
  await db.query('rollback');
  await db.query('begin');
  await db.query("update public.staff_role_assignments set role_id=(select id from public.roles where slug='sales_manager') where staff_id=$1", [outsider]);
  await db.query("insert into private.sale_team_aa_counters(accreditation_month,last_value) values(date_trunc('month',now() at time zone 'Asia/Manila')::date,9999) on conflict(accreditation_month) do update set last_value=9999");
  await assert.rejects(manage(db, outsider), /AA_SEQUENCE_EXHAUSTED/);
  checks++;
  await db.query('rollback');
  check((await db.query('select public.get_sale_team_accreditation($1) result', [outsider])).rows[0].result, null, 'Exhausted issuance rolls back');
  await assert.rejects(manage(db, outsider), /INVALID_(ACCREDITATION|EMPLOYEE_IDENTITY)_TARGET/);
  checks++;
  await db.query("update public.staff_users set status='invited' where id=$1", [seller]);
  await assert.rejects(manage(db, seller), /INVALID_(ACCREDITATION|EMPLOYEE_IDENTITY)_TARGET/);
  checks++;
  await db.query("update public.staff_users set status='active' where id=$1", [seller]);
  await assert.rejects(manage(db, seller, 'approve', 'IST', seller), /FORBIDDEN/);
  checks++;
  await db.query('update public.staff_users set must_change_password=true where id=$1', [actor]);
  await assert.rejects(manage(db, seller), /FORBIDDEN/);
  checks++;
  await db.query('update public.staff_users set must_change_password=false where id=$1', [actor]);
  await assert.rejects(manage(db, seller, 'revoke'), /IST_EMPLOYEE_LIFECYCLE_REQUIRED/);
  checks++;
  await db.query("update public.staff_users set status='inactive' where id=$1", [seller]);
  check(await search(first.aaNumber), null, 'Inactive employee denied');
  await db.query("update public.staff_users set status='active' where id=$1", [seller]);
  check((await manage(db, seller)).aaNumber, first.aaNumber, 'Reapproval preserves number');
  await manage(db, seller, 'approve', 'IST', actor, '2020-01-01', '2020-12-31');
  check((await search(first.aaNumber)).status, 'accredited', 'IST legacy date input does not add expiry');
  await manage(db, seller, 'approve', 'IST', actor, '2090-01-01', '2099-12-31');
  check((await search(first.aaNumber)).status, 'accredited', 'IST has no accreditation start date');
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
    "insert into private.ost_accreditation_terms(id,ost_id,application_id,starts_on,expires_on,approved_by) values($1,$2,$3,'2020-01-01','2021-01-01',$4)",
    [term, ost, application, actor],
  );
  const ostRecord = (await db.query('select public.get_sale_team_accreditation($1) result', [ost]))
    .rows[0].result;
  await db.query("update public.staff_users set status='suspended' where id=$1", [ost]);
  await assert.rejects(manage(db, ost, 'approve', 'OST'), /INVALID_(ACCREDITATION|EMPLOYEE_IDENTITY)_TARGET/);
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
  assert.match(newlyIssued.aaNumber, /^AAO\d{8}$/);
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
  check(await search(ostRecord.aaNumber), null, 'Expired OST denied');
  await db.query("update private.ost_accreditation_terms set status='superseded' where id=$1", [
    term,
  ]);
  const renewal = randomUUID();
  await db.query(
    "insert into private.ost_accreditation_renewals(id,renewal_number,request_id,payload_hash,ost_id,prior_term_id,date_of_renewal,requested_start,requested_end,status,applicant_snapshot,original_accreditation_date,last_expiry_date,old_sponsor_staff_id,referrer_snapshot,applicant_signature_status,referrer_signature_status,created_by,approved_by,approved_at) values($1,'AA-RENEWAL-TEST',$2,repeat('b',64),$3,$4,'2026-01-01','2026-01-01','2027-01-01','approved','{}','2020-01-01','2021-01-01',$5,'{}','received','received',$6,$6,now())",
    [renewal, randomUUID(), ost, term, seller, actor],
  );
  await db.query(
    "insert into private.ost_accreditation_terms(ost_id,renewal_id,starts_on,expires_on,approved_by) values($1,$3,'2026-01-01','2027-01-01',$2)",
    [ost, actor, renewal],
  );
  check((await search(ostRecord.aaNumber)).aaNumber, ostRecord.aaNumber, 'Renewal preserves AA');
  check(
    (await search(ostRecord.aaNumber)).expiresOn,
    '2027-01-01',
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
      'supabase/migrations/20261212000001_afhomes_public_sale_team_search.sql',
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
  const normalization = fs.readFileSync(
    'supabase/migrations/20261201000001_afhomes_normalization_integrity.sql',
    'utf8',
  );
  const orphanRule = randomUUID();
  await db.query(
    "insert into public.commission_rules(id,target_type,target_id,rate,effective_from,created_by) values($1,'staff',$2,'0.04','2026-01-01',$3)",
    [orphanRule, randomUUID(), actor],
  );
  await assert.rejects(
    db.query(normalization),
    (error) =>
      error.code === '23503' && error.message === 'NORMALIZATION_BLOCKED_ORPHAN_COMMISSION_TARGETS',
  );
  await db.query('rollback');
  check(
    (
      await db.query(
        "select count(*)::int n from pg_attribute where attrelid='public.commission_rules'::regclass and attname='target_staff_id' and not attisdropped",
      )
    ).rows[0].n,
    0,
    'Blocked migration leaves no generated columns',
  );
  check(
    (
      await db.query('select count(*)::int n from public.commission_rules where id=$1', [
        orphanRule,
      ])
    ).rows[0].n,
    1,
    'Blocked migration preserves orphan for review',
  );
  const repair = fs.readFileSync(
    'supabase/migrations/20261130000002_afhomes_archive_orphan_commission_rules.sql',
    'utf8',
  );
  await assert.rejects(
    db.query(repair),
    (error) => error.message === 'ARCHIVE_BLOCKED_UNREVIEWED_ORPHAN',
  );
  await db.query('rollback');
  await db.query('delete from public.commission_rules where id=$1', [orphanRule]);

  // Synthetic rows only. Substitute their SHA pins, never the allowlist or repair logic.
  const repairedIds = [
    '01d28c04-b31c-48e5-be11-b1ec7db35cd5',
    '9a7640d8-4b93-44ed-aa47-f93ecbce2db1',
  ];
  const deletedTargets = [randomUUID(), randomUUID()];
  for (let i = 0; i < 2; i++)
    await db.query(
      "insert into public.commission_rules(id,target_type,target_id,rate,effective_from,effective_until,is_active,created_by) values($1,'staff',$2,$3,'2026-10-01',$4,$5,$6)",
      [
        repairedIds[i],
        deletedTargets[i],
        i === 0 ? '0.04' : '0.08',
        i === 0 ? null : '2026-10-01',
        i !== 0,
        actor,
      ],
    );
  const originals = (
    await db.query(
      "select id,to_jsonb(r) snapshot,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') hash from public.commission_rules r order by id",
    )
  ).rows;
  check(originals.length, 2, 'Two synthetic reviewed rules');
  const syntheticRepair = repair
    .replace('23c969c31b18b7d959cf784dc215c970840c0a26fa595a58ddd1fb55dfe6a6e8', originals[0].hash)
    .replace('1d445cf3fcacb87ee3bc30377c46618f5a75acd793f520449419c1b88c622e5b', originals[1].hash);
  check(syntheticRepair !== repair, true, 'Only synthetic expected hashes substituted');
  const validRule = randomUUID();
  const validRole = (
    await db.query('select role_id from public.staff_role_assignments where staff_id=$1', [seller])
  ).rows[0].role_id;
  await db.query(
    "insert into public.commission_rules(id,target_type,target_id,rate,effective_from,created_by) values($1,'role',$2,'0.06','2026-01-01',$3)",
    [validRule, validRole, actor],
  );
  const resolveCurrentRate = async () =>
    (
      await db.query("select * from public.resolve_commission_rule('staff',$1,'2026-10-14')", [
        seller,
      ])
    ).rows;
  const rateBeforeRepair = await resolveCurrentRate();
  check(
    rateBeforeRepair,
    [{ rule_id: validRule, rate: '0.06' }],
    'Representative valid current rule selected',
  );
  await db.query("update public.commission_rules set rate='0.09' where id=$1", [repairedIds[1]]);
  await assert.rejects(
    db.query(syntheticRepair),
    (error) => error.message === 'ARCHIVE_BLOCKED_CHANGED_OR_ELIGIBLE_RULE',
  );
  await db.query('rollback');
  check(
    (await db.query('select count(*)::int n from private.commission_rule_archive')).rows[0].n,
    0,
    'Second-row drift rolls back first archive',
  );
  check(
    (
      await db.query(
        "select count(*)::int n from public.audit_events where action='COMMISSION_RULE_ARCHIVED'",
      )
    ).rows[0].n,
    0,
    'Second-row drift rolls back audit',
  );
  check(
    (
      await db.query(
        'select count(*)::int n from public.commission_rules where id=any($1::uuid[])',
        [repairedIds],
      )
    ).rows[0].n,
    2,
    'Second-row drift preserves both source rules',
  );
  await db.query("update public.commission_rules set rate='0.08' where id=$1", [repairedIds[1]]);

  const category = randomUUID(),
    plan = randomUUID(),
    customer = randomUUID(),
    sale = randomUUID();
  await db.query(
    "insert into public.card_categories(id,slug,name) values($1,'synthetic-archive','Synthetic archive category')",
    [category],
  );
  await db.query(
    "insert into public.card_plans(id,category_id,code,name,cash_price,minimum_down_payment,yearly_points) values($1,$2,'SYNTHETIC_ARCHIVE','Synthetic archive plan','60000.00','10000.00',60000)",
    [plan, category],
  );
  await db.query(
    "insert into public.customers(id,customer_number,email,phone,first_name,last_name) values($1,'SYNTHETIC_ARCHIVE','archive@example.invalid','+639185550101','Synthetic','Archive')",
    [customer],
  );
  await db.query(
    "insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,commission_rate_snapshot,expected_commission_snapshot,created_by,commission_rule_id,status,balance_due_at) values($1,'SYNTHETIC_ARCHIVE',$2,$3,'staff',$4,'60000.00','60000.00','10000.00',60000,'0.08','4800.00',$5,$6,'draft',now()+interval '7 days')",
    [sale, customer, plan, actor, actor, repairedIds[1]],
  );
  await assert.rejects(
    db.query(syntheticRepair),
    (error) => error.message === 'ARCHIVE_BLOCKED_FINANCIAL_DEPENDENCY',
  );
  await db.query('rollback');
  check(
    (await db.query('select commission_rule_id from public.card_sales where id=$1', [sale])).rows[0]
      .commission_rule_id,
    repairedIds[1],
    'Dependency denial preserves sale link',
  );
  check(
    (await db.query('select count(*)::int n from private.commission_rule_archive')).rows[0].n,
    0,
    'Dependency denial rolls back whole archive batch',
  );
  // Local fixture only: remove the test dependency before exercising the allowed repair.
  await db.query('update public.card_sales set commission_rule_id=null where id=$1', [sale]);
  const protectedState = async () => {
    const state = {};
    for (const table of [
      'auth.users',
      'public.staff_users',
      'public.customers',
      'public.card_plans',
      'public.card_sales',
      'public.payments',
      'public.commissions',
      'public.customer_application_purchase_terms',
      'public.reservation_agreements',
      'public.memberships',
      'public.points_accounts',
      'public.points_ledger',
      'private.sale_team_accreditations',
    ])
      state[table] = (
        await db.query(
          `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) value from ${table} t`,
        )
      ).rows[0].value;
    state.audit = (
      await db.query(
        "select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) value from public.audit_events t where action<>'COMMISSION_RULE_ARCHIVED'",
      )
    ).rows[0].value;
    state.unrelatedRules = (
      await db.query(
        "select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) value from public.commission_rules t where not(id=any($1::uuid[]))",
        [repairedIds],
      )
    ).rows[0].value;
    return state;
  };
  const beforeRepair = await protectedState();
  await db.query(syntheticRepair);
  check(
    await protectedState(),
    beforeRepair,
    'Repair preserves every protected row and prior audit event byte-for-value',
  );
  check(await resolveCurrentRate(), rateBeforeRepair, 'Current commission resolution unchanged');
  check(
    (
      await db.query(
        'select count(*)::int n from public.commission_rules where id=any($1::uuid[])',
        [repairedIds],
      )
    ).rows[0].n,
    0,
    'Only reviewed rules removed from operational table',
  );
  check(
    (
      await db.query(
        'select rule_id id,rule_snapshot snapshot,snapshot_sha256 hash from private.commission_rule_archive order by rule_id',
      )
    ).rows,
    originals,
    'Entire original rows and hashes preserved',
  );
  check(
    (
      await db.query(
        "select entity_id id,before_data snapshot from public.audit_events where action='COMMISSION_RULE_ARCHIVED' order by entity_id",
      )
    ).rows,
    originals.map(({ id, snapshot }) => ({ id, snapshot })),
    'One exact before-image audit per archived rule',
  );
  for (const role of ['anon', 'authenticated', 'service_role'])
    check(
      (
        await db.query(
          "select has_table_privilege($1,'private.commission_rule_archive','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
      'Archive denies browser/service direct ACL',
    );
  for (const sql of [
    'update private.commission_rule_archive set reason=reason',
    'delete from private.commission_rule_archive',
    'truncate private.commission_rule_archive',
  ])
    await assert.rejects(
      db.query(sql),
      (error) => error.code === '42501' && error.message === 'COMMISSION_ARCHIVE_IMMUTABLE',
    );
  await db.query(syntheticRepair);
  check(
    (
      await db.query(
        "select count(*)::int n from public.audit_events where action='COMMISSION_RULE_ARCHIVED'",
      )
    ).rows[0].n,
    2,
    'Repair replay adds no audit duplicates',
  );
  await db.query(normalization);
  const targetRole = randomUUID();
  await db.query(
    "insert into public.roles(id,slug,name) values($1,'synthetic_normalization_role','Synthetic normalization role')",
    [targetRole],
  );
  for (const [kind, target] of [
    ['role', targetRole],
    ['staff', seller],
    ['ost', ost],
  ]) {
    await assert.rejects(
      db.query(
        "insert into public.commission_rules(target_type,target_id,rate,effective_from,created_by) values($1,$2,'0.04','2026-01-01',$3)",
        [kind, randomUUID(), actor],
      ),
      (error) =>
        error.code === '23503' && error.constraint === `commission_rules_target_${kind}_fk`,
    );
    const rule = randomUUID();
    await db.query(
      "insert into public.commission_rules(id,target_type,target_id,rate,effective_from,created_by) values($1,$2,$3,'0.04','2026-01-01',$4)",
      [rule, kind, target, actor],
    );
    const row = (
      await db.query(
        'select target_role_id,target_staff_id,target_ost_id from public.commission_rules where id=$1',
        [rule],
      )
    ).rows[0];
    check(
      row,
      {
        target_role_id: kind === 'role' ? target : null,
        target_staff_id: kind === 'staff' ? target : null,
        target_ost_id: kind === 'ost' ? target : null,
      },
      'Exactly one typed target generated',
    );
    if (kind === 'role')
      await assert.rejects(
        db.query('delete from public.roles where id=$1', [target]),
        (error) =>
          ['23503', '23001'].includes(error.code) &&
          error.constraint === 'commission_rules_target_role_fk',
      );
  }
  await assert.rejects(
    db.query("update public.staff_users set email=' NOT-CANONICAL@EXAMPLE.INVALID ' where id=$1", [
      seller,
    ]),
    (error) => error.code === '23514' && error.constraint === 'staff_users_email_canonical',
  );
  await db.query("update public.staff_users set full_name='McDonald de la Cruz' where id=$1", [
    seller,
  ]);
  check(
    (await db.query('select full_name from public.staff_users where id=$1', [seller])).rows[0]
      .full_name,
    'McDonald de la Cruz',
    'Normalization preserves deliberate name casing',
  );
  await assert.rejects(
    db.query("update public.ost_members set email=' NOT-CANONICAL@EXAMPLE.INVALID ' where id=$1", [
      ost,
    ]),
    (error) => error.code === '23514' && error.constraint === 'ost_members_email_canonical',
  );
  await db.query(normalization);
  check(
    (
      await db.query(
        "select count(*)::int n from pg_constraint where convalidated and conname in ('commission_rules_target_role_fk','commission_rules_target_staff_fk','commission_rules_target_ost_fk','staff_users_email_canonical','customers_email_canonical','ost_members_email_canonical')",
      )
    ).rows[0].n,
    6,
    'Six validated constraints survive migration replay',
  );
  const postNormalization = await db.query(
    fs.readFileSync('supabase/security/rls_invariants.sql', 'utf8'),
  );
  for (const result of Array.isArray(postNormalization) ? postNormalization : [postNormalization])
    check(result.rowCount, 0, 'Post-normalization RLS invariants');
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
