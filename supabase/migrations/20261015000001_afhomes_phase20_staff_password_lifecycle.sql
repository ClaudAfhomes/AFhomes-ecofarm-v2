-- ===========================================================================
-- Phase 20 (JAD parity Phase 1): staff temporary-password lifecycle.
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- AF Homes onboarded staff exclusively through Supabase Auth invitations
-- (`staff_users.status = 'invited'` + `staff_invitations` + invite-callback
-- activation). JAD instead creates the Auth identity server-side with a
-- temporary password (`auth.admin.createUser`) and forces the new staff
-- member through a first-login password change (`mustChangePassword`).
--
-- This migration adds the minimal equivalent state to `staff_users`:
--
--   * `must_change_password` - true while the account still runs on the
--     administrator-set temporary password; cleared by the password-change
--     endpoint after verifying the current password.
--   * `password_changed_at` - when the flag was last cleared (audit support;
--     nullable, never backfilled).
--
-- The change is ADDITIVE and idempotent:
--
--   * two new columns, both `IF NOT EXISTS`; existing rows read back
--     `must_change_password = false`, so every pre-existing account keeps
--     its current standing (invited/active/inactive/suspended) unchanged;
--   * no CHECK change, no RLS change, no grant change (the existing
--     table-wide SELECT grant on `staff_users` covers the new columns, and
--     the existing SELECT policies already scope which ROWS a caller sees);
--   * no write to any historical record or snapshot.
--
-- The temporary password itself is NEVER stored in any AF Homes table - it
-- lives in Supabase Auth only, passed through `auth.admin.createUser` /
-- `auth.admin.updateUserById` from the server. These columns record only
-- whether a change is still required, never any secret.
--
-- VALIDATION (run on a real PostgreSQL; `pnpm test:db:local` proves it):
--
--   1. select column_name, data_type, is_nullable, column_default
--        from information_schema.columns
--        where table_schema = 'public' and table_name = 'staff_users'
--          and column_name in ('must_change_password', 'password_changed_at')
--        order by column_name;
--        -- must_change_password:boolean/NO/false,
--        -- password_changed_at:timestamp with time zone/YES/null
--   2. select count(*) from public.staff_users
--        where must_change_password is null;                       -- zero rows
--   3. RLS invariants: supabase/security/rls_invariants.sql returns empty.
--
-- DOWN (operator-only, forward-only note, not a script): dropping
-- `must_change_password` destroys the forced-change state (accounts on a
-- temporary password would no longer be gated); dropping
-- `password_changed_at` destroys audit history. Re-adding the columns
-- defaults every row to `false`/NULL, which is NOT the pre-drop state.
--
--   alter table public.staff_users drop column must_change_password;
--   alter table public.staff_users drop column password_changed_at;

-- 1. Forced-change flag. NOT NULL with a false default: existing rows adopt
-- `false` on add, so no account is newly gated by the migration itself.
alter table public.staff_users
  add column if not exists must_change_password boolean not null default false;

comment on column public.staff_users.must_change_password is
'True while the account still runs on an administrator-set temporary password. Cleared only by the password-change endpoint after verifying the current password. The password itself lives in Supabase Auth and is never stored here.';

-- 2. Last rotation timestamp. Nullable, no default, never backfilled: NULL
-- means "no forced-change rotation recorded since this column existed".
alter table public.staff_users
  add column if not exists password_changed_at timestamptz;

comment on column public.staff_users.password_changed_at is
'When must_change_password was last cleared by the password-change endpoint. NULL means no recorded rotation. Audit support only; never gates access.';
