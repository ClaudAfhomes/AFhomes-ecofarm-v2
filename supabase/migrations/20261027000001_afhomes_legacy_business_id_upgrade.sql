-- AF Homes — legacy business-ID upgrade.
--
-- Converts EXISTING legacy business identifiers to the approved randomized
-- AF-* format, in place, preserving the previous value as a durable alias.
--
--   CUS-*  -> AF-CUS-XXXXX      SALE-* -> AF-CSALE-XXXXX
--   APP-*  -> AF-APP-XXXXX      RES-*  -> AF-RES-XXXXX
--   OST-*  -> AF-OST-XXXXX      AF-<32hex> -> AF-ACC-XXXXX
--   REN-*  -> AF-REN-XXXXX      RDM-*  -> AF-RED-XXXXX
--
-- This is an identifier migration, NOT an account recreation. Every row keeps
-- its UUID, its relationships, its money, its points and its credentials. Only
-- the human-facing business-ID column changes.
--
-- NEVER TOUCHED: customers.customer_code (AF-CC-*), memberships.membership_number,
-- memberships.qr_token_hash, memberships.fallback_code_hash, referral_codes,
-- customer_onboarding_tokens, activation/reset tokens, OTP, sessions and
-- idempotency keys. None of those are business identifiers.
--
-- ALREADY-MODERN IDs ARE LEFT ALONE: AF-EMP-*, AF-SALES-*, AF-PAY-*, AF-COM-*,
-- AF-IMP-*, AF-CC-*, and any row already matching its own approved AF pattern.
--
-- Historical artifacts are intentionally NOT rewritten: audit_events payloads,
-- frozen application/sale/benefit snapshots, membership snapshots and previously
-- generated PDFs. They keep the legacy value, which stays resolvable through the
-- alias table.
--
-- Validation queries (run read-only after applying):
--   -- no legacy value survives on a converted column
--   select count(*) from public.customers
--    where customer_number !~ '^AF-CUS-[A-HJ-NP-Z2-9]{5}$';
--   -- every alias points at a live row and matches its current identifier
--   select a.entity_type, count(*)
--     from private.business_id_aliases a group by 1 order by 1;
--   -- old and new identifiers resolve to the same UUID
--   select private.resolve_business_identifier('customer','CUS-000005');
--   -- browsers can reach neither the alias table nor the resolver
--   select has_table_privilege('anon','private.business_id_aliases','SELECT'),
--          has_function_privilege('anon','private.resolve_business_identifier(text,text)','EXECUTE');
--
-- Down note: forward-only. There is no down migration. To revert, a later
-- migration would copy alias.old_identifier back onto the entity column for
-- rows whose alias has not been superseded; identifiers minted after this
-- migration are never touched.

-- ---------------------------------------------------------------------------
-- 1. Durable alias table. Private: identifiers only, never a credential, and
--    never reachable from a browser role. Resolution happens exclusively
--    through private.resolve_business_identifier() in service-role code.
-- ---------------------------------------------------------------------------
create table if not exists private.business_id_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  old_identifier text not null,
  -- Evidence only. The resolver NEVER reads this: the canonical current
  -- identifier always comes from the entity's own column.
  current_identifier_snapshot text,
  migration_source text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint business_id_aliases_entity_type_chk check (entity_type in (
    'customer','card_sale','customer_application','reservation_agreement',
    'ost_member','ost_accreditation','ost_renewal','redemption'
  )),
  -- One legacy value identifies exactly one entity of one type. Legacy
  -- generators were per-table sequences, so uniqueness is asserted WITHIN an
  -- entity type rather than globally.
  constraint business_id_aliases_old_unique unique (entity_type, old_identifier),
  constraint business_id_aliases_entity_old_unique unique (entity_type, entity_id, old_identifier)
);

create index if not exists business_id_aliases_entity_idx
  on private.business_id_aliases (entity_type, entity_id);
create index if not exists business_id_aliases_active_idx
  on private.business_id_aliases (entity_type, old_identifier) where is_active;

revoke all on private.business_id_aliases from public, anon, authenticated;

-- service_role is the server-side caller of customer_directory/search_customer_ids,
-- which now consult the alias table for legacy lookups. It is never a browser
-- role, so this grants no browser access.
grant select on private.business_id_aliases to service_role;

