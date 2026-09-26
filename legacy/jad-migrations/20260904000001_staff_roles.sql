-- Staff roles for admin-shell RBAC (custom-roles pass).
-- Adds the staff role rows consumed by the frontend permission matrix; the
-- binary session gate (admin/user) is unchanged. Idempotent: safe to re-run.
-- SSOT: docs/business/BUSINESS-RULES.md #3 (Admin / Finance / Super Admin /
-- Merchant capabilities).

insert into "Role"(slug, name, description) values
  ('super_admin', 'Super Admin', 'Platform super user - full governance (BUSINESS-RULES #3)'),
  ('finance', 'Finance', 'Payment verification scope (BUSINESS-RULES #3)'),
  ('merchant', 'Merchant', 'Voucher redemption scope (BUSINESS-RULES #3)')
on conflict (slug) do nothing;
