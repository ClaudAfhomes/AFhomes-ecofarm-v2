import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
import { afHomesSessionSchema } from '../../contracts/src/schemas/afhomes.ts';
import { customerProfileSchema } from '../../contracts/src/schemas/customer.ts';
let postgres;
let db;
let checks = 0;
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  console.log('PASS ' + name);
  checks++;
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const asUser = async (id, fn) => {
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    return (await one('select public.' + fn + '() result')).result;
  } finally {
    await db.query('reset role');
  }
};
const denied = async (name, sql, pattern) => {
  await db.query('savepoint denied');
  let e;
  try {
    await db.query(sql);
  } catch (error) {
    e = error;
  }
  await db.query('rollback to savepoint denied');
  await db.query('release savepoint denied');
  assert.ok(e && pattern.test(e.message), name);
  checks++;
  console.log('PASS ' + name);
};
try {
  postgres = await startDisposablePostgres({
    beforeMigration: '20261102000001_afhomes_customer_directory_workflow_filter.sql',
    excludedMigrations: [
      '20261030000001_afhomes_customer_directory_id_filter.sql',
      '20261031000001_afhomes_customer_directory_payment_filter.sql',
    ],
  });
  db = postgres.client;
  assert.equal(new URL(postgres.url).hostname, '127.0.0.1');
  const identity = await one(
    'select current_database() db,inet_server_addr()::text host,(select count(*) from public.customers) customers',
  );
  assert.equal(identity.db, postgres.database);
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(identity.host));
  assert.equal(Number(identity.customers), 0);
  await db.query("set statement_timeout='15s';set lock_timeout='5s';begin");
  await db.query(
    fs
      .readFileSync(
        new URL(
          '../../../supabase/migrations/20261122000001_afhomes_readonly_auth_recovery.sql',
          import.meta.url,
        ),
        'utf8',
      )
      .replace(/^\uFEFF/, ''),
  );
  await db.query(
    fs
      .readFileSync(
        new URL(
          '../../../supabase/migrations/20261122000001_afhomes_readonly_auth_recovery.sql',
          import.meta.url,
        ),
        'utf8',
      )
      .replace(/^\uFEFF/, ''),
  );
  check('Auth-only migration can be safely reapplied', true, true);
  check(
    'Auth migration executes before all pending points migrations',
    await one("select to_regclass('public.earning_claims') claims"),
    { claims: null },
  );
  const staff = {};
  for (const role of ['super_admin', 'finance', 'employee']) {
    const id = randomUUID();
    staff[role] = id;
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      id,
      role + '@example.invalid',
    ]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,$3,'active')",
      [id, role + '@example.invalid', 'SYNTHETIC ' + role],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    const own = afHomesSessionSchema.parse(await asUser(id, 'afhomes_self_session'));
    check('Caller-owned ' + role + ' session resolves with complete permissions', own.id, id);
    check(
      'Caller-owned ' + role + ' portal resolves without role catalog grants',
      (await asUser(id, 'afhomes_self_portals')).staff.roleSlug,
      role,
    );
    check(
      'All active modules appear for ' + role,
      own.permissions.length,
      Number((await one('select count(*) n from public.modules where is_active')).n),
    );
  }
  const module = (
    await one("select id from public.modules where key='finance.payment_verification'")
  ).id;
  await db.query(
    'insert into public.staff_permission_restrictions(staff_id,module_id,deny_update) values($1,$2,true)',
    [staff.finance, module],
  );
  check(
    'Deny-only restriction is re-resolved on the next self session',
    (await asUser(staff.finance, 'afhomes_self_session')).permissions.find(
      (p) => p.moduleKey === 'finance.payment_verification',
    ).canUpdate,
    false,
  );
  await db.query("update public.staff_users set status='suspended' where id=$1", [staff.finance]);
  check(
    'Suspended staff receives no session',
    await asUser(staff.finance, 'afhomes_self_session'),
    null,
  );
  await db.query('update public.roles set is_active=false where slug=$1', ['employee']);
  check(
    'Inactive assigned role receives no session',
    await asUser(staff.employee, 'afhomes_self_session'),
    null,
  );
  const customerAuth = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    customerAuth,
    'customer@example.invalid',
  ]);
  const customer = (
    await one(
      "insert into public.customers(customer_number,auth_user_id,first_name,last_name,email,phone,status) values('AUTH-LOCAL',$1,'SYNTHETIC','BUYER','customer@example.invalid','09180000003','active') returning id",
      [customerAuth],
    )
  ).id;
  const profile = customerProfileSchema.parse(
    await asUser(customerAuth, 'afhomes_self_customer_profile'),
  );
  check('Customer profile is owned by the verified caller', profile.id, customer);
  check(
    'Customer does not receive staff access',
    await asUser(customerAuth, 'afhomes_self_session'),
    null,
  );
  check(
    'Staff cannot read a different customer profile',
    await asUser(staff.super_admin, 'afhomes_self_customer_profile'),
    null,
  );
  check(
    'Customer portal returns no staff identity',
    (await asUser(customerAuth, 'afhomes_self_portals')).staff,
    null,
  );
  check(
    'No government ID or financial data appears in self profile',
    /government|ledger|receipt|balance/i.test(JSON.stringify(profile)),
    false,
  );
  for (const fn of [
    'afhomes_self_portals',
    'afhomes_self_session',
    'afhomes_self_customer_profile',
  ]) {
    check(
      'Anonymous cannot execute ' + fn,
      (
        await one("select has_function_privilege('anon',$1,'EXECUTE') allowed", [
          'public.' + fn + '()',
        ])
      ).allowed,
      false,
    );
    check(
      'Service role cannot use ' + fn + ' as an arbitrary-user probe',
      (
        await one("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [
          'public.' + fn + '()',
        ])
      ).allowed,
      false,
    );
  }
  await db.query('set local role anon');
  await denied(
    'Anonymous direct invocation is refused',
    'select public.afhomes_self_session()',
    /permission denied/,
  );
  await db.query('reset role');
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub','',true)");
  check(
    'Missing JWT subject cannot obtain any staff session',
    (await one('select public.afhomes_self_session() result')).result,
    null,
  );
  await db.query('reset role');
  check(
    'Self session accepts no caller-supplied identity',
    (
      await one(
        "select pronargs from pg_proc where oid='public.afhomes_self_session()'::regprocedure",
      )
    ).pronargs,
    0,
  );
  check(
    'Auth migration never alters points balances',
    Number((await one('select coalesce(sum(balance),0) n from public.points_accounts')).n),
    0,
  );
  await db.query('rollback');
  check(
    'All synthetic Auth fixtures roll back',
    Number((await one('select count(*) n from auth.users')).n),
    0,
  );
  check(
    'Transaction rollback removes new auth RPCs',
    (await one("select to_regprocedure('public.afhomes_self_session()') fn")).fn,
    null,
  );
  console.log('LOCAL POSTGRES AUTH: ' + checks + ' checks; managed password login not claimed.');
} catch (error) {
  console.error('FAIL ' + error.stack);
  process.exitCode = 1;
} finally {
  if (db) await db.query('rollback').catch(() => {});
  if (postgres) {
    await postgres.stop();
    assert.equal(fs.existsSync(postgres.dataDir), false);
    console.log('PASS disposable cluster removed');
  }
}
