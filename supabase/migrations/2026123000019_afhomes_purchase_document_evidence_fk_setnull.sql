-- AF Homes: Change FK constraint on purchase_document_evidence.sale_id to SET NULL.
-- This allows card_sales to be deleted (during test cleanup) and sets
-- purchase_document_evidence.sale_id to NULL.
-- Validation: pnpm test:db:local section 21.
-- Down: forward repair only. Restore from backup if needed.
begin;

alter table private.purchase_document_evidence
  drop constraint purchase_document_evidence_sale_id_fkey,
  add constraint purchase_document_evidence_sale_id_fkey
    foreign key (sale_id) references public.card_sales(id)
    on delete set null;

notify pgrst,'reload schema';
commit;