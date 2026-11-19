-- Read-model repair only. No customer, payment, membership or history rows are rewritten.
-- Preserve the installed identifier matching, filters, pagination and privileges.
do $$
declare definition text; start_at integer; end_at integer;
begin
 select pg_get_functiondef('public.customer_directory(jsonb)'::regprocedure) into definition;
 start_at:=strpos(definition,'with base as (');
 end_at:=strpos(definition,'), categorized as (');
 if start_at=0 or end_at<=start_at or strpos(definition,'lower(d.customer_number) like')=0 then
  raise exception 'CUSTOMER_PURCHASE_SUMMARY_DIRECTORY_PRECONDITION';
 end if;
 definition:=substr(definition,1,start_at-1)||$base$with base as (
 select c.*,concat_ws(' ',c.first_name,c.middle_name,c.last_name,c.suffix) as full_name,
 m.id as membership_id,m.membership_number,m.status as member_status,m.activated_at,m.expires_at,
 cp.code as tier,coalesce(pa.balance,0) as available_points,
 coalesce(fin.seller_id,application.referrer_staff_id) as seller_id,su.full_name as seller_name,
 coalesce(fin.paid,0) as verified_paid,coalesce(fin.total,0) as frozen_total,
 fin.reservation_fee,fin.required_initial,
 coalesce(fin.open_reservation_total,0) as open_reservation_total,
 coalesce(fin.open_reservation_paid,0) as open_reservation_paid,
 m.fallback_code_hash,m.qr_token_hash
 from public.customers c
 left join public.memberships m on m.customer_id=c.id
 left join public.points_accounts pa on pa.membership_id=m.id
 left join lateral (
  select sum(purchase.total) as total,sum(purchase.paid) as paid,
   sum(purchase.reservation_fee) as reservation_fee,sum(purchase.required_initial) as required_initial,
   sum(purchase.total) filter(where purchase.is_reservation) as open_reservation_total,
   sum(purchase.paid) filter(where purchase.is_reservation) as open_reservation_paid,
   (array_agg(purchase.plan_id order by purchase.created_at desc,purchase.id))[1] as plan_id,
   (array_agg(purchase.seller_id order by purchase.created_at desc,purchase.id))[1] as seller_id
  from (
   select s.id,s.created_at,s.plan_id,coalesce(s.seller_staff_id,s.seller_ost_id) as seller_id,
    s.cash_price_snapshot::numeric as total,s.reservation_fee_snapshot::numeric as reservation_fee,
    s.required_initial_snapshot::numeric as required_initial,false as is_reservation,
    (select coalesce(sum(p.amount::numeric),0) from public.payments p where p.sale_id=s.id and p.status='verified') as paid
   from public.card_sales s where s.customer_id=c.id and s.status<>'cancelled'
   union all
   select r.id,r.created_at,r.plan_id,r.seller_staff_id,r.total_price_snapshot::numeric,
    r.reservation_fee_snapshot::numeric,r.required_initial_snapshot::numeric,true,
    (select coalesce(sum(p.amount::numeric),0) from public.payments p where p.reservation_id=r.id and p.status='verified')
   from public.reservation_agreements r
   where r.customer_id=c.id and r.status in ('submitted','executed') and r.sale_id is null
  ) purchase
 ) fin on true
 left join lateral (
  select a.plan_id,a.referrer_staff_id from public.customer_applications a
  where a.customer_id=c.id and a.status not in ('cancelled','rejected')
  order by a.created_at desc,a.id limit 1
 ) application on true
 left join public.card_plans cp on cp.id=coalesce(m.product_id,fin.plan_id,application.plan_id)
 left join public.staff_users su on su.id=coalesce(fin.seller_id,application.referrer_staff_id)
 $base$||substr(definition,end_at);
 -- Some installed directory versions lost the company-ID search branch.
 if strpos(definition,'lower(d.ra_number) like')=0 then
  definition:=replace(definition,'lower(d.customer_number) like',
   'lower(d.ra_number) like ''%''||lower(p_filters->>''search'')||''%'' or lower(d.customer_number) like');
 end if;
 execute definition;
end $$;
revoke all on function public.customer_directory(jsonb) from public,anon,authenticated;
grant execute on function public.customer_directory(jsonb) to service_role;

