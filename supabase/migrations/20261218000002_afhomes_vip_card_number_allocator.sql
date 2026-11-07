-- AF Homes: server-side allocator for official VIP card numbers.
-- Format: YYMMDDNNNNNVTPMMS (17 chars). Sequential number from a DB sequence.
-- Down: drop function and sequence.
begin;

create sequence if not exists private.vip_card_number_seq start 1;

create or replace function public.generate_vip_card_number(
  p_tier text,
  p_payment_scheme text default 'CASH',
  p_months integer default 1
) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  v_tier text := upper(coalesce(p_tier, 'BRONZE'));
  v_tier_code text;
  v_pay text := upper(coalesce(p_payment_scheme, 'CASH'));
  v_pay_code text;
  v_months text;
  v_seq bigint;
  v_date text;
begin
  v_tier_code := case v_tier when 'GOLD' then 'G1' when 'SILVER' then 'S1' else 'B1' end;
  if v_pay = 'INSTALLMENT' then v_pay_code := 'T'; else v_pay_code := 'C'; end if;
  v_months := lpad(coalesce(p_months, 1)::text, 2, '0');
  if v_pay_code = 'C' then v_months := '01'; end if;
  v_seq := nextval('private.vip_card_number_seq');
  v_date := to_char((now() at time zone 'Asia/Manila')::date, 'YYMMDD');
  return v_date || lpad(v_seq::text, 5, '0') || v_tier_code || v_pay_code || v_months || 'S';
end;
$$;

revoke all on function public.generate_vip_card_number(text,text,integer) from public,anon,authenticated;
grant execute on function public.generate_vip_card_number(text,text,integer) to service_role;

commit;