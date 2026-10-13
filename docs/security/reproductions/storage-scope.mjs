import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
const db=new pg.Client({host:'127.0.0.1',port:55447,user:'afhomes',password:'afhomes-local-test',database:'postgres'});
await db.connect();
const seller='00000000-0000-4000-8000-00000000b001';
const other='00000000-0000-4000-8000-00000000b002';
try{
  assert.equal((await db.query('select host(inet_server_addr()) as host')).rows[0].host,'127.0.0.1');
  await db.query('begin');
  // Reproduce the verified managed platform SELECT grant missing from the minimal local shim.
  await db.query('grant usage on schema storage to authenticated');
  await db.query('grant select on storage.objects to authenticated');
  await db.query('insert into auth.users(id,email) values($1,$2)',[seller,'audit-seller@example.invalid']);
  await db.query('insert into auth.users(id,email) values($1,$2)',[other,'audit-other@example.invalid']);
  await db.query("insert into public.staff_users(id,email,full_name,status) values($1,$2,'Audit Seller','active')",[seller,'audit-seller@example.invalid']);
  await db.query("insert into public.staff_users(id,email,full_name,status) values($1,$2,'Audit Other','active')",[other,'audit-other@example.invalid']);
  await db.query("insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='sales_manager'",[seller]);
  await db.query("insert into public.role_permissions(role_id,module_id,can_view) select r.id,m.id,true from public.roles r,public.modules m where r.slug='sales_manager' and m.key='sales.id_documents' on conflict(role_id,module_id) do update set can_view=true");
  await db.query("insert into storage.objects(bucket_id,name,owner) values('afhomes-customer-ids','audit-only/own.png',$1),('afhomes-customer-ids','audit-only/other.png',$2)",[seller,other]);
  for(const [label,owner] of [['own',seller],['other',other]]) {
    const customer=(await db.query("insert into public.customers(customer_number,email,phone,first_name,last_name,created_by) values(public.next_customer_number(),$1,'+639170000001','AUDIT','FIXTURE',$2) returning id",[`audit-${label}@example.invalid`,owner])).rows[0].id;
    await db.query("insert into public.identity_documents(subject_type,customer_id,storage_path,original_filename,mime_type,size_bytes,sha256,uploaded_by,extracted_data) values('customer',$1,$2,'audit.png','image/png',1,$3,$4,'{\"governmentIdNumber\":\"SYNTHETIC-AUDIT-ONLY\"}'::jsonb)",[customer,`afhomes-customer-ids/audit-only/${label}.png`,'a'.repeat(64),owner]);
  }
  await db.query('savepoint probe');
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[seller]);
  const rows=(await db.query("select name,owner=$1 as own from storage.objects where name like 'audit-only/%' order by name",[seller])).rows;
  assert.equal(rows.length,1);
  assert(rows.every(r=>r.own));
  const documents=(await db.query("select uploaded_by=$1 as own from public.identity_documents where storage_path like 'afhomes-customer-ids/audit-only/%'",[seller])).rows;
  assert.equal(documents.length,1);
  assert(documents.every(r=>r.own));
  await db.query('savepoint raw_fields');
  let rawDenied=false;
  try {await db.query('select extracted_data,reviewed_data from public.identity_documents limit 0');}
  catch(error){assert.equal(error.code,'42501');rawDenied=true;}
  finally{await db.query('rollback to savepoint raw_fields');await db.query('release savepoint raw_fields');}
  assert(rawDenied);
  await db.query('rollback to savepoint probe');
  await db.query('release savepoint probe');
  // OST sponsor scope and uploader access must match the existing API as well.
  await db.query("insert into public.role_permissions(role_id,module_id,can_view) select r.id,m.id,true from public.roles r,public.modules m where r.slug='sales_manager' and m.key='network.ost_registrations' on conflict(role_id,module_id) do update set can_view=true");
  for(const [label,owner] of [['own',seller],['other',other]]) {
    const referral=(await db.query("insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,created_by,expires_at) values($1,$2,$3,$3,now()+interval '1 day') returning id",[label==='own'?'d'.repeat(64):'e'.repeat(64),'scope-'+label,owner])).rows[0].id;
    const application=(await db.query("insert into public.ost_applications(referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address) values($1,$2,$3,'+639170000001','SCOPE','OST','1990-01-01','{}'::jsonb) returning id",[referral,owner,'scope-'+label+'@example.invalid'])).rows[0].id;
    await db.query("insert into public.identity_documents(subject_type,ost_application_id,storage_path,original_filename,mime_type,size_bytes,sha256,uploaded_by) values('ost_application',$1,$2,'audit.png','image/png',1,$3,$4)",[application,`afhomes-ost-ids/audit-only/${label}.png`,'b'.repeat(64),owner]);
    await db.query("insert into storage.objects(bucket_id,name,owner) values('afhomes-ost-ids',$1,$2)",[`audit-only/${label}.png`,owner]);
  }
  const uploadCustomer=(await db.query("insert into public.customers(customer_number,email,phone,first_name,last_name,created_by) values(public.next_customer_number(),'uploader@example.invalid','+639170000001','AUDIT','UPLOADER',$1) returning id",[other])).rows[0].id;
  await db.query("insert into public.identity_documents(subject_type,customer_id,storage_path,original_filename,mime_type,size_bytes,sha256,uploaded_by) values('customer',$1,'afhomes-customer-ids/audit-only/uploaded.png','audit.png','image/png',1,$2,$3)",[uploadCustomer,'c'.repeat(64),seller]);
  await db.query("insert into storage.objects(bucket_id,name,owner) values('afhomes-customer-ids','audit-only/uploaded.png',$1),('afhomes-customer-ids','audit-only/orphan.png',$1)",[seller]);
  const scopes=[];
  for(const test of [
    {name:'seller customer/OST/uploader',actor:seller,count:3},
    {name:'authorized reviewer',actor:other,reviewer:true,count:5},
    {name:'customer without staff role',actor:other,count:0},
    {name:'inactive seller',actor:seller,inactive:true,count:0},
    {name:'forced-password seller',actor:seller,password:true,count:0},
    {name:'restricted seller',actor:seller,restricted:true,count:0},
  ]) {
    await db.query('savepoint scope_case');
    if(test.reviewer) await db.query("insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",[other]);
    if(test.inactive) await db.query("update public.staff_users set status='inactive' where id=$1",[seller]);
    if(test.password) await db.query('update public.staff_users set must_change_password=true where id=$1',[seller]);
    if(test.restricted) await db.query("insert into public.staff_permission_restrictions(staff_id,module_id,deny_view) select $1,id,true from public.modules where key in ('sales.id_documents','network.ost_registrations')",[seller]);
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[test.actor]);
    assert.equal((await db.query("select id from public.identity_documents where storage_path like '%/audit-only/%'")).rowCount,test.count,test.name+' SQL');
    assert.equal((await db.query("select id from storage.objects where name like 'audit-only/%'")).rowCount,test.count,test.name+' Storage');
    scopes.push({name:test.name,visibleDocuments:test.count,visibleObjects:test.count});
    await db.query('rollback to savepoint scope_case');await db.query('release savepoint scope_case');
  }
  await db.query('savepoint anonymous');
  await db.query('set local role anon');
  let anonymousDenied=false;
  try{await db.query('select id from public.identity_documents');}catch(error){assert.equal(error.code,'42501');anonymousDenied=true;}
  await db.query('rollback to savepoint anonymous');await db.query('release savepoint anonymous');
  assert(anonymousDenied);
  await db.query('rollback');
  assert.equal((await db.query("select id from storage.objects where name like 'audit-only/%'")).rowCount,0);
  fs.writeFileSync('docs/security/evidence/storage-scope-remediated.json',JSON.stringify({target:'loopback only',platformSelectGrantVerifiedLive:true,sellerModuleGrantExplicitSynthetic:true,fixtureRolledBack:true,rows,documents,rawDenied,anonymousDenied,scopes},null,2)+'\n');
  console.log(JSON.stringify({rows,documents}));
}finally{await db.query('rollback').catch(()=>{});await db.end();}
