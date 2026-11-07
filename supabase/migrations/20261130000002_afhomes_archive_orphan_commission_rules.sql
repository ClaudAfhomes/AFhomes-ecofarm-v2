-- Exact archival repair for two reviewed orphan rules; apply only after approval.
-- Order: AA migration -> this repair -> normalization_integrity.
-- Validate: two preserved snapshots/hashes, two audit events, zero source rows;
-- no browser/service ACLs; immutable archive; all protected business rows unchanged.
-- Empty fresh installations are a no-op. A populated shared target must pass
-- the separately reviewed two-row/hash/history preflight before execution.
-- Recovery: transaction rollback on error. After commit retain the archive/audit;
-- restore only through a later approved repair with a verified valid owner.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.commission_rules in share row exclusive mode;

create table if not exists private.commission_rule_archive (
  rule_id uuid primary key,
  rule_snapshot jsonb not null check(jsonb_typeof(rule_snapshot)='object'),
  snapshot_sha256 text not null check(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  archived_at timestamptz not null default now(),
  reason text not null,
  migration_version text not null,
  check(rule_snapshot->>'id'=rule_id::text),
  check(snapshot_sha256=encode(sha256(convert_to(rule_snapshot::text,'UTF8')),'hex'))
);
alter table private.commission_rule_archive enable row level security;
revoke all on private.commission_rule_archive from public,anon,authenticated,service_role;

create or replace function private.reject_commission_archive_mutation() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  raise exception 'COMMISSION_ARCHIVE_IMMUTABLE' using errcode='42501';
end $$;
revoke all on function private.reject_commission_archive_mutation() from public,anon,authenticated,service_role;
drop trigger if exists commission_archive_immutable on private.commission_rule_archive;
create trigger commission_archive_immutable before update or delete on private.commission_rule_archive
  for each row execute function private.reject_commission_archive_mutation();
drop trigger if exists commission_archive_no_truncate on private.commission_rule_archive;
create trigger commission_archive_no_truncate before truncate on private.commission_rule_archive
  for each statement execute function private.reject_commission_archive_mutation();

do $$
declare
  ids uuid[] := array['01d28c04-b31c-48e5-be11-b1ec7db35cd5'::uuid,'9a7640d8-4b93-44ed-aa47-f93ecbce2db1'::uuid];
  hashes text[] := array['23c969c31b18b7d959cf784dc215c970840c0a26fa595a58ddd1fb55dfe6a6e8','1d445cf3fcacb87ee3bc30377c46618f5a75acd793f520449419c1b88c622e5b'];
  i integer; r public.commission_rules%rowtype; snapshot jsonb; archive private.commission_rule_archive%rowtype;
  reason text := 'Reviewed orphan staff-target rule; no financial dependencies; preserve original values before integrity normalization.';
begin
  -- The allowlist never becomes a generic orphan cleanup operation.
  if exists(select 1 from public.commission_rules c where not (c.id=any(ids)) and (
       (c.target_type='role' and not exists(select 1 from public.roles x where x.id=c.target_id))
    or (c.target_type='staff' and not exists(select 1 from public.staff_users x where x.id=c.target_id))
    or (c.target_type='ost' and not exists(select 1 from public.ost_members x where x.id=c.target_id)))) then
    raise exception 'ARCHIVE_BLOCKED_UNREVIEWED_ORPHAN';
  end if;
  if not exists(select 1 from public.commission_rules) and not exists(select 1 from private.commission_rule_archive) then
    return; -- Fresh disposable/rebuild schema, not permission to skip shared preflight.
  end if;
  for i in 1..cardinality(ids) loop
    select * into r from public.commission_rules where id=ids[i] for update;
    if not found then
      select * into archive from private.commission_rule_archive where rule_id=ids[i];
      if not found or archive.snapshot_sha256<>hashes[i] or archive.migration_version<>'20261130000002' then
        raise exception 'ARCHIVE_BLOCKED_MISSING_OR_CHANGED_RULE';
      end if;
      if (select count(*) from public.audit_events where action='COMMISSION_RULE_ARCHIVED'
          and entity_type='commission_rule' and entity_id=ids[i]::text
          and request_id='migration:20261130000002:'||ids[i]::text)<>1 then
        raise exception 'ARCHIVE_BLOCKED_MISSING_AUDIT';
      end if;
      continue;
    end if;
    snapshot:=to_jsonb(r);
    if encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')<>hashes[i]
       or r.target_type<>'staff'
       or exists(select 1 from public.staff_users where id=r.target_id)
       or (r.is_active and (r.effective_until is null or r.effective_until>=date '2026-10-14'))
       or exists(select 1 from private.commission_rule_archive where rule_id=r.id) then
      raise exception 'ARCHIVE_BLOCKED_CHANGED_OR_ELIGIBLE_RULE';
    end if;
    if exists(select 1 from public.card_sales where commission_rule_id=r.id)
       or exists(select 1 from public.commissions where commission_rule_id=r.id)
       or exists(select 1 from public.customer_application_purchase_terms where commission_rule_id=r.id)
       or exists(select 1 from public.reservation_agreements where commission_rule_id=r.id) then
      raise exception 'ARCHIVE_BLOCKED_FINANCIAL_DEPENDENCY';
    end if;
    insert into private.commission_rule_archive(rule_id,rule_snapshot,snapshot_sha256,reason,migration_version)
      values(r.id,snapshot,hashes[i],reason,'20261130000002');
    insert into public.audit_events(actor_id,action,entity_type,entity_id,reason,before_data,after_data,request_id)
      values(null,'COMMISSION_RULE_ARCHIVED','commission_rule',r.id::text,reason,snapshot,
        jsonb_build_object('archiveSchema','private','archiveTable','commission_rule_archive','snapshotSha256',hashes[i]),
        'migration:20261130000002:'||r.id::text);
    delete from public.commission_rules where id=r.id;
  end loop;
end $$;
commit;
