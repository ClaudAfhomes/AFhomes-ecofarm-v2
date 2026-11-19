# Phase 2 authentication design

25 October 2026. Direction confirmed by the user: **Better Auth + MongoDB**.
Implementation starts with an isolated backend foundation. No Atlas writes,
account bootstrap, live invitation email, application cutover or deployment is
authorized by this design. The source AFHomes repository stays read-only.

## Decision and alternatives

**User correction, 25 October 2026:** Do not send user invitations. Preserve
AFHomes staff creation with an administrator-set temporary password and a
server-enforced password change before business access. The Phase 2B
passwordless/email-setup experiment is not the approved onboarding flow.

**VIP/customer activation remains separate:** provide an activation code or link,
then let the customer activate their account and choose a password. Preserve
single-use redemption, expiry and customer-ownership checks. The no-invitations
rule for staff does not remove this existing customer activation workflow.

Use Better Auth for authentication and its official MongoDB adapter with the
existing official Node.js driver. Keep AFHomes authorization and portal ownership
in AFHomes code. Do not replace existing business roles with a library admin or
organization plugin.

Keeping Supabase Auth temporarily would reduce the initial change but retain the
dependency the user chose to remove. A separate hosted identity provider adds an
external identity service; a hand-written password/token system adds avoidable
security ownership. Better Auth is the selected direction, not a claim that its
default configuration meets AFHomes requirements without integration tests.

The first slice adds configuration and tests only. It is deliberately unmounted:
the inherited application keeps its present runtime until the identity lifecycle,
RBAC and customer ownership ports are complete and separately verified.

## Verified integration constraints

- `api/_lib/auth-verify.ts` verifies Supabase bearer tokens and assurance claims;
  the browser session providers/API clients still use the Supabase SDK.
- `api/_lib/afhomes-access.ts` reconstructs active staff, role grants and deny-only
  restrictions on every request. `deny_view` also removes create/update/delete;
  restrictions apply to Super Admin too. Preserve this exact model.
- `api/_lib/customer-access.ts` resolves customer ownership separately from staff
  RBAC. Neither a portal label nor an identifier authorizes a request.
- `afHomesSessionSchema` requires UUID strings for staff/role IDs. The pinned
  Mongo adapter stores BSON UUIDs for `generateId: "uuid"`; a callback returning
  `crypto.randomUUID()` retains string IDs. This was verified in the published
  adapter source, and still needs database round-trip proof before acceptance.
- The adapter can create indexes during its operations. Library session reads
  can also refresh persisted sessions. Treat auth initialization/requests against
  Atlas as write-capable operations, not as the Phase 1 read-only ping.
- Phase 2B widens shared response headers to support separate `Set-Cookie`
  values and proves raw Node transport on loopback. It remains unmounted;
  do not join cookie values with commas.
- A raw Node auth handler must be mounted before the existing JSON body parser;
  parsed business routes must continue through the shared router. Resolve local
  and retained Vercel compatibility together; do not add an Express server.

## Backend configuration for the first slice

- Pin `better-auth` and `@better-auth/mongo-adapter` to matching `1.7.12` releases.
  Registry metadata identifies MIT licenses and MongoDB 6/7 peer compatibility.
  Recheck advisories before future upgrades; no blanket vulnerability-free claim.
- Inject the database/client explicitly into a factory. Importing the module,
  starting the existing API or running the ping must not initialize Better Auth.
- Read the server-only `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`; validate them
  without printing values. No generated secret or credential is committed.
- Enable password authentication and require email verification. Disable public
  email/password signup in this initial slice. Do not add social login, magic-link
  login, anonymous access, a publicly reachable library admin plugin or
  organization roles. Phase 2B uses a separate private admin-plugin instance
  solely for its supported server-side identity-creation API; its handler is
  never exposed and provider roles do not authorize AFHomes operations.
- Preserve the shared ten-character/lowercase/uppercase/digit password policy
  before delegating hashing to Better Auth's crypto functions.
- Use the library's password hashing and supported session APIs. Cookie sessions
  are HttpOnly and SameSite=Lax; HTTPS is required outside loopback development.
  Trusted origins are explicit, with no wildcard origins or disabled CSRF checks.
- Explicitly keep `disableOriginCheck: false` and `disableCSRFCheck: false`.
  The pinned library otherwise skips origin checks by default in a test environment;
  real-handler memory tests must exercise the same checks as production.
