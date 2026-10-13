import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
const db = new pg.Client({ host: '127.0.0.1', port: 55447, user: 'afhomes', password: 'afhomes-local-test', database: 'postgres' });
await db.connect();
const actor = '00000000-0000-4000-8000-00000000a001';
const results = [];
try {
  assert.equal((await db.query('select host(inet_server_addr()) as host')).rows[0].host, '127.0.0.1');
  await db.query('begin');
  await db.query('insert into auth.users(id,email) values($1,$2)', [actor, 'audit-only@example.invalid']);
  await db.query("insert into public.staff_users(id,email,full_name,status,must_change_password) values($1,$2,'Audit Only','active',true)", [actor, 'audit-only@example.invalid']);
  await db.query("insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'", [actor]);
  for (const status of ['active', 'inactive']) {
    await db.query('update public.staff_users set status=$1 where id=$2', [status, actor]);
    await db.query('savepoint probe');
    try {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim',$2,true)", [actor, JSON.stringify({sub: actor, role: 'authenticated', aal: 'aal1'})]);
      const rows = (await db.query("select id from public.preview_staff_save_service(null,'{\"name\":\"Audit Fixture\",\"basePrice\":\"1.00\"}'::jsonb)")).rows;
      results.push({status, mustChangePassword: true, aal: 'aal1', outcome: 'ALLOWED', createdRows: rows.length});
    } catch (error) { results.push({status, outcome: 'DENIED', code: error.code}); }
    finally { await db.query('rollback to savepoint probe'); await db.query('release savepoint probe'); }
  }
  assert.equal(results[0].outcome, 'DENIED');
  assert.equal(results[0].code, '42501');
  assert.equal(results[1].outcome, 'DENIED');
  assert.equal(results[1].code, '42501');
  await db.query('rollback');
  assert.equal((await db.query('select id from auth.users where id=$1', [actor])).rowCount, 0);
  fs.writeFileSync('docs/security/evidence/rpc-password-gate-remediated.json', JSON.stringify({target:'loopback only', fixtureRolledBack:true, results}, null, 2)+'\n');
  console.log(JSON.stringify(results));
} finally { await db.query('rollback').catch(() => {}); await db.end(); }
