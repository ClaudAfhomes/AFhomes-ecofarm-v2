-- Forward-only correction: service-only directory RPC private dependencies.
-- Validation (execute as the migration owner):
--   select has_schema_privilege('service_role', 'private', 'USAGE'); -- true
--   select has_function_privilege('service_role', 'private.money(numeric)', 'EXECUTE'),
--          has_function_privilege('service_role', 'private.hash_token(text)', 'EXECUTE'); -- true, true
--   select r, has_function_privilege(r, 'private.money(numeric)', 'EXECUTE'),
--          has_function_privilege(r, 'private.hash_token(text)', 'EXECUTE')
--   from unnest(array['anon','authenticated']) r; -- false, false for both roles
--   begin; set local role service_role;
--   select * from public.customer_directory('{"limit":1}'::jsonb);
--   select * from public.search_customer_ids('nonexistent'); rollback;
--   Run supabase/security/rls_invariants.sql: every result set must be empty.
-- Down note: no automatic rollback. Revoke these two EXECUTEs and schema USAGE
-- only after checking other server RPC dependencies; revocation restores the
-- directory failure. No data, function bodies, ownership, browser grants or RLS change.

-- These public RPCs already allow only service_role and execute as the caller.
-- Their fully qualified private calls need schema resolution AND EXECUTE.
-- Keep SECURITY INVOKER: no owner elevation or new RLS bypass is introduced.
grant usage on schema private to service_role;
grant execute on function private.money(numeric) to service_role;
grant execute on function private.hash_token(text) to service_role;
