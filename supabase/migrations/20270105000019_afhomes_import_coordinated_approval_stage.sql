-- Keep imported draft applications in the coordinated Application & RA review.
-- Migration 16 creates the linked RA at application creation; that provisional
-- agreement alone must not advance an unapproved application to reservation work.
-- Read-model correction only: no customer, approval, payment or snapshot writes.
-- Validation:
--   select position('Continue application and RA approval' in prosrc)>0
--   from pg_proc where oid='private.import_continuation_before_external(uuid,jsonb)'::regprocedure;
--   pnpm test:db:workflow; pnpm test:db:local; security/rls_invariants.sql.
-- Down: forward-only; retain all linked records and restore the classifier only
-- through a later reviewed migration if coordinated approval is ever replaced.
begin;
do $repair$
declare
 definition text;
 old_clause text:=$old$else v_stage:='reservation';v_path:='/admin/sales/reservations/'||a.id::text;v_label:='Complete reservation';end if;$old$;
 new_clause text:=$new$elsif exists(select 1 from public.customer_applications app where app.id=s.application_id and app.status in ('draft','submitted')) then
    v_stage:='application';v_path:='/admin/customers/applications/'||s.application_id::text;v_label:='Continue application and RA approval';
   else v_stage:='reservation';v_path:='/admin/sales/reservations/'||a.id::text;v_label:='Complete reservation';end if;$new$;
begin
 select pg_get_functiondef('private.import_continuation_before_external(uuid,jsonb)'::regprocedure) into definition;
 if position(new_clause in definition)>0 then return; end if;
 if position(old_clause in definition)=0 then
   raise exception 'IMPORT_CONTINUATION_CLASSIFIER_REQUIRES_REVIEW';
 end if;
 execute replace(definition,old_clause,new_clause);
end $repair$;
notify pgrst,'reload schema';
commit;
