# GSD Customer Lookup

28 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

GSD's canonical role slug is `employee`, and its local lookup route is
`http://localhost:5184/employee/customer-lookup`. Navigation and direct API access
both require `operations.customer_lookup/view`. The module is independent of the
disabled Services and Redemption modules.

Read-only inspection found one active employee role, one assigned account, an
active lookup module, no role grant for it and no individual view denials. The
MongoDB core installer seeded the old default role matrix but missed the later
`20261131000003_afhomes_customer_lookup_module.sql` grant. Therefore the menu was
correctly hidden and direct API access correctly denied; the fix must restore
reference configuration instead of bypassing authorization in the browser.

Newly created employee/admin reference roles now receive the canonical view-only
lookup grant from the existing migration grant catalog. Existing role records
and explicit saved denials remain unchanged by core initialization. A separate,
operator-only, audited transaction is prepared to add a missing employee lookup
grant. It preserves individual restrictions and existing grants, validates the
existing active bootstrap Super Admin, serializes with organization changes and
rolls back on audit failure. It never runs during startup, login or a lookup.

The user explicitly approved GSD read-only lookup access. Apply exited 0 against
`afhomes_dev`, adding exactly one employee role grant with view=true and
create/update/delete=false, plus the audit event. Post-apply reads verified every
pre-existing role grant, role assignment and individual restriction is unchanged.
No staff identity or password was modified. Refresh the GSD session/menu, or sign
out and back in, then open `/employee/customer-lookup`.

Verification: the new core setup assertion failed before the patch. Five native
core/GSD HTTP tests pass after it: actual synthetic GSD sign-in/password change,
403 before grant, effective session permission plus lookup success after grant,
write/other-module denial, owner checks, replay, staff restrictions, saved role
denials and audit rollback. Thirty-six existing navigation, role route and lookup
UI tests passed. Browser acceptance for the user's account remains pending.
API TypeScript and environment isolation also passed.
