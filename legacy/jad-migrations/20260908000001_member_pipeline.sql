-- Member pipeline tables (Phase B3): registrations queue, customers,
-- sales with resubmission/lock lifecycle, plus Member profile columns.
-- Idempotent. All service_role-only RLS - every read/write proxies through
-- api/v1 Functions, which enforce JWT auth, ownership, and role matrix.
-- SSOT: saleSchema / registration schemas in @jad/contracts.

alter table "Member" add column if not exists "firstName" text;
alter table "Member" add column if not exists "lastName" text;
alter table "Member" add column if not exists "middleInitial" text default '';
alter table "Member" add column if not exists "nameSuffix" text default '';
alter table "Member" add column if not exists gender text;
alter table "Member" add column if not exists "dateOfBirth" text;
alter table "Member" add column if not exists phone text;
alter table "Member" add column if not exists address text;
alter table "Member" add column if not exists "countryCode" text;
alter table "Member" add column if not exists "countryName" text;
alter table "Member" add column if not exists "programId" text;
alter table "Member" add column if not exists "referralCode" text;
alter table "Member" add column if not exists "registrationId" text;
alter table "Member" add column if not exists "accountStatus" text not null default 'ACTIVE';
alter table "Member" add column if not exists "archivedAt" timestamp with time zone;
alter table "Member" add column if not exists "archivedBy" uuid references "Member"(id) on delete set null;
alter table "Member" add column if not exists "archiveSnapshot" jsonb;

create table if not exists "Registration" (
  id text primary key,
  status text not null default 'PENDING',
  "firstName" text not null,
  "middleInitial" text,
  "lastName" text not null,
  "nameSuffix" text,
  phone text,
  "dateOfBirth" text,
  gender text,
  "countryCode" text,
  "countryName" text,
  address text,
  "programId" text,
  "programCode" text,
  "referralCode" text,
  "qualificationAnswers" jsonb not null default '[]',
  "governmentId" jsonb,
  "submittedAt" timestamp with time zone not null default now(),
  "reviewedAt" timestamp with time zone,
  "reviewedBy" uuid,
  "rejectionNote" jsonb,
  "createdAt" timestamp with time zone not null default now(),
  "updatedAt" timestamp with time zone not null default now()
);
create index if not exists "Registration_status_idx" on "Registration"(status);

create table if not exists "Customer" (
  id text primary key,
  "memberId" uuid references "Member"(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  "createdAt" timestamp with time zone not null default now()
);
create index if not exists "Customer_member_idx" on "Customer"("memberId");

create table if not exists "Sale" (
  id text primary key,
  status text not null default 'SUBMITTED',
  "propertyId" text not null,
  "propertyName" text not null,
  "propertyValue" text not null,
  "customerId" text references "Customer"(id) on delete set null,
  "customerName" text not null,
  "sellerId" uuid references "Member"(id) on delete cascade,
  "sellerName" text not null,
  "submittedAt" timestamp with time zone not null default now(),
  "approvedAt" timestamp with time zone,
  "paymentVerifiedAt" timestamp with time zone,
  "lockedAt" timestamp with time zone,
  "resubmissionCount" integer not null default 0,
  "rejectionReason" text,
  "reopenRequested" boolean not null default false,
  "reopenRequestedAt" timestamp with time zone,
  "createdAt" timestamp with time zone not null default now(),
  "updatedAt" timestamp with time zone not null default now()
);
create index if not exists "Sale_seller_idx" on "Sale"("sellerId");
create index if not exists "Sale_status_idx" on "Sale"(status);

create table if not exists "IdempotencyKey" (
  key text primary key,
  "memberId" uuid references "Member"(id) on delete cascade,
  response jsonb not null,
  "createdAt" timestamp with time zone not null default now()
);

alter table "Registration" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Registration' and policyname='registration_service_role_all') then
    create policy registration_service_role_all on "Registration" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Customer" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Customer' and policyname='customer_service_role_all') then
    create policy customer_service_role_all on "Customer" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "Sale" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='Sale' and policyname='sale_service_role_all') then
    create policy sale_service_role_all on "Sale" for all to service_role using (true) with check (true);
  end if;
end $$;

alter table "IdempotencyKey" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='IdempotencyKey' and policyname='idempotency_service_role_all') then
    create policy idempotency_service_role_all on "IdempotencyKey" for all to service_role using (true) with check (true);
  end if;
end $$;

-- Member-category roles (single MEMBER category; assigned via MemberRole).
-- Staff roles live in 20260904000001_staff_roles.sql; both share the Role table.
insert into "Role"(slug, name, description) values
  ('member_basic', 'Member', 'Base member - single category default'),
  ('member_qualified', 'Qualified', 'Qualified member')
on conflict (slug) do nothing;
