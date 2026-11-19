-- Validation: generated values match ^MBS-([0-9A-F]{8}-){3}[0-9A-F]{8}$;
-- sample at least 1000 values; existing memberships and ACLs remain unchanged.
-- SELECT private.next_membership_number() ~ '^MBS-([0-9A-F]{8}-){3}[0-9A-F]{8}$';
-- SELECT p.proacl FROM pg_proc p WHERE p.oid = 'private.next_membership_number()'::regprocedure;
-- Run supabase/security/rls_invariants.sql (zero rows required).
-- Down: restore the previous allocator in a new migration, retaining every issued code.
-- 16 pgcrypto bytes = 128 bits, with no truncation. Existing unique constraint wins.
create or replace function private.next_membership_number() returns text
language plpgsql security definer
set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare raw text; candidate text; attempt integer;
begin
  -- All activation/import allocations retain the shared transaction lock until insert.
  perform pg_advisory_xact_lock(19000002,1);
  for attempt in 1..64 loop
    raw := upper(encode(gen_random_bytes(16), 'hex'));
    candidate := 'MBS-' || substring(raw,1,8) || '-' || substring(raw,9,8)
      || '-' || substring(raw,17,8) || '-' || substring(raw,25,8);
    if not exists(select 1 from public.memberships m where m.membership_number=candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'MEMBERSHIP_NUMBER_ALLOCATION_FAILED' using errcode='55000';
end $$;
-- CREATE OR REPLACE preserves the existing owner and EXECUTE ACL. No grants,
-- policies, tables, sequence state, or historical membership rows are changed.
-- Explicit imports retain their supplied number, including a previously issued
-- random number. Only legacy numeric values participate in the legacy sequence.
do $$
declare definition text; old_sequence text;
begin
  select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure) into definition;
  if strpos(definition, '!~ ''^MBS-[0-9]{6}$'' then raise exception ''IMPORT_BAD_MEMBERSHIP_NUMBER''') > 0 then
    old_sequence := 'perform setval(''public.membership_number_seq'', greatest((select last_value from public.membership_number_seq), substring(v_membership_number from 5)::bigint), true);';
    if strpos(definition, old_sequence) = 0 then raise exception 'IMPORT_ALLOCATOR_DEFINITION_MISMATCH'; end if;
    definition := replace(definition, '^MBS-[0-9]{6}$', '^MBS-([0-9]{6}|[0-9A-F]{8}(-[0-9A-F]{8}){3})$');
    definition := replace(definition, old_sequence, 'if v_membership_number ~ ''^MBS-[0-9]{6}$'' then ' || old_sequence || ' end if;');
    execute definition;
  elsif strpos(definition, '^MBS-([0-9]{6}|[0-9A-F]{8}(-[0-9A-F]{8}){3})$') = 0 then
    raise exception 'IMPORT_ALLOCATOR_DEFINITION_MISMATCH';
  end if;
end $$;
