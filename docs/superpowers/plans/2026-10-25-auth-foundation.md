# Better Auth backend foundation implementation plan

**Goal:** Prepare independently configured authentication without activating it
against Atlas or changing the existing application runtime.

**Spec:** `docs/mongodb/PHASE2-AUTH-DESIGN.md`.

**Status:** Completed local backend foundation. Actual MongoDB integration,
identity lifecycle, RBAC port and UI cutover remain separate acceptance gates.

**Architecture:** A server-only factory accepts an injected MongoDB database and
client. Configuration is validated before the library is initialized. Existing
routes, Supabase clients, principal resolvers and frontend providers are unchanged.

**Constraints:** No live database operations, bootstrap, email sends, migration,
deployment, source changes, commits or pushes. No secrets in source or output.

## Tasks

- [x] Add exact backend dependencies `better-auth@1.7.12` and
  `@better-auth/mongo-adapter@1.7.12`; preserve pnpm/lockfile policies.
- [x] Add `api/_lib/auth.ts`: strict server environment validation, exported options
  builder and explicitly invoked factory with injected database/client.
- [x] Add `api/_lib/auth.spec.ts`: missing/invalid configuration, HTTPS/loopback origin
  boundaries, closed registration, cookie protections, uncached sessions, TOTP,
  UUID-string generation and lazy/injected initialization. Mock the adapter;
  no network or real identity store is permitted in these tests.
- [x] Add `api/_lib/auth-runtime.spec.ts`: exercise actual library handlers with
  disposable JavaScript memory storage, including public-signup and origin denial.
- [x] Extend `.env.example` with empty server-only auth settings and extend the
  existing environment-isolation forbidden-name list.
- [x] Run focused tests, API typecheck and environment isolation, then the relevant
  full verification after the source is stable. Record exact results/limits.
- [x] Document the unmounted state and remaining lifecycle/RBAC/database test gates.

## Review focus

- Merely importing the new module must not connect, create indexes or load secrets.
- A missing secret or untrusted/non-HTTPS remote origin fails before initialization.
- Public signup stays closed; no new default credentials or accounts exist.
- Cookies cannot use a wildcard domain or silently bypass origin/CSRF validation.
- String UUID behavior and real transaction/index semantics remain explicitly
  unproven until an approved disposable-database test is executed.
