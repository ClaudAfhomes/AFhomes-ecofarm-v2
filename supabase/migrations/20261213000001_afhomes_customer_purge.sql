-- AF Homes: full customer purge (cascade).
--
-- Validation (run after apply):
--   select public.purge_customer('00000000-0000-0000-0000-000000000000'::uuid);
--   -- should raise "customer not found"
--
-- Down note: drop function public.purge_customer(uuid); and restore
-- private.purchase_test_cleanup_allowed to its original definition. Purged
-- rows are gone and cannot be restored.

-- Allow the purge path to remove protected purchase evidence, which is otherwise
-- immutable. The flag is transaction-local and only effective for the table
-- owner (the SECURITY DEFINER purge function runs as the migration owner).
create or replace function private.purchase_test_cleanup_allowed(p_table regclass)
returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
  select (current_setting('afhomes.allow_purchase_test_cleanup', true) = 'on'
          or current_setting('afhomes.allow_customer_purge', true) = 'on')
    and current_user = pg_get_userbyid(c.relowner)
  from pg_class c where c.oid = p_table;
$$;
revoke all on function private.purchase_test_cleanup_allowed(regclass) from public, anon, authenticated, service_role;

create or replace function public.purge_customer(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_customer_id is null then
    raise exception 'p_customer_id is required';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found';
  end if;

  -- Bypass FK/trigger enforcement for this transaction so the cascade can run
  -- in any order without partial failures.
  perform set_config('session_replication_role', 'replica', true);
  perform set_config('afhomes.allow_customer_purge', 'on', true);

  -- Identity documents (rows only; storage objects are removed by the handler).
  delete from public.identity_documents where customer_id = p_customer_id;

  -- Ephemeral onboarding tokens.
  delete from public.customer_onboarding_tokens where customer_id = p_customer_id;

  -- Customer applications and their children.
  delete from public.customer_application_holders
    where application_id in (select id from public.customer_applications where customer_id = p_customer_id);
  delete from public.customer_application_documents
    where application_id in (select id from public.customer_applications where customer_id = p_customer_id)
       or identity_document_id in (select id from public.identity_documents where customer_id = p_customer_id);
  delete from private.customer_import_payment_claims
    where source_id in (select id from private.customer_import_purchase_sources where customer_id = p_customer_id);
  delete from private.customer_import_source_rows
    where source_id in (select id from private.customer_import_purchase_sources where customer_id = p_customer_id);
  delete from private.customer_external_import_receipts
    where source_id in (select id from private.customer_import_purchase_sources where customer_id = p_customer_id);
  delete from private.customer_import_purchase_sources where customer_id = p_customer_id;
  delete from public.customer_application_purchase_terms where customer_id = p_customer_id;
  delete from public.customer_applications where customer_id = p_customer_id;

  -- Reservation agreements and their children.
  delete from public.reservation_agreement_documents
    where agreement_id in (select id from public.reservation_agreements where customer_id = p_customer_id)
       or payment_id in (select id from public.payments where customer_id = p_customer_id);
  delete from public.reservation_agreement_holders
    where agreement_id in (select id from public.reservation_agreements where customer_id = p_customer_id);
  delete from public.reservation_agreement_schedule
    where agreement_id in (select id from public.reservation_agreements where customer_id = p_customer_id);
  delete from private.purchase_document_evidence
    where reservation_id in (select id from public.reservation_agreements where customer_id = p_customer_id)
       or payment_id in (select id from public.payments where customer_id = p_customer_id)
       or sale_id in (select id from public.card_sales where customer_id = p_customer_id)
       or membership_id in (select id from public.memberships where customer_id = p_customer_id);

  -- Purchases and their children.
  delete from public.purchase_lines
    where purchase_id in (select id from public.purchases where customer_id = p_customer_id);
  delete from public.purchase_payments
    where purchase_id in (select id from public.purchases where customer_id = p_customer_id);
  delete from public.purchase_point_refunds
    where purchase_id in (select id from public.purchases where customer_id = p_customer_id);
  delete from public.service_refund_repayments
    where refund_id in (select id from public.service_refunds where purchase_id in (select id from public.purchases where customer_id = p_customer_id));
  delete from public.service_refunds
    where purchase_id in (select id from public.purchases where customer_id = p_customer_id);
  delete from public.earning_claims where customer_id = p_customer_id;
  delete from public.purchases where customer_id = p_customer_id;

  -- Redemptions and quotes.
  delete from public.redemptions where customer_id = p_customer_id;
  delete from public.redemption_quotes where approval_customer_id = p_customer_id;

  -- Points (ledger + account) via memberships.
  delete from public.points_periods
    where account_id in (select id from public.points_accounts where membership_id in (select id from public.memberships where customer_id = p_customer_id));
  delete from public.points_ledger
    where account_id in (select id from public.points_accounts where membership_id in (select id from public.memberships where customer_id = p_customer_id));
  delete from public.points_accounts
    where membership_id in (select id from public.memberships where customer_id = p_customer_id);

  -- Payments and commissions for this customer's sales.
  delete from public.payments
    where customer_id = p_customer_id
       or sale_id in (select id from public.card_sales where customer_id = p_customer_id)
       or reservation_id in (select id from public.reservation_agreements where customer_id = p_customer_id);
  delete from public.commissions
    where sale_id in (select id from public.card_sales where customer_id = p_customer_id);

  -- Final qualifications and hierarchy snapshots.
  delete from public.final_qualifications
    where sale_id in (select id from public.card_sales where customer_id = p_customer_id);
  delete from public.card_sale_hierarchy_snapshots
    where sale_id in (select id from public.card_sales where customer_id = p_customer_id);

  -- Memberships.
  delete from public.memberships where customer_id = p_customer_id;

  -- Reservation agreements.
  delete from public.reservation_agreements where customer_id = p_customer_id;

  -- Card sales.
  delete from public.card_sales where customer_id = p_customer_id;

  -- Import rows.
  delete from public.customer_import_rows where customer_id = p_customer_id;

  -- Identity documents and onboarding tokens.
  delete from public.identity_documents where customer_id = p_customer_id;
  delete from public.customer_onboarding_tokens where customer_id = p_customer_id;

  -- Customer row last.
  delete from public.customers where id = p_customer_id;
end;
$$;

revoke all on function public.purge_customer(uuid) from public;
grant execute on function public.purge_customer(uuid) to service_role;
