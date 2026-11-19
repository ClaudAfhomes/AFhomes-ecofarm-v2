-- AF Homes Phase 2 - default role permission baseline.
--
-- The production database currently holds ZERO role_permissions rows, so every
-- role except super_admin (implicit full access by slug) resolves to zero
-- modules. This migration installs the explicit, reviewed default grants for
-- the eight operational roles. It is the database copy of
-- `packages/contracts/src/schemas/role-baseline.ts` - that file is the
-- authority; this file must match it row for row.
--
-- Validation before apply (every query must return zero rows):
--   -- a baseline row whose role or module does not exist:
--   select count(*) from public.role_permissions rp
--    left join public.roles r on r.id = rp.role_id
--    left join public.modules m on m.id = rp.module_id
--    where r.id is null or m.id is null;
--   -- super_admin must hold NO explicit rows (its access stays implicit):
--   select count(*) from public.role_permissions rp
--    join public.roles r on r.id = rp.role_id where r.slug = 'super_admin';
--   -- customer must hold NO admin-module rows:
--   select count(*) from public.role_permissions rp
--    join public.roles r on r.id = rp.role_id where r.slug = 'customer';
--   -- no delete grant anywhere (no delete endpoint exists to authorize):
--   select count(*) from public.role_permissions where can_delete;
--   -- no create/update without view (the table CHECKs require it):
--   select count(*) from public.role_permissions
--    where (can_create and not can_view) or (can_update and not can_view)
--       or (can_delete and not can_view);
--
-- Validation after apply (expected counts; super_admin stays implicit):
--   select r.slug, count(*) from public.role_permissions rp
--    join public.roles r on r.id = rp.role_id group by 1 order by 1;
--   -- admin 20, finance 8, hr 3, vice_director 10, senior_sales_manager 8,
--   -- sales_manager 10, ost 8, employee 3, customer 0, super_admin 0.
--
-- Down (forward-only; this note is documentation, not a script): delete only
-- the rows that still carry exactly the baseline values below, so an operator
-- customization made after this migration is never removed by a rollback:
--   delete from public.role_permissions rp using public.roles r, public.modules m
--    where rp.role_id = r.id and rp.module_id = m.id
--      and (r.slug, m.key, rp.can_view, rp.can_create, rp.can_update, rp.can_delete)
--      in (<the 70 tuples below>);

-- ---------------------------------------------------------------------------
-- Baseline reconciliation. One statement, fixed row order (deterministic).
-- Keyed by (role slug, module key), so it is safe to run twice: the second
-- run reconciles drift back to the reviewed baseline and changes nothing
-- else. Rows NOT listed here - custom roles, custom grants, future modules -
-- are left untouched: nothing is deleted, truncated or reset. super_admin
-- and customer intentionally have no tuples, so their semantics cannot move.
-- The (role_id, module_id) primary key is the conflict target.
-- ---------------------------------------------------------------------------

