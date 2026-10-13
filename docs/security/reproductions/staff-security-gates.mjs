import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
const db = new pg.Client({host:'127.0.0.1',port:55447,user:'afhomes',password:'afhomes-local-test',database:'postgres'});
await db.connect();
const actor='00000000-0000-4000-8000-00000000c001';
const results=[];
try {
  assert.equal((await db.query('select host(inet_server_addr()) host')).rows[0].host,'127.0.0.1');
  await db.query('begin');
  await db.query('insert into auth.users(id,email) values($1,$2)',[actor,'gate-only@example.invalid']);
  await db.query("insert into public.staff_users(id,email,full_name,status) values($1,$2,'GATE TEST','active')",[actor,'gate-only@example.invalid']);
  await db.query("insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",[actor]);
  for (const test of [
    {name:'normal administrator',mfa:false,aal:'aal1',allow:true},
    {name:'forced password',password:true,mfa:false,aal:'aal1',allow:false},
    {name:'forced password even with MFA',password:true,mfa:true,aal:'aal2',allow:false},
    {name:'inactive administrator',status:'inactive',mfa:false,aal:'aal2',allow:false},
    {name:'MFA required aal1',mfa:true,aal:'aal1',allow:false},
    {name:'MFA satisfied aal2',mfa:true,aal:'aal2',allow:true},
    {name:'non-admin no global MFA',role:'sales_manager',mfa:true,aal:'aal1',allow:true},
    {name:'deny-only restriction',restrict:true,mfa:false,aal:'aal2',allow:false},
    {name:'inactive role',inactiveRole:true,mfa:false,aal:'aal2',allow:false},
    {name:'missing assignment',unassigned:true,mfa:false,aal:'aal2',allow:false},
  ]) {
    await db.query('savepoint scenario');
    await db.query('update private.staff_security_policy set admin_mfa_required=$1',[test.mfa]);
    await db.query('update public.staff_users set status=$1,must_change_password=$2 where id=$3',[test.status??'active',test.password??false,actor]);
    if(test.role) {
      await db.query('update public.staff_role_assignments set role_id=(select id from public.roles where slug=$1) where staff_id=$2',[test.role,actor]);
      await db.query("insert into public.role_permissions(role_id,module_id,can_view,can_create) select r.id,m.id,true,true from public.roles r,public.modules m where r.slug=$1 and m.key='operations.catalog' on conflict(role_id,module_id) do update set can_view=true,can_create=true",[test.role]);
    }
    if(test.restrict) await db.query("insert into public.staff_permission_restrictions(staff_id,module_id,deny_view) select $1,id,true from public.modules where key='operations.catalog'",[actor]);
    if(test.inactiveRole) await db.query("update public.roles set is_active=false where slug='super_admin'");
    if(test.unassigned) await db.query('delete from public.staff_role_assignments where staff_id=$1',[actor]);
    await db.query('set local role authenticated');
    const claims=JSON.stringify({sub:actor,role:'authenticated',aal:test.aal});
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim',$2,true),set_config('request.jwt.claims',$2,true)",[actor,claims]);
    const permission=(await db.query("select private.has_permission('operations.catalog','view') allowed")).rows[0].allowed;
    assert.equal(permission,test.allow,test.name+' RLS gate');
    if(!test.unassigned&&!test.inactiveRole&&test.status!=='inactive') {
      const session=(await db.query('select public.afhomes_self_session() session')).rows[0].session;
      assert.equal(session.id,actor,test.name+' self-session available');
      assert.equal(session.mustChangePassword,test.password??false);
    }
    for(const sql of ["select * from public.preview_staff_services()", "select id from public.preview_staff_save_service(null,'{\"name\":\"Gate Fixture\",\"basePrice\":\"1.00\"}'::jsonb)"]) {
      await db.query('savepoint operation');
      let allowed=true;
      try {await db.query(sql);} catch(error){assert.equal(error.code,'42501',test.name);allowed=false;}
      finally {await db.query('rollback to savepoint operation');await db.query('release savepoint operation');}
      assert.equal(allowed,test.allow,test.name+' RPC gate');
    }
    results.push({name:test.name,allowed:test.allow,selfSessionPreserved:!test.unassigned&&!test.inactiveRole&&test.status!=='inactive'});
    await db.query('rollback to savepoint scenario');await db.query('release savepoint scenario');
  }
  const wrappers=(await db.query("select p.proname,array(select format_type(t,null) from unnest(p.proargtypes) t) arg_types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'preview_staff_%' order by p.proname")).rows;
  assert(wrappers.length>=30,'All public staff wrappers inventoried');
  await db.query('savepoint all_wrappers');
  await db.query('update public.staff_users set must_change_password=true where id=$1',[actor]);
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim',$2,true),set_config('request.jwt.claims',$2,true)",[actor,JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'})]);
  for(const wrapper of wrappers) {
    assert.match(wrapper.proname,/^[a-z_]+$/);
    await db.query('savepoint wrapper');
    let denied=false;
    try {await db.query(`select * from public.${wrapper.proname}(${wrapper.arg_types.map(type=>'NULL::'+type).join(',')})`);}
    catch(error){assert.equal(error.code,'42501',wrapper.proname);denied=true;}
    finally {await db.query('rollback to savepoint wrapper');await db.query('release savepoint wrapper');}
    assert(denied,wrapper.proname+' cannot bypass password gate');
  }
  await db.query('rollback to savepoint all_wrappers');await db.query('release savepoint all_wrappers');
  const audits=await db.query(fs.readFileSync('supabase/security/rls_invariants.sql','utf8'));
  for(const result of audits) assert.equal(result.rows.length,0,'RLS invariant');
  // Forward migrations must be idempotent and preserve rows.
  for(const file of ['20261129000001_afhomes_document_scope_security.sql','20261129000002_afhomes_staff_business_security.sql']) await db.query(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.query('rollback');
  assert.equal((await db.query('select id from auth.users where id=$1',[actor])).rowCount,0);
  fs.writeFileSync('docs/security/evidence/staff-security-gates.json',JSON.stringify({target:'loopback only',fixtureRolledBack:true,idempotent:true,rlsInvariants:'PASS',results,passwordGatedWrappers:wrappers.map(w=>w.proname)},null,2)+'\n');
  console.log('Staff password, MFA, role, restriction, self-session and RLS gates passed: '+results.length+' scenarios');
} finally {await db.query('rollback').catch(()=>{});await db.end();}
