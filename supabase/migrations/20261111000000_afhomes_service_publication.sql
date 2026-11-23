-- Persistent service publication, private photos, and atomic audited catalog writes.
-- Validation: pnpm test:db:local; supabase/security/rls_invariants.sql.
-- select public from storage.buckets where id = 'afhomes-service-images'; -- false
-- select has_table_privilege('authenticated','public.service_catalog','update'); -- false
-- Down: unpublish services; retain images, snapshots and audit history.
alter table public.service_catalog alter column code set default ('AF-SVC-' || upper(replace(gen_random_uuid()::text, '-', '')));
alter table public.service_catalog add column if not exists published boolean not null default false;
alter table public.service_catalog add column if not exists availability text not null default 'available' check (availability in ('available','unavailable','coming_soon'));
alter table public.service_catalog add column if not exists photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 6);
alter table public.purchase_lines add column if not exists service_name_snapshot text;
alter table public.purchase_lines add column if not exists pricing_unit_snapshot text;
alter table public.service_catalog add column if not exists details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and coalesce(details->>'pricingUnit','unit') in ('unit','person','session','night','booking'));
insert into storage.buckets(id,name,public) values ('afhomes-service-images','afhomes-service-images',false)
on conflict (id) do update set public = false;

create or replace function public.save_service_catalog(p_service_id uuid, p_input jsonb, p_actor_id uuid)
returns setof public.service_catalog language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp as $$
declare v_before public.service_catalog%rowtype; v_after public.service_catalog%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id, 'operations.catalog', case when p_service_id is null then 'create' else 'update' end);
  if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('name','description','basePrice','isActive','published','availability','summary','category','location','pricingUnit','highlights')) then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  if p_service_id is null then
    if nullif(btrim(p_input->>'name'),'') is null or p_input->>'basePrice' is null then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
    insert into public.service_catalog (name,description,base_price,is_active,published,availability,details)
    values (btrim(p_input->>'name'),p_input->>'description',p_input->>'basePrice',coalesce((p_input->>'isActive')::boolean,true),coalesce((p_input->>'published')::boolean,false),coalesce(p_input->>'availability','available'),p_input - array['name','description','basePrice','isActive','published','availability']) returning * into v_after;
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
      details = s.details || (p_input - array['name','description','basePrice','isActive','published','availability']), updated_at = now()
    where s.id = p_service_id returning s.* into v_after;
  end if;
  if nullif(v_after.name,'') is null then raise exception 'INVALID_SERVICE_INPUT' using errcode = '22023'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
  select su.id,case when p_service_id is null then 'SERVICE_CREATED' else 'SERVICE_UPDATED' end,'service_catalog',v_after.id::text,to_jsonb(v_before),to_jsonb(v_after) from public.staff_users su where su.id = p_actor_id;
  return next v_after;
end $$;
revoke all on function public.save_service_catalog(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_service_catalog(uuid,jsonb,uuid) to service_role;

create or replace function public.append_service_photo(p_service_id uuid,p_path text,p_alt text,p_actor_id uuid)
returns setof public.service_catalog language plpgsql security definer
set search_path = pg_catalog, extensions, private, public, pg_temp as $$
declare v_before public.service_catalog%rowtype; v_after public.service_catalog%rowtype;
begin
  perform private.mutation_actor_role(p_actor_id,'operations.catalog','update');
  if p_path not like p_actor_id::text || '/%' or nullif(btrim(p_alt),'') is null then raise exception 'INVALID_SERVICE_IMAGE' using errcode = '22023'; end if;
  select s.* into v_before from public.service_catalog s where s.id = p_service_id for update;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if jsonb_array_length(v_before.photos) >= 6 then raise exception 'SERVICE_PHOTO_LIMIT' using errcode = '22023'; end if;
  update public.service_catalog s set photos = s.photos || jsonb_build_array(jsonb_build_object('path',p_path,'alt',btrim(p_alt))),updated_at=now() where s.id=p_service_id returning s.* into v_after;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
  select su.id,'SERVICE_PHOTO_ADDED','service_catalog',v_after.id::text,jsonb_build_object('path',p_path,'alt',p_alt) from public.staff_users su where su.id=p_actor_id;
  return next v_after;
end $$;
revoke all on function public.append_service_photo(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.append_service_photo(uuid,text,text,uuid) to service_role;
