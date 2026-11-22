-- AF Homes module switches for every switchable module.
--
-- Owner instruction 2026-11-21: the Modules page must cover all modules of the
-- system, not only Services, Redemption, Reports and CMS. Adds Sales, Finance,
-- IST payroll, Commissions and Sales network. Dashboard, Organization/Settings,
-- the audit log and the profile stay always on (switching them off would lock an
-- administrator out of the Modules page itself), so they have no row.
--
-- A key is now valid when its row exists, so the allowlist lives in one place
-- (the rows) and a later module needs only an insert. Unknown keys are still
-- refused with FEATURE_FLAG_UNKNOWN.
--
-- forward-only, idempotent: drop constraint if exists, insert ... on conflict do
-- nothing, create or replace. New rows default ON, so nothing changes on apply.
--
-- Validation after apply (expected):
--   select public.get_feature_flags();
--     -- 9 keys, all true unless an admin already switched one of the first four off
--   select has_table_privilege('authenticated','private.feature_flags','SELECT'); -- false
--   select has_function_privilege('authenticated','public.update_feature_flags(uuid,jsonb)','EXECUTE'); -- false
--
-- Down: delete from private.feature_flags where key in ('sales','finance','payroll',
-- 'commissions','network'); alter table private.feature_flags drop constraint
-- feature_flags_key_format, add constraint feature_flags_key_check check (key in
-- ('services','redemption','reports','cms')); restore update_feature_flags from 20270105000025. The
-- apps fall back to the code defaults (ON) for keys the store does not return.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

alter table private.feature_flags drop constraint if exists feature_flags_key_check;
alter table private.feature_flags drop constraint if exists feature_flags_key_format;
alter table private.feature_flags
  add constraint feature_flags_key_format check (key ~ '^[a-z][a-z_]{1,39}$');

insert into private.feature_flags (key, enabled)
values ('sales', true), ('finance', true), ('payroll', true), ('commissions', true), ('network', true)
on conflict (key) do nothing;

revoke all on private.feature_flags from public, anon, authenticated;

create or replace function public.update_feature_flags(p_actor uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_key text;
  v_value jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  perform private.mutation_actor_role(p_actor, 'governance.config', 'update');
  if p_input is null or jsonb_typeof(p_input) <> 'object' or p_input = '{}'::jsonb then
    raise exception 'FEATURE_FLAGS_EMPTY' using errcode = '22023';
  end if;

  perform 1 from private.feature_flags for update;
  for v_key, v_value in select * from jsonb_each(p_input) loop
    if not exists (select 1 from private.feature_flags f where f.key = v_key) then
      raise exception 'FEATURE_FLAG_UNKNOWN' using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'boolean' then
      raise exception 'FEATURE_FLAG_NOT_BOOLEAN' using errcode = '22023';
    end if;
  end loop;

  v_before := public.get_feature_flags();

  update private.feature_flags f
     set enabled = (e.value)::boolean, updated_by = p_actor, updated_at = now()
    from jsonb_each(p_input) e
   where f.key = e.key and f.enabled is distinct from (e.value)::boolean;

  v_after := public.get_feature_flags();
  if v_after is distinct from v_before then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor, 'FEATURE_FLAGS_UPDATED', 'feature_flags', 'modules', v_before, v_after);
  end if;
  return v_after;
end $$;
revoke all on function public.update_feature_flags(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_feature_flags(uuid, jsonb) to service_role;
