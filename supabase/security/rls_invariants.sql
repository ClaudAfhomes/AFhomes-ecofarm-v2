-- AF Homes Phase 1 invariant audit. Every query must return zero rows.

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where roles && array['anon','authenticated','public']::name[]
  and cmd in ('INSERT','UPDATE','DELETE','ALL');

select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee in ('anon','authenticated','PUBLIC') and table_schema = 'public'
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

select n.nspname as schemaname, c.relname as tablename
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

select id, public from storage.buckets
where id in ('afhomes-customer-ids','afhomes-ost-ids','afhomes-payment-receipts') and public;

select policyname, cmd, roles from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and roles && array['anon','authenticated','public']::name[]
  and cmd in ('INSERT','UPDATE','DELETE','ALL');

select grantee, routine_schema, routine_name from information_schema.role_routine_grants
where routine_schema = 'private' and grantee in ('PUBLIC','anon');