- Disable telemetry explicitly. Disable session cookie caching so revocation is
  checked against storage. Defer GET-session refresh writes to POST; this does not
  make the adapter generally read-only or authorize contacting Atlas.
- Keep the library's documented seven-day session / one-day refresh defaults
  explicit for this foundation. Five-minute freshness is the proposed requirement
  for sensitive identity changes. These are proposed policies, not verified
  Supabase project settings; validate/review them before live activation.
- Include the TOTP plugin for later MFA integration. Having the plugin configured
  does not enforce the existing Admin/Super Admin policy on AFHomes endpoints.
  Server-side assurance gating is a required later port before cutover.

## Identity lifecycle and authorization gates

Authentication collection models belong to the library; business staff/customer,
roles, assignments and restrictions remain separate. Identity and business-link
uniqueness must be enforced by reviewed indexes before enabling writes.

Staff creation needs an authorized administrator, a validated temporary password,
consistent identity/staff linking and audit history. Public signup stays closed.
Enforce the forced-password-change gate server-side until the owner changes the
temporary password. Do not send invitation or initial password-setup links.
Phase 2B's passwordless memory experiment must be replaced for onboarding; it
does not prove this approved temporary-password flow. Do not automatically match
source accounts by email or accept browser role claims as authority.

Password recovery must use library tokens, generic responses, approved callback
origins, transactional mail delivery and session revocation. MFA enrollment must
be verified before activation; pending/partial MFA sessions cannot authorize
business operations. Preserve the source's configured privileged MFA policy and
forced-password-change gate; missing policy/configuration must fail closed.

Do not accept a MongoDB identity and then forward it into an unconverted Supabase
service-role handler. New sessions may access only converted, authorized endpoints;
unconverted business routes stay unavailable in the eventual MongoDB runtime.
There is no fallback between identity systems and no dual write.
Cookie-authenticated business mutations also require server-side CSRF protection;
the library's own endpoint protections do not automatically cover the existing
AFHomes business router. That shared boundary must be implemented before cutover.

## Acceptance and delivery order

1. **Backend foundation (this slice):** explicit factory/config validation,
   closed signup, cookie/origin settings, UUID-string strategy, telemetry off,
   TOTP wiring and local tests. No route mounting or external database access.
2. **Transport and lifecycle:** cookie transport/body parsing, administrator-created
   temporary-password accounts, forced change, login/logout/recovery/MFA and token replay tests with injected
   local stores. Use an explicitly approved disposable database for real adapter
   round trips, unique indexes and transaction/concurrency tests.
3. **MongoDB authorization:** port staff principal/effective grants, customer/OST
   ownership, portal/session contracts and immediate revocation. Test denial and
   cross-account cases before changing browser session providers.
4. **UI integration:** preserve existing forms and navigation; replace SDK calls
   behind current session providers/API clients. Clear all identity-scoped query
   state on logout, revocation or account switching. Validate reload persistence
   and complete MFA/recovery flows in a real browser.
5. **Cutover review:** verify the full chain before enabling a MongoDB runtime.
   No source data migration, production bootstrap, deployment or push is implied.

## Primary references checked

- [MongoDB adapter](https://better-auth.com/docs/adapters/mongo): official driver
  integration, transaction/retry behavior and index-capable adapter source.
- [Session management](https://better-auth.com/docs/concepts/session-management):
  storage-backed sessions, caching/revocation and deferred refresh writes.
- [Two-factor authentication](https://better-auth.com/docs/plugins/2fa): TOTP,
  verified enrollment and the distinction between pending and completed sign-in.
- [Security](https://better-auth.com/docs/reference/security): password hashing,
  cookie/origin/CSRF controls and session handling.
- [Admin API](https://better-auth.com/docs/plugins/admin): supported server-only
  user creation with an optional password, isolated from public routing.
- [Email/password](https://better-auth.com/docs/authentication/email-password):
  email verification and owner-controlled password reset/setup.
- [Installation / Node handler](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/installation.mdx):
  raw handler integration before body parsing.
- [Release history](https://better-auth.com/changelog) and
  [security advisories](https://github.com/better-auth/better-auth/security/advisories).
  Published npm `@better-auth/mongo-adapter@1.7.12` source was read without executing it.
