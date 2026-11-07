# Phase 2B auth transport and closed identity setup plan

**Goal:** Verify raw HTTP/cookie handling and a supported owner-password setup
path while keeping the application and Atlas authentication unmounted.

**Scope:** Local target files, loopback HTTP, disposable JavaScript memory stores.
No database writes, real email, bootstrap, source changes, commits, push or deploy.

## Design decision

Better Auth's closed-signup setting also blocks server signup. Its supported
admin-plugin `createUser` API permits server-only creation without a password or
request headers. Use that API in a private provisioning instance whose handler
is never returned or mounted. Return a narrow creation function accepting only
validated name/email, with no password, provider role or verified-email input.
This is a scoped exception to the earlier no-admin-plugin design: the public
instance still has no admin plugin, and provider roles never authorize AFHomes.

The public transport uses an explicit endpoint/method allowlist and the official
raw Node handler. It exposes neither signup nor admin/plugin-management endpoints.
It remains a factory, not a mounted listener in the existing application.

Email verification and password setup use Better Auth's own supported token
endpoints. Tests capture delivery callbacks in memory; no messages are sent.
Staff invitation records, privileged issuer authorization, expiry/revocation of
business invitations, atomic staff activation and RBAC are a later port. A bare
identity can never be treated as active staff.

## Tasks

- Extend shared response headers/dev adapter/test fake to preserve string arrays.
- Add `api/_lib/auth-transport.ts` with a fail-closed raw Node route allowlist.
- Add `api/_lib/auth-provisioning.ts` returning a private server-only creation
  capability, with strict input validation and a safe identity projection.
- Test real loopback HTTP with multiple cookies, unconsumed request bodies,
  closed signup, blocked admin routes and sanitized failures.
- Test real Better Auth APIs with memory storage: no initial credentials/session,
  owner verification, password setting, login/logout, token expiry and replay,
  and rejection of identity/role/password input injection.
- Run focused proof, full API tests, typecheck and relevant build/env checks.
- Document exact outcomes and the remaining MongoDB/RBAC/UI gates.
