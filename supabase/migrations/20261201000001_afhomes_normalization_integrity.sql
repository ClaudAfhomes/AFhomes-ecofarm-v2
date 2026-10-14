-- Forward-only integrity normalization; ordered after the AA migration.
-- Preflight: commission rule targets must exist; never guess replacement owners.
-- Validate: all three target FKs and canonical email checks must be validated.
-- Run rls_invariants.sql after an authorized apply.
-- Recovery: roll back a failed transaction; after commit retain constraints and
-- fix incompatible callers forward. No history, account or financial rewrites.
begin;

do $$
begin
  if exists (
    select 1 from public.commission_rules r
    where (r.target_type='role' and not exists(select 1 from public.roles x where x.id=r.target_id))
       or (r.target_type='staff' and not exists(select 1 from public.staff_users x where x.id=r.target_id))
       or (r.target_type='ost' and not exists(select 1 from public.ost_members x where x.id=r.target_id))
  ) then
    raise exception 'NORMALIZATION_BLOCKED_ORPHAN_COMMISSION_TARGETS' using errcode='23503';
  end if;
end $$;

-- Keep the existing API vocabulary; generated keys cannot disagree with target_id.
-- Real FKs protect against concurrent target deletion, unlike an API precheck.
alter table public.commission_rules
  add column if not exists target_role_id uuid generated always as
    (case when target_type='role' then target_id end) stored,
  add column if not exists target_staff_id uuid generated always as
    (case when target_type='staff' then target_id end) stored,
  add column if not exists target_ost_id uuid generated always as
    (case when target_type='ost' then target_id end) stored;

do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.commission_rules'::regclass and conname='commission_rules_target_role_fk') then
    alter table public.commission_rules add constraint commission_rules_target_role_fk
      foreign key(target_role_id) references public.roles(id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.commission_rules'::regclass and conname='commission_rules_target_staff_fk') then
    alter table public.commission_rules add constraint commission_rules_target_staff_fk
      foreign key(target_staff_id) references public.staff_users(id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.commission_rules'::regclass and conname='commission_rules_target_ost_fk') then
    alter table public.commission_rules add constraint commission_rules_target_ost_fk
      foreign key(target_ost_id) references public.ost_members(id) on delete restrict;
  end if;
end $$;

-- The API already lowercases/trims emails. Enforce that storage convention
-- without rewriting names, approved identities, document snapshots or history.
do $$
declare relation text;
begin
  foreach relation in array array['staff_users','customers','ost_members'] loop
    if not exists(select 1 from pg_constraint
      where conrelid=format('public.%I',relation)::regclass and conname=relation||'_email_canonical') then
      execute format('alter table public.%I add constraint %I check(email=lower(btrim(email)))',
        relation,relation||'_email_canonical');
    end if;
  end loop;
end $$;
commit;
