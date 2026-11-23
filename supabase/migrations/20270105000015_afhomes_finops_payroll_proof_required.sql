-- AF Homes: require the proof-bearing entry point for new external payroll payments.
-- Validation: service_role has EXECUTE only on the seven-argument overload.
-- The SECURITY DEFINER wrapper retains owner access to the internal six-argument function.
-- Existing payment history is preserved. Simulation has its separate entry point.
-- Down: forward only. Restore the legacy grant only through an authorized migration.
begin;
revoke all on function public.record_payroll_disbursement(uuid,text,text,text,date,uuid)
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.payroll_disbursements from service_role;
notify pgrst,'reload schema';
commit;
