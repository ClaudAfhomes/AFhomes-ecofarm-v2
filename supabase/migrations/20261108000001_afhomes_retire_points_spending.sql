-- AF Homes: retire points SPENDING. Points are earned and claimed, not spent.
--
-- PURPOSE. Business rule B: the active workflow is "earn points on a purchase,
-- then the CUSTOMER claims them in their own account". Spending an existing
-- balance - against a catalog item, or as a discount on an Operational Services
-- bill - is no longer part of the product.
--
-- This file deletes NOTHING. Every points ledger row, redemption record,
-- redemption quote and purchase created under the old rules stays exactly as it
-- is, because it is financial history and rewriting it is not reversible. What
-- is retired is the ABILITY to create a new spend transaction.
--
-- Execute privilege is REVOKED, not the function dropped, because:
--   * the API talks to Postgres as service_role, so this is the control that
--     actually stops a new spend - whether it arrives from a route, a script,
--     or a future developer who re-adds a button. A removed button proves
--     nothing; a revoked grant is enforced by the database itself.
--   * the functions stay callable by their owner, so history stays readable and
--     a rollback is a single GRANT rather than a data migration.
--
-- NOT retired, deliberately:
--   * create_earning_claim / claim_earning_points / reissue_earning_claim. The
--     earning and claiming lifecycle IS the product.
--   * adjust_membership_points. A manual adjustment is an audited CORRECTION,
--     not a spend, and staff still need it.
--   * point_redemption_rules rows. They are historical configuration; nothing
--     reads them any more, but deleting configuration is not this file's job.
--
-- VALIDATION QUERNS (all must return false / the expected counts):
--
--   -- 1. Nothing can spend. Every one of these must be false.
--   select has_function_privilege('service_role','public.quote_point_discount(uuid,bigint,uuid)','execute');
--   select has_function_privilege('service_role','public.commit_point_discount(uuid,uuid)','execute');
--   select has_function_privilege('service_role','public.apply_purchase_points_discount(uuid,bigint,text,uuid)','execute');
--   select has_function_privilege('service_role','public.redeem_membership_points(uuid,uuid,integer,text,uuid)','execute');
--   select has_function_privilege('authenticated','public.redeem_membership_points(uuid,uuid,integer,text,uuid)','execute');
--
--   -- 2. The product still works: earning and claiming are untouched.
--   select has_function_privilege('service_role','public.claim_earning_points(text,uuid)','execute');
--   select has_function_privilege('service_role','public.create_earning_claim(uuid,uuid)','execute');
--
--   -- 3. History is intact (expect 4).
--   select count(*) from information_schema.tables
--    where table_schema='public' and table_name in
--      ('points_ledger','redemptions','redemption_quotes','redemption_items');
--
-- DOWN NOTE. Re-grant execute to service_role on the four functions above and
-- restore the retired routes in api/_handlers/points.ts and
-- api/_handlers/redemptions.ts. No data changes in either direction.

-- ===========================================================================
-- 1. Withdraw the ability to create a points-spend transaction
-- ===========================================================================

revoke execute on function public.quote_point_discount(uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.commit_point_discount(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.apply_purchase_points_discount(uuid, bigint, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.redeem_membership_points(uuid, uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;

-- The comments are the operator-facing explanation. pg_proc.prosrc is what a
-- DBA reads when a function fails, so the reason belongs here rather than only
-- in a commit message. History is explicitly NOT affected.
comment on function public.quote_point_discount(uuid, bigint, uuid) is
  'RETIRED. Points spending was removed from the product: points are earned on a purchase and then claimed by the CUSTOMER in their own account. Existing redemption_quotes rows remain readable and unchanged; no new quote can be created. Kept rather than dropped so the change is reversible with a single GRANT.';

comment on function public.commit_point_discount(uuid, uuid) is
  'RETIRED. See public.quote_point_discount. Existing points_ledger rows written by earlier commits remain intact for audit; no new commit can be executed.';

comment on function public.apply_purchase_points_discount(uuid, bigint, text, uuid) is
  'RETIRED. The till-side points spend is gone: an Operational Services sale may no longer be reduced by the member''s existing balance. The VIP service-tier discount and the points EARNING rule are unaffected. Historical purchases are unchanged.';

comment on function public.redeem_membership_points(uuid, uuid, integer, text, uuid) is
  'RETIRED. Items a member already redeemed are financial history and remain readable exactly as written; that is why this function was revoked rather than dropped. What is withdrawn is the ability to CREATE a new catalog redemption, because spending a balance is no longer part of the product.';

-- ===========================================================================
-- 2. Record the change where an operator will actually find it
-- ===========================================================================
--
-- audit_events is append-only and is surfaced by the admin Audit Log. Someone
-- asking "why can I not spend points any more?" should find the answer in the
-- product's own audit trail, not only in git history.
--
-- Guarded by `where not exists` so re-applying this migration on a database
-- where it already ran inserts nothing: a notice stacked once per deploy would
-- be its own kind of noise.

insert into public.audit_events (action, entity_type, entity_id, after_data, reason)
select
  'POINTS_SPENDING_RETIRED',
  'points_policy',
  'spend',
  jsonb_build_object(
    'revokedFunctions', jsonb_build_array(
      'public.quote_point_discount(uuid,bigint,uuid)',
      'public.commit_point_discount(uuid,uuid)',
      'public.apply_purchase_points_discount(uuid,bigint,text,uuid)',
      'public.redeem_membership_points(uuid,uuid,integer,text,uuid)'
    ),
    'preservedHistory', true,
    'earningAndClaimingUnaffected', true
  ),
  'Points are earned on a purchase and claimed by the customer in their own AF Homes account. Spending an existing balance is no longer part of the workflow.'
where not exists (
  select 1 from public.audit_events where action = 'POINTS_SPENDING_RETIRED'
);