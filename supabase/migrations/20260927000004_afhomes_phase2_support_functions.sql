-- AF Homes Phase 2 - supporting functions for customer identity and onboarding.
-- Validation before apply (must return zero rows):
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname in ('public','private') and proacl is not null
--      and array_to_string(proacl, ',') like '%anon%';
-- Down: drop the two functions and the sequence created here.

create sequence if not exists public.customer_number_seq;
create sequence if not exists public.sale_number_seq;

-- ---------------------------------------------------------------------------
-- Next customer number
-- ---------------------------------------------------------------------------
-- Sequence-backed, so two concurrent registrations can never collide. The
-- unique constraint on customers.customer_number is the backstop.

create or replace function public.next_customer_number()
returns table (customer_number text)
language sql
volatile
as $$
  select 'CUS-' || to_char(nextval('public.customer_number_seq'), 'FM000000')
$$;

-- ---------------------------------------------------------------------------
-- Next sale number
-- ---------------------------------------------------------------------------

create or replace function public.next_sale_number()
returns table (sale_number text)
language sql
volatile
as $$
  select 'SALE-' || to_char(nextval('public.sale_number_seq'), 'FM000000')
$$;

-- ---------------------------------------------------------------------------
-- Customer onboarding token
-- ---------------------------------------------------------------------------
-- Issues a single-use, expiring, HASHED token. The raw value is returned to the
-- calling authorized staff member exactly once and is never stored. No password
-- is generated, read, or stored anywhere in this path.
--
-- Issuing for a customer that is not yet active is refused: account onboarding
-- follows activation, it does not replace it.

create or replace function public.issue_customer_onboarding_token(
  p_customer_id uuid,
  p_purpose text,
  p_valid_hours integer,
  p_actor_id uuid
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
  v_raw text;
  v_expires timestamptz;
  v_hash text;
begin
  if p_actor_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = '42501';
  end if;
  if p_purpose not in ('account_activation', 'password_reset') then
    raise exception 'INVALID_PURPOSE' using errcode = '22023';
  end if;
  if coalesce(p_valid_hours, 0) < 1 or p_valid_hours > 168 then
    raise exception 'INVALID_VALIDITY_HOURS' using errcode = '22023';
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Account activation requires an activated customer. A password reset for an
  -- already-active customer does not.
  if p_purpose = 'account_activation' and v_customer.status <> 'active' then
    raise exception 'CUSTOMER_NOT_ACTIVE:%', v_customer.status using errcode = '55000';
  end if;

  -- Single use: any outstanding token for this purpose is retired first.
  update public.customer_onboarding_tokens
  set consumed_at = now()
  where customer_id = p_customer_id
    and purpose = p_purpose
    and consumed_at is null;

  v_raw := encode(gen_random_bytes(32), 'base64');
  v_hash := private.hash_token(v_raw);
  v_expires := now() + make_interval(hours => p_valid_hours);

  insert into public.customer_onboarding_tokens (
    customer_id, token_hash, purpose, expires_at, created_by
  ) values (
    p_customer_id, v_hash, p_purpose, v_expires, p_actor_id
  );

  return query select v_raw, v_expires;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: service role only. Neither function is reachable from a browser.
-- ---------------------------------------------------------------------------
revoke all on function public.next_customer_number() from public, anon, authenticated;
revoke all on function public.next_sale_number() from public, anon, authenticated;
revoke all on function public.issue_customer_onboarding_token(uuid, text, integer, uuid)
  from public, anon, authenticated;

-- Sequences are advanced by the service role only.
grant usage on sequence public.customer_number_seq to service_role;
grant usage on sequence public.sale_number_seq to service_role;
