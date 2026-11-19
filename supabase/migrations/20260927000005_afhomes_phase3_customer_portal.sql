-- ===========================================================================
-- AF Homes Phase 3 - customer account activation and portal.
-- ===========================================================================
-- Validation before apply (every query must return zero rows):
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname in ('public','private') and p.prosecdef
--      and array_to_string(coalesce(p.proconfig, '{}'), ',') not like '%search_path%';
--   select has_column_privilege('authenticated', 'public.customers',
--                                'select', 'government_id_number');
--   select has_column_privilege('authenticated', 'public.memberships',
--                                'select', 'qr_token_hash');
--
-- Down: drop public.claim_customer_onboarding_token and
--       public.reissue_membership_credentials, restore the table-wide SELECT
--       grants revoked below, and drop the revoke/grant pairs.

-- ===========================================================================
-- 1. Redemption is a single atomic claim
-- ===========================================================================
-- Supabase Auth and Postgres are not one transaction, so the split is:
--
--   1. read + validate the token and the customer  (no writes)
--   2. create the Auth user                    (outside Postgres)
--   3. THIS FUNCTION: link the customer, consume the token, write the audit
--   4. on (3) failing, delete the Auth user created in (2)
--
-- Everything that can be atomic IS atomic here: the compare-and-set on
-- `consumed_at` and on `customers.auth_user_id` happens under a row lock, so a
-- double submission can never consume the token twice or link two Auth users to
-- one customer. The caller passes the already-hashed token; the plaintext
-- never reaches the database and is never stored or logged.

create or replace function public.claim_customer_onboarding_token(
  p_token_hash text,
  p_auth_user_id uuid,
  p_purpose text default 'account_activation'
)
returns table (
  customer_id uuid,
  customer_number text,
  email text,
  outcome text
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_token public.customer_onboarding_tokens%rowtype;
  v_customer public.customers%rowtype;
begin
  if p_auth_user_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'TOKEN_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- FOR UPDATE serialises concurrent redemptions of the same token.
  select * into v_token
  from public.customer_onboarding_tokens t
  where t.token_hash = p_token_hash
  for update;
  if not found then
    raise exception 'TOKEN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_token.purpose <> p_purpose then
    raise exception 'TOKEN_WRONG_PURPOSE' using errcode = '22023';
  end if;

  select * into v_customer from public.customers c where c.id = v_token.customer_id for update;
  if not found then
    raise exception 'TOKEN_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ORDER MATTERS. Idempotency is decided BEFORE the token and lifecycle checks.
  -- A client that retries after a response was lost must get the same success it
  -- already earned, not "this token was already used" - and it must get it even
  -- if the token has since expired, because the work is already committed. (An
  -- earlier draft checked `consumed_at` first, which made the ALREADY_LINKED
  -- branch below unreachable: a real retry could never be idempotent.)
  if v_customer.auth_user_id is not null then
    if v_customer.auth_user_id = p_auth_user_id then
      return query
        select v_customer.id, v_customer.customer_number, v_customer.email, 'ALREADY_LINKED';
      return;
    end if;
    -- Never silently move an account between customers.
    raise exception 'CUSTOMER_ALREADY_CLAIMED' using errcode = '55000';
  end if;

  if v_token.consumed_at is not null then
    raise exception 'TOKEN_ALREADY_CONSUMED' using errcode = '55000';
  end if;
  if v_token.expires_at <= now() then
    raise exception 'TOKEN_EXPIRED' using errcode = '55000';
  end if;

  if v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE:%', v_customer.status using errcode = '55000';
  end if;

  -- An activation requires an active membership. A token is only ever issued
  -- after activation, so this is a consistency check, not a gate on the customer.
  perform 1
  from public.memberships m
  where m.customer_id = v_customer.id and m.status = 'active';
  if not found then
    raise exception 'CUSTOMER_HAS_NO_ACTIVE_MEMBERSHIP' using errcode = '55000';
  end if;

  update public.customers
  set auth_user_id = p_auth_user_id, updated_at = now()
  where id = v_customer.id;

  update public.customer_onboarding_tokens
  set consumed_at = now(), consumed_by = p_auth_user_id
  where id = v_token.id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_auth_user_id,
    'CUSTOMER_AUTH_ACTIVATED',
    'customer',
    v_customer.id::text,
    jsonb_build_object('customerNumber', v_customer.customer_number, 'via', 'onboarding_token')
  );
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_auth_user_id,
    'CUSTOMER_ONBOARDING_TOKEN_CONSUMED',
    'customer_onboarding_token',
    v_token.id::text,
    jsonb_build_object('customerId', v_customer.id, 'purpose', v_token.purpose)
  );
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (
    p_auth_user_id,
    'CUSTOMER_ACCOUNT_LINKED',
    'customer',
    v_customer.id::text,
    jsonb_build_object('authUserId', p_auth_user_id)
  );

  return query
    select v_customer.id, v_customer.customer_number, v_customer.email, 'CLAIMED';
