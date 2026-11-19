-- AF Homes: Change FK constraint on customer_applications.sale_id to CASCADE.
-- This allows card_sales to be deleted (during test cleanup) and cascades
-- to customer_applications.sale_id (set NULL).
-- Validation: pnpm test:db:local section 21.
-- Down: forward repair only. Restore from backup if needed.
begin;

alter table public.customer_applications
  drop constraint customer_applications_sale_id_fkey,
  add constraint customer_applications_sale_id_fkey
    foreign key (sale_id) references public.card_sales(id)
    on delete set null;

notify pgrst,'reload schema';
commit;