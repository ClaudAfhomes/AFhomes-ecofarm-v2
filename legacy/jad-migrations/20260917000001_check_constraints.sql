-- Phase 2A - Vocabulary & money-format CHECK constraints (review F-05 / F-06).
--
-- Statuses, entry types, directions, and content kinds were bare text enforced
-- only at the Zod API edge. Money/rates were unconstrained text. These CHECKs
-- make the DB reject out-of-vocabulary states and malformed exact-decimal
-- strings (they also forbid negatives, so non-negative balance invariants are
-- DB-enforced for free).
--
-- Pre-apply validation (run first; fix offenders before applying):
--   select 'Member.status',   count(*) from "Member"        where status not in ('PENDING','APPROVED_ACTIVE','REJECTED')
--   union all select 'Member.accountStatus', count(*) from "Member" where accountStatus not in ('ACTIVE','INACTIVE')
--   union all select 'Registration.status', count(*) from "Registration" where status not in ('PENDING','APPROVED_ACTIVE','REJECTED')
--   union all select 'Sale.status', count(*) from "Sale" where status not in ('SUBMITTED','ADMIN_APPROVED','PAYMENT_VERIFIED','QUALIFYING_SALE','REJECTED','LOCKED')
--   union all select 'Property.status', count(*) from "Property" where status not in ('ACTIVE','INACTIVE')
--   union all select 'Voucher.status', count(*) from "Voucher" where status not in ('ACTIVE','FULLY_REDEEMED')
--   union all select 'PayoutAccount.status', count(*) from "PayoutAccount" where status not in ('PENDING','ADMIN_REVIEW','CONFIRMED','REJECTED')
--   union all select 'MemberPayoutAccount.status', count(*) from "MemberPayoutAccount" where status not in ('PENDING','ADMIN_REVIEW','CONFIRMED','REJECTED')
--   (legacy table; dropped by the 20260924 payout unification - skip if absent)
--   union all select 'Withdrawal.status', count(*) from "Withdrawal" where status not in ('REQUESTED','RESERVED','COMPLETED','REJECTED')
--   union all select 'Commission.status', count(*) from "Commission" where status not in ('PENDING','AVAILABLE','CANCELLED','REVERSED')
--   union all select 'ContentItem.kind', count(*) from "ContentItem" where kind not in ('DOCUMENT','IMAGE','VIDEO','PROMO')
--   and the same non-list money/rate scans (e.g. amount !~ '^[0-9]+(\.[0-9]{1,2})?$').
-- Idempotent guard on every constraint name. Down: drop each named constraint.

-- ── Status vocabularies ────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_status_check') THEN
    alter table "Member" add constraint member_status_check check (status in ('PENDING','APPROVED_ACTIVE','REJECTED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_account_status_check') THEN
    alter table "Member" add constraint member_account_status_check check ("accountStatus" in ('ACTIVE','INACTIVE'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registration_status_check') THEN
    alter table "Registration" add constraint registration_status_check check (status in ('PENDING','APPROVED_ACTIVE','REJECTED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_status_check') THEN
    alter table "Sale" add constraint sale_status_check check (status in ('SUBMITTED','ADMIN_APPROVED','PAYMENT_VERIFIED','QUALIFYING_SALE','REJECTED','LOCKED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_status_check') THEN
    alter table "Property" add constraint property_status_check check (status in ('ACTIVE','INACTIVE'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_status_check') THEN
    alter table "Voucher" add constraint voucher_status_check check (status in ('ACTIVE','FULLY_REDEEMED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payoutaccount_status_check') THEN
    alter table "PayoutAccount" add constraint payoutaccount_status_check check (status in ('PENDING','ADMIN_REVIEW','CONFIRMED','REJECTED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payoutaccount_method_check') THEN
    alter table "PayoutAccount" add constraint payoutaccount_method_check check (method in ('TRADITIONAL_BANK','DIGITAL_BANK','GCASH','OTHER'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberpayoutaccount_status_check') THEN
    alter table "MemberPayoutAccount" add constraint memberpayoutaccount_status_check check (status in ('PENDING','ADMIN_REVIEW','CONFIRMED','REJECTED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberpayoutaccount_method_check') THEN
    alter table "MemberPayoutAccount" add constraint memberpayoutaccount_method_check check (method in ('TRADITIONAL_BANK','DIGITAL_BANK','GCASH','OTHER'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdrawal_status_check') THEN
    alter table "Withdrawal" add constraint withdrawal_status_check check (status in ('REQUESTED','RESERVED','COMPLETED','REJECTED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_status_check') THEN
    alter table "Commission" add constraint commission_status_check check (status in ('PENDING','AVAILABLE','CANCELLED','REVERSED'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_type_check') THEN
    alter table "Commission" add constraint commission_type_check check ("commissionType" in ('DIRECT_COMMISSION','DIRECT_REFERRAL','GROUP_INCENTIVE'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adjustment_entry_type_check') THEN
    alter table "Adjustment" add constraint adjustment_entry_type_check check ("entryType" in ('FINANCIAL_ADJUSTMENT','COMMISSION_REVERSAL','WITHDRAWAL_REVERSAL'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adjustment_direction_check') THEN
    alter table "Adjustment" add constraint adjustment_direction_check check (direction in ('CREDIT','DEBIT'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entry_type_check') THEN
    alter table "LedgerEntry" add constraint ledger_entry_type_check check ("entryType" in ('DIRECT_COMMISSION','DIRECT_REFERRAL','GROUP_INCENTIVE','WITHDRAWAL','WITHDRAWAL_RESERVATION','WITHDRAWAL_COMPLETION','WITHDRAWAL_REVERSAL','COMMISSION_REVERSAL','FINANCIAL_ADJUSTMENT'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_direction_check') THEN
    alter table "LedgerEntry" add constraint ledger_direction_check check (direction in ('CREDIT','DEBIT'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contentitem_kind_check') THEN
    alter table "ContentItem" add constraint contentitem_kind_check check (kind in ('DOCUMENT','IMAGE','VIDEO','PROMO'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_pending_check') THEN
    alter table "Wallet" add constraint wallet_pending_check check ("pendingAmount" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_withdrawals_check') THEN
    alter table "Wallet" add constraint wallet_withdrawals_check check ("totalWithdrawals" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_earned_check') THEN
    alter table "Wallet" add constraint wallet_earned_check check ("totalEarned" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_amount_check') THEN
    alter table "LedgerEntry" add constraint ledger_amount_check check (amount ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_base_check') THEN
    alter table "Commission" add constraint commission_base_check check ("baseValue" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rate_check') THEN
    alter table "Commission" add constraint commission_rate_check check (rate ~ '^[0-9]+(\.[0-9]{1,4})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_amount_check') THEN
    alter table "Commission" add constraint commission_amount_check check (amount ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_original_check') THEN
    alter table "Voucher" add constraint voucher_original_check check ("originalValue" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_remaining_check') THEN
    alter table "Voucher" add constraint voucher_remaining_check check ("remainingValue" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchertemplate_original_check') THEN
    alter table "VoucherTemplate" add constraint vouchertemplate_original_check check ("originalValue" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adjustment_amount_check') THEN
    alter table "Adjustment" add constraint adjustment_amount_check check (amount ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_property_value_check') THEN
    alter table "Sale" add constraint sale_property_value_check check ("propertyValue" ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_price_check') THEN
    alter table "Property" add constraint property_price_check check (price ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdrawal_amount_check') THEN
    alter table "Withdrawal" add constraint withdrawal_amount_check check (amount ~ '^[0-9]+(\.[0-9]{1,2})?$');
  END IF;
END $$;
