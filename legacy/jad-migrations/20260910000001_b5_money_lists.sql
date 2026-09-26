-- B5 money-list tables (Phase B5): transactional catalog side, payout
-- accounts, voucher templates + assignments, staff adjustments.
-- Idempotent. All service_role-only RLS - every read proxies through
-- api/v1 Functions, which enforce JWT auth and the role matrix.
-- SSOT: catalogPropertySchema / payoutAccountSchema / voucherSchema /
-- voucherTemplateSchema / adjustmentSchema in @jad/contracts.
--
-- Catalog split: these tables own ID/category/price/status (transactional).
-- Presentation (titles, galleries, copy) stays in cms_contents 'properties'.

create table if not exists "PropertyCategory" (
  slug text primary key,
  title text not null,
  "createdAt" timestamp with time zone not null default now()
);

create table if not exists "Property" (
  id text primary key,
  name text not null,
  "categorySlug" text not null references "PropertyCategory"(slug) on delete restrict,
  price text,
  status text not null default 'ACTIVE',
  "createdAt" timestamp with time zone not null default now(),
  "updatedAt" timestamp with time zone not null default now()
);
create index if not exists "Property_category_idx" on "Property"("categorySlug");
create index if not exists "Property_status_idx" on "Property"(status);

create table if not exists "PayoutAccount" (
  id text primary key,
  method text not null,
  "accountName" text not null,
  "accountIdentifierMasked" text not null,
  status text not null default 'PENDING',
  "isPrimary" boolean not null default false,
  "createdAt" timestamp with time zone not null default now(),
  "rejectionReason" text
);
create index if not exists "PayoutAccount_status_idx" on "PayoutAccount"(status);

create table if not exists "VoucherTemplate" (
  id text primary key,
  title text not null,
  "originalValue" text not null,
  "createdAt" timestamp with time zone not null default now(),
  "expiresAt" timestamp with time zone,
  "validityDays" integer
);

create table if not exists "Voucher" (
  id text primary key,
  "templateId" text not null references "VoucherTemplate"(id) on delete restrict,
  code text unique not null,
  title text not null,
  "originalValue" text not null,
  "remainingValue" text not null,
  status text not null default 'ACTIVE',
  "memberId" uuid references "Member"(id) on delete set null,
  "memberName" text not null,
  "createdAt" timestamp with time zone not null default now(),
  "expiresAt" timestamp with time zone
);
create index if not exists "Voucher_template_idx" on "Voucher"("templateId");
create index if not exists "Voucher_member_idx" on "Voucher"("memberId");
create index if not exists "Voucher_status_idx" on "Voucher"(status);

create table if not exists "Adjustment" (
  id text primary key,
  "memberId" uuid references "Member"(id) on delete set null,
  "memberName" text not null,
  "entryType" text not null,
  direction text not null,
  amount text not null,
  reason text not null,
  "createdBy" text not null,
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "Adjustment_member_idx" on "Adjustment"("memberId");

alter table "PropertyCategory" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='PropertyCategory' and policyname='propertycategory_service_role_all') then
    create policy propertycategory_service_role_all on "PropertyCategory" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Property" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Property' and policyname='property_service_role_all') then
    create policy property_service_role_all on "Property" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "PayoutAccount" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='PayoutAccount' and policyname='payoutaccount_service_role_all') then
    create policy payoutaccount_service_role_all on "PayoutAccount" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "VoucherTemplate" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='VoucherTemplate' and policyname='vouchertemplate_service_role_all') then
    create policy vouchertemplate_service_role_all on "VoucherTemplate" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Voucher" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Voucher' and policyname='voucher_service_role_all') then
    create policy voucher_service_role_all on "Voucher" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Adjustment" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Adjustment' and policyname='adjustment_service_role_all') then
    create policy adjustment_service_role_all on "Adjustment" for all to service_role using (true) with check (true);
  end if;
end $$;
