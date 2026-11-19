-- A later application mirror must not recase or truncate facts already accepted
-- by the verified-import transaction. Ordinary application edits keep their mirror.
do $$
declare definition text; anchor text:=E'begin\n';
begin
 if to_regprocedure('private.mirror_application_onto_customer(uuid,jsonb,jsonb,jsonb)') is null then raise exception 'CUSTOMER_IMPORT_MIRROR_REQUIRED';end if;
 select replace(pg_get_functiondef('private.mirror_application_onto_customer(uuid,jsonb,jsonb,jsonb)'::regprocedure),E'\r\n',E'\n') into definition;
 if strpos(definition,anchor)=0 then raise exception 'CUSTOMER_IMPORT_MIRROR_PRECONDITION';end if;
 definition:=replace(definition,anchor,anchor||$guard$
  if exists (
   select 1 from private.customer_import_purchase_sources s
   join public.customer_import_rows r on r.id=s.original_row_id
   where s.customer_id=p_customer_id and s.application_id is null
    and r.normalized_data->>'externalVerified'='true'
  ) then return;end if;
 $guard$);
 execute definition;
 revoke all on function private.mirror_application_onto_customer(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
end $$;
