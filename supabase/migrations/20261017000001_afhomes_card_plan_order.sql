-- AF Homes card-plan presentation order: GOLD, SILVER, BRONZE.
--
-- Validation before apply: every `card_plans` read orders by
-- `sort_order, name`, so with all three reference plans at the default
-- `sort_order = 0` the tiebreak is `name ASC` and members see
-- Bronze, Gold, Silver. This migration pins the intended presentation order
-- (GOLD 10, SILVER 20, BRONZE 30) without touching plan ids, codes, prices,
-- points, economics or activity flags.
--
-- Validation after apply:
--   select code, name, sort_order from public.card_plans
--   where code in ('GOLD','SILVER','BRONZE') order by sort_order;
--   -- GOLD 10, SILVER 20, BRONZE 30.
--
-- Down: update public.card_plans set sort_order = 0
--   where code in ('GOLD','SILVER','BRONZE');
--
-- NOTE: prepared, not yet applied. Apply only with approval via
-- `pnpm db:migrate` against the approved target.

update public.card_plans set sort_order = 10 where code = 'GOLD';
update public.card_plans set sort_order = 20 where code = 'SILVER';
update public.card_plans set sort_order = 30 where code = 'BRONZE';