end $$;

comment on function public.claim_customer_onboarding_token(text, uuid, text) is
  'Atomic, idempotent redemption of a customer onboarding token. Locks the token and the customer, links customers.auth_user_id, marks the token consumed and appends the audit trail in one transaction. The plaintext token is hashed by the caller and never reaches the database.';

-- ===========================================================================
-- 2. Credential re-issue
-- ===========================================================================
-- Only a hash is stored at rest, so the QR token and the fallback member code
-- cannot be recovered for display. Rather than weakening at-rest security (or
-- inventing an encrypted column and a new secret), the identifiers are ROTATED:
-- a fresh 256-bit token and a fresh fallback code are generated, their hashes
-- replace the old ones - so the previous codes stop working immediately - and
-- the plaintext is returned to the caller exactly once.
--
-- `p_customer_id` is supplied by the handler and re-checked here, so a handler
-- bug cannot rotate somebody else's membership.

create or replace function public.reissue_membership_credentials(
  p_membership_id uuid,
  p_customer_id uuid,
  p_actor_id uuid
)
returns table (membership_id uuid, fallback_code text, qr_token text)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_membership public.memberships%rowtype;
  v_fallback text;
  v_qr text;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;

  select * into v_membership from public.memberships m where m.id = p_membership_id for update;
  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Ownership is enforced in SQL, not only in the handler.
  if v_membership.customer_id <> p_customer_id then
    raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- The CUSTOMER's own status, not just the membership's. A suspended member's
  -- membership row is still `active`, so checking only the membership would let a
  -- suspended customer rotate their own card from a direct database call. The
  -- handler refuses this too; the database must not depend on the handler.
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.status = 'active'
  ) then
    raise exception 'CUSTOMER_NOT_ACTIVE:%', (
      select c.status from public.customers c where c.id = p_customer_id
    ) using errcode = '55000';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'MEMBERSHIP_NOT_ACTIVE:%', v_membership.status using errcode = '55000';
  end if;

  v_fallback := private.new_fallback_code();
  v_qr := private.new_qr_token();

  update public.memberships
  set fallback_code_hash = private.hash_token(v_fallback),
      qr_token_hash = private.hash_token(v_qr)
  where id = v_membership.id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_id,
    'CUSTOMER_CREDENTIALS_REISSUED',
    'membership',
    v_membership.id::text,
    jsonb_build_object('previousCodesInvalidated', true),
    jsonb_build_object('membershipNumber', v_membership.membership_number, 'selfService', true)
  );

  -- Plaintext leaves the database exactly once and is never stored.
  return query select v_membership.id, v_fallback, v_qr;
end $$;

comment on function public.reissue_membership_credentials(uuid, uuid, uuid) is
  'Rotates the QR token and fallback member code for an active membership the customer owns. The previous codes are invalidated immediately. Returns the new plaintext exactly once; only hashes are persisted.';

-- ===========================================================================
-- 3. Grants: the two mutating functions are service-role only
-- ===========================================================================
revoke all on function public.claim_customer_onboarding_token(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.reissue_membership_credentials(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ===========================================================================
-- 4. Column-level SELECT grants for browser roles
-- ===========================================================================
-- Row level security decides WHICH ROWS a browser role may read. It says nothing
-- about which COLUMNS. `authenticated` currently holds a table-wide SELECT on
-- public.customers, so a signed-in customer - who legitimately passes the
-- self-read policy for their own row - could read their own
-- `government_id_number`, `referred_by_staff_id` and `referral_code_used`
-- through PostgREST. Same for the membership credential hashes and the points
-- ledger's internal actor/metadata columns.
--
-- Replace the table-wide grant with an explicit column list. This narrows only
-- DIRECT browser access; every server-side read goes through the service role,
-- which bypasses column privileges and is unaffected. Staff screens keep
-- working because they read through the API.

revoke select on public.customers from authenticated;
grant select (
  id, customer_number, first_name, middle_name, last_name, suffix,
  birth_date, gender, email, phone, address, status, auth_user_id,
  created_at, updated_at
) on public.customers to authenticated;

revoke select on public.memberships from authenticated;
grant select (
  id, customer_id, sale_id, membership_number, product_id, status,
  points_balance, yearly_points_allocated, sale_status_at_activation,
  activated_at, expires_at, renewal_due_at, issued_at
) on public.memberships to authenticated;
-- fallback_code_hash and qr_token_hash are credentials, not profile data. A
-- customer reading their own hash gains nothing and it must not leave the DB.

revoke select on public.points_ledger from authenticated;
grant select (
  id, account_id, entry_type, amount, balance_after,
  reference_type, reference_id, reason, created_at
) on public.points_ledger to authenticated;
-- actor_id (a staff id) and metadata (internal) are not member-facing.

revoke select on public.points_accounts from authenticated;
grant select (
  id, membership_id, balance, lifetime_allocated, lifetime_redeemed,
  created_at, updated_at
) on public.points_accounts to authenticated;