-- ---------------------------------------------------------------------------
-- 2. One canonical resolver. Alias logic is NOT duplicated per handler:
--    handlers call this, then apply their normal authorization.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_business_identifier(
  p_entity_type text,
  p_identifier text
)
returns table(entity_id uuid, current_identifier text, via_alias boolean)
language plpgsql
stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_table regclass;
  v_column text;
  v_key text;
  v_trimmed text := nullif(btrim(p_identifier), '');
begin
  -- Server-side whitelist. p_entity_type selects from a fixed map, so no
  -- client-supplied relation or column ever reaches dynamic SQL.
  case p_entity_type
    when 'customer'              then v_table := 'public.customers'::regclass;                  v_column := 'customer_number';    v_key := 'id';
    when 'card_sale'             then v_table := 'public.card_sales'::regclass;                  v_column := 'sale_number';        v_key := 'id';
    when 'customer_application'  then v_table := 'public.customer_applications'::regclass;      v_column := 'application_number'; v_key := 'id';
    when 'reservation_agreement' then v_table := 'public.reservation_agreements'::regclass;      v_column := 'reservation_number'; v_key := 'id';
    when 'ost_member'            then v_table := 'public.ost_members'::regclass;                 v_column := 'ost_number';        v_key := 'id';
    -- private.ost_registration_details is keyed by application_id, not id.
    when 'ost_accreditation'     then v_table := 'private.ost_registration_details'::regclass;  v_column := 'form_number';        v_key := 'application_id';
    when 'ost_renewal'           then v_table := 'private.ost_accreditation_renewals'::regclass; v_column := 'renewal_number';     v_key := 'id';
    when 'redemption'            then v_table := 'public.redemptions'::regclass;                 v_column := 'redemption_number';  v_key := 'id';
    else raise exception 'UNKNOWN_BUSINESS_ENTITY_TYPE' using errcode = '22023';
  end case;

  if v_trimmed is null then
    return;
  end if;

  -- 1. the current identifier wins
  execute format('select t.%I, t.%I from %s t where lower(t.%I) = lower($1) limit 1',
                 v_key, v_column, v_table, v_column)
    into entity_id, current_identifier using v_trimmed;
  if entity_id is not null then
    via_alias := false;
    return next;
  end if;

  -- 2. otherwise the durable alias, then re-read the canonical value
  select a.entity_id into entity_id
    from private.business_id_aliases a
   where a.entity_type = p_entity_type
     and a.is_active
     and lower(a.old_identifier) = lower(v_trimmed)
   limit 1;
  if entity_id is null then
    -- No row at all: an unknown identifier must be indistinguishable from an
    -- unauthorised one at this layer.
    current_identifier := null;
    via_alias := false;
    return;
  end if;
  via_alias := true;
  execute format('select t.%I from %s t where t.%I = $1', v_column, v_table, v_key)
    into current_identifier using entity_id;
  -- Assigning the OUT parameters is not enough: a RETURNS TABLE function only
  -- emits a row on an explicit RETURN NEXT.
  return next;
end $$;

revoke all on function private.resolve_business_identifier(text, text)
  from public, anon, authenticated;
