-- Sale referrer name snapshot.
--
-- The member sale submission form lets the seller attribute a customer to a
-- referrer - chosen from the seller's 1st-level genealogy (direct referrals)
-- or typed free-form ("Add a new name"). The value is stored as an optional
-- informational text snapshot on the Sale row; it has NO commission effect
-- (BR-REF-001/002 keep the Direct Referral commission on the seller's
-- sponsor). Members are never created from this field.
-- Down: alter table "Sale" drop column "referrerName";

alter table "Sale" add column if not exists "referrerName" text;