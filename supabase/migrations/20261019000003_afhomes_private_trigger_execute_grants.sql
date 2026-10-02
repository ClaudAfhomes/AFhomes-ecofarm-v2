-- Correct the default PUBLIC EXECUTE grants discovered by the required RLS
-- invariant audit. These are trigger-only functions, not browser APIs.
-- Validation: supabase/security/rls_invariants.sql returns zero violations.
-- Down: forward-only; never restore browser execute on private trigger code.
-- Applied migration bodies and the D1 function remain untouched.
revoke all on function private.reject_overlapping_commission_rule() from public, anon, authenticated;
revoke all on function private.validate_official_form_holders() from public, anon, authenticated;
