-- AF Homes: customer claims use the session-authorized server API only.
-- Validation: each browser-role result below must be false; service_role true.
-- select has_function_privilege('anon', 'public.claim_earning_points(text,uuid)', 'execute');
-- select has_function_privilege('authenticated', 'public.claim_earning_points(text,uuid)', 'execute');
-- select has_function_privilege('service_role', 'public.claim_earning_points(text,uuid)', 'execute');
-- Down note: do not restore browser access to an RPC accepting a trusted customer
-- identity. A replacement must bind browser identity to auth.uid() before grants.
-- No customer, claim, balance, ledger, or historical migration is rewritten.

revoke all on function public.claim_earning_points(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_earning_points(text, uuid) to service_role;

comment on function public.claim_earning_points(text, uuid) is
  'Server-only customer claim. The API resolves the customer from the authenticated session; browser roles cannot supply p_customer_id directly. Awards remain atomic and customer-bound.';
