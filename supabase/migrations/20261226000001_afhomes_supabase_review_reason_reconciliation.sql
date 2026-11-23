-- Reconcile develop's optional review reason on Supabase.
-- 20261211000005 removed a named constraint, but the original table-level
-- constraint was unnamed and PostgreSQL called it customer_application_purchase_terms_check.
-- Validation: select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.customer_application_purchase_terms'::regclass
--   and contype='c' and pg_get_constraintdef(oid) like '%reason%';
-- Expect only the nullable reason-length check; a supplied reason still needs 5-500 characters.
-- Run pnpm test:db:local and supabase/security/rls_invariants.sql (zero violations).
-- Down: forward-only. Restoring the mandatory-reason check requires reviewing
-- existing reasonless review captures; do not rewrite frozen commercial history.
alter table public.customer_application_purchase_terms
  drop constraint if exists customer_application_purchase_terms_check;
