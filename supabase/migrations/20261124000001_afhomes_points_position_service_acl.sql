-- AF Homes: allow the server-only points-position RPC to release expired reservations.
-- November 18 revoked service_role EXECUTE while customer_points_position remains
-- SECURITY INVOKER and calls this helper. Real PostgREST returns SQLSTATE 42501.
-- Validation: supabase/recovery/points-position-acl-regression.sql on isolated PG.
-- Down: revoke this grant; no balances, ledger rows, policies or ownership changed.
-- Browser ownership remains checked by the customer API; private is not exposed.
grant execute on function private.release_point_reservations(uuid,uuid) to service_role;