insert into public.role_permissions
  (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, v.can_view, v.can_create, v.can_update, v.can_delete
from (values
  -- admin: delegated administrator (20). Qualification decisions
  -- (network.commissions update) and catalog maintenance
  -- (operations.catalog create/update) live here and nowhere else.
  ('admin', 'dashboard.view',                 true,  false, false, false),
  ('admin', 'sales.card_sales',               true,  true,  false, false),
  ('admin', 'sales.card_plans',               true,  false, true,  false),
  ('admin', 'sales.customers',                true,  true,  true,  false),
  ('admin', 'sales.id_documents',             true,  false, false, false),
  ('admin', 'sales.uplines',                  true,  true,  true,  false),
  ('admin', 'finance.payment_verification',   true,  false, true,  false),
  ('admin', 'finance.card_activation',        true,  false, true,  false),
  ('admin', 'finance.points',                 true,  false, false, false),
  ('admin', 'network.commissions',            true,  false, true,  false),
  ('admin', 'network.genealogy',              true,  false, false, false),
  ('admin', 'network.ost_members',            true,  false, false, false),
  ('admin', 'network.ost_registrations',      true,  false, false, false),
  ('admin', 'network.referrals',              true,  false, false, false),
  ('admin', 'operations.catalog',             true,  true,  true,  false),
  ('admin', 'operations.redemption',          true,  false, false, false),
  ('admin', 'organization.departments',       true,  true,  false, false),
  ('admin', 'organization.roles',             true,  true,  true,  false),
  ('admin', 'organization.staff',             true,  true,  true,  false),
  ('admin', 'governance.audit',               true,  false, false, false),
  -- finance: payments, activation, points inspection (8). No qualification
  -- decision, no payout, no identity documents - each deliberately withheld.
  ('finance', 'dashboard.view',               true,  false, false, false),
  ('finance', 'finance.payment_verification', true,  false, true,  false),
  ('finance', 'finance.card_activation',      true,  false, true,  false),
  ('finance', 'finance.points',               true,  false, false, false),
  ('finance', 'network.commissions',          true,  false, false, false),
  ('finance', 'sales.customers',              true,  false, false, false),
  ('finance', 'sales.card_sales',             true,  false, false, false),
  ('finance', 'sales.card_plans',             true,  false, false, false),
  -- hr: people and departments only (3). Role management stays with admin.
  ('hr', 'dashboard.view',                    true,  false, false, false),
  ('hr', 'organization.staff',                true,  true,  true,  false),
  ('hr', 'organization.departments',          true,  true,  false, false),
  -- vice_director: sell, onboard, read the network (10). No finance
  -- verification, no org admin, no upline assignment, no redemption spend.
  ('vice_director', 'dashboard.view',          true,  false, false, false),
  ('vice_director', 'sales.card_sales',        true,  true,  false, false),
  ('vice_director', 'sales.customers',         true,  true,  true,  false),
  ('vice_director', 'sales.id_documents',      true,  false, false, false),
  ('vice_director', 'sales.card_plans',        true,  false, false, false),
  ('vice_director', 'network.genealogy',       true,  false, false, false),
  ('vice_director', 'network.referrals',       true,  false, false, false),
  ('vice_director', 'network.ost_members',     true,  false, false, false),
  ('vice_director', 'network.ost_registrations', true, false, false, false),
  ('vice_director', 'network.commissions',     true,  false, false, false),
  -- senior_sales_manager: sell, onboard, authorized genealogy (8).
  ('senior_sales_manager', 'dashboard.view',   true,  false, false, false),
  ('senior_sales_manager', 'sales.card_sales', true,  true,  false, false),
  ('senior_sales_manager', 'sales.customers',  true,  true,  true,  false),
  ('senior_sales_manager', 'sales.id_documents', true, false, false, false),
  ('senior_sales_manager', 'sales.card_plans', true,  false, false, false),
  ('senior_sales_manager', 'network.genealogy', true, false, false, false),
  ('senior_sales_manager', 'network.referrals', true, false, false, false),
  ('senior_sales_manager', 'network.commissions', true, false, false, false),
  -- sales_manager: sell, onboard, OST referral ownership (10).
  ('sales_manager', 'dashboard.view',          true,  false, false, false),
  ('sales_manager', 'sales.card_sales',        true,  true,  false, false),
  ('sales_manager', 'sales.customers',         true,  true,  true,  false),
  ('sales_manager', 'sales.id_documents',      true,  false, false, false),
  ('sales_manager', 'sales.card_plans',        true,  false, false, false),
  ('sales_manager', 'network.genealogy',       true,  false, false, false),
  ('sales_manager', 'network.referrals',       true,  false, false, false),
  ('sales_manager', 'network.ost_members',     true,  false, false, false),
  ('sales_manager', 'network.ost_registrations', true, false, false, false),
  ('sales_manager', 'network.commissions',     true,  false, false, false),
  -- ost: sell where permitted, own scope only (8). No org, no finance.
  ('ost', 'dashboard.view',                    true,  false, false, false),
  ('ost', 'sales.card_sales',                  true,  true,  false, false),
  ('ost', 'sales.customers',                   true,  true,  true,  false),
  ('ost', 'sales.id_documents',                true,  false, false, false),
  ('ost', 'sales.card_plans',                  true,  false, false, false),
  ('ost', 'network.commissions',               true,  false, false, false),
  ('ost', 'network.referrals',                 true,  false, false, false),
  ('ost', 'network.genealogy',                 true,  false, false, false),
  -- employee: redemption point-of-sale only (3). Catalog is read-only here.
  ('employee', 'dashboard.view',               true,  false, false, false),
  ('employee', 'operations.redemption',        true,  true,  false, false),
  ('employee', 'operations.catalog',           true,  false, false, false)
) as v(role_slug, module_key, can_view, can_create, can_update, can_delete)
join public.roles r on r.slug = v.role_slug
join public.modules m on m.key = v.module_key
on conflict (role_id, module_id) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;
