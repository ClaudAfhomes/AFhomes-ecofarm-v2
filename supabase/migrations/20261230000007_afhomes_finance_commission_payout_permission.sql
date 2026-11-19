-- AF Homes: Grant finance role commission payout update permission.
-- This forward-only migration adds the update permission that was previously
-- modified in the historical baseline migration (20260930000001).
-- The baseline migration is now restored to its original state.
-- Validation: pnpm test:db:local, phase26-finance.spec.ts, official-forms-transitions.spec.ts.
-- Down: forward repair only. Never remove a permission that may be in use.
begin;

-- Finance role gains update permission on finance.commission_payouts for payout actions.
-- Qualification decision remains admin-only (network.commissions update); payout is a finance action.
update public.role_permissions rp
set can_update = true
from public.roles r, public.modules m
where rp.role_id = r.id
  and rp.module_id = m.id
  and r.slug = 'finance'
  and m.key = 'finance.commission_payouts';

notify pgrst,'reload schema';
commit;