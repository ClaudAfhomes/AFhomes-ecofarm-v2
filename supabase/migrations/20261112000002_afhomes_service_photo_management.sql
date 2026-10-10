-- Mutable service photos with stable opaque identifiers and atomic audit evidence.
-- Validate: SELECT has_function_privilege('authenticated',
-- 'public.manage_service_photo(uuid,text,text,text,text,uuid)','execute'); -- false
-- Down: revoke execution; retain private objects and audit evidence.
create or replace function public.manage_service_photo(
 p_service_id uuid,p_photo_id text,p_operation text,p_path text,p_alt text,p_actor_id uuid
) returns setof public.service_catalog language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare v_before public.service_catalog%rowtype; v_after public.service_catalog%rowtype; v_index int; v_photos jsonb; v_photo jsonb;
begin
 perform private.mutation_actor_role(p_actor_id,'operations.catalog','update');
 select s.* into v_before from public.service_catalog s where s.id=p_service_id for update;
 if not found then raise exception 'SERVICE_NOT_FOUND' using errcode='P0002'; end if;
 select (p.ordinality-1)::int,p.value into v_index,v_photo
 from jsonb_array_elements(v_before.photos) with ordinality p(value,ordinality)
 where encode(extensions.digest(p.value->>'path','sha256'),'hex')=p_photo_id;
 if v_index is null then raise exception 'SERVICE_PHOTO_NOT_FOUND' using errcode='P0002'; end if;
 if p_operation='remove' then v_photos := v_before.photos - v_index;
 elsif p_operation='cover' then v_photos := jsonb_build_array(v_photo) || (v_before.photos - v_index);
 elsif p_operation='replace' then
   if p_path is null or p_path not like p_actor_id::text || '/%' or nullif(btrim(p_alt),'') is null then raise exception 'INVALID_SERVICE_IMAGE' using errcode='22023'; end if;
   v_photos := jsonb_set(v_before.photos,array[v_index::text],jsonb_build_object('path',p_path,'alt',btrim(p_alt)));
 else raise exception 'INVALID_SERVICE_IMAGE_ACTION' using errcode='22023'; end if;
 update public.service_catalog s set photos=v_photos,updated_at=now() where s.id=p_service_id returning s.* into v_after;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_id,'SERVICE_PHOTOS_CHANGED','service_catalog',p_service_id,jsonb_build_object('photos',v_before.photos),jsonb_build_object('photos',v_after.photos,'operation',p_operation));
 return next v_after;
end $$;
revoke all on function public.manage_service_photo(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.manage_service_photo(uuid,text,text,text,text,uuid) to service_role;
