-- Account-status vocabulary correction (follow-up to 20260917).
--
-- Member.accountStatus carries two documented vocabularies on one column:
-- members use ACTIVE/INACTIVE (accountStatusSchema) while staff rows use
-- ACTIVE/DISABLED (staffStatusSchema, stored on the same column). The 2A
-- CHECK only allowed the member pair, which wrongly rejects seeded Disabled
-- staff (e.g. stf-005 Leo Tan) - the constraint itself surfaced this during
-- seeding. Widen to the union; garbage is still rejected.
-- Idempotent. Down: restore the two-value check.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_account_status_check') THEN
    ALTER TABLE "Member" DROP CONSTRAINT member_account_status_check;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_account_status_check') THEN
    ALTER TABLE "Member" ADD CONSTRAINT member_account_status_check
      CHECK ("accountStatus" IN ('ACTIVE','INACTIVE','DISABLED'));
  END IF;
END $$;
