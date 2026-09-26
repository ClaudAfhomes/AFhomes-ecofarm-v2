-- Registration lifecycle: PENDING | REJECTED only (owner-approved).
--
-- Approval moves the application to the Member domain and deletes the
-- Registration row (see approve handler) - APPROVED_ACTIVE lives on Member,
-- never in Registration. Legacy APPROVED_ACTIVE rows (incl. ones orphaned by
-- pre-fix purges, whose members are gone) are removed here so they can no
-- longer resurface in the queue or block re-registration via the B8 email
-- unique index. Member rows are untouched.
--
-- Validation (must hold after apply):
--   select count(*) = 0 from "Registration" where status = 'APPROVED_ACTIVE';
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'registration_status_check';
--     -- must read: CHECK (status = ANY (ARRAY['PENDING', 'REJECTED']))
-- Idempotent (guarded deletes + constraint swap are re-runnable).
-- Down (rollback only):
--   alter table "Registration" drop constraint if exists registration_status_check;
--   alter table "Registration" add constraint registration_status_check
--     check (status in ('PENDING','APPROVED_ACTIVE','REJECTED'));
--   (deleted APPROVED_ACTIVE rows are NOT restored - re-register if needed.)

-- Backfill first: remove every consumed application (member owns identity).
delete from "Registration" where status = 'APPROVED_ACTIVE';

-- Narrow the vocabulary AFTER the backfill.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_status_check') THEN
    alter table "Registration" drop constraint registration_status_check;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_status_check') THEN
    alter table "Registration" add constraint registration_status_check check (status in ('PENDING','REJECTED'));
  END IF;
END $$;
