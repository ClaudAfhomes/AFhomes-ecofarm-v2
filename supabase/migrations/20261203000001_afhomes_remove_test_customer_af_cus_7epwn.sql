-- One-off removal of anonymized test customer AF-CUS-7EPWN
-- (Orlando Arcangel Dela Cruz, already anonymized to Deleted Customer) and its
-- single test application APP-20261015-08C2ADCA with 2 purchase-terms rows.
--
-- Validation before apply (all expect 0 rows / empty):
--   select count(*) from public.customers
--    where id = 'e2611b0a-bc7c-491a-a454-cbfd4f79096d';
--   select count(*) from public.customer_applications
--    where id = '08c2adca-16a9-413c-b26a-29c3d1de2a45';
--   select count(*) from public.customer_application_purchase_terms
--    where customer_id = 'e2611b0a-bc7c-491a-a454-cbfd4f79096d';
-- Validation after apply (expect 0, 0, 0):
--   same three queries as above.
-- Then run supabase/security/rls_invariants.sql (empty = PASS).
--
-- Down: forward-only. Row deletion is irreversible; recovery is
-- restore-from-backup only. The CUSTOMER_APPLICATION_DELETED and
-- CUSTOMER_DELETED audit rows are retained by design.
--
-- Preflight (enforced below, aborts the transaction on violation):
--   the customer must have no sales, payments, memberships, redemptions,
--   purchases, earning claims, redemption approvals, reservations, import rows
--   or identity documents; the application must have no sale and no
--   reservation. Anything else aborts with a named exception and changes
--   nothing. Re-running after a successful apply is a no-op.
-- The purchase-terms delete uses the schema's own test-cleanup bypass
-- (afhomes.allow_purchase_test_cleanup, owner-only, transaction-local);
-- no privilege is granted or altered.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Sanctioned test-cleanup bypass for the append-only purchase-evidence
-- trigger (see private.purchase_test_cleanup_allowed in
-- 20261101000001_afhomes_application_purchase_flow.sql): session-local,
-- owner-only, DELETE-only. Without it the trigger raises
-- PURCHASE_TERMS_IMMUTABLE below. No grant is changed.
set local afhomes.allow_purchase_test_cleanup = 'on';

do $$
declare
  c_customer_id uuid := 'e2611b0a-bc7c-491a-a454-cbfd4f79096d';
  c_application_id uuid := '08c2adca-16a9-413c-b26a-29c3d1de2a45';
  v_customer_number text;
  v_application_number text;
  v_application_status text;
begin
  lock table public.customers in share row exclusive mode;
  lock table public.customer_applications in share row exclusive mode;
  lock table public.customer_application_purchase_terms in share row exclusive mode;

  select customer_number into v_customer_number
    from public.customers where id = c_customer_id;

  select application_number, status into v_application_number, v_application_status
    from public.customer_applications where id = c_application_id;

  if v_customer_number is null and v_application_number is null then
    return; -- Already removed: re-running is a no-op, not an error.
  end if;

  if v_application_number is not null then
    -- The application must belong to this customer and carry no sale.
    if not exists (
      select 1 from public.customer_applications
       where id = c_application_id and customer_id = c_customer_id
    ) then
      raise exception 'TEST_WIPE_UNEXPECTED_APPLICATION' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.customer_applications
       where id = c_application_id and sale_id is not null
    ) then
      raise exception 'TEST_WIPE_APPLICATION_HAS_SALE' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.reservation_agreements
       where customer_application_id = c_application_id
    ) then
      raise exception 'TEST_WIPE_RESERVATION_EXISTS' using errcode = 'P0001';
    end if;
  end if;

  -- No financial, operational or identity history may exist for this customer.
  if exists (select 1 from public.card_sales where customer_id = c_customer_id)
    or exists (select 1 from public.payments where customer_id = c_customer_id)
    or exists (select 1 from public.memberships where customer_id = c_customer_id)
    or exists (select 1 from public.redemptions where customer_id = c_customer_id)
    or exists (select 1 from public.purchases where customer_id = c_customer_id)
    or exists (select 1 from public.earning_claims where customer_id = c_customer_id)
    or exists (select 1 from public.redemption_quotes where approval_customer_id = c_customer_id)
    or exists (select 1 from public.reservation_agreements where customer_id = c_customer_id)
    or exists (select 1 from public.customer_import_rows where customer_id = c_customer_id)
    or exists (select 1 from public.identity_documents where customer_id = c_customer_id)
  then
    raise exception 'TEST_WIPE_PROTECTED_HISTORY' using errcode = 'P0001';
  end if;

  -- Bottom-up: purchase terms reference the application and the customer, the
  -- application references the customer. Holders/documents/tokens are
  -- expected empty; deleting them is a no-op either way.
  delete from public.customer_application_purchase_terms
   where customer_id = c_customer_id;
  delete from public.customer_application_holders
   where application_id = c_application_id;
  delete from public.customer_application_documents
   where application_id = c_application_id;
  delete from public.customer_applications
   where id = c_application_id;
  delete from public.customer_onboarding_tokens
   where customer_id = c_customer_id;
  delete from public.customers
   where id = c_customer_id;

  if v_application_number is not null then
    insert into public.audit_events
      (actor_id, action, entity_type, entity_id, before_data, after_data, reason, request_id)
    values
      (null, 'CUSTOMER_APPLICATION_DELETED', 'customer_application', c_application_id::text,
       jsonb_build_object('applicationNumber', v_application_number, 'status', v_application_status),
       jsonb_build_object('deleted', true),
       'One-off removal of test application with its test customer; no sale, no reservations, no financial rows.',
       'migration:20261203000001:' || c_application_id::text);
  end if;

  if v_customer_number is not null then
    insert into public.audit_events
      (actor_id, action, entity_type, entity_id, before_data, after_data, reason, request_id)
    values
      (null, 'CUSTOMER_DELETED', 'customer', c_customer_id::text,
       jsonb_build_object('customerNumber', v_customer_number),
       jsonb_build_object('deleted', true),
       'One-off removal of anonymized test customer; replicates DELETE /customers/:id handler (no blockers, no login).',
       'migration:20261203000001:' || c_customer_id::text);
  end if;
end $$;

commit;
