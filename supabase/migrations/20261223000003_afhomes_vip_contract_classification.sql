-- AF Homes: S = Standard; N = Non-Standard VIP contracts.
-- Validation: test:db:external-import on disposable PostgreSQL; run rls_invariants.sql.
-- Down: forward repair only; do not rewrite existing Non-Standard VIP identifiers.
begin;
alter table public.customers drop constraint if exists customers_vip_card_number_format;
alter table public.customers add constraint customers_vip_card_number_format
 check(vip_card_number is null or vip_card_number ~ '^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$');

-- New issuance remains Standard-only through the unchanged official allocator.
-- N is accepted solely to preserve previously issued historical identifiers.
create table if not exists private.vip_card_number_issuances (
 vip_card_number text primary key,
 customer_id uuid not null,
 recorded_at timestamptz not null default now()
);
alter table private.vip_card_number_issuances enable row level security;
revoke all on private.vip_card_number_issuances from public,anon,authenticated,service_role;
insert into private.vip_card_number_issuances(vip_card_number,customer_id)
 select vip_card_number,id from public.customers where vip_card_number is not null
 on conflict(vip_card_number) do nothing;

-- No customer FK: a purged account must not release its issued number for reuse.
create or replace function private.protect_vip_card_number() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='UPDATE' and old.vip_card_number is not null
  and new.vip_card_number is distinct from old.vip_card_number then
  raise exception 'VIP_CARD_NUMBER_IMMUTABLE' using errcode='55000';
 end if;
 if new.vip_card_number is null then return new;end if;
 insert into private.vip_card_number_issuances(vip_card_number,customer_id)
  values(new.vip_card_number,new.id) on conflict(vip_card_number) do nothing;
 if not exists(select 1 from private.vip_card_number_issuances i
  where i.vip_card_number=new.vip_card_number and i.customer_id=new.id) then
  raise exception 'VIP_CARD_NUMBER_ALREADY_ISSUED' using errcode='23505';
 end if;
 return new;
end $$;
revoke all on function private.protect_vip_card_number() from public,anon,authenticated,service_role;
drop trigger if exists protect_vip_card_number on public.customers;
create trigger protect_vip_card_number before insert or update of vip_card_number on public.customers
 for each row execute function private.protect_vip_card_number();
commit;
