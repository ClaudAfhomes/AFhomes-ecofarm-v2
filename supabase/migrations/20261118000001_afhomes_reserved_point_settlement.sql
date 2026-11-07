-- Approved customer reservations settle only at fully verified purchase completion.
-- Validation: test:db:local ownership, reservation races, expiry, zero-cash and refund cases.
-- Down: revoke new application RPCs; never rewrite balances or ledger history.
alter table public.point_redemption_rules add column if not exists rule_kind text not null default 'promotion' check(rule_kind in ('promotion','accommodation'));
alter table public.redemption_quotes
 add column if not exists redemption_rule_id uuid references public.point_redemption_rules(id),
 add column if not exists reserved_at timestamptz,
 add column if not exists released_at timestamptz;

-- Pricing, quantities and eligibility changes invalidate approval. Receipt and
-- workflow timestamps do not: Finance verification is expected after approval.
create or replace function private.point_redemption_approval_snapshot(p_quote_id uuid)
returns jsonb language sql stable set search_path=pg_catalog,extensions,private,public,pg_temp as $$
 select jsonb_build_object('quoteId',q.id,'points',q.points_requested,'pesoValue',q.peso_value,'rate',q.peso_value_per_point,'quoteExpiresAt',q.expires_at,
 'purchase',jsonb_build_object('id',p.id,'customer_id',p.customer_id,'membership_id',p.membership_id,'purchase_number',p.purchase_number,'gross_amount',p.gross_amount,'tier_discount_amount',p.tier_discount_amount,'points_discount_amount',p.points_discount_amount,'net_amount',p.net_amount),
 'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.purchase_lines l where l.purchase_id=p.id),
 'services',(select jsonb_agg(to_jsonb(s) order by s.id) from public.service_catalog s where s.id in(select l.service_id from public.purchase_lines l where l.purchase_id=p.id)),
 'rules',(select to_jsonb(r) from public.point_redemption_rules r where r.id=q.redemption_rule_id))
 from public.redemption_quotes q join public.purchases p on p.id=q.purchase_id where q.id=p_quote_id
$$;

