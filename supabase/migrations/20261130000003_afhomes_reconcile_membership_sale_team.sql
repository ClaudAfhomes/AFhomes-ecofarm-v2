-- Reconcile the historical duplicate migration version 20261130000001.
-- Both original files remain immutable. The version-keyed runner can record
-- only one, so this distinct version re-delivers the missing prerequisites.
-- It sorts before later customer SSOT/import migrations which require these columns.
-- Existing rows, issued AA identifiers, approvals and audit events are preserved.
-- Only nullable company columns and the existing accreditation objects are reconciled.
-- Do NOT replay the original import_legacy_member body: later SSOT work owns it.
-- Idempotent: IF NOT EXISTS columns/table; existing function definitions/grants
-- are the current canonical accreditation implementation; trigger is replaced.
-- Validation: select to_regclass('private.sale_team_accreditations'); -- non-null
-- select count(*) from information_schema.columns where table_schema='public'
-- and table_name='customers' and column_name in ('ra_number','stated_vip_package',
-- 'supplementary_tin_number'); -- 3
-- Run test-migration-version-reconciliation.mjs and test:db:local;
-- supabase/security/rls_invariants.sql must return zero violations.
-- Down: forward-only; retain customer facts, identifiers and protected history.
-- Live application still requires explicit approval and verified target history.

alter table public.customers
  add column if not exists ra_number text,
  add column if not exists company_status text,
  add column if not exists citizenship text,
  add column if not exists civil_status text,
  add column if not exists tin_number text,
  add column if not exists occupation_business_name text,
  add column if not exists office_business_address text,
  add column if not exists employed_position text,
  add column if not exists supplementary_full_name text,
  add column if not exists supplementary_address text,
  add column if not exists supplementary_birthday date,
  add column if not exists supplementary_gender text
    check (supplementary_gender is null or supplementary_gender in ('male', 'female', 'other', 'undisclosed')),
  add column if not exists supplementary_citizenship text,
  add column if not exists supplementary_civil_status text,
  add column if not exists supplementary_tin_number text,
  add column if not exists supplementary_mobile text,
  add column if not exists supplementary_email text,
  add column if not exists supplementary_occupation_business_name text,
  add column if not exists supplementary_office_address text,
  add column if not exists supplementary_position text,
  add column if not exists ost_ist_name text,
  add column if not exists svd_name text,
  add column if not exists ssm_name text,
  add column if not exists sm_name text,
  add column if not exists referrer_name text,
  add column if not exists vip_recommender_name text,
  add column if not exists related_contact_no text,
  add column if not exists related_email text,
  add column if not exists stated_vip_package text,
  add column if not exists stated_payment_terms text,
  add column if not exists stated_regular_price text,
  add column if not exists stated_discount text,
  add column if not exists stated_total_amount text,
  add column if not exists stated_rf text,
  add column if not exists stated_payment_type text,
  add column if not exists stated_ref_no text,
  add column if not exists stated_payment_date date;

comment on column public.customers.tin_number is
  'Company-stated TIN, verbatim. Write-only like government_id_number: no browser SELECT grant, masked on read, never in audit payloads.';
comment on column public.customers.supplementary_tin_number is
  'Company-stated supplementary TIN, verbatim. Write-only, masked on read, never in audit payloads.';
comment on column public.customers.company_status is
  'Company-stated membership status, verbatim. Independent of the lifecycle status column, which remains authoritative.';
comment on column public.customers.stated_regular_price is
  'Company-stated figure, verbatim. Never an input to server-computed totals; payment verification and activation read verified payment rows only. Same for stated_discount, stated_total_amount and stated_rf.';


-- Requires OST accreditation workflow and 20261129000002 staff business security.
-- CLI-created file ordered after the current repository baseline, not wall-clock order.
-- Validate: browser table/function privileges must all be false;
-- SELECT aa_number,count(*) FROM private.sale_team_accreditations GROUP BY 1 HAVING count(*)>1;
-- Forward recovery: disable the API/page, retain issued numbers and audit history.
-- Never renumber existing records or grant browser access.

