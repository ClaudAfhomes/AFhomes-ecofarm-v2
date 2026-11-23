-- AF Homes: expose staffId on the sale-team accreditation lookups so the API
-- can mint a short-lived signed URL for the seller's profile photo on the
-- public verification card. staffId is consumed only by the service-role
-- handler and is stripped before the response is sent; it is never part of the
-- public contract.
--
-- Idempotent: create or replace. Safe to re-run.
-- Validation: select public.search_sale_team_accreditation('AA-...'); -- staffId present
-- Run supabase/security/rls_invariants.sql (empty = PASS).
-- Down: forward-only; re-apply the prior function bodies to drop staffId.

create or replace function public.get_sale_team_accreditation(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('staffId',a.staff_id,'aaNumber',a.aa_number,'kind',a.kind,'fullName',a.public_name,
   'startsOn',case when a.kind='OST' then coalesce(t.starts_on,a.starts_on) else a.starts_on end,
   'expiresOn',case when a.kind='OST' then coalesce(t.expires_on,a.expires_on) else a.expires_on end,
   'status',case
     when a.status='revoked' or (a.kind='OST' and t.status='revoked') then 'revoked'
     when s.status<>'active' or not r.is_active
       or (a.kind='IST' and r.slug not in ('vice_director','senior_sales_manager','sales_manager'))
       or (a.kind='OST' and (r.slug<>'ost' or m.status is distinct from 'active' or t.id is null)) then 'inactive'
     when (case when a.kind='OST' then t.starts_on else a.starts_on end)>(now() at time zone 'Asia/Manila')::date then 'not_started'
     when (case when a.kind='OST' then t.expires_on else a.expires_on end)<(now() at time zone 'Asia/Manila')::date then 'expired'
     else 'accredited' end)
 from private.sale_team_accreditations a
 join public.staff_users s on s.id=a.staff_id
 join public.staff_role_assignments ra on ra.staff_id=s.id
 join public.roles r on r.id=ra.role_id
 left join public.ost_members m on m.id=s.id and a.kind='OST'
 left join lateral (select ot.* from private.ost_accreditation_terms ot
   where ot.ost_id=m.id and ot.status in ('active','revoked')
   order by ot.approved_at desc,ot.id desc limit 1) t on true
 where a.staff_id=p_staff_id;
$$;
revoke all on function public.get_sale_team_accreditation(uuid) from public,anon,authenticated;
grant execute on function public.get_sale_team_accreditation(uuid) to service_role;

create or replace function public.resolve_sale_team_accreditation_number(p_aa_number text)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('staffId',h.staff_id,'aaNumber',h.aa_number,'kind',h.kind,'fullName',h.public_name,
    'status',h.status,'startsOn',h.starts_on,'expiresOn',h.expires_on,
    'successorAaNumber',h.successor_aa_number)
  from private.sale_team_accreditation_history h
  where h.aa_number=p_aa_number
    and not exists(select 1 from private.sale_team_accreditations a where a.aa_number=h.aa_number)
  order by h.recorded_at desc,h.id desc limit 1;
$$;
revoke all on function public.resolve_sale_team_accreditation_number(text) from public,anon,authenticated;
grant execute on function public.resolve_sale_team_accreditation_number(text) to service_role;
