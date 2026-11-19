-- Customer portal approval of an exact server-calculated points quote.
-- Validation: test:db:local; ownership, expiry, rejection, changed quote and ACL probes.
-- Down: keep privileged spending revoked until the replacement settlement path is approved.
-- Existing ledger, balances, purchases and earlier migration files are untouched.
alter table public.redemption_quotes
  add column if not exists approval_snapshot jsonb,
  add column if not exists approval_expires_at timestamptz,
  add column if not exists approval_customer_id uuid references public.customers(id),
  add column if not exists approval_auth_user_id uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists approval_consumed_at timestamptz;

-- Staff confirmation cannot authorize a debit. The historical functions remain
-- available to the database owner for history checks, never to application roles.
revoke all on function public.commit_point_discount(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.apply_purchase_points_discount(uuid,bigint,text,uuid) from public, anon, authenticated, service_role;

create or replace function private.point_redemption_approval_snapshot(p_quote_id uuid)
returns jsonb language sql stable
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
 select jsonb_build_object(
   'quoteId', q.id, 'points', q.points_requested, 'pesoValue', q.peso_value,
   'rate', q.peso_value_per_point, 'quoteExpiresAt', q.expires_at,
   'purchase', to_jsonb(p),
   'lines', (select jsonb_agg(to_jsonb(l) order by l.id) from public.purchase_lines l where l.purchase_id=p.id),
   'services', (select jsonb_agg(to_jsonb(s) order by s.id) from public.service_catalog s where s.id in (select l.service_id from public.purchase_lines l where l.purchase_id=p.id)),
   'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.point_redemption_rules r where r.service_id in (select l.service_id from public.purchase_lines l where l.purchase_id=p.id)))
 from public.redemption_quotes q join public.purchases p on p.id=q.purchase_id where q.id=p_quote_id
$$;
revoke all on function private.point_redemption_approval_snapshot(uuid) from public,anon,authenticated,service_role;

create or replace function public.request_point_redemption_approval(p_quote_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_quote public.redemption_quotes%rowtype; v_purchase public.purchases%rowtype; v_member public.memberships%rowtype;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.redemption','create');
 select q.* into v_quote from public.redemption_quotes q where q.id=p_quote_id;
 if not found or v_quote.created_by<>p_actor_id then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 select m.* into v_member from public.memberships m where m.id=v_quote.membership_id for update;
 select p.* into v_purchase from public.purchases p where p.id=v_quote.purchase_id for update;
 select q.* into v_quote from public.redemption_quotes q where q.id=p_quote_id for update;
 if v_quote.status<>'open' or v_quote.expires_at<=now() or v_purchase.status<>'draft' then raise exception 'QUOTE_NOT_OPEN' using errcode='55000'; end if;
 if v_member.status<>'active' or v_member.expires_at<=now() then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='55000'; end if;
 if v_quote.approval_snapshot is not null then return v_quote.id; end if;
 update public.redemption_quotes q set status='cancelled'
 where q.purchase_id=v_quote.purchase_id and q.id<>v_quote.id and q.status='open';
 update public.redemption_quotes q set approval_snapshot=private.point_redemption_approval_snapshot(q.id),
   approval_expires_at=least(q.expires_at,now()+interval '10 minutes'),approval_customer_id=v_purchase.customer_id
 where q.id=v_quote.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
 values(p_actor_id,'POINT_REDEMPTION_APPROVAL_REQUESTED','purchase',v_purchase.id,
 jsonb_build_object('quoteId',v_quote.id,'customerId',v_purchase.customer_id,'points',v_quote.points_requested,'pesoValue',v_quote.peso_value));
 return v_quote.id;
end $$;
revoke all on function public.request_point_redemption_approval(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_point_redemption_approval(uuid,uuid) to service_role;

create or replace function public.decide_point_redemption_approval(p_quote_id uuid,p_customer_id uuid,p_auth_user_id uuid,p_approve boolean)
returns text language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp
as $$
declare v_quote public.redemption_quotes%rowtype; v_customer public.customers%rowtype; v_member public.memberships%rowtype; v_purchase public.purchases%rowtype;
begin
 select c.* into v_customer from public.customers c where c.id=p_customer_id and c.auth_user_id=p_auth_user_id and p_auth_user_id is not null;
 if not found or v_customer.status<>'active' then raise exception 'APPROVAL_NOT_FOUND' using errcode='P0002'; end if;
 select q.* into v_quote from public.redemption_quotes q where q.id=p_quote_id and q.approval_customer_id=p_customer_id;
 if not found then raise exception 'APPROVAL_NOT_FOUND' using errcode='P0002'; end if;
 select m.* into v_member from public.memberships m where m.id=v_quote.membership_id for update;
 select p.* into v_purchase from public.purchases p where p.id=v_quote.purchase_id for update;
 select q.* into v_quote from public.redemption_quotes q where q.id=p_quote_id for update;
 if v_quote.status<>'open' or v_quote.approval_consumed_at is not null or v_quote.rejected_at is not null
    or v_quote.approval_expires_at<=now() or v_quote.expires_at<=now() then raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000'; end if;
 if v_purchase.status<>'draft' or v_member.status<>'active' or v_member.expires_at<=now()
    or v_quote.approval_snapshot is distinct from private.point_redemption_approval_snapshot(v_quote.id)
 then raise exception 'APPROVAL_CHANGED' using errcode='55000'; end if;
 if p_approve is null then raise exception 'APPROVAL_DECISION_REQUIRED' using errcode='22023'; end if;
 if v_quote.approved_at is not null then
   if p_approve then return 'approved'; end if;
   raise exception 'APPROVAL_UNAVAILABLE' using errcode='55000';
 end if;
 update public.redemption_quotes q set approved_at=case when p_approve then now() end,
   rejected_at=case when not p_approve then now() end,approval_auth_user_id=p_auth_user_id
 where q.id=v_quote.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
 values(p_auth_user_id,case when p_approve then 'POINT_REDEMPTION_CUSTOMER_APPROVED' else 'POINT_REDEMPTION_CUSTOMER_REJECTED' end,
 'purchase',v_purchase.id,jsonb_build_object('quoteId',v_quote.id,'customerId',p_customer_id,'points',v_quote.points_requested,'pesoValue',v_quote.peso_value));
 return case when p_approve then 'approved' else 'rejected' end;
end $$;
revoke all on function public.decide_point_redemption_approval(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.decide_point_redemption_approval(uuid,uuid,uuid,boolean) to service_role;