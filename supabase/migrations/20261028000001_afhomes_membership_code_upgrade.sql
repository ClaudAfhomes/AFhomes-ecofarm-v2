-- AF Homes — legacy membership-code upgrade.
--
-- Upgrades EXISTING sequential membership numbers to the current approved
-- high-entropy format, in place, preserving the previous value as a durable
-- alias. MEMBERSHIP ONLY: no communications, announcements, notifications, CMS
-- or SEO content belongs in this file.
--
--   MBS-000004  ->  MBS-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX
--
-- The value is allocated by private.next_membership_number(), the SAME
-- allocator that already issues new membership numbers (128 bits from
-- gen_random_bytes(16)). No second allocator is created and no weaker format is
-- introduced. Membership Code is a membership TRANSACTION identifier; it is
-- never a Customer ID or a Customer Code, and it authorizes nothing by itself.
--
-- NEVER TOUCHED: memberships.id, customer_id, tier, status, activation/expiry
-- dates, qr_token_hash, fallback_code_hash, points_accounts, points_ledger,
-- redemptions, and every customers column including customer_number and
-- customer_code.
--
-- Alias resolution is TRANSACTION-ONLY. public.search_customer_ids and
-- public.customer_directory are deliberately NOT modified: a Membership Code
-- must never return a customer from general customer search.
--
-- Validation queries (read-only, after applying):
--   -- no sequential legacy membership number survives
--   select count(*) from public.memberships where membership_number ~ '^MBS-[0-9]{6}$';   -- 0
--   -- six memberships became 128-bit random codes
--   select count(*) from public.memberships
--    where membership_number ~ '^MBS-[0-9A-F]{8}(-[0-9A-F]{8}){3}$';                  -- 6
--   -- every legacy value is preserved as an alias
--   select count(*) from private.business_id_aliases where entity_type = 'membership'; -- 6
--   -- browsers still cannot reach the alias table
--   select has_table_privilege('anon','private.business_id_aliases','SELECT');          -- false
--
-- Down: forward-only. There is no down migration. A later migration would copy
-- alias.old_identifier back for rows whose alias has not been superseded;
-- membership codes minted after this migration are never touched.

-- ---------------------------------------------------------------------------
-- 1. Widen the alias entity_type CHECK to admit memberships. Existing alias
--    rows are untouched, and the existing UNIQUE constraints are unchanged, so
--    a legacy membership number identifies exactly one membership.
-- ---------------------------------------------------------------------------
alter table private.business_id_aliases
  drop constraint if exists business_id_aliases_entity_type_chk;
alter table private.business_id_aliases
  add constraint business_id_aliases_entity_type_chk check (entity_type in (
    'customer','card_sale','customer_application','reservation_agreement',
    'ost_member','ost_accreditation','ost_renewal','redemption','membership'
  ));

-- ---------------------------------------------------------------------------
-- 2. The conversion. Callable so the database suite can exercise the exact code
--    path against synthetic legacy rows; a conversion only ever asserted on an
--    empty table proves nothing.
-- ---------------------------------------------------------------------------
create or replace function private.upgrade_legacy_membership_numbers()
returns bigint
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_row record;
  v_id uuid;
  v_old text;
  v_new text;
  v_converted bigint := 0;
begin
  for v_row in
    select m.id, m.membership_number
      from public.memberships m
     where m.membership_number ~ '^MBS-[0-9]{6}$'
     order by m.id
  loop
    v_id  := v_row.id;
    v_old := v_row.membership_number;

    -- Alias BEFORE the overwrite, so the legacy value is never lost.
    insert into private.business_id_aliases
      (entity_type, entity_id, old_identifier, migration_source)
    values ('membership', v_id, v_old, '20261028000001')
    on conflict (entity_type, old_identifier) do nothing;

    v_new := private.next_membership_number();

    update public.memberships set membership_number = v_new where id = v_id;

    if not exists (
      select 1 from private.business_id_aliases a
       where a.entity_type = 'membership' and a.entity_id = v_id and a.old_identifier = v_old
    ) then
      raise exception 'MEMBERSHIP_ALIAS_MISSING: % %', v_id, v_old;
    end if;

    v_converted := v_converted + 1;
  end loop;

  -- Fail loudly: nothing sequential may survive.
  if exists (select 1 from public.memberships where membership_number ~ '^MBS-[0-9]{6}$') then
    raise exception 'LEGACY_MEMBERSHIP_NUMBER_REMAINS';
  end if;

  return v_converted;
