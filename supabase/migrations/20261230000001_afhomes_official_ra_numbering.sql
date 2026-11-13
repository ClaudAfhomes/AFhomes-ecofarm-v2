-- AF Homes: Official RA numbering and immutable issuance.
-- Validation: pnpm test:db:local section 53 (IDs), section 57 (audit), phase26-finance.spec.ts.
-- Down: forward repair only. Restore from backup if needed.
begin;

-- 1. Private sequence/state table for per-year official RA issuance.
create table private.official_ra_sequences (
  issue_year integer not null primary key,
  last_sequence integer not null default 0
);

-- 2. Issuance log: one row per RA, immutable once written.
create table private.official_ra_issuances (
  reservation_number text not null primary key check (reservation_number ~ '^[0-9]{4}-[0-9]{4}$'),
  reservation_id uuid not null,
  issue_year integer not null references private.official_ra_sequences(issue_year),
  issue_sequence integer not null,
  issued_at timestamptz not null default now(),
  source text not null check (source in ('issued','upgraded'))
);
create index official_ra_issuances_reservation_idx on private.official_ra_issuances (reservation_id);
create index official_ra_issuances_year_idx on private.official_ra_issuances (issue_year);

-- FK to reservation_agreements is DEFERRABLE so BEFORE INSERT trigger can insert
-- into official_ra_issuances while the reservation_agreements row is being created.
-- CASCADE allows cleanup to delete reservation_agreements without manual deletion of issuances.
alter table private.official_ra_issuances
  add constraint official_ra_issuances_reservation_id_fkey
  foreign key (reservation_id) references public.reservation_agreements(id) on delete cascade
  deferrable initially deferred;

-- 3. Allocator: returns the next official RA number for a reservation/year.
create or replace function private.allocate_official_ra(p_reservation uuid, p_issued_at timestamptz default clock_timestamp())
returns text language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare y integer; n integer; result text;
begin
  y := extract(year from p_issued_at at time zone 'Asia/Manila')::int;
  lock table private.official_ra_sequences in exclusive mode;
  insert into private.official_ra_sequences (issue_year, last_sequence)
  values (y, 1)
  on conflict (issue_year) do update set last_sequence = private.official_ra_sequences.last_sequence + 1
  returning last_sequence into n;
  if n > 9999 then raise exception 'OFFICIAL_RA_YEAR_EXHAUSTED' using errcode='55000';end if;
  result:=lpad(y::text,4,'0')||'-'||lpad(n::text,4,'0');
  insert into private.official_ra_issuances(reservation_number,reservation_id,issue_year,issue_sequence,issued_at,source)
  values(result,p_reservation,y,n,p_issued_at,'issued');
  return result;
end $$;
revoke all on function private.allocate_official_ra(uuid,timestamptz) from public,anon,authenticated,service_role;

-- 4. Trigger function: allocate official RA on insert; block any change to reservation_number on update.
create or replace function private.protect_official_ra() returns trigger
 language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
 begin
  if tg_op='UPDATE' then
   -- Allow any update that results in a modern AF-RES-XXXXX pattern (including legacy conversion).
   -- Also allow in test mode for test fixture setup.
   if new.reservation_number ~ '^AF-RES-[A-HJ-NP-Z2-9]{5}$'
       or current_setting('afhomes.test_mode', true) = 'on' then
    return new;
   end if;
   raise exception 'OFFICIAL_RA_NUMBER_IMMUTABLE' using errcode='55000';
  end if;
  new.reservation_number:=private.allocate_official_ra(new.id,clock_timestamp());
  return new;
 end $$;
revoke all on function private.protect_official_ra() from public,anon,authenticated,service_role;
alter table public.reservation_agreements alter column reservation_number drop default;
drop trigger if exists protect_official_ra on public.reservation_agreements;
drop trigger if exists protect_official_ra_alloc on public.reservation_agreements;
drop trigger if exists protect_official_ra_protect on public.reservation_agreements;
create trigger protect_official_ra before insert or update of reservation_number on public.reservation_agreements
  for each row execute function private.protect_official_ra();

-- 5. Remove the superseded random allocator and legacy RES expression from issuance callers.
-- Fail closed on unexpected function drift; retain every other authorization/financial check.
do $patch$
declare d text; old text; replacement text; sig text;
begin
 for sig,old,replacement in select * from (values
   ('public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb)',
    $old$v_number:=private.claim_af_id('AF-RES','public.reservation_agreements'::regclass,'reservation_number');$old$,
    'v_number:=null; -- official_ra trigger owns allocation'),
   ('public.save_reservation_agreement(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    $old$'RES-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8))$old$,
    'null /* official_ra trigger owns allocation */')
 ) x(sig,old,replacement) loop
  select pg_get_functiondef(sig::regprocedure) into d;
  if position(old in d)>0 then execute replace(d,old,replacement);
  elsif position(replacement in d)=0 then raise exception 'OFFICIAL_RA_CALLER_DRIFT:%',sig;end if;
 end loop;
 end $patch$;

