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

-- Exempt purge from the purchase-term identity/version guards.
create or replace function private.guard_reservation_purchase_identity() returns trigger
language plpgsql set search_path=pg_catalog,public,private,pg_temp as $$
declare t public.customer_application_purchase_terms%rowtype;
begin
  if current_setting('afhomes.allow_customer_purge', true) = 'on' then return new; end if;
  if tg_op='UPDATE' and new.origin is distinct from old.origin then raise exception 'RESERVATION_SOURCE_IMMUTABLE' using errcode='55000'; end if;
  if new.origin<>'application' then return new; end if;
  select pt.* into t from public.customer_application_purchase_terms pt where pt.id=new.purchase_terms_id;
  if not found then raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000'; end if;
  if row(new.customer_application_id,new.customer_id,new.plan_id,new.seller_staff_id,new.tier_snapshot,new.payment_scheme_snapshot,
    new.total_price_snapshot::numeric,new.reservation_fee_snapshot::numeric,new.required_initial_snapshot::numeric,new.down_payment_snapshot::numeric,new.validity_years_snapshot,new.inclusions_snapshot,
    new.monthly_amortization_snapshot::numeric,new.installment_months_snapshot,new.validity_months_snapshot,new.spot_cash_days_snapshot,
    new.minimum_down_payment_snapshot::numeric,new.discount_percent_snapshot,new.yearly_points_snapshot,new.annual_points_tranches_snapshot,
    new.holder_limit_snapshot,new.commission_rule_id,new.commission_rate_snapshot::numeric,new.commission_base_snapshot::numeric,new.expected_commission_snapshot::numeric)
    is distinct from row(t.application_id,t.customer_id,t.plan_id,t.seller_staff_id,t.tier,t.payment_scheme,
    t.total_price::numeric,t.reservation_fee::numeric,t.required_initial::numeric,t.required_initial::numeric,t.validity_months/12,jsonb_build_object('items',t.inclusions),t.monthly_amount::numeric,t.installment_months,
    t.validity_months,t.spot_cash_days,t.minimum_down_payment::numeric,t.discount_percent,t.yearly_points,t.annual_points_tranches,
    t.holder_limit,t.commission_rule_id,t.commission_rate::numeric,t.commission_base::numeric,t.expected_commission::numeric) then
    raise exception 'RESERVATION_TERMS_CONFLICT' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    if row(new.purchase_terms_id,new.customer_application_id,new.customer_id,new.plan_id,new.seller_staff_id,new.reservation_date)
      is distinct from row(old.purchase_terms_id,old.customer_application_id,old.customer_id,old.plan_id,old.seller_staff_id,old.reservation_date) then
      raise exception 'RESERVATION_TERMS_IMMUTABLE' using errcode='55000';
    end if;
    if old.sale_id is not null and new.sale_id is distinct from old.sale_id then raise exception 'RESERVATION_SALE_IMMUTABLE' using errcode='55000'; end if;
    if old.status in ('executed','cancelled') and new.status is distinct from old.status then raise exception 'INVALID_AGREEMENT_TRANSITION' using errcode='55000'; end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_reservation_purchase_identity() from public, anon, authenticated, service_role;

create or replace function private.guard_application_purchase_terms() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if current_setting('afhomes.allow_customer_purge', true) = 'on' then return new; end if;
  if tg_table_name='customer_application_purchase_terms' then
    if not exists(select 1 from public.customer_applications a where a.id=new.application_id
      and a.customer_id=new.customer_id and a.plan_id=new.plan_id) then
      raise exception 'APPLICATION_TERMS_IDENTITY_INVALID' using errcode='23514';
    end if;
    return new;
  end if;
  if new.purchase_terms_id is distinct from old.purchase_terms_id and exists(
    select 1 from public.reservation_agreements r where r.customer_application_id=old.id and r.status<>'cancelled') then
    raise exception 'PURCHASE_TERMS_VERSION_FROZEN' using errcode='55000';
  end if;
  if new.purchase_terms_id is not null and not exists(select 1 from public.customer_application_purchase_terms pt
    where pt.id=new.purchase_terms_id and pt.application_id=new.id
      and pt.customer_id=new.customer_id and pt.plan_id=new.plan_id) then
    raise exception 'PURCHASE_TERMS_REVIEW_REQUIRED' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.guard_application_purchase_terms() from public, anon, authenticated, service_role;

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

  -- Enable guarded deletes (purchase evidence, payment history) for this transaction.
  perform set_config('afhomes.allow_customer_purge', 'on', true);

  -- Null out cross-references that create circular FKs.
  update public.card_sales set import_row_id = null, import_job_id = null where customer_id = p_customer_id;
  update public.customer_import_rows set sale_id = null, membership_id = null where customer_id = p_customer_id;
  update private.customer_import_purchase_sources set application_id = null where customer_id = p_customer_id;

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
  -- (customer applications and their purchase terms are deleted after
  --  reservation agreements, to satisfy circular FKs.)

  -- Null application purchase_terms_id now that reservations are about to be
  -- removed (avoids PURCHASE_TERMS_REVIEW_REQUIRED / origin check).
  update public.customer_applications set purchase_terms_id = null where customer_id = p_customer_id;

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

  -- Purchase terms and applications (after reservations are gone).
  delete from public.customer_application_purchase_terms where customer_id = p_customer_id;
  delete from public.customer_applications where customer_id = p_customer_id;

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
