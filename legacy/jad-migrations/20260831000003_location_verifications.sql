-- Location verifications - FEAT-014 / BR-GEO-001..004.
-- BE-authoritative: GPS primary → IP fallback via Vercel header. No external provider invented.
-- PH → DOMESTIC, non-PH → ABROAD is isolated in app BE mapping function (see api/v1/registration/location-verify.ts).
-- No accuracy/anti-spoof/location-exceptions yet (OD-014/015 deferred, BR-GEO-005/006 TBD).

create table if not exists public.location_verifications (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null unique default gen_random_uuid(),
  verified_country_code text not null check (verified_country_code ~ '^[A-Z]{2}$'),
  detected_country_code text check (detected_country_code ~ '^[A-Z]{2}$'),
  program_id text not null,
  program_code text not null check (program_code in ('DOMESTIC','ABROAD')),
  method text not null check (method in ('GPS','IP')),
  is_philippines boolean not null,
  blocked boolean not null default false,
  requires_exception boolean not null default false,
  accuracy double precision,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  ip_country_header text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

-- Index for lookup by verification_id (used at POST /auth/register binding)
create index if not exists location_verifications_verification_id_idx on public.location_verifications (verification_id);
create index if not exists location_verifications_expires_at_idx on public.location_verifications (expires_at);
create index if not exists location_verifications_created_at_idx on public.location_verifications (created_at desc);

-- RLS: service_role only. Public/BE handler uses service_role; anon/authenticated have no direct access.
alter table public.location_verifications enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='location_verifications' and policyname='location_verifications_service_all') then
    create policy location_verifications_service_all on public.location_verifications
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- Cleanup helper: delete expired verifications (optional, not auto-run in MVP; call from handler or cron later)
comment on table public.location_verifications is 'BE-authoritative location verification records for registration (GPS → IP fallback). verification_id is passed through POST /auth/register. PH→DOMESTIC mapping is isolated in api/v1/registration/location-verify.ts.';
