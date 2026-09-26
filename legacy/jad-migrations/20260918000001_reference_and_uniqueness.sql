-- Phase 2B - Referral uniqueness & reference FKs (review F-09 / F-10 / F-17).
--
-- Note: Withdrawal.payoutAccountId is intentionally left FK-less - seeded
-- rows reference BOTH PayoutAccount (admin queue: wdr-004..006 → pac-*) and
-- MemberPayoutAccount (member: wdr-001..003 → pa-*) ids. A correct FK is only
-- possible after the Phase-5 payout-model unification (owner decision D2).
--
-- Pre-apply validation:
--   select referralCode, count(*) from "Member" group by referralCode
--     having count(*) > 1 and referralCode is not null and referralCode <> '';
--   select id from "Registration" r left join "Program" p on r."programId"=p.id
--     where r."programId" is not null and p.id is null;
--   select id from "Member" m left join "Program" p on m."programId"=p.id
--     where m."programId" is not null and p.id is null;
--   select distinct "reviewedBy" from "Registration" rv left join "Member" m
--     on m.id = rv."reviewedBy" where rv."reviewedBy" is not null and m.id is null;
-- Down: drop each constraint/index by name.

-- Unique referral codes (empty-string rows excluded so the '' default never
-- collides; the app generates codes that are non-empty and unique). Column is
-- quoted camelCase - an unquoted reference folds to lowercase and errors.
create unique index if not exists "Member_referralCode_uidx" on "Member"("referralCode")
  where "referralCode" is not null and "referralCode" <> '';

-- Program references (nullable - legacy rows may predate a program).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_program_fkey') THEN
    alter table "Registration" add constraint registration_program_fkey
      foreign key ("programId") references "Program"(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_program_fkey') THEN
    alter table "Member" add constraint member_program_fkey
      foreign key ("programId") references "Program"(id);
  END IF;
END $$;

-- Reviewer / assigner attribution survives nothing but must not orphan rows.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_reviewed_by_fkey') THEN
    alter table "Registration" add constraint registration_reviewed_by_fkey
      foreign key ("reviewedBy") references "Member"(id) on delete set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberrole_assigned_by_fkey') THEN
    alter table "MemberRole" add constraint memberrole_assigned_by_fkey
      foreign key ("assignedBy") references "Member"(id) on delete set null;
  END IF;
END $$;
