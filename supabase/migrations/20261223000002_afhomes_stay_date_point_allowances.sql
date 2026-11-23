-- Stay/service dates govern separate weekday/weekend allowances, never processing time.
-- Validation: disposable PostgreSQL date, reservation, settlement, refund and RLS checks.
-- Down: forward repair only; retain ledger attribution and dated customer approvals.
begin;

alter table public.points_accounts
 add column if not exists weekday_balance bigint,
 add column if not exists weekend_balance bigint;
-- Existing balances start this policy at 70/30; historical spending dates are not inferred.
update public.points_accounts set
 weekend_balance=sign(balance-reversal_debt)*((abs(balance-reversal_debt)*30+50)/100),
 weekday_balance=(balance-reversal_debt)-sign(balance-reversal_debt)*((abs(balance-reversal_debt)*30+50)/100)
where weekday_balance is null and weekend_balance is null;
alter table public.points_accounts alter column weekday_balance set default 0,
 alter column weekday_balance set not null, alter column weekend_balance set default 0,
 alter column weekend_balance set not null;
alter table public.points_ledger
 add column if not exists weekday_delta bigint,
 add column if not exists weekend_delta bigint;
alter table public.redemption_quotes
 add column if not exists service_date date,
 add column if not exists check_in_date date,
 add column if not exists check_out_date date,
 add column if not exists allowance_type text check(allowance_type in ('weekday','weekend','mixed')),
 add column if not exists weekday_points bigint,
 add column if not exists weekend_points bigint,
 add column if not exists redemption_date timestamptz;

-- The ledger attribution and total account must reconcile at transaction end.
alter table public.points_ledger drop constraint if exists points_ledger_allowance_amounts;
alter table public.points_ledger add constraint points_ledger_allowance_amounts check(
 (weekday_delta is null and weekend_delta is null) or
 (weekday_delta is not null and weekend_delta is not null and weekday_delta+weekend_delta=amount));
create or replace function private.check_point_allowance_total() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if exists(select 1 from public.points_accounts a where a.id=new.id and a.weekday_balance+a.weekend_balance<>a.balance-a.reversal_debt) then raise exception 'POINT_ALLOWANCE_LEDGER_MISMATCH';end if;
 return null;
end $$;
revoke all on function private.check_point_allowance_total() from public,anon,authenticated,service_role;
drop trigger if exists check_point_allowance_total on public.points_accounts;
create constraint trigger check_point_allowance_total after insert or update on public.points_accounts
 deferrable initially deferred for each row execute function private.check_point_allowance_total();

create or replace function private.stay_point_allocation(p_points bigint,p_service date,p_check_in date,p_check_out date)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare nights integer; i integer; d date; points bigint; weekday bigint:=0;weekend bigint:=0;weekday_nights integer:=0;weekend_nights integer:=0;
begin
 if p_points is null or p_points<=0 then raise exception 'POINTS_AMOUNT_REQUIRED';end if;
 if p_service is not null and p_check_in is null and p_check_out is null then
  nights:=1;d:=p_service;
 elsif p_service is null and p_check_in is not null and p_check_out is not null and p_check_out>p_check_in and p_check_out-p_check_in<=366 then
  nights:=p_check_out-p_check_in;d:=p_check_in;
 else raise exception 'STAY_SERVICE_DATES_REQUIRED';end if;
 -- Uniform nightly quantities: distribute whole-point remainders in night order.
 for i in 0..nights-1 loop
  points:=p_points/nights+case when i<p_points%nights then 1 else 0 end;
  if extract(isodow from d+i) in (6,7) then weekend:=weekend+points;weekend_nights:=weekend_nights+1;else weekday:=weekday+points;weekday_nights:=weekday_nights+1;end if;
 end loop;
 return jsonb_build_object('weekday',weekday,'weekend',weekend,'type',case when weekday_nights=0 then 'weekend' when weekend_nights=0 then 'weekday' else 'mixed' end);
end $$;
revoke all on function private.stay_point_allocation(bigint,date,date,date) from public,anon,authenticated,service_role;

create or replace function private.enforce_quote_allowances() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare allocation jsonb;a public.points_accounts%rowtype;reserved_weekday bigint;reserved_weekend bigint;
begin
 if tg_op='UPDATE' then
  if old.approved_at is not null and (new.service_date is distinct from old.service_date or new.check_in_date is distinct from old.check_in_date or new.check_out_date is distinct from old.check_out_date or new.points_requested<>old.points_requested) then
   raise exception 'APPROVAL_CHANGED';
  end if;
  if new.status<>'open' then
   if new.status='committed' and old.status<>'committed' then new.redemption_date:=now();end if;
   return new;
  end if;
 end if;
 allocation:=private.stay_point_allocation(new.points_requested,new.service_date,new.check_in_date,new.check_out_date);
 new.weekday_points:=(allocation->>'weekday')::bigint;new.weekend_points:=(allocation->>'weekend')::bigint;new.allowance_type:=allocation->>'type';
 select * into strict a from public.points_accounts where id=new.account_id for update;
 select coalesce(sum(q.weekday_points),0),coalesce(sum(q.weekend_points),0) into reserved_weekday,reserved_weekend
 from public.redemption_quotes q where q.account_id=a.id and q.id<>new.id and q.status='open' and q.reserved_at is not null and q.expires_at>now();
 if exists(select 1 from public.redemption_quotes q where q.account_id=a.id and q.id<>new.id and q.status='open' and q.reserved_at is not null and q.expires_at>now() and q.allowance_type is null) then raise exception 'LEGACY_REDEMPTION_DATES_REQUIRED';end if;
 if a.weekday_balance-reserved_weekday<new.weekday_points or a.weekend_balance-reserved_weekend<new.weekend_points then raise exception 'INSUFFICIENT_DAY_ALLOWANCE';end if;
 return new;