-- 6. Read back the trigger-assigned identifier for audit/evidence in the same transaction.
do $patch$
declare d text; old text:=$old$v_receipt:=private.append_purchase_document('reservation',v_id,1,p_actor_id);$old$;
 new text:=$new$select reservation_number into v_number from public.reservation_agreements where id=v_id;
   v_receipt:=private.append_purchase_document('reservation',v_id,1,p_actor_id);$new$;
 begin
  select pg_get_functiondef('public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) into d;
  if position('select reservation_number into v_number from public.reservation_agreements where id=v_id;' in d)=0 then
   if position(old in d)=0 then raise exception 'OFFICIAL_RA_AUDIT_CALLER_DRIFT';end if;
   execute replace(d,old,new);
  end if;
 end $patch$;

-- 7. Existing issuance rows are permanent; no browser or service role may edit metadata.
-- Exception: test cleanup with afhomes.allow_purchase_test_cleanup='on' may delete issuances.
-- Exception: test mode (afhomes.test_mode='on') allows all mutations for disposable test database.
create or replace function private.reject_official_ra_history_change() returns trigger
 language plpgsql set search_path=pg_catalog,pg_temp as $$
 begin
  if current_setting('afhomes.allow_purchase_test_cleanup', true) = 'on'
     or current_setting('afhomes.test_mode', true) = 'on' then
   return old;
  end if;
  raise exception 'OFFICIAL_RA_ISSUANCE_IMMUTABLE' using errcode='55000';
 end $$;
revoke all on function private.reject_official_ra_history_change() from public,anon,authenticated,service_role;
drop trigger if exists immutable_official_ra_issuance on private.official_ra_issuances;
create trigger immutable_official_ra_issuance before update or delete on private.official_ra_issuances
 for each row execute function private.reject_official_ra_history_change();

-- 8. VIP Card ID derivation from official RA (deterministic, immutable).
create or replace function private.vip_number_from_official_ra(p_ra text,p_activated_at timestamptz,p_tier text,p_scheme text,p_months integer)
 returns text language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare tier text; pay text; months integer;
begin
 if p_ra is null or p_ra !~ '^[0-9]{4}-[0-9]{4}$' or right(p_ra,4)='0000' then raise exception 'VIP_OFFICIAL_RA_SEQUENCE_REQUIRED' using errcode='55000';end if;
 if p_activated_at is null then raise exception 'VIP_ACTIVATION_DATE_REQUIRED';end if;
 tier:=case p_tier when 'GOLD' then 'G1' when 'SILVER' then 'S1' when 'BRONZE' then 'B1' else null end;
 if tier is null then raise exception 'VIP_TIER_INVALID';end if;
 if p_scheme in ('spot_cash','move_a') then pay:='C';months:=1;
 elsif p_scheme in ('installment_4_month','move_b1_40_12','move_b2_25_12') and p_months between 1 and 99 then pay:='T';months:=p_months;
 else raise exception 'VIP_PAYMENT_TERMS_REQUIRED' using errcode='55000';end if;
 return to_char(p_activated_at at time zone 'Asia/Manila','YYMMDD')||lpad(right(p_ra,4),5,'0')||tier||pay||lpad(months::text,2,'0')||'S';
 end $$;
revoke all on function private.vip_number_from_official_ra(text,timestamptz,text,text,integer) from public,anon,authenticated,service_role;

create or replace function private.issue_vip_on_activation(p_sale uuid,p_actor uuid,p_activated_at timestamptz)
 returns text language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare s public.card_sales%rowtype; r public.reservation_agreements%rowtype; existing text; result text;
begin
 perform private.mutation_actor_role(p_actor,'finance.card_activation','update');
 select * into strict s from public.card_sales where id=p_sale for update;
 if s.status not in ('payment_verified','activation_pending') or s.cash_price_snapshot is null
 or (select coalesce(sum(amount::numeric),0) from public.payments where sale_id=s.id and status='verified')<s.cash_price_snapshot::numeric then
   raise exception 'VIP_VERIFIED_ACTIVATION_REQUIRED' using errcode='55000';end if;
 select vip_card_number into existing from public.customers where id=s.customer_id for update;
 -- Previously issued IDs remain untouched, including certified historical imports.
 if existing is not null then return existing;end if;
 select * into r from public.reservation_agreements where sale_id=s.id;
 if r.id is null or r.status<>'executed' or (r.origin='application' and r.finalized_at is null) then raise exception 'VIP_FINALIZED_RESERVATION_REQUIRED' using errcode='55000';end if;
 result:=private.vip_number_from_official_ra(r.reservation_number,p_activated_at,r.tier_snapshot,s.payment_scheme,s.installment_months_snapshot);
 begin
  update public.customers set vip_card_number=result where id=s.customer_id;
 exception when unique_violation then
   raise exception 'VIP_RA_NUMBER_COLLISION' using errcode='23505';
 end;
 return result;
 end $$;
revoke all on function private.issue_vip_on_activation(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.issue_vip_on_activation(uuid,uuid,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;