create or replace function private.release_point_reservations(p_membership_id uuid,p_replace_purchase_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_q record;
begin
 perform 1 from public.memberships m where m.id=p_membership_id for update;
 for v_q in select q.* from public.redemption_quotes q where q.membership_id=p_membership_id and q.status='open' order by q.purchase_id,q.id loop
  perform 1 from public.purchases p where p.id=v_q.purchase_id for update;
  perform 1 from public.redemption_quotes q where q.id=v_q.id for update;
  if v_q.purchase_id=p_replace_purchase_id or v_q.expires_at<=now() or v_q.rejected_at is not null
   or (v_q.reserved_at is not null and v_q.approval_snapshot is distinct from private.point_redemption_approval_snapshot(v_q.id)) then
   if v_q.reserved_at is not null then
    update public.purchase_lines l set points_discount_amount='0.00',discount_eligible=false where l.purchase_id=v_q.purchase_id;
    update public.purchases p set points_discount_amount='0.00',net_amount=private.money(p.gross_amount::numeric-p.tier_discount_amount::numeric),updated_at=now() where p.id=v_q.purchase_id and p.status='draft';
   end if;
   update public.redemption_quotes q set status=case when q.expires_at<=now() then 'expired' else 'cancelled' end,released_at=now() where q.id=v_q.id;
   if v_q.approval_snapshot is not null then
   insert into public.audit_events(action,entity_type,entity_id,after_data,reason) values('POINT_RESERVATION_RELEASED','purchase',v_q.purchase_id,jsonb_build_object('quoteId',v_q.id,'points',v_q.points_requested),'Expired, rejected, replaced or changed quote');
   end if;
  end if;
 end loop;
end $$;
revoke all on function private.release_point_reservations(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.prepare_customer_point_redemption(p_purchase_id uuid,p_points_requested bigint,p_actor_id uuid)
returns table(quote_id uuid,quote_number text,points_requested bigint,peso_value text,eligible_line_total text,remaining_points_after bigint,expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_p public.purchases%rowtype;v_m public.memberships%rowtype;v_a public.points_accounts%rowtype;v_l public.purchase_lines%rowtype;v_s public.service_catalog%rowtype;v_r public.point_redemption_rules%rowtype;v_tier text;v_available bigint;v_value numeric;v_id uuid;v_number text;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.redemption','create');
 select p.* into v_p from public.purchases p where p.id=p_purchase_id;
 if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode='P0002'; end if;
 select m.* into v_m from public.memberships m where m.id=v_p.membership_id for update;
 perform private.release_point_reservations(v_m.id,p_purchase_id);
 select p.* into v_p from public.purchases p where p.id=p_purchase_id for update;
 if v_p.created_by<>p_actor_id then raise exception 'SALE_REFERENCE_CONFLICT' using errcode='42501';end if;
 if v_p.status<>'draft' then raise exception 'PURCHASE_NOT_DISCOUNTABLE' using errcode='55000'; end if;
 if v_m.status<>'active' or v_m.expires_at<=now() then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='55000'; end if;
 if not exists(select 1 from public.customers c where c.id=v_p.customer_id and c.status='active') then raise exception 'CUSTOMER_NOT_ACTIVE' using errcode='55000'; end if;
 if p_points_requested is null or p_points_requested<=0 then raise exception 'POINTS_AMOUNT_REQUIRED' using errcode='22023'; end if;
 if (select count(*) from public.purchase_lines l where l.purchase_id=p_purchase_id)<>1 then raise exception 'PURCHASE_HAS_NO_LINES' using errcode='22023'; end if;
 select l.* into v_l from public.purchase_lines l where l.purchase_id=p_purchase_id;
 select s.* into v_s from public.service_catalog s where s.id=v_l.service_id and s.is_active and s.availability='available' for share;
 if not found then raise exception 'SERVICE_NOT_FOUND' using errcode='P0002'; end if;
 select cp.code into v_tier from public.card_plans cp where cp.id=v_m.product_id;
 select r.* into v_r from public.point_redemption_rules r
 where r.service_id=v_s.id and r.is_active and v_tier=any(r.eligible_tiers)
 and r.effective_start<=(now() at time zone 'Asia/Manila')::date and r.effective_end>(now() at time zone 'Asia/Manila')::date
 and (r.rule_kind='promotion' or v_s.is_staycation_eligible)
 and p_points_requested>=r.min_points and (r.max_points is null or p_points_requested<=r.max_points)
 and (r.min_purchase_amount is null or v_l.line_total::numeric>=r.min_purchase_amount::numeric)
 and (v_p.tier_discount_amount::numeric=0 or (r.rule_kind='promotion' and r.allow_discount_stacking))
 order by r.peso_value_per_point desc,r.id limit 1 for share;
 if not found then raise exception 'NO_REDEMPTION_RATE' using errcode='55000'; end if;
 perform private.ensure_points_period((select a.id from public.points_accounts a where a.membership_id=v_m.id));
 select a.* into v_a from public.points_accounts a where a.membership_id=v_m.id for update;
 if not found then raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode='P0002'; end if;
 if v_a.reversal_debt>0 then raise exception 'REVERSAL_DEBT_OUTSTANDING' using errcode='55000'; end if;
 select v_a.balance-coalesce(sum(q.points_requested),0) into v_available from public.redemption_quotes q where q.account_id=v_a.id and q.status='open' and q.reserved_at is not null and q.expires_at>now();
 if p_points_requested>v_available then raise exception 'INSUFFICIENT_POINTS' using errcode='55000'; end if;
 v_value:=round(p_points_requested*v_r.peso_value_per_point,2);
 if v_value<=0 or v_value>v_p.net_amount::numeric then raise exception 'DISCOUNT_EXCEEDS_GROSS' using errcode='55000'; end if;
 v_number:=private.claim_af_id('AF-QTE','public.redemption_quotes'::regclass,'quote_number');
 insert into public.redemption_quotes as q(quote_number,purchase_id,account_id,membership_id,points_requested,peso_value_per_point,peso_value,eligible_line_total,points_balance_snapshot,remaining_points_after,expires_at,created_by,redemption_rule_id)
 values(v_number,v_p.id,v_a.id,v_m.id,p_points_requested,v_r.peso_value_per_point,private.money(v_value),v_l.line_total,v_a.balance,v_available-p_points_requested,least(now()+interval '30 minutes',v_r.effective_end::timestamp at time zone 'Asia/Manila'),p_actor_id,v_r.id) returning q.id into v_id;
 perform public.request_point_redemption_approval(v_id,p_actor_id);
 return query select v_id,v_number,p_points_requested,private.money(v_value),v_l.line_total,v_available-p_points_requested,(select q.expires_at from public.redemption_quotes q where q.id=v_id);
end $$;
revoke all on function public.prepare_customer_point_redemption(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.prepare_customer_point_redemption(uuid,bigint,uuid) to service_role;
revoke all on function public.quote_point_discount(uuid,bigint,uuid) from public,anon,authenticated,service_role;

create or replace function public.decide_point_redemption_approval(p_quote_id uuid,p_customer_id uuid,p_auth_user_id uuid,p_approve boolean)
returns text language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_q public.redemption_quotes%rowtype;v_p public.purchases%rowtype;v_m public.memberships%rowtype;v_a public.points_accounts%rowtype;v_available bigint;
begin
 if not exists(select 1 from public.customers c where c.id=p_customer_id and c.auth_user_id=p_auth_user_id and p_auth_user_id is not null and c.status='active') then raise exception 'APPROVAL_NOT_FOUND' using errcode='P0002'; end if;
 select q.* into v_q from public.redemption_quotes q where q.id=p_quote_id and q.approval_customer_id=p_customer_id;
 if not found then raise exception 'APPROVAL_NOT_FOUND' using errcode='P0002'; end if;
 select m.* into v_m from public.memberships m where m.id=v_q.membership_id for update;
 perform private.release_point_reservations(v_m.id);
 select p.* into v_p from public.purchases p where p.id=v_q.purchase_id for update;
 select q.* into v_q from public.redemption_quotes q where q.id=p_quote_id for update;
 perform 1 from public.customers c where c.id=p_customer_id and c.id=v_p.customer_id and c.auth_user_id=p_auth_user_id and c.status='active' for share;
 if not found then raise exception 'APPROVAL_NOT_FOUND' using errcode='P0002';end if;
 if v_q.status<>'open' or v_q.approval_consumed_at is not null or v_q.rejected_at is not null or v_q.approval_expires_at<=now() or v_q.expires_at<=now() then raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000'; end if;
 if v_p.status<>'draft' or v_m.status<>'active' or v_m.expires_at<=now() or v_q.approval_snapshot is distinct from private.point_redemption_approval_snapshot(v_q.id) then raise exception 'APPROVAL_CHANGED' using errcode='55000'; end if;
 if p_approve is null then raise exception 'APPROVAL_DECISION_REQUIRED' using errcode='22023'; end if;
 if v_q.approved_at is not null and p_approve then return 'approved'; end if;
 select a.* into v_a from public.points_accounts a where a.id=v_q.account_id for update;
 if p_approve then
  select v_a.balance-coalesce(sum(q.points_requested),0) into v_available from public.redemption_quotes q where q.account_id=v_a.id and q.status='open' and q.reserved_at is not null and q.expires_at>now();
  if v_a.reversal_debt>0 or v_available<v_q.points_requested then raise exception 'INSUFFICIENT_POINTS' using errcode='55000'; end if;
  update public.purchase_lines l set points_discount_amount=v_q.peso_value,discount_eligible=true where l.purchase_id=v_p.id;
  update public.purchases p set points_discount_amount=v_q.peso_value,net_amount=private.money(p.gross_amount::numeric-p.tier_discount_amount::numeric-v_q.peso_value::numeric),updated_at=now() where p.id=v_p.id;
  update public.redemption_quotes q set approved_at=now(),reserved_at=now(),approval_auth_user_id=p_auth_user_id where q.id=v_q.id;
  update public.redemption_quotes q set approval_snapshot=private.point_redemption_approval_snapshot(q.id) where q.id=v_q.id;
 else
  update public.redemption_quotes q set rejected_at=now(),approval_auth_user_id=p_auth_user_id where q.id=v_q.id;
  perform private.release_point_reservations(v_m.id);
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_auth_user_id,case when p_approve then 'POINT_REDEMPTION_CUSTOMER_APPROVED' else 'POINT_REDEMPTION_CUSTOMER_REJECTED' end,'purchase',v_p.id,jsonb_build_object('quoteId',v_q.id,'points',v_q.points_requested,'pesoValue',v_q.peso_value));
 return case when p_approve then 'approved' else 'rejected' end;
end $$;

create or replace function public.complete_purchase(p_purchase_id uuid,p_actor_id uuid)
returns table(purchase_id uuid,net_amount text,verified_total text,fully_paid boolean)
language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_p public.purchases%rowtype;v_q public.redemption_quotes%rowtype;v_m public.memberships%rowtype;v_a public.points_accounts%rowtype;v_verified numeric;v_ledger bigint;v_period uuid;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.sales','create');
 select p.* into v_p from public.purchases p where p.id=p_purchase_id;
 if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode='P0002'; end if;
 select m.* into v_m from public.memberships m where m.id=v_p.membership_id for update;
 perform private.release_point_reservations(v_m.id);
 select p.* into v_p from public.purchases p where p.id=p_purchase_id for update;
 if v_p.status='completed' then return query select v_p.id,v_p.net_amount,private.money(private.purchase_verified_total(v_p.id)),true;return;end if;
 if v_p.status<>'draft' then raise exception 'PURCHASE_ALREADY_REVERSED' using errcode='55000'; end if;
 if v_m.status<>'active' or v_m.expires_at<=now() then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='55000'; end if;
 if not exists(select 1 from public.customers c where c.id=v_p.customer_id and c.status='active') then raise exception 'CUSTOMER_NOT_ACTIVE' using errcode='55000';end if;
 v_verified:=private.purchase_verified_total(v_p.id);
 if v_verified<v_p.net_amount::numeric then raise exception 'PURCHASE_NOT_SETTLED' using errcode='55000';end if;
 select q.* into v_q from public.redemption_quotes q where q.purchase_id=v_p.id and q.status='open' and q.reserved_at is not null for update;
 if found then
  perform 1 from public.customers c where c.id=v_p.customer_id and c.id=v_q.approval_customer_id and c.auth_user_id=v_q.approval_auth_user_id and c.status='active' for share;
  if not found then raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000';end if;
  perform 1 from public.service_catalog s where s.id in(select l.service_id from public.purchase_lines l where l.purchase_id=v_p.id) and s.is_active and s.availability='available' for share;
  if not found then raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000';end if;
  perform 1 from public.point_redemption_rules r where r.id=v_q.redemption_rule_id and r.is_active and r.effective_start<=(now() at time zone 'Asia/Manila')::date and r.effective_end>(now() at time zone 'Asia/Manila')::date and (select cp.code from public.card_plans cp where cp.id=v_m.product_id)=any(r.eligible_tiers) and (v_p.tier_discount_amount::numeric=0 or (r.rule_kind='promotion' and r.allow_discount_stacking)) for share;
  if not found then raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000';end if;
  if v_q.approved_at is null or v_q.approval_auth_user_id is null or v_q.expires_at<=now() or v_q.approval_snapshot is distinct from private.point_redemption_approval_snapshot(v_q.id) then raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000';end if;
  v_period:=private.ensure_points_period(v_q.account_id);
  select a.* into v_a from public.points_accounts a where a.id=v_q.account_id for update;
  if v_a.reversal_debt>0 or v_a.balance<v_q.points_requested then raise exception 'INSUFFICIENT_POINTS' using errcode='55000';end if;
  insert into public.points_ledger(account_id,entry_type,amount,balance_before,balance_after,counts_toward_cap,origin_period_id,reference_type,reference_id,actor_id,reason)
  values(v_a.id,'redemption',-v_q.points_requested,v_a.balance,v_a.balance-v_q.points_requested,false,v_period,'redemption_quote',v_q.id::text,p_actor_id,'Customer-authorized points on purchase '||v_p.purchase_number) returning id into v_ledger;
  update public.points_accounts a set balance=a.balance-v_q.points_requested,lifetime_redeemed=a.lifetime_redeemed+v_q.points_requested,updated_at=now() where a.id=v_a.id;
  update public.memberships m set points_balance=v_a.balance-v_q.points_requested where m.id=v_m.id;
  update public.redemption_quotes q set status='committed',committed_at=now(),ledger_entry_id=v_ledger,approval_consumed_at=now() where q.id=v_q.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor_id,'POINT_REDEMPTION_COMPLETED','purchase',v_p.id,jsonb_build_object('quoteId',v_q.id,'approvedBy',v_q.approval_auth_user_id,'points',v_q.points_requested,'pesoValue',v_q.peso_value,'ruleId',v_q.redemption_rule_id));
 elsif v_p.points_discount_amount::numeric>0 and not exists(select 1 from public.redemption_quotes q where q.purchase_id=v_p.id and q.status='committed' and q.ledger_entry_id is not null) then
  raise exception 'APPROVAL_REQUIRED' using errcode='55000';
 end if;
 update public.purchases p set status='completed',completed_at=now(),updated_at=now() where p.id=v_p.id;
 return query select v_p.id,v_p.net_amount,private.money(v_verified),true;
end $$;
revoke all on function public.complete_purchase(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_purchase(uuid,uuid) to service_role;
create or replace function public.customer_points_position(p_membership_id uuid)
returns table (
  membership_id uuid,
  balance bigint,
  annual_cap bigint,
  remaining_earning_capacity bigint,
  spendable bigint,
  reversal_debt bigint,
  period_start date,
  period_end date,
  tier text,
  earned_this_period bigint,
  redeemed_this_period bigint
)
language plpgsql
volatile
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare
  v_account  public.points_accounts%rowtype;
  v_period   public.points_periods%rowtype;
  v_membership public.memberships%rowtype;
  v_period_id uuid;
  v_tier     text;
begin
  select * into v_membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- QUALIFIED: `membership_id` is both a column of points_accounts and an OUT
  -- parameter of this function, so the bare name is ambiguous (SQLSTATE 42702).
  select * into v_account from public.points_accounts as pa
   where pa.membership_id = p_membership_id;
  if not found then
    raise exception 'POINTS_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ASSIGNMENT, never a volatile call inside a WHERE over a table scan. A
  -- `where id = ensure(...)` qual is evaluated PER SCANNED ROW, so on an empty
  -- points_periods table ensure NEVER RUNS, v_period stays null, and every
  -- period field comes back null (remaining capacity reads as 0) on the first
  -- call for a fresh database. The direct call always executes.
  -- The open period is then resolved BY ACCOUNT, not by the returned id, so a
  -- stale return can never point the read at the wrong row.
  perform private.release_point_reservations(p_membership_id);
  v_period_id := private.ensure_points_period(v_account.id);
  select pa.* into v_account from public.points_accounts pa where pa.membership_id=p_membership_id;
  perform 1 from public.points_periods where id = v_period_id;
  select * into v_period from public.points_periods as pp
   where pp.account_id = v_account.id and pp.status = 'open'
   order by pp.period_start desc limit 1;

  select coalesce(pc.code, 'BRONZE') into v_tier
    from public.memberships m
    left join public.card_plans pc on pc.id = m.product_id
   where m.id = p_membership_id;

  return query
    select
      p_membership_id,
      v_account.balance,
      v_period.annual_points_cap,
      -- CASTS are load-bearing: sum(bigint) is numeric, and the OUT parameters
      -- are bigint, so an uncast select fails with "structure of query does not
      -- match function result type" on every call.
      greatest(v_period.annual_points_cap
               - coalesce((select sum(pl.amount) from public.points_ledger pl
                            where pl.account_id = v_account.id
                              and pl.origin_period_id = v_period.id
                              and pl.counts_toward_cap
                              and pl.amount > 0), 0), 0)::bigint,
      greatest(v_account.balance - v_account.reversal_debt - coalesce((select sum(q.points_requested) from public.redemption_quotes q where q.account_id=v_account.id and q.status='open' and q.reserved_at is not null and q.expires_at>now()),0), 0)::bigint,
      v_account.reversal_debt,
      v_period.period_start,
      v_period.period_end,
      v_tier,
      coalesce((select sum(pl.amount) from public.points_ledger pl
                 where pl.account_id = v_account.id
                   and pl.origin_period_id = v_period.id
                   and pl.counts_toward_cap
                   and pl.amount > 0), 0)::bigint,
      coalesce((select -sum(pl.amount) from public.points_ledger pl
                 where pl.account_id = v_account.id
                   and pl.origin_period_id = v_period.id
                   and pl.entry_type in ('redemption','reversal','expiration')), 0)::bigint;
end $$;

comment on function public.customer_points_position(uuid) is
  'Three figures, never collapsed: balance, spendable and remaining earning capacity. Alias-qualified after the ambiguous-column fix.';

revoke all on function public.customer_points_position(uuid) from public, anon, authenticated;
grant execute on function public.customer_points_position(uuid) to service_role;
