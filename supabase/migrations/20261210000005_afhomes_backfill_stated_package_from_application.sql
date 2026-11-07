-- ============================================================================
-- Backfill company-stated VIP package / payment terms from applications
--
-- PROBLEM
--   Customers created before the application form sent `statedVipPackage` /
--   `statedPaymentTerms` (and customers created via other paths) have NULL
--   `stated_vip_package` / `stated_payment_terms`, so the "Package and
--   Payment (company stated)" card on the customer detail page reads
--   "Not Recorded" even though the linked application captured the card tier
--   and payment scheme.
--
-- FIX
--   For every customer with a linked customer_application, copy the latest
--   application's `tier_snapshot` (uppercased) and `payment_scheme_snapshot`
--   into the customer row, but only where the customer's column is NULL.
--   Coalesce-only in spirit: a manually corrected value is never overwritten.
--
-- IDEMPOTENCE
--   The `where ... is null` guard makes every run a no-op once the backfill
--   has landed; re-running changes nothing.
--
-- VALIDATION (after applying; must return 0)
--   select count(*) from public.customers c
--     join public.customer_applications a on a.customer_id = c.id
--    where c.stated_vip_package is null;
--
-- DOWN
--   No down action needed: the copied values are company-stated facts an
--   operator may already have seen and corrected, and removing them would
--   destroy data. Re-running the guard is a no-op.
-- ============================================================================

update public.customers c
   set stated_vip_package = coalesce(
         c.stated_vip_package,
         (select upper(a.tier_snapshot)
            from public.customer_applications a
           where a.customer_id = c.id
           order by a.created_at desc
           limit 1)
       ),
       stated_payment_terms = coalesce(
         c.stated_payment_terms,
         (select a.payment_scheme_snapshot
            from public.customer_applications a
           where a.customer_id = c.id
           order by a.created_at desc
           limit 1)
       )
 where (c.stated_vip_package is null or c.stated_payment_terms is null)
   and exists (select 1 from public.customer_applications a where a.customer_id = c.id);
