-- Validation: test:db:customer-workbook; test:db:external-import; rls_invariants.sql.
-- Down: remove the new portal RPC and restore the two saved function definitions.
-- Never delete accepted commission policies or rewrite historical purchase snapshots.

create table if not exists private.customer_import_commission_policies (
 source_id uuid primary key references private.customer_import_purchase_sources(id) on delete restrict,
 settled_before_system boolean not null,
 created_at timestamptz not null default now()
);
alter table private.customer_import_commission_policies enable row level security;
revoke all on private.customer_import_commission_policies from public,anon,authenticated,service_role;
do $$begin
 if not exists(select 1 from pg_trigger where tgname='import_commission_policy_immutable') then
  create trigger import_commission_policy_immutable before update or delete on private.customer_import_commission_policies
   for each row execute function private.prevent_purchase_evidence_mutation();
 end if;
end $$;

-- Derive only from the original accepted import, never from a later payment or activation.
insert into private.customer_import_commission_policies(source_id,settled_before_system)
select src.id,coalesce(r.normalized_data->'externalSummary'->>'stage' in ('activation','active','inactive'),
 r.raw_data->>'stated_status' in ('Fully Paid','Active VIP','Expired','Suspended','Cancelled','Inactive'),false)
from private.customer_import_purchase_sources src join public.customer_import_rows r on r.id=src.original_row_id
where r.committed_at is not null
on conflict(source_id) do nothing;

-- Keep any previously recorded commission history for audit, but exclude settled
-- pre-system entries from salesperson lists and totals without changing money/status.
alter table public.commissions add column if not exists settled_before_system boolean not null default false;
update public.commissions commission set settled_before_system=true
from private.customer_import_purchase_sources src
join private.customer_import_commission_policies policy on policy.source_id=src.id and policy.settled_before_system
join public.customer_applications a on a.id=src.application_id
where commission.sale_id=a.sale_id and not commission.settled_before_system;

do $$declare definition text;needle text;replacement text;begin
 select pg_get_functiondef('private.reconcile_external_customer_import(uuid,uuid,text)'::regprocedure) into definition;
 if position('customer_import_commission_policies' in definition)=0 then
  needle:=' perform 1 from public.customers where id=s.customer_id for update;';
  replacement:=' insert into private.customer_import_commission_policies(source_id,settled_before_system)
   select s.id,coalesce(original.normalized_data->''externalSummary''->>''stage'' in (''activation'',''active'',''inactive''),false)
   from public.customer_import_rows original where original.id=s.original_row_id on conflict(source_id) do nothing;
  perform 1 from public.customers where id=s.customer_id for update;';
  if position(needle in definition)=0 then raise exception 'IMPORT_COMMISSION_POLICY_DRIFT';end if;
  definition:=replace(definition,needle,replacement);
  needle:='null,''0'',private.money(total),''0.00'');';
  replacement:='case when stage in (''reservation'',''finance'') then (terms->>''commissionRuleId'')::uuid end,
   case when stage in (''reservation'',''finance'') then coalesce(terms->>''commissionRate'',''0'') else ''0'' end,
   private.money(total),case when stage in (''reservation'',''finance'') then private.money(round(total*coalesce((terms->>''commissionRate'')::numeric,0),2)) else ''0.00'' end);';
  if position(needle in definition)=0 then raise exception 'IMPORT_COMMISSION_TERMS_DRIFT';end if;
  execute replace(definition,needle,replacement);
 end if;
end $$;

