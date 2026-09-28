-- AF Homes Phase 17: release-readiness function search_path hardening.
--
-- Validation:
--   select n.nspname, p.proname, p.proconfig
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where (n.nspname, p.proname) in (
--     ('private', 'hash_token'),
--     ('private', 'money'),
--     ('private', 'new_fallback_code'),
--     ('private', 'new_qr_token'),
--     ('public', 'sale_financial_summary'),
--     ('public', 'next_customer_number'),
--     ('public', 'next_sale_number'),
--     ('public', 'next_redemption_number'),
--     ('public', 'next_ost_number')
--   )
--   order by n.nspname, p.proname;
-- Every row must report the fixed path below.
--
-- Down: forward-fix only. Restoring an ambient search_path would reintroduce
-- name-resolution risk and is not a safe rollback. Function bodies and grants
-- are deliberately unchanged.

alter function private.hash_token(text)
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function private.money(numeric)
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function private.new_fallback_code()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function private.new_qr_token()
  set search_path = pg_catalog, extensions, private, public, pg_temp;

alter function public.sale_financial_summary(uuid)
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_customer_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_sale_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_redemption_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
alter function public.next_ost_number()
  set search_path = pg_catalog, extensions, private, public, pg_temp;
