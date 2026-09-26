-- Voucher uniqueness + redemption lifecycle (admin QR scanning).
--
-- Unique voucher semantics: an admin creates a voucher for a member through
-- POST /admin/vouchers (one-step "Create Voucher"); the handler resolves or
-- creates the VoucherTemplate by natural key (title, originalValue) and issues
-- the voucher against it, so templateId stays NOT NULL and this index becomes
-- the "one voucher per member per type" guard (a 23505 insert conflict is
-- surfaced as 409 CONFLICT to the create UI).
--   Voucher (memberId, templateId) unique  -- one voucher per member per type
--   "redeemedAt" timestamptz, "redeemedBy" uuid → StaffUser(id)
--     -- POST /admin/vouchers/:id/redeem marks the voucher FULLY_REDEEMED and
--     -- sets remainingValue = '0.00' plus these columns in one conditional
--     -- statement; the status CHECK vocabulary is unchanged.
-- Idempotent (guarded backfill + `if not exists`).
--
-- Validation (must hold after apply):
--   select count(*) from "Voucher" v
--    where exists (
--      select 1 from "Voucher" d
--       where d."memberId" = v."memberId" and d."templateId" = v."templateId"
--         and d."createdAt" < v."createdAt");
--     -- 0 rows (duplicates backfilled away)
--   select indexname from pg_indexes
--    where tablename = 'Voucher' and indexname = 'Voucher_member_template_uidx';
--     -- 1 row
--   select column_name from information_schema.columns
--    where table_name = 'Voucher' and column_name in ('redeemedAt', 'redeemedBy');
--     -- 2 rows
-- Down (rollback only):
--   alter table "Voucher" drop column if exists "redeemedBy";
--   alter table "Voucher" drop column if exists "redeemedAt";
--   drop index if exists "Voucher_member_template_uidx";

-- Backfill first: when a member already holds multiple vouchers of one type,
-- keep the earliest issued (the live one); drop the rest before the index.
delete from "Voucher" v
 using "Voucher" d
 where d."memberId" = v."memberId"
   and d."templateId" = v."templateId"
   and d."createdAt" < v."createdAt";

create unique index if not exists "Voucher_member_template_uidx"
  on "Voucher"("memberId", "templateId");

alter table "Voucher" add column if not exists "redeemedAt" timestamp with time zone;
alter table "Voucher" add column if not exists "redeemedBy" uuid references "StaffUser"(id) on delete set null;