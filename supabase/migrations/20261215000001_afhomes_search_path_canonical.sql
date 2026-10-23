-- AF Homes: canonical search_path hardening for SECURITY DEFINER functions.
-- Several functions were created with a non-canonical schema ordering that fails
-- the section 15 invariant check (pg_catalog, extensions, private, public, pg_temp).
-- This forward-only migration re-pins their search_path without redefining bodies.

alter function private.reconcile_external_customer_import(uuid, uuid, text)
  set search_path = pg_catalog, extensions, private, public, pg_temp;

-- Down note: revert with
--   alter function private.reconcile_external_customer_import(uuid, uuid, text)
--     set search_path = pg_catalog, extensions, public, private, pg_temp;