end $$;
revoke all on function private.enforce_quote_allowances() from public,anon,authenticated,service_role;
drop trigger if exists enforce_quote_allowances on public.redemption_quotes;
create trigger enforce_quote_allowances before insert or update on public.redemption_quotes
 for each row execute function private.enforce_quote_allowances();

create or replace function private.attribute_point_allowances() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare a public.points_accounts%rowtype;q public.redemption_quotes%rowtype;prior bigint;weekday bigint;weekend bigint;net bigint;
begin
 select * into strict a from public.points_accounts where id=new.account_id for update;
 if new.entry_type='redemption' then
  if new.reference_type is distinct from 'redemption_quote' then raise exception 'STAY_SERVICE_DATES_REQUIRED';end if;
  select * into strict q from public.redemption_quotes where id=new.reference_id::uuid and account_id=a.id;
  if q.allowance_type is null or q.weekday_points+q.weekend_points<>-new.amount then raise exception 'STAY_SERVICE_DATES_REQUIRED';end if;
  weekday:=-q.weekday_points;weekend:=-q.weekend_points;
  if a.weekday_balance+weekday<0 or a.weekend_balance+weekend<0 then raise exception 'INSUFFICIENT_DAY_ALLOWANCE';end if;
 elsif new.reference_type='point_refund' then
  select * into q from public.redemption_quotes where id=(new.metadata->>'quoteId')::uuid and account_id=a.id;
  if q.allowance_type is null then raise exception 'LEGACY_REDEMPTION_DATES_REQUIRED';end if;
  select coalesce(sum(l.amount),0) into prior from public.points_ledger l where l.account_id=a.id and l.reference_type='point_refund' and l.metadata->>'quoteId'=q.id::text;
  if prior+new.amount>q.points_requested then raise exception 'POINT_REFUND_EXCEEDS_SPENT';end if;
  weekday:=floor((prior+new.amount)::numeric*q.weekday_points/q.points_requested)::bigint-floor(prior::numeric*q.weekday_points/q.points_requested)::bigint;
  weekend:=new.amount-weekday;
 elsif new.entry_type in ('annual_reset','expiration') then
  net:=a.weekday_balance+a.weekend_balance+new.amount;
  weekend:=sign(net)*((abs(net)*30+50)/100)-a.weekend_balance;
  weekday:=new.amount-weekend;
 else
  weekend:=sign(new.amount)*((abs(new.amount)*30+50)/100);weekday:=new.amount-weekend;
 end if;
 new.weekday_delta:=weekday;new.weekend_delta:=weekend;
 update public.points_accounts set weekday_balance=weekday_balance+weekday,weekend_balance=weekend_balance+weekend where id=a.id;
 return new;
end $$;
revoke all on function private.attribute_point_allowances() from public,anon,authenticated,service_role;
drop trigger if exists attribute_point_allowances on public.points_ledger;
create trigger attribute_point_allowances before insert on public.points_ledger
 for each row execute function private.attribute_point_allowances();

