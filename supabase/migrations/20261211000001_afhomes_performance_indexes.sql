-- AF Homes: performance indexes for the customer directory and finance queue.
--
-- Targets the hot paths identified in the loading-speed review:
--   * customer_directory() lateral joins (card_sales by customer, payments by
--     sale, memberships by customer) and its leading-wildcard search.
--   * finance queue reservation aggregation (payments by reservation, sellers).
--
-- Idempotent: every statement uses IF NOT EXISTS / IF EXISTS. Safe to re-run.
--
-- Validation after apply:
--   select count(*) from pg_indexes where indexname like 'afhomes_perf_%';  -- >= 1
--   explain (costs off) select * from public.customer_directory('{}'::jsonb) limit 1;
--
-- Down note: forward-only; drop the named indexes to revert.

create extension if not exists pg_trgm;

-- Customer directory lateral joins.
create index if not exists afhomes_perf_card_sales_customer_created
  on public.card_sales (customer_id, created_at desc);

create index if not exists afhomes_perf_payments_sale
  on public.payments (sale_id);

create index if not exists afhomes_perf_memberships_customer
  on public.memberships (customer_id);

-- Customer directory search (leading-wildcard, trigram-backed).
create index if not exists afhomes_perf_customers_name_trgm
  on public.customers using gin (
    (lower(coalesce(first_name, '') || ' ' || coalesce(middle_name, '') || ' ' ||
           coalesce(last_name, '') || ' ' || coalesce(suffix, ''))) gin_trgm_ops
  );

create index if not exists afhomes_perf_customers_number_trgm
  on public.customers using gin (lower(customer_number) gin_trgm_ops);

create index if not exists afhomes_perf_customers_code_trgm
  on public.customers using gin (lower(customer_code) gin_trgm_ops);

create index if not exists afhomes_perf_customers_email_trgm
  on public.customers using gin (lower(email) gin_trgm_ops);

-- Business id aliases (customer lookup by legacy identifier).
create index if not exists afhomes_perf_business_id_aliases_lookup
  on private.business_id_aliases (entity_type, lower(old_identifier))
  where is_active;

-- Finance queue reservation aggregation.
create index if not exists afhomes_perf_payments_reservation
  on public.payments (reservation_id);

create index if not exists afhomes_perf_reservation_agreements_finance
  on public.reservation_agreements (origin, status, sale_id);