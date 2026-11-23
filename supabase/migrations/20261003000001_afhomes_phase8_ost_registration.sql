-- AF Homes Phase 8 - OST registration and approval foundation.
--
-- Reuses the Phase 1 tables (`referral_codes`, `ost_applications`,
-- `ost_members`) and the Phase 7 genealogy model. No status CHECK is changed:
-- `submitted` is the pending state, `approved` marks an approved application,
-- and `ost_members.status` (active/inactive/suspended) is the seller state.
-- Application status and member status stay conceptually separate.
--
-- Validation before apply (every query must return zero rows):
--   select count(*) from public.ost_applications
--    where status not in ('submitted','under_review','changes_requested','approved','rejected','withdrawn');
--   select lower(email), count(*) from public.ost_applications
--    where status in ('submitted','under_review','changes_requested')
--    group by 1 having count(*) > 1;
--   select count(*) from information_schema.role_table_grants
--    where table_schema='public' and table_name in ('ost_applications','ost_members','referral_codes')
--      and grantee in ('anon','authenticated','PUBLIC')
--      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--
-- Validation after apply (expected):
--   select public.next_ost_number();  -- one row like OST-000001
--   select indexname from pg_indexes where schemaname='public'
--    and indexname='ost_applications_one_reviewable_per_email';  -- one row
--
-- Down (forward-only; this note is documentation, not a script): drop function
-- public.next_ost_number(), drop sequence public.ost_number_seq, and drop the
-- two indexes created below. Application and member rows are never deleted.

-- ---------------------------------------------------------------------------
-- Preflight: the Phase 1 tables this phase builds on must exist.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='ost_applications') then
    raise exception 'PHASE8_PREREQ_MISSING:ost_applications';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='ost_members') then
    raise exception 'PHASE8_PREREQ_MISSING:ost_members';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='referral_codes') then
    raise exception 'PHASE8_PREREQ_MISSING:referral_codes';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='referral_relationships') then
    raise exception 'PHASE8_PREREQ_MISSING:referral_relationships';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OST numbers: sequence-backed, so two concurrent approvals can never
-- collide. The unique constraint on ost_members.ost_number is the backstop.
-- ---------------------------------------------------------------------------
create sequence if not exists public.ost_number_seq;

create or replace function public.next_ost_number()
returns table (ost_number text)
language sql
volatile
as $$
  select 'OST-' || to_char(nextval('public.ost_number_seq'), 'FM000000')
$$;

revoke all on function public.next_ost_number() from public, anon, authenticated;
grant usage on sequence public.ost_number_seq to service_role;
revoke all on sequence public.ost_number_seq from anon, authenticated;

comment on function public.next_ost_number() is
  'Phase 8 OST member numbers. Sequence-backed; ost_members.ost_number unique is the backstop.';

-- ---------------------------------------------------------------------------
-- Duplicate pending protection: one reviewable application per email,
-- case-insensitive. The Phase 1 unique(email, status) blocks an exact second
-- `submitted` row but still allows submitted + under_review for the same
-- person; this partial index closes that gap. Terminal states
-- (approved/rejected/withdrawn) never collide, so a later re-application
-- after a terminal outcome is still possible.
-- ---------------------------------------------------------------------------
create unique index if not exists ost_applications_one_reviewable_per_email
  on public.ost_applications (lower(email))
  where status in ('submitted', 'under_review', 'changes_requested');

-- Live-code lookup per sponsor (SM "my codes" and issuance guard).
create index if not exists referral_codes_sponsor_active_idx
  on public.referral_codes (sponsor_staff_id)
  where is_active;

comment on table public.ost_applications is
  'Phase 8: sponsor is frozen from the referral code at submission and never edited. Corrections use the audited upline path after activation.';
