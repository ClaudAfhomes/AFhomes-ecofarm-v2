-- Money core (Phase B6): stored wallets, append-only ledger, member payout
-- accounts (raw identifier - masked on output), withdrawals with payout
-- snapshots, commissions.
-- Idempotent. All service_role-only RLS - every read/write proxies through
-- api/v1 Functions, which enforce JWT auth, ownership, and role matrix.
-- SSOT: walletSchema / ledgerEntrySchema / payoutAccountSchema /
-- withdrawalSchema / commissionSchema in @jad/contracts.
--
-- Money rules (mirror the member mock semantics exactly):
-- - Wallet is a STORED row, mutated transactionally alongside ledger appends
--   (server-authoritative; the client never derives balances, BI-001).
-- - Amounts are exact-decimal TEXT end to end - never floats.
-- - WITHDRAWAL_COMPLETION finalizes an already-reserved deduction and does
--   not move the running balance (BR-WDR-003).
-- - B5 `PayoutAccount` (admin review queue, pac-*) is intentionally separate
--   from `MemberPayoutAccount` (member-owned, pa-*) - mirrors the mocks;
--   unification needs owner confirmation.

create table if not exists "Wallet" (
  "memberId" uuid primary key references "Member"(id) on delete cascade,
  "availableBalance" text not null default '0.00',
  "pendingAmount" text not null default '0.00',
  "totalWithdrawals" text not null default '0.00',
  "totalEarned" text not null default '0.00'
);

create table if not exists "LedgerEntry" (
  id text primary key,
  "memberId" uuid not null references "Member"(id) on delete cascade,
  "entryType" text not null,
  direction text not null,
  amount text not null,
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "LedgerEntry_member_idx" on "LedgerEntry"("memberId");

create table if not exists "MemberPayoutAccount" (
  id text primary key,
  "memberId" uuid not null references "Member"(id) on delete cascade,
  method text not null,
  "accountName" text not null,
  "accountIdentifier" text not null,
  status text not null default 'PENDING',
  "isPrimary" boolean not null default false,
  "createdAt" timestamp with time zone not null default now(),
  "rejectionReason" text
);
create index if not exists "MemberPayoutAccount_member_idx" on "MemberPayoutAccount"("memberId");

create table if not exists "Withdrawal" (
  id text primary key,
  "memberId" uuid references "Member"(id) on delete set null,
  "payoutAccountId" text not null,
  "accountMethod" text not null,
  "accountName" text not null,
  "accountIdentifierMasked" text not null,
  amount text not null,
  status text not null default 'RESERVED',
  "reservedAt" timestamp with time zone,
  "completedAt" timestamp with time zone,
  "rejectedAt" timestamp with time zone,
  "rejectionReason" text,
  "externalReference" text,
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "Withdrawal_member_idx" on "Withdrawal"("memberId");
create index if not exists "Withdrawal_status_idx" on "Withdrawal"(status);

create table if not exists "Commission" (
  id text primary key,
  "memberId" uuid not null references "Member"(id) on delete cascade,
  "commissionType" text not null,
  "saleId" text not null,
  "baseValue" text not null,
  rate text not null,
  amount text not null,
  status text not null default 'PENDING',
  "clearedAt" timestamp with time zone,
  "cancelledAt" timestamp with time zone,
  "reversedAt" timestamp with time zone,
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "Commission_member_idx" on "Commission"("memberId");

alter table "Wallet" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Wallet' and policyname='wallet_service_role_all') then
    create policy wallet_service_role_all on "Wallet" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "LedgerEntry" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='LedgerEntry' and policyname='ledgerentry_service_role_all') then
    create policy ledgerentry_service_role_all on "LedgerEntry" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "MemberPayoutAccount" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='MemberPayoutAccount' and policyname='memberpayoutaccount_service_role_all') then
    create policy memberpayoutaccount_service_role_all on "MemberPayoutAccount" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Withdrawal" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Withdrawal' and policyname='withdrawal_service_role_all') then
    create policy withdrawal_service_role_all on "Withdrawal" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Commission" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Commission' and policyname='commission_service_role_all') then
    create policy commission_service_role_all on "Commission" for all to service_role using (true) with check (true);
  end if;
end $$;