end $$;

revoke all on function private.upgrade_legacy_membership_numbers() from public, anon, authenticated;
grant execute on function private.upgrade_legacy_membership_numbers() to service_role;

select private.upgrade_legacy_membership_numbers();

-- ---------------------------------------------------------------------------
-- 3. General customer search must NOT resolve a Membership Code.
--
-- Both customer-search RPCs matched `membership_number` with a LIKE predicate,
-- which is how a Membership Code could return a customer from an ordinary
-- customer lookup. A Membership Code is a TRANSACTION identifier: it belongs to
-- the protected redemption path (section 4) and to nothing else. Removing the
-- predicate narrows what a search returns; it grants nothing.
-- ---------------------------------------------------------------------------
create or replace function public.search_customer_ids(p_search text)
returns table(customer_id uuid) language sql stable set search_path = public, pg_temp as $$
  select c.id from public.customers c
  left join public.memberships m on m.customer_id = c.id
  left join public.card_plans cp on cp.id = m.product_id
  where lower(concat_ws(' ', c.first_name, c.middle_name, c.last_name, c.suffix)) like '%' || lower(p_search) || '%'
    or lower(c.customer_number) like '%' || lower(p_search) || '%'
    or lower(c.customer_code) like '%' || lower(p_search) || '%'
    or lower(c.email) like '%' || lower(p_search) || '%'
    or c.phone like '%' || p_search || '%'
    or lower(cp.code) = lower(p_search)
    or m.fallback_code_hash = private.hash_token(upper(regexp_replace(p_search, '[-[:space:]]', '', 'g')))
    or exists (
      select 1 from private.business_id_aliases a
       where a.entity_type = 'customer' and a.is_active
         and lower(a.old_identifier) = lower(btrim(p_search))
         and a.entity_id = c.id
    )
$$;
revoke all on function public.search_customer_ids(text) from public, anon, authenticated;
grant execute on function public.search_customer_ids(text) to service_role;

-- customer_directory carries the same membership_number predicate. Redefined in
-- full rather than by string surgery: pg_get_functiondef re-wraps whitespace, so
-- a fragment match is fragile, and a silent no-op would leave a directory that
-- still answers to a Membership Code. The Customer Code predicate added by
-- 20261026000001 is preserved.
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

revoke all on function public.customer_directory(jsonb) from public, anon, authenticated;
grant execute on function public.customer_directory(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Transaction-only membership resolver. Deliberately NOT a public RPC:
--    general customer search must never resolve a membership identifier, so
--    this lives in the private schema beside the allocator and is reached only
--    by the server-side redemption path.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_membership_code(p_identifier text)
returns table(membership_id uuid, current_number text, via_alias boolean)
language plpgsql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_trimmed text := nullif(btrim(p_identifier), '');
  v_upper text;
begin
  if v_trimmed is null then
    return;
  end if;
  -- The card envelope `AFHOMES:<number>` is accepted as compatible input; the
  -- bare code is matched case-insensitively, exactly as the existing
  -- identifier path already normalises it.
  v_upper := upper(regexp_replace(v_trimmed, '^AFHOMES:', '', 'i'));

  -- 1. the CURRENT membership number wins
  select m.id, m.membership_number into membership_id, current_number
    from public.memberships m
   where upper(m.membership_number) = v_upper
   limit 1;
  if membership_id is not null then
    via_alias := false;
    return next;
    return;
  end if;

  -- 2. otherwise the durable legacy alias, then re-read the canonical value
  select a.entity_id into membership_id
    from private.business_id_aliases a
   where a.entity_type = 'membership'
     and a.is_active
     and upper(a.old_identifier) = v_upper
   limit 1;
  if membership_id is null then
    current_number := null;
    via_alias := false;
    return;
  end if;

  via_alias := true;
  select m.membership_number into current_number
    from public.memberships m
   where m.id = membership_id;
  return next;
end $$;

revoke all on function private.resolve_membership_code(text) from public, anon, authenticated;
grant execute on function private.resolve_membership_code(text) to service_role;