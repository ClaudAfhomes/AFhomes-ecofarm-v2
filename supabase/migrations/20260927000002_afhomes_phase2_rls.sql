-- AF Homes Phase 2 - row level security.
-- Validation before apply (every query must return zero rows):
--   select count(*) from pg_policies
--    where schemaname='public' and cmd <> 'SELECT';
--   select count(*) from information_schema.role_table_grants
--    where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')
--      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--   select count(*) from information_schema.role_routine_grants
--    where specific_schema='private' and grantee in ('PUBLIC','anon');
-- Down: drop the policies created below and re-grant/revoke to the Phase 1 set.

-- ---------------------------------------------------------------------------
-- New Phase 2 tables. Same posture as Phase 1: browser roles get SELECT only,
-- every predicate goes through private.has_permission(), and all writes happen
-- through service-role handlers or SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array[
    'referral_relationships',
    'points_accounts',
    'points_ledger',
    'customer_onboarding_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Referral / upline hierarchy
-- ---------------------------------------------------------------------------
-- A subject may read their own upline; an authorized reader sees the network.
grant select on public.referral_relationships to authenticated;
create policy referral_relationships_read on public.referral_relationships
  for select to authenticated
  using (
    subject_staff_id = (select auth.uid())
    or upline_staff_id = (select auth.uid())
    or private.has_permission('network.referrals')
    or private.has_permission('sales.uplines')
  );

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------
-- A customer sees their own balance. Points staff and redemption staff see the
-- ledger. Nobody else, and no browser role can write a ledger row.
grant select on public.points_accounts to authenticated;
create policy points_accounts_read on public.points_accounts
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      join public.customers c on c.id = m.customer_id
      where m.id = points_accounts.membership_id
        and c.auth_user_id = (select auth.uid())
    )
    or private.has_permission('finance.points')
    or private.has_permission('operations.redemption')
  );

grant select on public.points_ledger to authenticated;
create policy points_ledger_read on public.points_ledger
  for select to authenticated
  using (
    exists (
      select 1
      from public.points_accounts pa
      join public.memberships m on m.id = pa.membership_id
      join public.customers c on c.id = m.customer_id
      where pa.id = points_ledger.account_id
        and c.auth_user_id = (select auth.uid())
    )
    or private.has_permission('finance.points')
    or private.has_permission('operations.redemption')
  );

-- ---------------------------------------------------------------------------
-- Customer onboarding tokens
-- ---------------------------------------------------------------------------
-- Deliberately NOT granted to any browser role: a row here is a credential
-- hash. Issue and inspect happen server-side only.
revoke all on public.customer_onboarding_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Widened reads on existing Phase 1 tables, each tied to a real Phase 2 need.
-- ---------------------------------------------------------------------------

-- Finance must inspect the customer behind a sale it is handling payments for.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or private.has_permission('sales.customers')
    or private.has_permission('finance.payment_verification')
    or private.has_permission('finance.card_activation')
  );

-- Finance (payment queue) and activation staff (activation queue) need the
-- sale. A seller still sees only their own sales.
drop policy if exists card_sales_read on public.card_sales;
create policy card_sales_read on public.card_sales
  for select to authenticated
  using (
    seller_staff_id = (select auth.uid())
    or seller_ost_id = (select auth.uid())
    or private.has_permission('sales.card_sales')
    or private.has_permission('finance.payment_verification')
    or private.has_permission('finance.card_activation')
  );

-- A seller sees the payments on their own sale; Finance sees all of them.
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select to authenticated
  using (
    private.has_permission('finance.payment_verification')
    or exists (
      select 1
      from public.card_sales s
      where s.id = payments.sale_id
        and (s.seller_staff_id = (select auth.uid()) or s.seller_ost_id = (select auth.uid()))
    )
  );

-- Memberships: own customer, customer staff, activation staff, redemption staff.
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (
    exists (
      select 1 from public.customers c
      where c.id = memberships.customer_id
        and c.auth_user_id = (select auth.uid())
    )
    or private.has_permission('sales.customers')
    or private.has_permission('finance.card_activation')
    or private.has_permission('operations.redemption')
  );

-- Commissions: the beneficiary sees their own, network staff see all.
-- Phase 1 keyed on ost_id only; the beneficiary is now staff-or-OST.
drop policy if exists commissions_read on public.commissions;
create policy commissions_read on public.commissions
  for select to authenticated
  using (
    beneficiary_staff_id = (select auth.uid())
    or beneficiary_ost_id = (select auth.uid())
    or private.has_permission('network.commissions')
  );

comment on policy identity_documents_read on public.identity_documents is
  'Government ID metadata stays narrow on purpose: sales.id_documents or network.ost_registrations only. Finance verifies payments, not identity, and must not gain document access here.';
