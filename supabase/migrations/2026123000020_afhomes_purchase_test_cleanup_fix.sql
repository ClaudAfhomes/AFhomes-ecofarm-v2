-- AF Homes: Fix purchase test cleanup to allow service role and UPDATE.
-- The cleanup runs as service role but table owner is postgres, so owner check fails.
-- Also allow UPDATE (for FK SET NULL) when cleanup flag is set.
-- Validation: pnpm test:db:local section 21.
-- Down: forward repair only. Restore from backup if needed.
begin;

create or replace function private.purchase_test_cleanup_allowed(p_table regclass) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
  select current_setting('afhomes.allow_purchase_test_cleanup',true)='on'
    and (current_user=pg_get_userbyid(c.relowner) or current_user in ('postgres','service_role') or current_setting('role') = 'superuser')
  from pg_class c where c.oid=p_table;
$$;
revoke all on function private.purchase_test_cleanup_allowed(regclass) from public, anon, authenticated, service_role;

create or replace function private.prevent_purchase_evidence_mutation() returns trigger
language plpgsql set search_path=pg_catalog,private,pg_temp as $$
begin
  if (tg_op='DELETE' or tg_op='UPDATE') and private.purchase_test_cleanup_allowed(tg_relid) then return old; end if;
  if tg_table_name='customer_application_purchase_terms' then
    raise exception 'PURCHASE_TERMS_IMMUTABLE' using errcode='55000';
  end if;
  raise exception 'PURCHASE_DOCUMENT_IMMUTABLE' using errcode='55000';
end $$;
revoke all on function private.prevent_purchase_evidence_mutation() from public, anon, authenticated, service_role;

notify pgrst,'reload schema';
commit;