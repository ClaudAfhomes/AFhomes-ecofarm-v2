-- AF Homes: Change FK constraint on commission_records to CASCADE.
-- This allows reservation agreements to be deleted (if ever needed) and cascades
-- to commission records. Fixes test cleanup FK violations.
-- Validation: pnpm test:db:local sections 21, 60.
-- Down: forward repair only. Restore from backup if needed.
begin;

alter table public.commission_records
  drop constraint commission_records_reservation_id_fkey,
  add constraint commission_records_reservation_id_fkey
    foreign key (reservation_id) references public.reservation_agreements(id)
    on delete cascade;

notify pgrst,'reload schema';
commit;