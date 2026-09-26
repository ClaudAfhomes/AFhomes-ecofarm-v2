-- Reference data for Phase B1: programs, system config, policies.
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING). Public reads for
-- programs/policies (anon + authenticated SELECT, mirroring countries/CMS);
-- SystemConfig is service_role-only - the public subset is served exclusively
-- through GET /api/v1/config/public so sensitive values (commission rates)
-- are never directly readable.

create table if not exists "Program" (
  id text primary key,
  code text unique not null,
  name text not null,
  description text,
  "createdAt" timestamp with time zone not null default now()
);

create table if not exists "ProgramQuestion" (
  id text primary key,
  "programId" text not null references "Program"(id) on delete cascade,
  "questionText" text not null,
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "ProgramQuestion_program_idx" on "ProgramQuestion"("programId");

create table if not exists "SystemConfig" (
  key text primary key,
  label text not null,
  value text not null,
  category text not null,
  updated_by uuid references "Member"(id) on delete set null,
  updated_at timestamp with time zone not null default now()
);

create table if not exists "Policy" (
  id text primary key,
  type text not null,
  title text not null,
  content text,
  updated_at timestamp with time zone not null default now()
);

alter table "Program" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Program' and policyname='program_public_read') then
    create policy program_public_read on "Program" for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='Program' and policyname='program_service_role_all') then
    create policy program_service_role_all on "Program" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "ProgramQuestion" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ProgramQuestion' and policyname='programquestion_public_read') then
    create policy programquestion_public_read on "ProgramQuestion" for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='ProgramQuestion' and policyname='programquestion_service_role_all') then
    create policy programquestion_service_role_all on "ProgramQuestion" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "SystemConfig" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='SystemConfig' and policyname='systemconfig_service_role_all') then
    create policy systemconfig_service_role_all on "SystemConfig" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Policy" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Policy' and policyname='policy_public_read') then
    create policy policy_public_read on "Policy" for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='Policy' and policyname='policy_service_role_all') then
    create policy policy_service_role_all on "Policy" for all to service_role using (true) with check (true);
  end if;
end $$;
