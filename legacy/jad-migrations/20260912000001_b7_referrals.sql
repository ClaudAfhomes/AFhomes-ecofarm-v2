-- B7 cutover (Phase B7): member sponsor linkage for referrals/reporting.
-- Idempotent. Service_role-only RLS, like every other proxied table.

alter table "Member" add column if not exists "sponsorId" uuid references "Member"(id) on delete set null;
create index if not exists "Member_sponsor_idx" on "Member"("sponsorId");
