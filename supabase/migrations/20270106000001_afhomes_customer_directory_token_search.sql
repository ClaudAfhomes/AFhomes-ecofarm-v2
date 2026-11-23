-- afhomes: customer_directory name search matches each typed word, in any order.
--
-- Before: the name predicate was one substring match of the whole typed text against
-- "first middle last suffix", so a double space, "Last, First" or a reversed name
-- found nobody. After: the typed text is split on spaces/commas and EVERY word must
-- appear somewhere in the full name (case-insensitive). All other predicates
-- (customer number/code, e-mail, RA number, identifiers, aliases) are unchanged.
-- Single-word searches behave exactly as before.
--
-- Forward-only and idempotent (create or replace; grants and ownership are kept).
-- Validation (run after applying):
--   select count(*) from public.customer_directory('{"search":"zzzz  yyyy"}'::jsonb);   -- 0
--   -- for any customer named ADA LOVELACE these must each return that customer:
--   --   {"search":"lovelace ada"}, {"search":"LOVELACE, ADA"}, {"search":"ada  lov"}
-- Down: re-create the previous definition from migration
--   20261223000001_afhomes_customer_historical_import.sql (single-substring predicate).

CREATE OR REPLACE FUNCTION public.customer_directory(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(record jsonb, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with base as (
 select c.*,concat_ws(' ',c.first_name,c.middle_name,c.last_name,c.suffix) as full_name,
 m.id as membership_id,m.membership_number,m.status as member_status,m.activated_at,m.expires_at,
 cp.code as tier,coalesce(pa.balance,0) as available_points,greatest(least(pa.weekday_balance,pa.balance),0) as weekday_available_points,greatest(least(pa.weekend_balance,pa.balance),0) as weekend_available_points,
 coalesce(fin.seller_id,application.referrer_staff_id) as seller_id,su.full_name as seller_name,
 coalesce(fin.paid,0) as verified_paid,coalesce(fin.total,0) as frozen_total,
 fin.reservation_fee,fin.required_initial,
 coalesce(fin.open_reservation_total,0) as open_reservation_total,
 coalesce(fin.open_reservation_paid,0) as open_reservation_paid,
 m.fallback_code_hash,m.qr_token_hash
 from public.customers c
 left join lateral (select member.* from public.memberships member where member.customer_id=c.id
    order by (member.status='active') desc,member.activated_at desc,member.id desc limit 1) m on true
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
 ), categorized as (
 select b.*,case
 when b.status='cancelled' or b.member_status='cancelled' then 'CANCELLED'
 when b.status='suspended' or b.member_status='suspended' then 'SUSPENDED'
 when b.member_status='expired' or (b.member_status='active' and b.expires_at<=now()) then 'EXPIRED'
 when b.member_status='active' then 'ACTIVE_VIP'
 when b.verified_paid=0 then case when b.status='prospect' then 'PENDING' else 'ACTIVE' end
 when b.verified_paid>=b.frozen_total then 'FULLY_PAID_AWAITING_ACTIVATION'
 when b.required_initial>b.reservation_fee and b.verified_paid>=b.required_initial then 'DOWN_PAYMENT_COMPLETED'
 when b.reservation_fee>0 and b.verified_paid>=b.reservation_fee then 'RESERVATION_PAID'
 else 'PARTIALLY_PAID' end as derived_category,
 case when b.verified_paid=0 then 'no_payment' when b.verified_paid>=b.frozen_total then 'fully_paid' else 'partially_paid' end as payment_status
 from base b
 ), filtered as (
 select d.* from categorized d where
 (coalesce(p_filters->>'id','')='' or d.id=(p_filters->>'id')::uuid) and
 (coalesce(p_filters->>'category','')='' or d.derived_category=p_filters->>'category') and
 (coalesce(p_filters->>'status','')='' or d.status=p_filters->>'status') and
 (coalesce(p_filters->>'payment','')='' or d.payment_status=p_filters->>'payment') and
 (coalesce(p_filters->>'companyStatus','')='' or d.company_status=p_filters->>'companyStatus') and
 (coalesce(p_filters->>'tier','')='' or d.tier=p_filters->>'tier') and
 (coalesce(p_filters->>'seller','')='' or d.seller_id=(p_filters->>'seller')::uuid) and
 (coalesce(p_filters->>'from','')='' or d.created_at>=(p_filters->>'from')::date) and
 (coalesce(p_filters->>'to','')='' or d.created_at<(p_filters->>'to')::date+interval '1 day') and
 (not coalesce((p_filters->>'membersOnly')::boolean,false) or d.membership_id is not null) and
 (not coalesce((p_filters->>'activeVipOnly')::boolean,false) or (
   d.status='active' and d.membership_id is not null and d.member_status='active'
   and d.expires_at is not null and d.expires_at > now()
   and d.tier in ('BRONZE','SILVER','GOLD')
 )) and
 (coalesce(p_filters->>'workflow','')<>'directory' or not exists (
   select 1 from public.card_sales open_sale
   where open_sale.customer_id=d.id and open_sale.status in ('submitted','payment_pending','payment_in_progress','overdue')
 ) and not exists (
   select 1 from public.reservation_agreements ra
   left join lateral (
     select coalesce(sum(p.amount::numeric) filter (where p.status='verified'),0) as verified_total
     from public.payments p where p.reservation_id=ra.id
   ) reservation_payments on true
   where ra.customer_id=d.id and ra.origin='application' and ra.status='executed' and ra.sale_id is null
     and reservation_payments.verified_total < ra.total_price_snapshot::numeric
 )) and
 (coalesce(p_filters->>'search','')='' or coalesce((select bool_and(lower(d.full_name) like '%'||lower(t.w)||'%') from regexp_split_to_table(btrim(regexp_replace(p_filters->>'search','[[:space:],]+',' ','g')),' ') as t(w) where t.w<>''),false) or
 lower(d.ra_number) like '%'||lower(p_filters->>'search')||'%' or lower(d.customer_number) like '%'||lower(p_filters->>'search')||'%' or lower(d.customer_code) like '%'||lower(p_filters->>'search')||'%' or lower(d.email) like '%'||lower(p_filters->>'search')||'%' or
 d.fallback_code_hash=private.hash_token(p_filters->>'identifier') or d.qr_token_hash=private.hash_token(p_filters->>'search') or
 exists (select 1 from private.business_id_aliases a where a.entity_type='customer' and a.is_active
          and lower(a.old_identifier)=lower(btrim(p_filters->>'search')) and a.entity_id=d.id))
 )
 select (to_jsonb(f)-'government_id_number'-'fallback_code_hash'-'qr_token_hash')||jsonb_build_object('available_points',f.available_points::text,'verified_paid',private.money(f.verified_paid),'government_id_masked',case when f.government_id_number is null then null when length(trim(f.government_id_number))<=4 then repeat('*',length(trim(f.government_id_number))) else repeat('*',greatest(length(trim(f.government_id_number))-4,3))||right(trim(f.government_id_number),4) end,'derivedCategory',f.derived_category,'memberships',case when f.membership_id is null then null else jsonb_build_object('id',f.membership_id,'status',f.member_status) end), count(*) over()
 from filtered f
 order by
 case when p_filters->>'sort'='name' then lower(f.full_name) end,
 case when p_filters->>'sort'='tier' then f.tier end,
 case when p_filters->>'sort'='category' then f.derived_category end,
 case when p_filters->>'sort'='payment_status' then f.payment_status end,
 case when p_filters->>'sort'='membership_status' then f.member_status end,
 case when p_filters->>'sort'='verified_paid' then f.verified_paid end desc,
 f.created_at desc,f.id
 limit least(greatest(coalesce((p_filters->>'limit')::integer,50),1),5000)
 offset greatest(coalesce((p_filters->>'offset')::integer,0),0);
$function$
;
