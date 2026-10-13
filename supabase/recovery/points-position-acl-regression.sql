-- Run only against the isolated restored-and-migrated recovery database.
-- Rolls back all test grants and any reservation/period maintenance.
begin;
revoke execute on function private.release_point_reservations(uuid,uuid) from service_role;
set local role service_role;
do $$
declare member_id uuid;
begin
 select id into member_id from public.memberships limit 1;
 if member_id is null then raise exception 'RESTORED_MEMBERSHIP_REQUIRED'; end if;
 begin
  perform public.customer_points_position(member_id);
  raise exception 'EXPECTED_PRE_FIX_PERMISSION_DENIAL';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
\ir ../migrations/20261124000001_afhomes_points_position_service_acl.sql
\ir ../migrations/20261124000001_afhomes_points_position_service_acl.sql
do $$
begin
 if not has_function_privilege('service_role','private.release_point_reservations(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','private.release_point_reservations(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.release_point_reservations(uuid,uuid)','EXECUTE') then
  raise exception 'SERVER_ONLY_EXECUTE_INVARIANT_FAILED';
 end if;
end $$;
set local role service_role;
do $$
declare m record; calls integer := 0;
begin
 for m in select id from public.memberships loop
  perform public.customer_points_position(m.id);
  calls := calls + 1;
 end loop;
 if calls < 10 then raise exception 'RESTORED_ACCOUNTS_NOT_EXERCISED'; end if;
end $$;
reset role;
set local role authenticated;
do $$
begin
 begin
  perform private.release_point_reservations('00000000-0000-0000-0000-000000000000'::uuid);
  raise exception 'EXPECTED_BROWSER_PERMISSION_DENIAL';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set local role anon;
do $$
begin
 begin
  perform private.release_point_reservations('00000000-0000-0000-0000-000000000000'::uuid);
  raise exception 'EXPECTED_ANONYMOUS_PERMISSION_DENIAL';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;