-- Extend the existing quote transaction; preserve its pricing, ownership and approval checks.
do $$declare definition text;begin
 select pg_get_functiondef('public.prepare_customer_point_redemption(uuid,bigint,uuid)'::regprocedure) into definition;
 if position('STAY_SERVICE_DATES_REQUIRED' in definition)=0 then
  definition:=replace(definition,'p_actor_id uuid)', 'p_actor_id uuid, p_service_dates jsonb)');
  if position('p_service_dates jsonb' in definition)=0 then raise exception 'DATED_QUOTE_SIGNATURE_DRIFT';end if;
  definition:=replace(definition,'created_by,redemption_rule_id)','created_by,redemption_rule_id,service_date,check_in_date,check_out_date)');
  definition:=replace(definition,'p_actor_id,v_r.id) returning', 'p_actor_id,v_r.id,nullif(p_service_dates->>''serviceDate'','''')::date,nullif(p_service_dates->>''checkInDate'','''')::date,nullif(p_service_dates->>''checkOutDate'','''')::date) returning');
  if position('service_date,check_in_date,check_out_date' in definition)=0 then raise exception 'DATED_QUOTE_INSERT_DRIFT';end if;
  execute definition;
 end if;
end $$;
create or replace function public.prepare_customer_point_redemption(p_purchase_id uuid,p_points_requested bigint,p_actor_id uuid)
returns table(quote_id uuid,quote_number text,points_requested bigint,peso_value text,eligible_line_total text,remaining_points_after bigint,expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin raise exception 'STAY_SERVICE_DATES_REQUIRED';end $$;
revoke all on function public.prepare_customer_point_redemption(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_customer_point_redemption(uuid,bigint,uuid,jsonb) to service_role;
create or replace function public.preview_staff_prepare_quote(p_purchase_id uuid,p_points_requested bigint,p_service_dates jsonb)
returns table(quote_id uuid,quote_number text,points_requested bigint,peso_value text,eligible_line_total text,remaining_points_after bigint,expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare actor uuid:=private.preview_require_staff('operations.redemption','create');
begin return query select * from public.prepare_customer_point_redemption(p_purchase_id,p_points_requested,actor,p_service_dates);end $$;
revoke all on function public.preview_staff_prepare_quote(uuid,bigint,jsonb) from public,anon;
grant execute on function public.preview_staff_prepare_quote(uuid,bigint,jsonb) to authenticated,service_role;

do $$declare definition text;begin
 select pg_get_functiondef('private.point_redemption_approval_snapshot(uuid)'::regprocedure) into definition;
 if position('serviceDates' in definition)=0 then
  execute replace(definition,'FUNCTION private.point_redemption_approval_snapshot(', 'FUNCTION private.point_redemption_snapshot_before_dates(');
 end if;
 select pg_get_functiondef('public.refund_purchase_redeemed_points(uuid,text,text,text,boolean,uuid)'::regprocedure) into definition;
 if position('p_reason,jsonb_build_object(''quoteId'',v_q.id))' in definition)=0 then
  definition:=replace(definition,'reference_type,reference_id,actor_id,reason)', 'reference_type,reference_id,actor_id,reason,metadata)');
  definition:=replace(definition,'false,''point_refund'',p_reference,p_actor_id,p_reason)', 'false,''point_refund'',p_reference,p_actor_id,p_reason,jsonb_build_object(''quoteId'',v_q.id))');
  execute definition;
 end if;
end $$;
revoke all on function private.point_redemption_snapshot_before_dates(uuid) from public,anon,authenticated,service_role;
create or replace function private.point_redemption_approval_snapshot(p_quote_id uuid) returns jsonb
language sql stable set search_path=pg_catalog,public,private,pg_temp as $$
 select private.point_redemption_snapshot_before_dates(q.id)||jsonb_build_object('serviceDates',jsonb_build_object('serviceDate',q.service_date,'checkInDate',q.check_in_date,'checkOutDate',q.check_out_date),'allowanceType',q.allowance_type,'weekdayPoints',q.weekday_points,'weekendPoints',q.weekend_points)
 from public.redemption_quotes q where q.id=p_quote_id
$$;

create or replace function public.customer_points_position_with_allowances(p_membership_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result jsonb;a public.points_accounts%rowtype;weekday bigint;weekend bigint;
begin
 select to_jsonb(p) into result from public.customer_points_position(p_membership_id) p;
 select * into strict a from public.points_accounts where membership_id=p_membership_id;
 select coalesce(sum(q.weekday_points),0),coalesce(sum(q.weekend_points),0) into weekday,weekend from public.redemption_quotes q where q.account_id=a.id and q.status='open' and q.reserved_at is not null and q.expires_at>now();
 return result||jsonb_build_object('weekday_spendable',greatest(least(a.weekday_balance-weekday,(result->>'spendable')::bigint),0),'weekend_spendable',greatest(least(a.weekend_balance-weekend,(result->>'spendable')::bigint),0));
end $$;
revoke all on function public.customer_points_position_with_allowances(uuid) from public,anon,authenticated;
grant execute on function public.customer_points_position_with_allowances(uuid) to service_role;
create or replace function public.preview_customer_position_with_allowances() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare customer uuid:=private.preview_require_customer(true);
begin return public.customer_points_position_with_allowances(private.preview_customer_membership(customer));end $$;
revoke all on function public.preview_customer_position_with_allowances() from public,anon;
grant execute on function public.preview_customer_position_with_allowances() to authenticated,service_role;
do $$declare definition text;needle text:='coalesce(pa.balance,0) as available_points,';begin
 select pg_get_functiondef('public.customer_directory(jsonb)'::regprocedure) into definition;
 if position('weekday_available_points' in definition)=0 then
  if position(needle in definition)=0 then raise exception 'ALLOWANCE_DIRECTORY_DRIFT';end if;
  execute replace(definition,needle,needle||'greatest(least(pa.weekday_balance,pa.balance),0) as weekday_available_points,greatest(least(pa.weekend_balance,pa.balance),0) as weekend_available_points,');
 end if;
end $$;
commit;
