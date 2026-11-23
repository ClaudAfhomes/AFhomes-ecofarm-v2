-- Staycation eligibility is admin-managed service metadata, not a name heuristic.
-- Validation: pnpm test:db:local.
-- select is_staycation_eligible from public.service_catalog limit 1;
-- Down: retain the column; restore the prior save_service_catalog body. No rows rewritten.
--
-- WHY a new file. 20261111000000_afhomes_service_publication.sql defines
-- save_service_catalog with a closed key allowlist. is_staycation_eligible has
-- existed since 20261104000001 (default false) but no write path ever accepted
-- it, so an Admin could not mark a staycation/hotel service eligible and the
-- points-spending gate (private.line_discount_eligible) could only see false.
-- This file adds the key to the allowlist and persists it. It rewrites no
-- history: existing rows keep their stored value.
create or replace function public.save_service_catalog(p_service_id uuid, p_input jsonb, p_actor_id uuid)
returns setof public.service_catalog language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp as $$
declare v_before public.service_catalog%rowtype; v_after public.service_catalog%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'operations.catalog', case when p_service_id is null then 'create' else 'update' end);
  if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('name','description','basePrice','isActive','published','availability','isStaycationEligible','summary','category','location','pricingUnit','highlights')) then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  if p_service_id is null then
    if nullif(btrim(p_input->>'name'),'') is null or p_input->>'basePrice' is null then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
    insert into public.service_catalog (name,description,base_price,is_active,published,availability,is_staycation_eligible,details)
    values (btrim(p_input->>'name'),p_input->>'description',p_input->>'basePrice',coalesce((p_input->>'isActive')::boolean,true),coalesce((p_input->>'published')::boolean,false),coalesce(p_input->>'availability','available'),coalesce((p_input->>'isStaycationEligible')::boolean,false),p_input - array['name','description','basePrice','isActive','published','availability','isStaycationEligible']) returning * into v_after;
  else
    select s.* into v_before from public.service_catalog s where s.id = p_service_id for update;
    if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
    update public.service_catalog s set
      name = case when p_input ? 'name' then btrim(p_input->>'name') else s.name end,
      description = case when p_input ? 'description' then p_input->>'description' else s.description end,
      base_price = coalesce(p_input->>'basePrice',s.base_price),
      is_active = coalesce((p_input->>'isActive')::boolean,s.is_active),
      published = coalesce((p_input->>'published')::boolean,s.published),
      availability = coalesce(p_input->>'availability',s.availability),
      is_staycation_eligible = case when p_input ? 'isStaycationEligible' then coalesce((p_input->>'isStaycationEligible')::boolean,false) else s.is_staycation_eligible end,
      details = s.details || (p_input - array['name','description','basePrice','isActive','published','availability','isStaycationEligible']), updated_at = now()
    where s.id = p_service_id returning s.* into v_after;
  end if;
  if nullif(v_after.name,'') is null then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
  select su.id,case when p_service_id is null then 'SERVICE_CREATED' else 'SERVICE_UPDATED' end,'service_catalog',v_after.id::text,to_jsonb(v_before),to_jsonb(v_after) from public.staff_users su where su.id = p_actor_id;
  return next v_after;
end $$;
revoke all on function public.save_service_catalog(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_service_catalog(uuid,jsonb,uuid) to service_role;