-- A pre-system fully paid purchase must not create even a zero-value commission.
do $$declare definition text;start_at integer;end_at integer;block text;begin
 select pg_get_functiondef('private.finalize_external_reservation_purchase_once(uuid,uuid,uuid)'::regprocedure) into definition;
 if position('customer_import_commission_policies' in definition)=0 then
  start_at:=position('  insert into public.commissions(' in definition);
  end_at:=position('  returning id into v_commission_id;' in definition);
  if start_at=0 or end_at<start_at then raise exception 'IMPORT_COMMISSION_FINALIZER_DRIFT';end if;
  block:=substr(definition,start_at,end_at-start_at+length('  returning id into v_commission_id;'));
  execute replace(definition,block,
   '  if not exists(select 1 from private.customer_import_purchase_sources src join private.customer_import_commission_policies policy on policy.source_id=src.id where src.application_id=v_app.id and policy.settled_before_system) then
   '||block||'
   end if;');
 end if;
end $$;

create or replace function private.reject_settled_import_commission() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if tg_op='UPDATE' then
  if old.settled_before_system and new is distinct from old then raise exception 'IMPORT_COMMISSION_ALREADY_SETTLED';end if;
  return new;
 end if;
 if exists(select 1 from private.customer_import_purchase_sources src
  join private.customer_import_commission_policies policy on policy.source_id=src.id
  join public.customer_applications a on a.id=src.application_id
  where a.sale_id=new.sale_id and policy.settled_before_system) then
  raise exception 'IMPORT_COMMISSION_ALREADY_SETTLED';
 end if;
 return new;
end $$;
revoke all on function private.reject_settled_import_commission() from public,anon,authenticated,service_role;
drop trigger if exists import_commission_already_settled on public.commissions;
create trigger import_commission_already_settled before insert or update on public.commissions
 for each row execute function private.reject_settled_import_commission();

-- Recorded participation attributes history; current downline still gates team access.
create or replace function private.imported_purchase_scope(p_actor_id uuid,p_team boolean) returns table(source_id uuid)
language sql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
 with recursive downline(id,path) as (
  select p_actor_id,array[p_actor_id]
  union all
  select rel.subject_staff_id,d.path||rel.subject_staff_id from downline d
  join public.referral_relationships rel on rel.upline_staff_id=d.id and rel.is_active and rel.is_authoritative
  where not rel.subject_staff_id=any(d.path)
 )
 select src.id from private.customer_import_purchase_sources src
 join public.customer_import_rows r on r.id=src.original_row_id and r.committed_at is not null
 where src.superseded_by is null and (case when p_team then
  (r.raw_data->>'referrer_staff_id' in (select id::text from downline where id<>p_actor_id)
   or r.raw_data->>'recommender_staff_id' in (select id::text from downline where id<>p_actor_id))
  and exists(select 1 from jsonb_each_text(r.raw_data) f where f.key in ('vd_staff_id','ssm_staff_id','sm_staff_id','referrer_vd_staff_id','referrer_ssm_staff_id','referrer_sm_staff_id','recommender_vd_staff_id','recommender_ssm_staff_id','recommender_sm_staff_id') and f.value=p_actor_id::text)
 else p_actor_id::text in (r.raw_data->>'referrer_staff_id',r.raw_data->>'recommender_staff_id') end)
$$;
revoke all on function private.imported_purchase_scope(uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.imported_commission_sale_ids_for_account(p_actor_id uuid) returns uuid[]
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result uuid[];role_slug text;
begin
 role_slug:=private.mutation_actor_role(p_actor_id,'network.commissions','view');
 if role_slug not in ('vice_director','senior_sales_manager','sales_manager') then raise exception 'FORBIDDEN';end if;
 select coalesce(array_agg(distinct a.sale_id) filter(where a.sale_id is not null),'{}') into result
 from private.imported_purchase_scope(p_actor_id,true) scope
 join private.customer_import_purchase_sources src on src.id=scope.source_id
 join private.customer_import_commission_policies policy on policy.source_id=src.id and not policy.settled_before_system
 join public.customer_applications a on a.id=src.application_id;
 return result;
end $$;
revoke all on function public.imported_commission_sale_ids_for_account(uuid) from public,anon,authenticated;
grant execute on function public.imported_commission_sale_ids_for_account(uuid) to service_role;

create or replace function public.imported_sales_for_account(p_actor_id uuid,p_team boolean default false,p_from date default null,p_to date default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result jsonb;role_slug text;can_names boolean;
begin
 role_slug:=private.mutation_actor_role(p_actor_id,'sales.card_sales','view');
 if role_slug not in ('vice_director','senior_sales_manager','sales_manager','ost') then raise exception 'FORBIDDEN';end if;
 if p_team and role_slug='ost' then raise exception 'FORBIDDEN';end if;
 if p_page not between 1 and 10000 or p_from>p_to then raise exception 'IMPORT_BATCH_LIMIT';end if;
 can_names:=private.has_permission_for_user(p_actor_id,'sales.customers','view');
 with purchases as (
  select src.id,src.purchase_reference,c.ra_number,c.customer_number,c.first_name,c.middle_name,c.last_name,c.suffix,
   coalesce(a.tier_snapshot,r.raw_data->>'vip_tier') as tier,
   coalesce(m.status,s.status,ra.status,a.status,'draft') as status,
   coalesce(s.cash_price_snapshot,ra.total_price_snapshot,nullif(r.raw_data->>'stated_total','')) as amount,
   coalesce(policy.settled_before_system,r.normalized_data->'externalSummary'->>'stage' in ('activation','active','inactive'),false) as settled,
   array(select label from (values
    ('vd_staff_id','VD'),('ssm_staff_id','SSM'),('sm_staff_id','SM'),('referrer_staff_id','Referrer'),('recommender_staff_id','VIP Recommender'),
    ('referrer_vd_staff_id','Referrer VD'),('referrer_ssm_staff_id','Referrer SSM'),('referrer_sm_staff_id','Referrer SM'),
    ('recommender_vd_staff_id','Recommender VD'),('recommender_ssm_staff_id','Recommender SSM'),('recommender_sm_staff_id','Recommender SM')) v(field,label)
    where r.raw_data->>v.field=p_actor_id::text order by label) as roles,
   src.created_at
  from private.customer_import_purchase_sources src
  join private.imported_purchase_scope(p_actor_id,p_team) scope on scope.source_id=src.id
  join public.customer_import_rows r on r.id=src.original_row_id and r.committed_at is not null
  join public.customers c on c.id=src.customer_id
  left join public.customer_applications a on a.id=src.application_id
  left join lateral (select reservation.* from public.reservation_agreements reservation where reservation.customer_application_id=a.id order by reservation.created_at desc,reservation.id limit 1) ra on true
  left join public.card_sales s on s.id=coalesce(a.sale_id,ra.sale_id,r.sale_id)
  left join public.memberships m on m.sale_id=s.id
  left join private.customer_import_commission_policies policy on policy.source_id=src.id
  where src.superseded_by is null
   and (p_from is null or src.created_at>=(p_from::timestamp at time zone 'UTC'))
   and (p_to is null or src.created_at<((p_to+1)::timestamp at time zone 'UTC'))
 ), page as (select * from purchases order by created_at desc,id limit 25 offset (p_page-1)*25)
 select jsonb_build_object('data',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'reference',p.purchase_reference,'customerName',case when can_names then concat_ws(' ',p.first_name,nullif(p.middle_name,''),p.last_name,nullif(p.suffix,'')) end,
  'customerNumber',coalesce(p.ra_number,p.customer_number),'tier',coalesce(nullif(p.tier,''),'Not selected'),'status',p.status,'roles',p.roles,'amount',p.amount,
  'commissionPolicy',case when p.settled then 'settled_before_system' else 'normal_qualification' end) order by p.created_at desc,p.id) from page p),'[]'::jsonb),
  'meta',jsonb_build_object('page',p_page,'pageSize',25,'total',(select count(*) from purchases))) into result;
 return result;
end $$;
revoke all on function public.imported_sales_for_account(uuid,boolean,date,date,integer) from public,anon,authenticated;
grant execute on function public.imported_sales_for_account(uuid,boolean,date,date,integer) to service_role;