grant execute on function private.resolve_business_identifier(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The conversion. A callable function so the exact code path the migration
--    runs can also be exercised directly by the database suite against
--    synthetic legacy fixtures - a conversion that is only ever asserted on an
--    empty database proves nothing.
-- ---------------------------------------------------------------------------
create or replace function private.upgrade_legacy_business_ids()
returns bigint
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_entity text;
  v_table_name text;
  v_column text;
  v_key text;
  v_prefix text;
  v_table regclass;
  v_old text;
  v_new text;
  v_id uuid;
  v_row record;
  v_left bigint := 0;
  v_converted bigint := 0;
begin
  -- entity_type, table, column, approved prefix. Fixed here in SQL, so no
  -- client-supplied relation or column is ever reachable.
  for v_entity, v_table_name, v_column, v_key, v_prefix in
    select * from (values
      ('customer',            'public.customers',                    'customer_number',    'id',             'AF-CUS'),
      ('card_sale',           'public.card_sales',                   'sale_number',        'id',             'AF-CSALE'),
      ('customer_application','public.customer_applications',         'application_number', 'id',             'AF-APP'),
      ('reservation_agreement','public.reservation_agreements',       'reservation_number', 'id',             'AF-RES'),
      ('ost_member',          'public.ost_members',                  'ost_number',        'id',             'AF-OST'),
      ('ost_accreditation',   'private.ost_registration_details',    'form_number',        'application_id', 'AF-ACC'),
      ('ost_renewal',         'private.ost_accreditation_renewals',  'renewal_number',     'id',             'AF-REN'),
      ('redemption',          'public.redemptions',                  'redemption_number',  'id',             'AF-RED')
    ) as t(entity_type, tbl, col, key_column, prefix)
  loop
    v_table := v_table_name::regclass;

    for v_row in execute format(
      'select t.%I as ent_key, t.%I as old_value from %s t where t.%I is not null and btrim(t.%I) <> '''' and t.%I !~ %L order by t.%I',
      v_key, v_column, v_table, v_column, v_column, v_column,
      '^' || v_prefix || '-[A-HJ-NP-Z2-9]{5}$', v_key)
      loop
      v_id  := v_row.ent_key;
      v_old := v_row.old_value;

      -- The alias is recorded BEFORE the column is overwritten, so the legacy
      -- value is never lost even if the update itself fails.
      insert into private.business_id_aliases
        (entity_type, entity_id, old_identifier, migration_source)
      values (v_entity, v_id, v_old, '20261027000001')
      on conflict (entity_type, old_identifier) do nothing;

      v_new := private.claim_af_id(v_prefix, v_table, v_column);

      execute format('update %s set %I = $1 where %I = $2', v_table, v_column, v_key)
        using v_new, v_id;
      v_converted := v_converted + 1;

      -- The alias must exist for exactly this row, or the legacy value was lost.
      if not exists (
        select 1 from private.business_id_aliases a
         where a.entity_type = v_entity and a.entity_id = v_id and a.old_identifier = v_old
      ) then
        raise exception 'LEGACY_ID_ALIAS_MISSING: % % %', v_entity, v_id, v_old;
      end if;
    end loop;
  end loop;

  -- Fail loudly: no converted column may still hold a non-modern value.
  for v_table_name, v_column, v_prefix in
    select * from (values
      ('public.customers',                   'customer_number',    'AF-CUS'),
      ('public.card_sales',                  'sale_number',        'AF-CSALE'),
      ('public.customer_applications',        'application_number', 'AF-APP'),
      ('public.reservation_agreements',       'reservation_number', 'AF-RES'),
      ('public.ost_members',                  'ost_number',        'AF-OST'),
      ('private.ost_registration_details',    'form_number',        'AF-ACC'),
      ('private.ost_accreditation_renewals',  'renewal_number',     'AF-REN'),
      ('public.redemptions',                  'redemption_number',  'AF-RED')
    ) as t(tbl, col, prefix)
  loop
    v_table := v_table_name::regclass;
    execute format(
      'select count(*) from %s t where t.%I is not null and btrim(t.%I) <> '''' and t.%I !~ %L',
      v_table, v_column, v_column, v_column,
      '^' || v_prefix || '-[A-HJ-NP-Z2-9]{5}$')
      into v_left;
    if v_left > 0 then
      raise exception 'LEGACY_ID_REMAINS: %.% still has % non-modern values', v_table, v_column, v_left;
    end if;
  end loop;
  return v_converted;
end $$;

revoke all on function private.upgrade_legacy_business_ids() from public, anon, authenticated;
grant execute on function private.upgrade_legacy_business_ids() to service_role;

select private.upgrade_legacy_business_ids();

-- ---------------------------------------------------------------------------
-- 4. Authorized search accepts the legacy alias AND the current AF id, and
--    always displays the current AF id. Both functions stay service-role only,
--    exactly as before: this widens what an authorized caller may type, never
--    who may call.
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
    or lower(m.membership_number) like '%' || lower(regexp_replace(p_search, '^AFHOMES:', '', 'i')) || '%'
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
 lower(d.membership_number) like '%'||lower(regexp_replace(p_filters->>'search','^AFHOMES:','','i'))||'%' or
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

-- ---------------------------------------------------------------------------
-- 5. Column-level grants unchanged: browser roles hold no privilege on the new
--    table and gain no new function EXECUTE beyond what they already had.
-- ---------------------------------------------------------------------------
revoke all on function private.resolve_business_identifier(text, text) from anon, authenticated;
revoke all on private.business_id_aliases from anon, authenticated;