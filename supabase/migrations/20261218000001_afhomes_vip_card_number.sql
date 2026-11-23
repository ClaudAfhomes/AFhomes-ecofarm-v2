-- AF Homes: add official VIP card number to customers (read model).
-- Format: YYMMDDNNNNNVTPMMS (17 chars). Server-allocated or manually entered.
-- Validation: select count(*) from information_schema.columns where table_schema='public'
--   and table_name='customers' and column_name='vip_card_number'; -- 1
-- Down: alter table public.customers drop column if exists vip_card_number;
begin;

alter table public.customers
  add column if not exists vip_card_number text;

-- Unique when present; legacy rows stay null.
create unique index if not exists customers_vip_card_number_unique
  on public.customers (vip_card_number)
  where vip_card_number is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_vip_card_number_format'
  ) then
    alter table public.customers
      add constraint customers_vip_card_number_format
      check (vip_card_number is null or vip_card_number ~ '^[0-9]{11}[BGS]1[CT][0-9]{2}S$')
      not valid;
  end if;
end $$;
alter table public.customers validate constraint customers_vip_card_number_format;

commit;