import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

export async function seedSearchOst(db, sponsor) {
  assert.equal(db.connectionParameters.host, '127.0.0.1', 'Synthetic fixture is loopback only');
  const ost = randomUUID(), application = randomUUID(), code = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [ost, `${ost}@example.invalid`]);
  await db.query("insert into public.staff_users(id,email,full_name,status) values($1,$2,'Synthetic External Seller','active')", [ost, `${ost}@example.invalid`]);
  await db.query("insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='ost'", [ost]);
  await db.query("insert into public.referral_codes(id,sponsor_staff_id,code_hash,code_hint,expires_at,created_by) values($1,$2,$3,'SYNTHETIC SEARCH',now()+interval '1 day',$2)", [code, sponsor, randomBytes(32).toString('hex')]);
  await db.query("insert into public.ost_applications(id,referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address,status) values($1,$2,$3,$4,'+639171234567','Synthetic','External Seller','1990-01-01','{}','approved')", [application, code, sponsor, `${ost}@example.invalid`]);
  await db.query("insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,approved_by) values($1,$2,$3,$4,'Synthetic External Seller',$5,'+639171234567',$3)", [ost, application, sponsor, `OST-SEARCH-${ost}`, `${ost}@example.invalid`]);
  await db.query("insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by) values($1,'AAO26100001','Synthetic External Seller','OST','active',date_trunc('year',now())::date,(date_trunc('year',now())+interval '1 year')::date,$2)", [ost, sponsor]);
  await db.query("insert into private.ost_accreditation_terms(ost_id,application_id,starts_on,expires_on,approved_by) values($1,$2,date_trunc('year',now())::date,(date_trunc('year',now())+interval '1 year')::date,$3)", [ost, application, sponsor]);
  return 'AAO26100001';
}
