-- Role permission sets for true RBAC (Phase B4). Permissions live on the
-- role record (JSONB module array); `is_system` marks seeded roles.
-- Idempotent. RLS unchanged (authenticated SELECT, service_role writes).

alter table "Role" add column if not exists permissions jsonb not null default '[]';
alter table "Role" add column if not exists is_system boolean not null default false;
-- Stable external id (`role-finance-reviewer`); system rows default to slug.
alter table "Role" add column if not exists key text unique;
update "Role" set key = slug where key is null;

-- Backfill seeded slugs from the STAFF_PERMISSIONS matrix seed. Custom
-- (non-seeded) rows keep whatever permissions were assigned at creation.
update "Role" set
  permissions = '["dashboard","registrations","members","sales","payouts","withdrawals","vouchers","properties","marketing_tools","config","programs","audit","staff","cms"]',
  is_system = true
where slug = 'super_admin';

update "Role" set
  permissions = '["dashboard","registrations","members","sales","payouts","withdrawals","vouchers","properties","marketing_tools","cms"]',
  is_system = true
where slug = 'admin';

update "Role" set
  permissions = '["dashboard","sales","payouts","withdrawals"]',
  is_system = true
where slug = 'finance';

update "Role" set
  permissions = '["vouchers"]',
  is_system = true
where slug = 'merchant';

update "Role" set
  permissions = '[]',
  is_system = true
where slug in ('member_basic', 'member_qualified', 'user');
