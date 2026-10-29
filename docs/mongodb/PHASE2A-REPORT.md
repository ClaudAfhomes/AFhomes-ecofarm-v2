# Phase 2A backend authentication foundation

25 October 2026. User selected Better Auth + MongoDB. This slice is implemented
locally and **unmounted**; it does not complete the authentication/RBAC cutover.

## Implemented

- Added exact API dependencies `better-auth@1.7.12` and
  `@better-auth/mongo-adapter@1.7.12` using the existing pnpm workspace/lockfile.
  The official MongoDB Node.js driver remains `mongodb@7.7.0`.
- `api/_lib/auth.ts` exports a validated options builder and an explicit factory.
  Importing it does not initialize authentication or the database adapter. The
  factory requires a matching injected database/client and `afhomes_dev`.
- Server-only `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and
  `AFHOMES_AUTH_TRUSTED_ORIGINS` are documented in the template and forbidden by
  the browser environment checker. No actual secret was generated, requested,
  printed or written into the user's local environment file.
- Origin configuration rejects wildcards, credentials in URLs, paths, fragments,
  query strings and remote HTTP. Loopback HTTP is allowed only outside production;
  production requires HTTPS, including for additional trusted origins.
- Password auth is configured with email verification and closed signup. The
  shared ten-character/uppercase/lowercase/digit policy is checked before calling
  Better Auth's own hashing function; verification also uses the library.
- Cookies are configured HttpOnly, SameSite=Lax, host-scoped and Secure over HTTPS,
  with an application-specific prefix. Origin/CSRF checks are explicitly enabled.
  Session cookie caching and account linking are disabled; rate limiting uses
  database storage. Telemetry and adapter debug logging are disabled.
- Session settings are explicit (seven-day expiry, one-day refresh, five-minute
  freshness) and GET refresh is deferred to POST. These proposed settings are not
  presented as verified Supabase project configuration.
- TOTP support is configured. Privileged MFA enforcement, enrollment UI and
  assurance checks in business handlers remain required before cutover.
- UUID generation uses a callback returning a UUID string. The pinned Mongo
  adapter's enum `"uuid"` option instead stores BSON UUIDs, so it is not used.
- Auth models are namespaced as `auth_users`, `auth_accounts`, `auth_sessions`,
  `auth_verifications`, `auth_two_factors`, and `auth_rate_limits`. These are model
  configuration names; no such collections/indexes were created by this work.

## Verification

- New auth tests: **26 PASS** (23 configuration/factory/policy tests and three
  real Better Auth handler tests using disposable JavaScript memory storage).
- Real handlers deny public signup, return no anonymous authenticated session,
  and reject an untrusted origin without creating a user/session. No MongoDB or
  external identity store is involved in these tests.
- A failing origin test exposed the library's test-environment default bypass;
  explicitly setting both security-disable options to `false` made the actual
  rejection test pass. Tests do not disable security to obtain green results.
- Full API suite: **2,741 PASS across 143 files**, exit 0, with the existing
  two-worker setting. No test timeouts, skips or retry settings changed.
- Final review also reproduced and fixed wildcard URL acceptance in configuration;
  base and additional trusted origins reject wildcard hosts explicitly.

- Full `corepack pnpm typecheck`: **PASS**, exit 0; all seven workspace checks
  plus the operator TypeScript check.
- `corepack pnpm build`: **PASS**, exit 0; both SPAs and public prerender. This
  does not prove an authentication workflow because the new factory is unmounted.
- `corepack pnpm check:env -- --built`: **PASS**, exit 0; 701 browser and 299
  server source files plus built assets checked with the new server-only names.
- New files were formatted with the existing Prettier setup. The prior phase's
  complete web/shared/admin suites were not repeated because their runtime code
  is unchanged; no new full-repository test-total claim is made for this slice.

Ignored local evidence: `.phase2a-api-tests.log`, `.phase2a-typecheck.log`,
`.phase2a-build.log`, and `.phase2a-env.log`.

## Runtime and write boundary

No application route imports or mounts this factory. Login screens, frontend
session providers, Supabase session verification, staff permissions, customer/OST
ownership, existing business handlers and `/health` remain unchanged. Redemption
and Services flags remain off.

No Atlas requests were issued by these auth tests. No real account, password,
session, collection, index, invitation or email was created. No Supabase data was
read or migrated. No source-repository changes, credential edits, commits, pushes
or deployments occurred.

The adapter may create indexes during ordinary operations, and session reads may
write unless refresh is deferred. Therefore even an auth "smoke test" against
Atlas needs separately scoped database-write authorization; the Phase 1 ping
authorization does not cover it.

## Next slice

1. Implement transport that preserves multiple cookies and handles raw auth
   requests before JSON body parsing, with public signup still closed.
2. Prove a supported invitation-only identity provisioning/activation flow. Closed
   signup currently also rejects server signup; do not open public registration
   as a shortcut. Retain single-use/expiry checks and prevent orphan identities
   from granting staff access.
3. Port MongoDB principal resolution, deny-only RBAC, customer/OST ownership,
   session revocation and privileged MFA checks before switching UI providers.
4. Obtain an explicit scope for disposable MongoDB integration tests, then verify
   string IDs, indexes, transactions, concurrency, revocation and cookie/browser
   persistence. Do not use existing Atlas data as a test fixture.

See [the design](PHASE2-AUTH-DESIGN.md) for the source evidence, primary library
references, policy proposals and remaining acceptance gates.
