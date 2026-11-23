/** Offline referral RPC proof: node packages/db-testing/scripts/test-referral-codes.mjs */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afhomes-referral-test-'));
const server = new EmbeddedPostgres({
  databaseDir: directory,
  user: 'afhomes',
  password: 'local-referral-test',
  port: 55439,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
const connections = [];
let checks = 0;
const check = (condition) => {
  assert.ok(condition);
  checks++;
};
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
try {
  await server.initialise();
  await server.start();
  const db = server.getPgClient();
  connections.push(db);
  await db.connect();
  await db.query(fs.readFileSync(path.join(root, 'supabase/db-testing/supabase-shim.sql'), 'utf8'));
  // Freeze this proof at the applied operational RPC; do not read active Communications work.
  for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) {
    if (file.endsWith('.sql') && file <= '20261029000001_afhomes_operational_access_functions.sql')
      await db.query(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  }
  const ids = {};
  for (const role of ['sales_manager', 'admin', 'super_admin', 'ost']) {
    const id = randomUUID();
    ids[role] = id;
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}@referral.test`]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'REFERRAL QA','active')",
      [id, `${role}@referral.test`],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
  }
  await db.query(
    "insert into public.role_permissions(role_id,module_id,can_view) select r.id,m.id,true from public.roles r cross join public.modules m where r.slug in ('admin','sales_manager','ost') and m.key='network.referrals' on conflict(role_id,module_id) do update set can_view=true",
  );
  const issue = (client, actor, rotate = false) =>
    client.query(
      "select public.manage_ost_referral_code($1,$2,$3,$4,'OST-?-TEST',now()+interval '72 hours',2) id",
      [actor, ids.sales_manager, rotate, hash()],
    );
  const first = (await issue(db, ids.super_admin)).rows[0].id;
  const row = (await db.query('select * from public.referral_codes where id=$1', [first])).rows[0];
  check(row.sponsor_staff_id === ids.sales_manager && row.created_by === ids.super_admin);
  check(/^[a-f0-9]{64}$/.test(row.code_hash) && !Object.keys(row).includes('code'));
  await assert.rejects(issue(db, ids.admin), /CONFLICT/);
  checks++;
  await issue(db, ids.admin, true);
  check(
    (await db.query('select is_active from public.referral_codes where id=$1', [first])).rows[0]
      .is_active === false,
  );
  await assert.rejects(issue(db, ids.ost, true), /FORBIDDEN/);
  checks++;

  // Two separate connections contend on the SAME sponsor lock.
  const location = (await db.query('select current_database() name,current_user usr')).rows[0];
  for (let i = 0; i < 2; i++) {
    const connection = new pg.Client({
      host: '127.0.0.1',
      port: 55439,
      database: location.name,
      user: location.usr,
      password: 'local-referral-test',
    });
    await connection.connect();
    connections.push(connection);
  }
  await db.query('update public.referral_codes set is_active=false where sponsor_staff_id=$1', [
    ids.sales_manager,
  ]);
  const concurrent = await Promise.allSettled(connections.slice(1).map((c) => issue(c, ids.admin)));
  check(concurrent.filter((r) => r.status === 'fulfilled').length === 1);
  check(
    concurrent.filter((r) => r.status === 'rejected' && /CONFLICT/.test(r.reason.message))
      .length === 1,
  );
  check(
    Number(
      (
        await db.query(
          'select count(*) n from public.referral_codes where sponsor_staff_id=$1 and is_active',
          [ids.sales_manager],
        )
      ).rows[0].n,
    ) === 1,
  );

  const current = (
    await db.query('select id from public.referral_codes where sponsor_staff_id=$1 and is_active', [
      ids.sales_manager,
    ])
  ).rows[0].id;
  const request = randomUUID();
  const identity = {
    firstName: 'REFERRAL',
    lastName: 'QA',
    email: 'applicant@referral.test',
    phone: '+639171234567',
    birthDate: '1990-01-01',
    address: { line1: 'QA', city: 'QA', province: 'QA', countryCode: 'PH' },
  };
  const form = {
    dateApplied: '2026-01-01',
    programCategory: 'non_vip',
    sex: 'male',
    civilStatus: 'single',
    governmentIdType: 'QA',
    governmentIdNumber: 'QA',
    applicantSignatureStatus: 'pending',
    referrerSignatureStatus: 'pending',
  };
  const submit = (code = current, requestId = request, person = identity, client = db) =>
    client.query("select public.submit_ost_accreditation($1,null,$2,$3,$4,$5,'public') id", [
      requestId,
      ids.sales_manager,
      code,
      person,
      form,
    ]);
  const application = (await submit()).rows[0].id;
  check((await submit()).rows[0].id === application);
  check(
    (await db.query('select use_count from public.referral_codes where id=$1', [current])).rows[0]
      .use_count === 1,
  );
  check(
    (
      await db.query('select sponsor_staff_id from public.ost_applications where id=$1', [
        application,
      ])
    ).rows[0].sponsor_staff_id === ids.sales_manager,
  );
  const registrations = await Promise.allSettled(
    connections
      .slice(1)
      .map((client, index) =>
        submit(
          current,
          randomUUID(),
          { ...identity, email: `concurrent${index}@referral.test`, phone: `+63917123456${index}` },
          client,
        ),
      ),
  );
  check(registrations.filter((r) => r.status === 'fulfilled').length === 1);
  check(
    registrations.filter(
      (r) => r.status === 'rejected' && /INVALID_REFERRAL_CODE/.test(r.reason.message),
    ).length === 1,
  );
  check(
    (await db.query('select use_count from public.referral_codes where id=$1', [current])).rows[0]
      .use_count === 2,
  );
  for (const state of ['expired', 'revoked', 'exhausted']) {
    await db.query(
      "update public.referral_codes set is_active=$2,expires_at=now()+($3::int * interval '1 hour'),use_count=$4 where id=$1",
      [current, state !== 'revoked', state === 'expired' ? -1 : 72, state === 'exhausted' ? 2 : 1],
    );
    await assert.rejects(
      submit(current, randomUUID(), { ...identity, email: `${state}@referral.test` }),
      /INVALID_REFERRAL_CODE/,
    );
    checks++;
  }
  // An exhausted credential still permits the identical successful retry without consuming again.
  check((await submit()).rows[0].id === application);
  check(
    (await db.query('select use_count from public.referral_codes where id=$1', [current])).rows[0]
      .use_count === 2,
  );
  const replacement = (await issue(db, ids.admin, true)).rows[0].id;
  await assert.rejects(submit(current, randomUUID()), /INVALID_REFERRAL_CODE/);
  checks++;
  check(
    typeof (
      await submit(replacement, randomUUID(), {
        ...identity,
        email: 'rotated@referral.test',
        phone: '+639181234567',
      })
    ).rows[0].id === 'string',
  );
  await db.query("update public.staff_users set status='suspended' where id=$1", [
    ids.sales_manager,
  ]);
  await assert.rejects(issue(db, ids.admin, true), /active Sales Manager/);
  checks++;
  const audits = (
    await db.query(
      "select action,after_data from public.audit_events where entity_type='referral_code'",
    )
  ).rows;
  check(
    audits.some((a) => a.action === 'REFERRAL_CODE_ISSUED') &&
      audits.some((a) => a.action === 'REFERRAL_CODE_ROTATED'),
  );
  check(!JSON.stringify(audits).includes(row.code_hash));
  console.log(`PASS: ${checks} referral RPC checks, real disposable PostgreSQL; no remote access.`);
} finally {
  for (const connection of connections) await connection.end().catch(() => {});
  await server.stop().catch(() => {});
  // The exact mkdtemp result is the only deletion target, confined to the temp root.
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
