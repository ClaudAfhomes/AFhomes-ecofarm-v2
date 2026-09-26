-- CMS contents - Q1/Q2 single table document store
-- Supabase Postgres 15+ - Vercel Functions/REST API → Supabase → PostgreSQL (Q1)
-- Q2: single cms_contents(key, content JSONB, version)
-- Q5: updatedAt/updatedBy only (no revisions for v1)
-- Q4: hybrid images photo-* + marketing-tools preserved
-- Q6: public fallback to static on 404 (app layer)

-- 0) Table - one row per CMS key (8 keys), validated in app via @jad/contracts Zod
create table if not exists public.cms_contents (
  key text primary key check (key in ('homepage','about','properties','faqs','contact','global','login','register')),
  content jsonb not null,
  version integer not null default 1,
  updated_by uuid references public."Member"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at in sync if DB is written directly (app also sets it)
create or replace function public.cms_contents_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cms_contents_updated_at on public.cms_contents;
create trigger cms_contents_updated_at
  before update on public.cms_contents
  for each row execute function public.cms_contents_set_updated_at();

-- 1) RLS - public read (anon + authenticated) for marketing pages; writes via service_role (Vercel Functions with SERVICE_ROLE_KEY, Q3 server-side JWT + admin check in handler)
alter table public.cms_contents enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='cms_contents' and policyname='cms_contents_read_all') then
    create policy cms_contents_read_all on public.cms_contents for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='cms_contents' and policyname='cms_contents_service_all') then
    create policy cms_contents_service_all on public.cms_contents for all to service_role using (true) with check (true);
  end if;
end $$;

-- 2) Index for key already PK; ensure RLS bypass for seed via service_role
