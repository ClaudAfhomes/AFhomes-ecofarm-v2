-- AF Homes: Change FK constraint on reservation_agreement_signed_documents to CASCADE.
-- This allows reservation agreements to be deleted (if ever needed) and cascades
-- to signed documents. Fixes test cleanup FK violations.
-- Validation: pnpm test:db:local sections 21, 58, 60.
-- Down: forward repair only. Restore from backup if needed.
begin;

alter table public.reservation_agreement_signed_documents
  drop constraint reservation_agreement_signed_documents_agreement_id_fkey,
  add constraint reservation_agreement_signed_documents_agreement_id_fkey
    foreign key (agreement_id) references public.reservation_agreements(id)
    on delete cascade;

notify pgrst,'reload schema';
commit;