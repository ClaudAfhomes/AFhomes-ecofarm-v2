-- AF Homes: restore AUTHORIZED points spending with the staycation-default policy.
-- Validation: pnpm test:db:local; every browser-role result below must be false.
-- select has_function_privilege('service_role','public.quote_point_discount(uuid,bigint,uuid)','execute'); -- true
-- select has_function_privilege('service_role','public.commit_point_discount(uuid,uuid)','execute'); -- true
-- select has_function_privilege('service_role','public.apply_purchase_points_discount(uuid,bigint,text,uuid)','execute'); -- true
-- select has_function_privilege('service_role','public.redeem_membership_points(uuid,uuid,integer,text,uuid)','execute'); -- false (stays retired: no staycation gate, not in the checkout)
-- select has_function_privilege('authenticated','public.quote_point_discount(uuid,bigint,uuid)','execute'); -- false
-- select has_function_privilege('authenticated','public.commit_point_discount(uuid,uuid)','execute'); -- false
-- select has_function_privilege('authenticated','public.apply_purchase_points_discount(uuid,bigint,text,uuid)','execute'); -- false
-- Down: re-revoke EXECUTE from service_role on the three functions below. No rows rewritten.
--
-- WHY a new file. 20261108000001_afhomes_retire_points_spending.sql withdrew
-- EXECUTE on the four spend functions from every role including service_role.
-- That migration is IMMUTABLE and is not edited. Business policy now requires
-- purchase-discount spending again, restricted: staycation/hotel services by
-- default (service_catalog.is_staycation_eligible), every other service ONLY
-- through an active, in-date, tier-eligible promotion (point_redemption_rules).
-- That policy already lives inside quote_point_discount / commit_point_discount /
-- apply_purchase_points_discount (20261104000001, 20261106000001) and is NOT
-- changed here. This file restores ONLY those three purchase-discount functions
-- to service_role, so the API (which talks to Postgres as service_role) can
-- call them again. Browser roles stay revoked: no direct PostgREST execution.
--
-- Deliberately NOT restored: public.redeem_membership_points, the legacy
-- catalog-item redemption. It carries no staycation/promotion gate and is not
-- part of the approved purchase-discount checkout, so it stays revoked while
-- its history remains readable exactly as written.
-- Historical ledger, redemption and quote rows are untouched.
revoke all on function public.quote_point_discount(uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.quote_point_discount(uuid, bigint, uuid) to service_role;

revoke all on function public.commit_point_discount(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_point_discount(uuid, uuid) to service_role;

revoke all on function public.apply_purchase_points_discount(uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_purchase_points_discount(uuid, bigint, text, uuid) to service_role;

comment on function public.quote_point_discount(uuid, bigint, uuid) is
  'RESTORED. Spending is staycation-default: a service discounts only when is_staycation_eligible or an active, in-date, tier-eligible promotion names it. Browser roles hold no EXECUTE; the API calls as service_role after its own authorization.';

comment on function public.commit_point_discount(uuid, uuid) is
  'RESTORED. See public.quote_point_discount. Commits exactly what a live quote promised; re-validates balance, debt, purchase status and expiry.';

comment on function public.apply_purchase_points_discount(uuid, bigint, text, uuid) is
  'RESTORED. One-step till spend for a DRAFT purchase, idempotent by POS reference. A second reference against an already-discounted purchase is refused, never stacked.';

insert into public.audit_events (action, entity_type, entity_id, after_data, reason)
select
  'POINTS_SPENDING_RESTORED',
  'points_policy',
  'spend',
  jsonb_build_object(
    'restoredFunctions', jsonb_build_array(
      'public.quote_point_discount(uuid,bigint,uuid)',
      'public.commit_point_discount(uuid,uuid)',
      'public.apply_purchase_points_discount(uuid,bigint,text,uuid)'
    ),
    'stillRetired', jsonb_build_array(
      'public.redeem_membership_points(uuid,uuid,integer,text,uuid)'
    ),
    'policy', 'staycation-default with active promotion exceptions; browser roles hold no EXECUTE',
    'preservedHistory', true
  ),
  'Accumulated VIP points may discount staycation and hotel purchases by default, and other services only through an active eligible promotion.'
where not exists (
  select 1 from public.audit_events where action = 'POINTS_SPENDING_RESTORED'
);
