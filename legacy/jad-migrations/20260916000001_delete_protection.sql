-- Phase 1B - Financial deletion protection (Database review F-04).
--
-- Member.id references auth.users ON DELETE CASCADE, and the financial / CRM
-- tables below cascade to Member. Combined with the admin "Delete member
-- permanently" flow, one delete wiped Wallet, LedgerEntry, Commission,
-- MemberPayoutAccount, Sale, and Customer history - violating BR-LED / BI-005
-- (immutable ledger; deactivate, never delete).
--
-- Fix: money/CRM links become ON DELETE RESTRICT so a member with any
-- financial or sales history cannot be hard-deleted (archive is the only
-- sanctioned lifecycle). Nullable membership links already use SET NULL and
-- are left unchanged. AuditLog.actor_id stays NO ACTION (it already blocks
-- deletion of anyone who performed audited actions).
-- Idempotent per constraint (dropped then re-added with an explicit name).
-- Down: re-add each as the original cascade FK.

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'LedgerEntry_memberId_fkey') then
    alter table "LedgerEntry" drop constraint "LedgerEntry_memberId_fkey";
  end if;
  alter table "LedgerEntry" add constraint "LedgerEntry_memberId_fkey"
    foreign key ("memberId") references "Member"(id) on delete restrict;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'Commission_memberId_fkey') then
    alter table "Commission" drop constraint "Commission_memberId_fkey";
  end if;
  alter table "Commission" add constraint "Commission_memberId_fkey"
    foreign key ("memberId") references "Member"(id) on delete restrict;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'MemberPayoutAccount_memberId_fkey') then
    alter table "MemberPayoutAccount" drop constraint "MemberPayoutAccount_memberId_fkey";
  end if;
  alter table "MemberPayoutAccount" add constraint "MemberPayoutAccount_memberId_fkey"
    foreign key ("memberId") references "Member"(id) on delete restrict;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'Wallet_memberId_fkey') then
    alter table "Wallet" drop constraint "Wallet_memberId_fkey";
  end if;
  alter table "Wallet" add constraint "Wallet_memberId_fkey"
    foreign key ("memberId") references "Member"(id) on delete restrict;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'Sale_sellerId_fkey') then
    alter table "Sale" drop constraint "Sale_sellerId_fkey";
  end if;
  alter table "Sale" add constraint "Sale_sellerId_fkey"
    foreign key ("sellerId") references "Member"(id) on delete restrict;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'Customer_memberId_fkey') then
    alter table "Customer" drop constraint "Customer_memberId_fkey";
  end if;
  alter table "Customer" add constraint "Customer_memberId_fkey"
    foreign key ("memberId") references "Member"(id) on delete restrict;
end $$;