create table if not exists private.sale_team_accreditations (
  staff_id uuid primary key references public.staff_users(id) on delete restrict,
  aa_number text not null unique,
  public_name text not null,
  kind text not null check(kind in ('IST','OST')),
  status text not null check(status in ('active','revoked')),
  starts_on date not null,
  expires_on date not null check(expires_on>=starts_on),
  approved_by uuid not null references public.staff_users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_by uuid references public.staff_users(id) on delete restrict,
  revoked_at timestamptz
);
alter table private.sale_team_accreditations enable row level security;
revoke all on private.sale_team_accreditations from public,anon,authenticated,service_role;

-- Only future generation changes when the company supplies its numbering format.
create or replace function private.next_sale_team_aa_number() returns text
language plpgsql volatile security definer set search_path=pg_catalog,public,extensions,pg_temp as $$
declare chars text[] := array[]::text[]; b integer; i integer; shuffled text;
begin
  for i in 1..6 loop
    -- Reject the remainder to avoid modulo bias.
    loop b:=get_byte(gen_random_bytes(1),0); exit when b<234; end loop;
    chars:=array_append(chars,chr(65+b%26));
    loop b:=get_byte(gen_random_bytes(1),0); exit when b<250; end loop;
    chars:=array_append(chars,(b%10)::text);
  end loop;
  select string_agg(c,'' order by gen_random_bytes(16)) into shuffled from unnest(chars) as letters(c);
  return 'AA-'||shuffled;
end;
$$;
revoke all on function private.next_sale_team_aa_number() from public,anon,authenticated,service_role;

