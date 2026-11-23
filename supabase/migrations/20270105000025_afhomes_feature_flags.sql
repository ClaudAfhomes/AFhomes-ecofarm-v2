-- AF Homes module switches (Admin > Settings > Modules).
--
-- Owner instruction 2026-11-21: turn Services/Points, Redemption, Reports/Audit and CMS
-- ON, and let an authorized administrator switch a module on or off without a deploy.
-- Supersedes the Phase 1 code-only flags (decision D9) for these four modules.
--
-- A switch only hides and blocks routes; it never deletes data. Permission checks
-- still apply when a module is on. Every change writes one audit_events row with
-- the before/after values, in the same transaction as the change.
--
-- Access: browser roles hold nothing. The API reads through get_feature_flags()
-- (service role) and writes through update_feature_flags(), which re-checks
-- governance.config/update for the acting staff member.
--
-- forward-only, idempotent: create if not exists, insert ... on conflict do nothing,
-- create or replace. Re-running changes nothing.
--
-- Validation after apply (expected):
--   select public.get_feature_flags();
--     -- {"cms": true, "reports": true, "services": true, "redemption": true}
--   select has_function_privilege('authenticated','public.update_feature_flags(uuid,jsonb)','EXECUTE'); -- false
--   select has_table_privilege('authenticated','private.feature_flags','SELECT');                      -- false
--
-- Down: drop function public.update_feature_flags(uuid,jsonb); drop function
-- public.get_feature_flags(); drop table private.feature_flags. The apps then fall
-- back to the code defaults in packages/shared/src/features.ts (all ON).
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

create table if not exists private.feature_flags (
  key text primary key check (key in ('services', 'redemption', 'reports', 'cms')),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into private.feature_flags (key, enabled)
values ('services', true), ('redemption', true), ('reports', true), ('cms', true)
on conflict (key) do nothing;

revoke all on private.feature_flags from public, anon, authenticated;

create or replace function public.get_feature_flags() returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce(jsonb_object_agg(f.key, f.enabled), '{}'::jsonb) from private.feature_flags f;
$$;
revoke all on function public.get_feature_flags() from public, anon, authenticated;
grant execute on function public.get_feature_flags() to service_role;

create or replace function public.update_feature_flags(p_actor uuid, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
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
  for v_key, v_value in select * from jsonb_each(p_input) loop
    if v_key not in ('services', 'redemption', 'reports', 'cms') then
      raise exception 'FEATURE_FLAG_UNKNOWN' using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'boolean' then
      raise exception 'FEATURE_FLAG_NOT_BOOLEAN' using errcode = '22023';
    end if;
  end loop;

  perform 1 from private.feature_flags for update;
  v_before := public.get_feature_flags();

  insert into private.feature_flags (key, enabled, updated_by, updated_at)
  select e.key, (e.value)::boolean, p_actor, now() from jsonb_each(p_input) e
  on conflict (key) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where private.feature_flags.enabled is distinct from excluded.enabled;

  v_after := public.get_feature_flags();
  if v_after is distinct from v_before then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor, 'FEATURE_FLAGS_UPDATED', 'feature_flags', 'modules', v_before, v_after);
  end if;
  return v_after;
end $$;
revoke all on function public.update_feature_flags(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_feature_flags(uuid, jsonb) to service_role;
