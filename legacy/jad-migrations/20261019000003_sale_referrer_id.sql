-- Sale referrer as a real member (referrerId).
--
-- Prior: `Sale.referrerName` was a free-text snapshot ("The member who
-- referred this customer") with no commission effect (BR-REF-001/002).
-- New: the member-selected referrer (from the seller's direct referrals)
-- receives the 4% DIRECT_REFERRAL commission when the sale qualifies.
-- Free-text referrers are disallowed in the UI; only real members can be
-- paid. When no referrer is selected, no referral commission is issued.
--
-- This adds `Sale.referrerId uuid` (nullable, no FK to keep
-- `member_purge_cascade` safe) and best-effort backfills existing
-- `referrerName` rows by matching the name to a direct referral of the
-- seller (Member.sponsorId = Sale.sellerId). Already-qualified sales keep
-- their sponsor-paid referral commissions as-is.
--
-- Pre-apply validation (run first):
--   select count(*) from "Sale" where "referrerName" is not null and "referrerId" is null;
--
-- Down: alter table "Sale" drop column if exists "referrerId";

alter table "Sale" add column if not exists "referrerId" uuid;

-- Best-effort backfill: match referrerName to a direct referral of the seller
-- by full name (firstName + ' ' + lastName, or legacy name column). Only
-- where a unique match exists; free-text / no-match rows stay null.
update "Sale" s
set "referrerId" = m.id
from "Member" m
where s."referrerId" is null
  and s."referrerName" is not null
  and m."sponsorId" = s."sellerId"
  and (
    lower(trim(m."firstName" || ' ' || coalesce(m."lastName",''))) = lower(trim(s."referrerName"))
    or lower(trim(coalesce(m."name",''))) = lower(trim(s."referrerName"))
  )
  and not exists (
    -- only unique matches
    select 1 from "Member" m2
    where m2."sponsorId" = s."sellerId"
      and m2.id <> m.id
      and (
        lower(trim(m2."firstName" || ' ' || coalesce(m2."lastName",''))) = lower(trim(s."referrerName"))
        or lower(trim(coalesce(m2."name",''))) = lower(trim(s."referrerName"))
      )
  );