create or replace function public.get_sale_team_accreditation(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('aaNumber',a.aa_number,'kind',a.kind,'fullName',a.public_name,
   'startsOn',case when a.kind='OST' then coalesce(t.starts_on,a.starts_on) else a.starts_on end,
   'expiresOn',case when a.kind='OST' then coalesce(t.expires_on,a.expires_on) else a.expires_on end,
   'status',case
     when a.status='revoked' or (a.kind='OST' and t.status='revoked') then 'revoked'
     when s.status<>'active' or not r.is_active
       or (a.kind='IST' and r.slug not in ('vice_director','senior_sales_manager','sales_manager'))
       or (a.kind='OST' and (r.slug<>'ost' or m.status is distinct from 'active' or t.id is null)) then 'inactive'
     when (case when a.kind='OST' then t.starts_on else a.starts_on end)>(now() at time zone 'Asia/Manila')::date then 'not_started'
     when (case when a.kind='OST' then t.expires_on else a.expires_on end)<(now() at time zone 'Asia/Manila')::date then 'expired'
     else 'accredited' end)
 from private.sale_team_accreditations a
 join public.staff_users s on s.id=a.staff_id
 join public.staff_role_assignments ra on ra.staff_id=s.id
 join public.roles r on r.id=ra.role_id
 left join public.ost_members m on m.id=s.id and a.kind='OST'
 left join lateral (select ot.* from private.ost_accreditation_terms ot
   where ot.ost_id=m.id and ot.status in ('active','revoked')
   order by ot.approved_at desc,ot.id desc limit 1) t on true
 where a.staff_id=p_staff_id;
$$;
revoke all on function public.get_sale_team_accreditation(uuid) from public,anon,authenticated;
grant execute on function public.get_sale_team_accreditation(uuid) to service_role;

create or replace function public.search_sale_team_accreditation(p_aa_number text) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select result from (select public.get_sale_team_accreditation(a.staff_id) result
   from private.sale_team_accreditations a where a.aa_number=p_aa_number) found
 where result->>'status'='accredited';
$$;
revoke all on function public.search_sale_team_accreditation(text) from public,anon,authenticated;
grant execute on function public.search_sale_team_accreditation(text) to service_role;

create or replace function public.manage_sale_team_accreditation(
 p_actor_id uuid,p_staff_id uuid,p_kind text,p_action text,p_starts_on date default null,p_expires_on date default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text; v_target text; v_existing private.sale_team_accreditations%rowtype;
  v_attempt integer; v_constraint text;
begin
 if p_kind not in ('IST','OST') or p_action not in ('approve','revoke') then raise exception 'INVALID_ACCREDITATION'; end if;
 v_role:=private.mutation_actor_role(p_actor_id,case when p_kind='IST' then 'organization.staff' else 'network.ost_registrations' end,'update');
 if v_role is null or v_role not in ('admin','super_admin') then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.staff_users s where s.id=p_staff_id for update;
 select r.slug into v_target from public.staff_users s
 join public.staff_role_assignments ra on ra.staff_id=s.id
 join public.roles r on r.id=ra.role_id and r.is_active where s.id=p_staff_id
   and (s.status='active' or (p_kind='OST' and s.status='invited'));
 select * into v_existing from private.sale_team_accreditations a where a.staff_id=p_staff_id for update;
 if v_existing.staff_id is not null and v_existing.kind<>p_kind then raise exception 'ACCREDITATION_KIND_CONFLICT'; end if;
 if p_action='revoke' then
   if v_existing.staff_id is null then raise exception 'ACCREDITATION_REQUIRED'; end if;
   if v_existing.status='revoked' then return public.get_sale_team_accreditation(p_staff_id); end if;
   update private.sale_team_accreditations set status='revoked',revoked_by=p_actor_id,revoked_at=now() where staff_id=p_staff_id;
 else
   if v_target is null or (p_kind='IST' and v_target not in ('vice_director','senior_sales_manager','sales_manager'))
      or (p_kind='OST' and v_target<>'ost') then raise exception 'INVALID_ACCREDITATION_TARGET'; end if;
   if p_kind='OST' then
     select t.starts_on,t.expires_on into p_starts_on,p_expires_on
       from private.ost_accreditation_terms t join public.ost_members m on m.id=t.ost_id and m.status='active'
       where t.ost_id=p_staff_id and t.status='active';
   end if;
   if p_starts_on is null or p_expires_on is null or p_expires_on<p_starts_on then raise exception 'APPROVED_DATES_REQUIRED'; end if;
   if v_existing.status='active' and v_existing.starts_on=p_starts_on and v_existing.expires_on=p_expires_on
     and v_existing.public_name=(select s.full_name from public.staff_users s where s.id=p_staff_id) then
     return public.get_sale_team_accreditation(p_staff_id);
   end if;
   for v_attempt in 1..8 loop
    begin
     insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by)
     values(p_staff_id,coalesce(v_existing.aa_number,private.next_sale_team_aa_number()),
       (select s.full_name from public.staff_users s where s.id=p_staff_id),p_kind,'active',p_starts_on,p_expires_on,p_actor_id)
     on conflict(staff_id) do update set status='active',starts_on=excluded.starts_on,expires_on=excluded.expires_on,
       public_name=excluded.public_name,approved_by=excluded.approved_by,approved_at=now(),revoked_by=null,revoked_at=null;
     exit;
    exception when unique_violation then
     get stacked diagnostics v_constraint=CONSTRAINT_NAME;
     if v_existing.staff_id is not null or v_constraint<>'sale_team_accreditations_aa_number_key' or v_attempt=8 then raise; end if;
    end;
   end loop;
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
 values(p_actor_id,case when p_action='approve' then 'SALE_TEAM_ACCREDITATION_APPROVED' else 'SALE_TEAM_ACCREDITATION_REVOKED' end,
   'staff_user',p_staff_id::text,jsonb_build_object('kind',p_kind,'aaNumber',(select aa_number from private.sale_team_accreditations where staff_id=p_staff_id)));
 return public.get_sale_team_accreditation(p_staff_id);
end $$;
revoke all on function public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date) from public,anon,authenticated;
grant execute on function public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date) to service_role;

-- Piggyback on approved term insertion; no historical backfill or account edits.
create or replace function private.issue_ost_aa_on_approval() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from private.sale_team_accreditations where staff_id=new.ost_id)
   and private.has_permission_for_user(new.approved_by,'network.ost_registrations','update')
   and exists(select 1 from public.staff_role_assignments ra join public.roles r on r.id=ra.role_id
     where ra.staff_id=new.approved_by and r.is_active and r.slug in ('admin','super_admin')) then
   perform public.manage_sale_team_accreditation(new.approved_by,new.ost_id,'OST','approve');
 end if;
 return new;
end $$;
revoke all on function private.issue_ost_aa_on_approval() from public,anon,authenticated,service_role;
drop trigger if exists ost_accreditation_issue_aa on private.ost_accreditation_terms;
create trigger ost_accreditation_issue_aa after insert on private.ost_accreditation_terms
 for each row when(new.status='active') execute function private.issue_ost_aa_on_approval();
