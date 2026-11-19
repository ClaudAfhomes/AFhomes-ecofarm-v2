-- AF Homes: customer_directory id filter for the customer detail view.
--
-- The admin customer directory page links each row to /admin/customers/:id.
-- The new GET /customers/:id handler resolves that one record through the
-- same customer_directory RPC the list uses, so the detail view can never
-- disagree with the directory about derived category, membership state, or
-- the masked government ID. The RPC previously had no way to address a
-- single row, so this migration adds an optional `id` filter and nothing
-- else.
--
-- Base body: 20261028000001_afhomes_membership_code_upgrade.sql (the latest
-- full redefinition), which carries the Customer Code predicate from
-- 20261026000001 and the transaction-only membership-code rule (no
-- membership_number LIKE, customer aliases only). Redefining from any older
-- body would silently regress both rules - that exact mistake failed
-- db-integration sections 49, 54 and 56, and must never be repeated.
--
-- Forward-only. Does not touch 20261028000001 or any other applied migration.
--
-- Validation before apply (live):
--   select prosrc from pg_proc where proname = 'customer_directory';
--   -- does not contain "p_filters->>'id'" (the filter is absent).
-- Validation after apply:
--   select count(*) from pg_proc where proname = 'customer_directory'
--     and prosrc like '%p_filters->>''id''%';                               -- 1 row
--   select * from public.customer_directory('{"id":"00000000-0000-0000-0000-000000000000"}'::jsonb);
--                                                                          -- 0 rows, no error
--   -- then run pnpm test:db:local (covers the id filter against real rows).
--
-- Down note (forward-only, no down migration): redeploying an older build
-- does not remove the filter; handlers that never send `id` are unaffected.

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
 (coalesce(p_filters->>'tier','')='' or d.tier=p_filters->>'tier') and
 (coalesce(p_filters->>'seller','')='' or d.seller_id=(p_filters->>'seller')::uuid) and
 (coalesce(p_filters->>'from','')='' or d.created_at>=(p_filters->>'from')::date) and
 (coalesce(p_filters->>'to','')='' or d.created_at<(p_filters->>'to')::date+interval '1 day') and
 (not coalesce((p_filters->>'membersOnly')::boolean,false) or d.membership_id is not null) and
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
