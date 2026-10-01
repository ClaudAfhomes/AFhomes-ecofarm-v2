-- AF Homes official VIP paper-form benefits (prospective plan configuration).
--
-- This migration deliberately updates only public.card_plans. It does NOT
-- update card_sales snapshots, memberships, points_accounts, or points_ledger.
-- Existing commercial and points history therefore keeps its original value;
-- sales created after this migration freeze the official plan values and the
-- existing activation RPC allocates that frozen yearly_points_snapshot.
--
-- Validation before apply:
--   select code, yearly_points from public.card_plans
--    where code in ('BRONZE','SILVER','GOLD') order by code;
-- Validation after apply:
--   select code, yearly_points, discount_percent, base_validity_years,
--          validity_extension_years, cardholder_limit, annual_points_tranches,
--          total_loyalty_value, priority_reservation, no_monthly_annual_dues
--     from public.card_plans where code in ('BRONZE','SILVER','GOLD') order by code;
-- Expected: BRONZE 10000/15/5/2/1/5/50000.00/t/t;
--           SILVER 20000/20/10/2/1/10/200000.00/t/t;
--           GOLD   25000/25/20/2/2/20/500000.00/t/t.
-- Down: forward-only. Restore plan configuration with a later migration;
-- never rewrite historical sale snapshots or points ledgers.

alter table public.card_plans
  add column if not exists discount_percent integer not null default 0
    check (discount_percent between 0 and 100),
  add column if not exists base_validity_years integer not null default 1
    check (base_validity_years > 0),
  add column if not exists validity_extension_years integer not null default 0
    check (validity_extension_years >= 0),
  add column if not exists cardholder_limit integer not null default 1
    check (cardholder_limit between 1 and 2),
  add column if not exists annual_points_tranches integer not null default 1
    check (annual_points_tranches > 0),
  add column if not exists total_loyalty_value text not null default '0.00'
    check (total_loyalty_value ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'),
  add column if not exists priority_reservation boolean not null default false,
  add column if not exists no_monthly_annual_dues boolean not null default false;

comment on column public.card_plans.yearly_points is
  'Annual Loyalty Stay Points credited by the existing activation flow. Historical snapshots and ledgers are immutable.';
comment on column public.card_plans.annual_points_tranches is
  'Number of annual benefit tranches described by the official form. This is display/contract metadata; no annual scheduler is implied.';
comment on column public.card_plans.cardholder_limit is
  'Maximum registered cardholders. Gold permits two but never requires a secondary holder.';

update public.card_plans
set yearly_points = case code when 'BRONZE' then 10000 when 'SILVER' then 20000 when 'GOLD' then 25000 end,
    discount_percent = case code when 'BRONZE' then 15 when 'SILVER' then 20 when 'GOLD' then 25 end,
    base_validity_years = case code when 'BRONZE' then 5 when 'SILVER' then 10 when 'GOLD' then 20 end,
    validity_extension_years = 2,
    cardholder_limit = case code when 'GOLD' then 2 else 1 end,
    annual_points_tranches = case code when 'BRONZE' then 5 when 'SILVER' then 10 when 'GOLD' then 20 end,
    total_loyalty_value = case code when 'BRONZE' then '50000.00' when 'SILVER' then '200000.00' when 'GOLD' then '500000.00' end,
    priority_reservation = true,
    no_monthly_annual_dues = true,
    updated_at = now()
where code in ('BRONZE','SILVER','GOLD');

-- The existing validity_years field is the total validity used by sale
-- snapshots. Keep it aligned with base + general extension.
update public.card_plans
set validity_years = base_validity_years + validity_extension_years,
    updated_at = now()
where code in ('BRONZE','SILVER','GOLD');
