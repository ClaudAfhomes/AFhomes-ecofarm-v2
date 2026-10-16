import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { startDisposablePostgres } from './lib/local-postgres.mjs';

let postgres;
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
  console.log('PASS ' + message);
};
try {
  const migration = '20261206000003_afhomes_company_customer_workbook.sql';
  postgres = await startDisposablePostgres({ beforeMigration: migration });
  const db = postgres.client;
  const preceding = (await db.query("select pg_get_functiondef('public.commit_customer_import_row(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  await db.query(preceding.replace('v_n := v_row.normalized_data;', '-- COWORKER-PRESERVATION-PROBE\n  v_n := v_row.normalized_data;'));
  const migrationSql = readFileSync(new URL('../../../supabase/migrations/'+migration, import.meta.url),'utf8');
  await db.query(migrationSql);
  postgres.applied.push(migration);
  await db.query(migrationSql);
  check((await db.query("select pg_get_functiondef('private.commit_customer_import_legacy_row(uuid,uuid)'::regprocedure) definition")).rows[0].definition.includes('COWORKER-PRESERVATION-PROBE'), 'idempotent dispatcher migration preserves preceding legacy implementation');
  const actor = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    'workbook-admin@example.invalid',
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC ADMIN','active')",
    [actor, 'workbook-admin@example.invalid'],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",
    [actor],
  );
  const tables = [
    'card_sales',
    'payments',
    'memberships',
    'points_accounts',
    'points_ledger',
    'commissions',
    'customer_applications',
  ];
  const counts = async () => {
    const result = [];
    for (const name of tables)
      result.push((await db.query(`select count(*)::integer n from public.${name}`)).rows[0].n);
    return result;
  };
  const before = await counts();
  const fields = {
    workbook_format: 'company_v1',
    ra_number: 'SYNTHETIC-RA',
    first_name: 'Synthetic',
    last_name: 'Customer',
    email: 'synthetic-customer@example.invalid',
    mobile: '09123456789',
    birth_date: '2000-02-29',
    stated_status: 'Fully Paid',
    stated_total: '60000.00',
    stated_rf: '5000.00',
    stated_reference: 'NOT-PAYMENT-EVIDENCE',
    vip_tier: 'GOLD',
    secondary_first_name: 'Supplementary',
    secondary_last_name: 'Customer',
    secondary_mobile: '09987654321',
    tin: 'SYNTHETIC-PRIVATE',
    province: 'Laguna',
    city: 'Victoria',
    barangay: 'San Francisco',
    province_code: '0403400000',
    city_code: '0403434000',
    barangay_code: '0403434001',
    postal_code: '4011',
    verified_postal_code: '4011',
  };
  const normalized = {
    category: 'PENDING',
    customerStatus: 'prospect',
    payment: null,
    requireMember: false,
    person: {
      firstName: fields.first_name,
      lastName: fields.last_name,
      middleName: null,
      suffix: null,
      birthDate: fields.birth_date,
      email: fields.email,
      phone: fields.mobile,
    },
  };
  async function newRow(raw = fields, norm = normalized) {
    const job = randomUUID(),
      row = randomUUID();
    await db.query(
      "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'excel','synthetic.xlsm','ready',1,1,$2,now())",
      [job, actor],
    );
    await db.query(
      "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,2,$3,$4,'warning','CREATE')",
      [row, job, raw, norm],
    );
    return row;
  }
  const row = await newRow();
  const commit = async (id, staff = actor) =>
    (await db.query('select public.commit_customer_import_row($1,$2) result', [id, staff])).rows[0]
      .result;
  const first = await commit(row);
  check(
    Boolean(first.customerId) && !first.membershipId && !first.saleId,
    'company commit creates only customer identity',
  );
  const customer = (
    await db.query('select * from public.customers where id=$1', [first.customerId])
  ).rows[0];
  check(
    customer.status === 'prospect' && customer.phone === '09123456789',
    'phone leading zero and prospect status persist',
  );
  check(
    customer.address.barangayCode === fields.barangay_code &&
      customer.address.postalCode === '4011',
    'structured geography and resolved postal code persist together',
  );
  check(customer.customer_number.startsWith('AF-CUS-'), 'existing official allocator is reused');
  const retry = await commit(row);
  check(JSON.stringify(retry) === JSON.stringify(first), 'same-row retry is idempotent');
  const otherRow = await newRow();
  check(
    (await commit(otherRow)).customerId === first.customerId,
    'cross-job retry reuses the same customer',
  );
  const changedSuffix = await newRow();
  await db.query("update public.customers set suffix='Jr.' where id=$1", [first.customerId]);
  await assert.rejects(() => commit(changedSuffix), /IMPORT_IDENTITY_REVIEW_REQUIRED/);
  checks++;
  await db.query('update public.customers set suffix=null where id=$1', [first.customerId]);
  check(
    (
      await db.query('select count(*)::integer n from public.customers where id=$1', [
        first.customerId,
      ])
    ).rows[0].n === 1,
    'no duplicate customer',
  );
  const disagreement = await newRow(
    { ...fields, first_name: 'Different' },
    { ...normalized, person: { ...normalized.person, firstName: 'Different' } },
  );
  await assert.rejects(() => commit(disagreement), /IMPORT_IDENTITY_REVIEW_REQUIRED/);
  checks++;
  const duplicateRa = await newRow(
    { ...fields, email: 'different@example.invalid' },
    { ...normalized, person: { ...normalized.person, email: 'different@example.invalid' } },
  );
  await assert.rejects(() => commit(duplicateRa), /IMPORT_RA_REVIEW_REQUIRED/);
  checks++;
  const money = await newRow(
    { ...fields, email: 'money@example.invalid', ra_number: '' },
    { ...normalized, payment: { amount: '60000.00' } },
  );
  await assert.rejects(() => commit(money), /IMPORT_ROW_INVALID/);
  checks++;
  await assert.rejects(() => commit(row, randomUUID()), /ACTOR_INACTIVE/);
  checks++;
  check(
    JSON.stringify(await counts()) === JSON.stringify(before),
    'sales, verified money, memberships, points, commissions and application status remain unchanged',
  );
  const audits = (
    await db.query(
      "select after_data from public.audit_events where action='COMPANY_CUSTOMER_IMPORT_COMMITTED'",
    )
  ).rows;
  check(
    audits.length === 2 && !JSON.stringify(audits).includes('SYNTHETIC-PRIVATE'),
    'audit records contain IDs, never TIN',
  );
  const directory = await db.query(
    "select * from public.customer_directory(jsonb_build_object('search','synthetic-customer@example.invalid','limit',200))",
  );
  check(
    directory.rows.some((r) => r.record.id === first.customerId),
    'customer is discoverable through the real Customers directory RPC',
  );
  const acl = (
    await db.query(
      "select has_function_privilege('authenticated','public.commit_customer_import_row(uuid,uuid)','EXECUTE') browser, has_function_privilege('anon','public.commit_customer_import_row(uuid,uuid)','EXECUTE') anon, has_function_privilege('service_role','private.commit_company_customer_import(uuid,uuid)','EXECUTE') private",
    )
  ).rows[0];
  check(
    !acl.browser && !acl.anon && !acl.private,
    'browser and service callers cannot bypass the existing public RPC boundary',
  );
  const staff = async (name, role) => {
    const id = randomUUID();
    const email = id + '@example.invalid';
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,$3,'active')",
      [id, email, name],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    return id;
  };
  const vd = await staff('SYNTHETIC VD', 'vice_director');
  const ssm = await staff('SYNTHETIC SSM', 'senior_sales_manager');
  const sm = await staff('SYNTHETIC SM', 'sales_manager');
  await db.query(
    "insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,assigned_by) values($1,$2,'senior_sales_manager',$4),($3,$1,'sales_manager',$4)",
    [ssm, vd, sm, actor],
  );
  const matches = (
    await db.query('select * from public.match_company_import_staff($1)', [
      ['synthetic vd', 'SYNTHETIC SSM', 'SYNTHETIC SM'],
    ])
  ).rows;
  check(
    matches.length === 3 &&
      matches.find((m) => m.staff_id === sm).ancestor_ids.join(',') === [ssm, vd].join(','),
    'registered staff and their real manager ancestry resolve without fabricated links',
  );
  const withTeam = {
    ...fields,
    email: 'with-team@example.invalid',
    ra_number: '',
    vd_name: 'SYNTHETIC VD',
    vd_staff_id: vd,
    ssm_name: 'SYNTHETIC SSM',
    ssm_staff_id: ssm,
    sm_name: 'SYNTHETIC SM',
    sm_staff_id: sm,
    referrer_name: 'SYNTHETIC SM',
    referrer_staff_id: sm,
  };
  const teamRow = await newRow(withTeam, {
    ...normalized,
    person: { ...normalized.person, email: withTeam.email },
  });
  const teamCustomer = await commit(teamRow);
  check(
    (
      await db.query('select referred_by_staff_id from public.customers where id=$1', [
        teamCustomer.customerId,
      ])
    ).rows[0].referred_by_staff_id === sm,
    'a validated registered referrer links to the normal customer record',
  );
  await staff('SYNTHETIC VD', 'vice_director');
  const ambiguousRow = await newRow(
    { ...withTeam, email: 'ambiguous-team@example.invalid' },
    { ...normalized, person: { ...normalized.person, email: 'ambiguous-team@example.invalid' } },
  );
  await assert.rejects(() => commit(ambiguousRow), /IMPORT_STAFF_REVIEW_REQUIRED/);
  checks++;
  const forbiddenActor = await staff('SYNTHETIC UNPRIVILEGED', 'ost');
  await assert.rejects(() => commit(row, forbiddenActor), /IMPORT_FORBIDDEN/);
  checks++;
  const concurrentRaw = { ...fields, email: 'concurrent-import@example.invalid', ra_number: '' };
  const concurrentNorm = {
    ...normalized,
    person: { ...normalized.person, email: concurrentRaw.email },
  };
  const concurrentA = await newRow(concurrentRaw, concurrentNorm),
    concurrentB = await newRow(concurrentRaw, concurrentNorm);
  const peer = new pg.Client({ connectionString: postgres.url });
  await peer.connect();
  try {
    const [a, b] = await Promise.all([
      commit(concurrentA),
      peer
        .query('select public.commit_customer_import_row($1,$2) result', [concurrentB, actor])
        .then((r) => r.rows[0].result),
    ]);
    check(
      a.customerId === b.customerId && [a.action, b.action].sort().join(',') === 'CREATE,SKIP',
      'concurrent cross-job imports serialize to one CREATE and one SKIP',
    );
  } finally {
    await peer.end();
  }
  check(
    JSON.stringify(await counts()) === JSON.stringify(before),
    'referral and concurrent imports also preserve every financial ledger and application state',
  );
  const legacyRaw = {
    ...fields,
    workbook_format: 'legacy',
    email: 'legacy-review@example.invalid',
    ra_number: '',
  };
  const legacyNorm = { ...normalized, person: { ...normalized.person, email: legacyRaw.email } };
  const legacy = await commit(await newRow(legacyRaw, legacyNorm));
  const stale = await newRow(legacyRaw, legacyNorm);
  await db.query(
    "update public.customer_import_rows set action='UPDATE',customer_id=$2 where id=$1",
    [stale, legacy.customerId],
  );
  await db.query("update public.customers set first_name='VERIFIED CHANGE' where id=$1", [
    legacy.customerId,
  ]);
  await assert.rejects(() => commit(stale), /IMPORT_IDENTITY_REVIEW_REQUIRED/);
  checks++;
  const schemaIndex = readFileSync(
    new URL('../../../docs/supabase/CURRENT-SCHEMA.sql', import.meta.url),
    'utf8',
  );
  const inventory = (
    await db.query("select tablename from pg_tables where schemaname='public' order by tablename")
  ).rows.map((r) => r.tablename);
  check(
    inventory.every((name) => schemaIndex.includes('--   public.' + name)) &&
      inventory.length === Number(/Public table inventory: (\d+)/.exec(schemaIndex)[1]),
    'schema document inventory matches real migrated PostgreSQL',
  );
  const invariants = await db.query(
    readFileSync(new URL('../../../supabase/security/rls_invariants.sql', import.meta.url), 'utf8'),
  );
  check(
    (Array.isArray(invariants) ? invariants : [invariants]).every(
      (result) => result.rows.length === 0,
    ),
    'all RLS invariant queries return zero violations',
  );
  console.log(
    `Company workbook PostgreSQL: ${checks} checks passed; ${postgres.applied.length} migrations, ${inventory.length} public tables.`,
  );
} catch (error) {
  console.error('FAIL company workbook PostgreSQL:', error.message);
  process.exitCode = 1;
} finally {
  if (postgres) await postgres.stop();
}
