# Phase 2B auth transport and owner setup

25 October 2026. Implemented locally on `claud/develop`, with the application
authentication still **unmounted**. This is local transport/setup proof, not a
MongoDB authentication or business invitation cutover.

## Implemented

- `api/_lib/auth-transport.ts` provides raw Node request handling using
  `better-call/node`, the adapter already used by Better Auth's Node wrapper.
  Added an exact direct dependency on the already-installed `better-call@1.4.4`
  to use its supported bounded-body API; the wrapper does not expose that option.
- The explicit route/method allowlist includes session, login/logout, email
  verification and password recovery/setup. Public signup, admin endpoints and
  other plugin endpoints are denied before library dispatch. MFA endpoints await
  the assurance/enrollment port; this transport is not ready for live mounting.
- The raw body limit is 65,536 bytes, including streamed requests without
  Content-Length. The configured origin is used instead of forwarded host/proto
  headers. Responses disable caching and transport exceptions return static
  failures without exposing exception details.
- Separate Set-Cookie headers survive transport, including Expires commas.
  Shared response types, the local response adapter and test fake accept header
  arrays. Existing business routing/body parsing is unchanged.
- `api/_lib/auth-provisioning.ts` returns only a server-side creation function.
  A separate private Better Auth instance uses the supported admin `createUser`
  API without request headers. Its handler is never returned or mounted. The
  public instance remains free of admin endpoints; provider roles do not grant
  AFHomes access.
- Input uses the existing strict AFHomes email/name contract. Password, role,
  verification status and arbitrary metadata are rejected. New identities start
  unverified and passwordless, with no session or staff assignment. Callers must
  authorize the issuer before invoking this private capability; no caller is
  wired into the application yet.
- Real library email verification and password-reset APIs prove mailbox-owner
  setup without opening signup. Delivery callbacks only capture synthetic tokens
  in memory. Invalid shared-policy passwords now return the supported API 400
  error rather than an internal exception; a rejected password leaves the setup
  token available for a valid retry.

## Verification

Focused tests: **21 PASS across three new files**. They cover raw bytes, separate
cookies, forwarded-header isolation, denied routes/methods, both body-limit paths,
sanitized failures, strict identity validation, duplicate rejection, passwordless
creation, owner verification/setup, password policy, expired/replayed tokens,
concurrent setup redemption and login/session/logout over real loopback HTTP.

The concurrent test uses the library's disposable memory adapter. It does not
prove MongoDB atomicity, transaction semantics, uniqueness or index behavior.
The HTTP test also verifies hostile-origin signout is rejected and the public
login response does not expose the private provider role.

Broader verification:

- Full API suite: **2,762 PASS across 146 files**, exit 0, two workers. This
  includes the previous auth foundation tests and existing business/API tests.
- Full workspace/operator TypeScript check: **PASS**; seven workspace tasks
  (six cached, API rerun) plus the operator check.
- Frontend build: **PASS**; both build tasks cached. Existing chunk-size warnings
  remain. No new browser integration or workflow acceptance is claimed.
- Built/source environment isolation: **PASS**, 701 browser and 305 server files
  plus built assets checked. No server-only auth variables reach browser code.
- Workspace lint: **PASS**, both SPA tasks rerun with zero errors; 29 existing
  admin warnings and eight existing web warnings remain. The API has no lint
  task; its changes are covered by TypeScript and API tests.
- New implementation/test files formatted with existing Prettier configuration.
  The prior frontend/shared test suites were not repeated because their runtime
  code is unchanged. The loopback test uses native HTTP, not a real browser.

Ignored local evidence: `.phase2b-focused.log`, `.phase2b-api-tests.log`,
`.phase2b-typecheck.log`, `.phase2b-build.log`, `.phase2b-env.log` and
`.phase2b-lint.log`. The source inspection checkout remains clean; nothing is
staged in the target and the environment file remains ignored.

## Boundaries and next work

No Atlas requests, collections, indexes, real identities, messages or business
records were created. No Supabase data was migrated. Existing React login and
business workflows still use Supabase. Redemption and Services stay disabled.
No source-repository edits, credential edits, commits, pushes or deployments.

User correction after this slice: **do not send user invitations**. The next
local slice must preserve administrator-set temporary passwords and require a
server-enforced password change before business access, with authorized staff
creation, consistent identity/staff linking and audit history. The passwordless
setup experiment above remains unmounted and is not approved onboarding. Port
effective staff permissions, customer/OST ownership, revocation and privileged
MFA before any UI cutover.

Actual MongoDB adapter tests require separately scoped disposable database-write
authorization. UUID string persistence, unique indexes, transactions, concurrent
redemption and real browser cookie persistence remain unverified. Do not use
existing Atlas databases as test fixtures.

See [the canonical design](PHASE2-AUTH-DESIGN.md) and
[the prior backend foundation report](PHASE2A-REPORT.md).
