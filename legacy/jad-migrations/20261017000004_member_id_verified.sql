-- Persist government-ID verification on Member (qualification 100% fix).
--
-- `governmentId` lives only on the Registration row, which approval deletes
-- (approve.ts) without copying any ID flag onto Member. GET /me/qualification
-- computes ID_VERIFIED from that deleted row, so it is permanently false for
-- every approved member - the status page shows 4/5 = 80% with "Government ID
-- verified" missing even though the ID was provided and manually verified.
--
-- Approval IS the manual ID gate (the application carried the required
-- government ID per BR-REG-003), so a persistent `idVerified` flag on Member
-- is the authoritative record. Backfill: every APPROVED_ACTIVE member passed
-- the gate, so they are marked verified. Resubmit (member returns to PENDING)
-- clears it via the API (mirrors the mock's isIdVerified reset).
--
-- Pre-apply validation (run first; informational):
--   select status, count(*) from "Member" group by status;
-- Post-apply: every APPROVED_ACTIVE member must be idVerified:
--   select count(*) from "Member"
--   where status = 'APPROVED_ACTIVE' and coalesce("idVerified", false) = false;
--   -- expect 0.
--
-- Down: alter table "Member" drop column if exists "idVerified";

alter table "Member" add column if not exists "idVerified" boolean not null default false;

update "Member" set "idVerified" = true
where status = 'APPROVED_ACTIVE' and coalesce("idVerified", false) = false;