-- AF Homes: keep open unpaid purchases in Finance Queue, not the registration directory.
--
-- `customers` remains the protected master record. This adds only a read-model
-- filter used by the default staff directory. A customer with an executed
-- application reservation that still has a balance, or a sale in the payment
-- workflow, is returned by `/queues/finance` and omitted from this list.
--
-- Base body: 20261031000001_afhomes_customer_directory_payment_filter.sql.
-- All existing identifiers, filters, masks, and pagination semantics remain.
--
-- Validation after apply:
--   select * from public.customer_directory('{"workflow":"directory"}'::jsonb);
--   -- excludes only open unpaid reservation/sale workflows.
--
-- Down note: forward-only. Older callers omit `workflow` and retain prior behavior.

create or replace function public.customer_directory(p_filters jsonb default '{}'::jsonb)
returns table(record jsonb,total_count bigint) language sql stable set search_path=public,pg_temp as $$
 with base as (
 select c.*,concat_ws(' ',c.first_name,c.middle_name,c.last_name,c.suffix) as full_name,
 m.id as membership_id,m.membership_number,m.status as member_status,m.activated_at,m.expires_at,
 cp.code as tier,coalesce(pa.balance,0) as available_points,coalesce(cs.seller_staff_id,cs.seller_ost_id) as seller_id,su.full_name as seller_name,
 coalesce(pay.paid,0) as verified_paid,coalesce(cs.cash_price_snapshot::numeric,0) as frozen_total,
 cs.reservation_fee_snapshot::numeric as reservation_fee,cs.required_initial_snapshot::numeric as required_initial,
 m.fallback_code_hash,m.qr_token_hash
 from public.customers c left join public.memberships m on m.customer_id=c.id
 left join public.points_accounts pa on pa.membership_id=m.id
 left join lateral(select s.* from public.card_sales s where s.customer_id=c.id and s.status<>'cancelled' order by s.created_at desc,s.id limit 1) cs on true
 left join public.card_plans cp on cp.id=coalesce(m.product_id,cs.plan_id)
 left join public.staff_users su on su.id=coalesce(cs.seller_staff_id,cs.seller_ost_id)
 left join lateral(select sum(p.amount::numeric) as paid from public.payments p where p.sale_id=cs.id and p.status='verified') pay on true
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
 (coalesce(p_filters->>'tier','')='' or d.tier=p_filters->>'tier') and
 (coalesce(p_filters->>'seller','')='' or d.seller_id=(p_filters->>'seller')::uuid) and
 (coalesce(p_filters->>'from','')='' or d.created_at>=(p_filters->>'from')::date) and
 (coalesce(p_filters->>'to','')='' or d.created_at<(p_filters->>'to')::date+interval '1 day') and
 (not coalesce((p_filters->>'membersOnly')::boolean,false) or d.membership_id is not null) and
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
 (coalesce(p_filters->>'search','')='' or lower(d.full_name) like '%'||lower(p_filters->>'search')||'%' or
 lower(d.customer_number) like '%'||lower(p_filters->>'search')||'%' or lower(d.customer_code) like '%'||lower(p_filters->>'search')||'%' or lower(d.email) like '%'||lower(p_filters->>'search')||'%' or
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
$$;
revoke all on function public.customer_directory(jsonb) from public,anon,authenticated;
grant execute on function public.customer_directory(jsonb) to service_role;
