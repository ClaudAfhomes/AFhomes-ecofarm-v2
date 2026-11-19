-- AF Homes Phase 10 - membership card issuance/print state.
--
-- The credential model is UNCHANGED: only SHA-256 hashes of the QR token and
-- the fallback code are stored (Phase 3), plaintext is returned exactly once
-- at issuance/rotation, and rotation stays the only way to produce displayable
-- codes. This migration adds four informational columns so the card workflow
-- can report issuance and print history. No credential is regenerated, no
-- historical row is rewritten, and no secret is migrated.
--
-- Validation before apply (every query must return zero rows):
--   select count(*) from public.memberships
--    where card_issued_at is not null and card_issued_at <> activated_at;
--   select count(*) from public.memberships where print_count <> 0;
--   select count(*) from information_schema.role_table_grants
--    where table_schema='public' and table_name='memberships'
--      and grantee in ('anon','authenticated','PUBLIC')
--      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--
-- Validation after apply (expected):
--   select count(*) from public.memberships where card_issued_at is null;  -- 0
--   select count(*) from public.memberships where print_count <> 0;        -- 0
--
-- Down (forward-only; this note is documentation, not a script): drop the four
-- columns. Membership, credential and points history are unaffected.

-- ---------------------------------------------------------------------------
-- Preflight: the memberships table this phase builds on must exist.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='memberships') then
    raise exception 'PHASE10_PREREQ_MISSING:memberships';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Card issuance/print state. Informational only: printing a card never rotates
-- credentials, and rotating credentials never touches these columns except
-- through the explicit mark-printed call. No expiry, no fee, no courier state.
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column if not exists card_issued_at timestamptz,
  add column if not exists card_issued_by uuid references public.staff_users(id) on delete set null,
  add column if not exists last_printed_at timestamptz,
  add column if not exists print_count integer not null default 0
    check (print_count >= 0);

-- First issuance coincides with activation for every existing card. The issuer
-- is unknown historically and stays NULL rather than inventing one.
update public.memberships
set card_issued_at = activated_at
where card_issued_at is null;

comment on column public.memberships.card_issued_at is
  'Phase 10: when the current credential pair was first issued (activation). Rotation issues new codes; only an explicit reprint records a print.';
comment on column public.memberships.card_issued_by is
  'Phase 10: staff actor that activated the membership. NULL for pre-Phase-10 cards.';
comment on column public.memberships.last_printed_at is
  'Phase 10: last explicit mark-printed call. Printing never rotates credentials.';
comment on column public.memberships.print_count is
  'Phase 10: explicit mark-printed calls. A reprint is a new print, not a reissue.';

-- Browser column grants are deliberately NOT extended: the portal reads
-- through the service-role API, and direct PostgREST access keeps least
-- privilege. No new policy, no new privilege, no new module.
