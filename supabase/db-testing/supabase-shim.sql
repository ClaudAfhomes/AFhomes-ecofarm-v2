-- ===========================================================================
-- TEST-ENVIRONMENT SHIM - Supabase platform objects. NEVER APPLY TO SUPABASE.
-- ===========================================================================
-- The AF Homes migrations assume objects that the Supabase platform provides
-- out of the box and that no migration creates:
--
--   * the `anon`, `authenticated` and `service_role` database roles
--   * the `auth` schema, `auth.users` and the `auth.uid()` request helper
--   * the `storage` schema with `storage.buckets` and `storage.objects`
--
-- This file reproduces the minimum surface those migrations touch, so the same
-- unmodified SQL can be applied to a disposable local PostgreSQL and validated
-- for real. It exists ONLY for `pnpm test:db` / `pnpm test:db:local` and is
-- never part of `pnpm db:migrate`.
--
-- `auth.uid()` mirrors the Supabase/PostgREST contract exactly: it reads the
-- verified request claim, never anything the caller can set as a plain session
-- variable. Setting `request.jwt.claim.sub` with `set_config(..., true)` is
-- scoped to the current transaction, which is how the harness impersonates a
-- principal and therefore how the RLS tests are meaningful.
--
-- Deliberately NOT modelled: GoTrue's full user lifecycle, JWT signing, and
-- storage object delivery. This pass validates schema, constraints, functions,
-- RLS and financial arithmetic; it does not validate authentication.

-- Supabase exposes pgcrypto under BOTH names: the `extensions` schema (which the
-- migrations put on their search_path, and which newer SQL calls qualified) and
-- the default `public` schema that older unqualified calls resolve against.
-- Reproducing only one of the two breaks migrations that predate the other, so
-- both are provided here.
create extension if not exists pgcrypto;
create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'digest'
  ) then
    execute 'create function extensions.digest(bytea, text) returns bytea'
      ' language sql immutable strict as $f$ select public.digest($1, $2) $f$';
    execute 'create function extensions.digest(text, text) returns bytea'
      ' language sql immutable strict as $f$ select public.digest($1::bytea, $2) $f$';
  end if;
end $$;

-- Platform roles. NOLOGIN: these are switched into with SET ROLE, never logged
-- into directly, exactly as on Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Supabase's request-scoped helpers. `missing_ok = true` so the function is
-- usable outside a request context (it then returns NULL).
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim', true), '')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

-- RLS policies run as the QUERYING role, so a policy that calls `auth.uid()`
-- needs the querying role to be able to resolve the function at all. That
-- requires USAGE on the schema, which Supabase grants to anon, authenticated
-- and service_role on every project. Without this the customer self-read
-- policies cannot be exercised at all.
--
-- USAGE only, deliberately. Supabase also grants SELECT on `auth.users` by
-- default; the AF Homes application never reads it from a browser role (the
-- customer principal is resolved server-side with the service role), so the shim
-- does not model that platform default. Modelling it here would let a test pass
-- against the shim and then behave differently on a real project. See the
-- `auth.users` note in AGENTS.md.
grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
