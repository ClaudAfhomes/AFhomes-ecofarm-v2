-- Phase 4 - evidence-justified indexes only (review F-27).
--
-- Added after code-path evidence, not speculation:
--   Sale.propertyId - the Property delete-guard (Phase 2) counts Sales by
--   propertyId on every delete; a sales list filtered by property benefits
--   too. No other speculative indexes are added.
-- Down: drop the index by name.

create index if not exists "Sale_property_idx" on "Sale"("propertyId");
