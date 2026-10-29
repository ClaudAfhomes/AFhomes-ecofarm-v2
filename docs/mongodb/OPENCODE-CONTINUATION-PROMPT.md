# AFHomes MongoDB continuation prompt for OpenCode

Copy the contents below into OpenCode, or attach this file and instruct the model
to execute it. Intended model: Nemotron 3 Ultra 550B A55B, as selected by the user.
This is a work specification, not a model configuration or deployment approval.

---

You are continuing an EXISTING AFHomes application conversion in the local
repository. Implement and verify the work phase by phase. Do not build another
application, redesign the interface, or stop after writing another plan.

## 1. The exact objective

Make the existing AFHomes application work end to end using MongoDB and Better
Auth instead of Supabase, preserving the same user-visible functionality,
business rules, roles, permissions, forms, calculations, reports and workflows.

The requested changes are the persistence/authentication infrastructure and the
already-approved hiding/disabling of Redemption and operational Services.
Everything else must retain its existing behavior. New infrastructure must serve
the existing application, not dictate a new product or workflow.

Do not simplify a complex feature into basic CRUD. Do not substitute mock
responses, hardcoded totals, empty arrays, fake success, disabled buttons or
unfinished handlers for working functionality.

## 2. Repositories, workspace and non-negotiable boundaries

- Work ONLY in `C:\Users\SSD-CLAUD\afhomes-mongodb`, target repository
  `https://github.com/ClaudAfhomes/afhomes-mongodb`, branch `claud/develop`.
- Source repository is READ-ONLY:
  `https://github.com/ClaudAfhomes/AFhomes-ecofarm-v2`, source branch `develop`.
- Copied source snapshot: `f512c1416550feaf0c79a6bb204c51d08fa990f6`.
  A read-only inspection clone exists at
  `C:\Users\SSD-CLAUD\afhomes-mongodb-source-inspect`. Verify before using it.
- Preserve independent target Git history. Do not merge source history, replace
  target `.git`, add source remotes or recopy over the current target work.
- The import and subsequent changes were largely untracked/uncommitted at handoff.
  Untracked files are existing work, not disposable files. Inspect live status.
  Never reset, clean, overwrite or delete them to obtain a clean checkout.
- No source repository changes. No existing Supabase data migration, account
  copying, password-hash import or production data export.
- Do not modify ANY existing MongoDB database, including Atlas `afhomes_dev`.
  Do not run seeds, index creation, validators, account creation, auth requests
  or cleanup against Atlas under this prompt.
- Atlas context is project `AFHomes MongoDB`, cluster `Cluster0`, database
  `afhomes_dev`, application user `afhomes_dev_app`. Treat these as supplied
  configuration labels, not proof of currently verified administrative state.
- `MONGODB_URI` and `MONGODB_DB` are server-only and loaded from ignored local
  environment files. Never print, copy into Markdown, commit or expose credentials.
  Do not edit the user's Atlas credentials or change Atlas network/account settings.
- The existing `corepack pnpm mongodb:ping` is authorized for read-only connection
  verification. It issues only `{ ping: 1 }`. Auth/session requests are NOT ping:
  they may create indexes or write data.
- No commits, pushes, remote writes, deployment or DigitalOcean setup without
  separate explicit user approval. Do not follow a skill's routine commit step
  when it conflicts with these instructions.
- Do not send invitations, mail, SMS or other messages to real people. Local
  captured-mail fixtures are allowed. Actual transactional delivery requires
  separately authorized credentials/provider/destination scope.

Local implementation and synthetic tests are the work requested here. Use a
new, disposable, loopback-only MongoDB replica set and fresh synthetic data for
write/integration tests. Keep its data and test configuration separate from all
existing databases and the user's Atlas `.env.local`. Never fall back to Atlas
if local setup fails. Confirm the resolved local host, port, database and test
marker before creating or deleting test data. Cleanup may target only this
run's verified disposable resources. Do not delete an existing database or
Docker volume. If required local tooling is unavailable or a proposed action
would alter shared services, report the exact blocker and continue independent
local implementation; ask only for the missing scope actually needed.

## 3. User decisions that override old plans and experiments

### Staff, IST and OST onboarding

We DO NOT send user invitations.

Preserve the existing authorized administrator-created account flow:

1. An authorized administrator creates the account with its existing role,
   department/team associations and temporary password.
2. The user signs in with that temporary password.
3. The system requires the user to choose a new password before business access.
4. Enforce this restriction on the SERVER as well as in navigation and guards.
5. Clear the restriction only after a successful password change, using a
   consistent and recoverable identity/business-state boundary.

Keep the existing UI's temporary-password entry/confirmation. Where a source
import already generates individual temporary credentials, preserve that exact
workflow. Do not invent universal/default passwords, email invitations, public
registration, passwordless onboarding or mandatory emailed setup links.
Passwords belong only in the authentication system as secure hashes, never in
business documents, audit payloads, ordinary logs or committed fixtures.

Inspect source behavior instead of blindly retaining the experimental config:
`api/_handlers/admin/afhomes.ts` uses `createAfHomesStaffSchema`, passes the
temporary password to auth, sets `email_confirm: true`, and persists
`must_change_password: true`. The current staff creation schema accepts 8–128
characters; recovery/new-password policy is separately defined in shared code.
The Phase 2A hash callback currently applies recovery policy globally. Resolve
this mismatch so the migration preserves the source's operation-specific
validation; do not silently change password rules or require email activation
for administrator-created staff. Use the library's supported secure APIs.

### VIP/customer activation

VIP customers STILL receive an activation code OR link. Preserve this separate
existing workflow:

1. Authorized staff issues the customer activation credential using existing
   eligibility/ownership rules.
2. The customer enters the code or opens the link and chooses a password.
3. The backend checks purpose, expiry, single-use state and the correct customer
   association; it atomically consumes the token and links the identity.
4. Preserve existing already-linked-account behavior without allowing email-only
   takeover, relinking another customer, replay or cross-customer access.

VIP activation is not a staff invitation. Do not remove it because staff
invitations are prohibited. Preserve existing delivery/manual-copy options;
local tests capture delivery and do not send actual messages.

### Provider and deferred modules

- Better Auth + MongoDB is CONFIRMED. Do not switch providers, introduce a
  home-grown password/JWT system, or retain Supabase Auth as the final provider.
- `packages/shared/src/features.ts` keeps `redemption: false` and
  `services: false`. Preserve their implementation files. Hide and deny their
  navigation, direct routes, API actions and report/export paths.
- Do not disable existing Sales/Finance payments, memberships or retained
  customer dashboard points simply because operational Services/Redemption are
  disabled. Follow the current flags and source tests exactly.
- Keep CMS destination/experience content distinct from operational Services.

## 4. What already exists; verify before changing it

The project is a pnpm/Turborepo monorepo with React/Vite SPAs, TypeScript API,
REST envelopes and Zod contracts. Retain this architecture and existing UI.
Do not introduce Next.js, an ORM, a replacement frontend, Express, a new role
model or a generic Supabase-compatible chainable query emulator.

Implemented locally at handoff:

- Phase 1 source copy, independent target history, disabled feature flags,
  official `mongodb@7.7.0`, secure env loading, read-only ping and conversion audit.
- A historical authenticated ping to `afhomes_dev` passed after the user corrected
  credentials. This is not current proof of workflow or collection permissions.
- `api/_lib/mongodb.ts`: explicit client/ping factory; currently guarded to
  `afhomes_dev`. Do not weaken this guard to make arbitrary remote tests work.
- `api/_lib/auth.ts`: unmounted Better Auth configuration/factory;
  `better-auth@1.7.12`, `@better-auth/mongo-adapter@1.7.12`.
- `api/_lib/auth-transport.ts`: unmounted bounded raw Node transport using
  `better-call@1.4.4`; preserves independent cookies, ignores forwarded origin
  headers, allowlists methods/endpoints, blocks public signup/admin routes.
- Shared response types/local adapter/test fake support header arrays.
- `api/_lib/auth-provisioning.ts` and its tests demonstrate a PRIVATE library
  admin API capability. Its passwordless/mailbox-setup experiment is NOT the
  approved staff onboarding. Correct it; do not mount its admin handler.
- Memory-adapter tests and real loopback HTTP tests exist. They are not real
  MongoDB transaction, index, BSON-type or browser proof.
- Application login and business workflows still use Supabase at handoff.
  There is no completed MongoDB runtime/cutover.

Recorded historical checks, not numbers to copy as fresh results:

- Validation cleanup: 4,574 tests / 326 files passed before auth additions.
- Latest Phase 2B API run: 2,762 tests / 146 files passed.
- Workspace/operator typecheck, lint, source/built env isolation passed.
- Both frontend build tasks passed from cache; existing lint/chunk warnings remain.

Start by reading, in this order, only the relevant context:

1. Root `AGENTS.md`, relevant nested instructions, `README.md`, package scripts.
2. `docs/mongodb/PHASE1-REPORT.md` and `VALIDATION-CLEANUP.md` for the foundation.
3. `PHASE2-AUTH-DESIGN.md`, `PHASE2A-REPORT.md`, `PHASE2B-REPORT.md`.
4. `CONVERSION-PLAN.md` and `SUPABASE-INVENTORY.md`.
5. Actual callers, contracts, handlers, SQL functions/policies/triggers and tests
   for the phase being implemented. SQL is behavior evidence; do not execute it
   against the original service.

Some old docs/tests use invitations or refer to abandoned source phases. The
latest user rules in section 3 take priority. Do not port a retired flow just
because its code still exists. Do not infer that every literal `.from()` match
is a database table; the static inventory contains false positives/dynamic gaps.

## 5. Rules for implementation and parity

- Search with targeted `rg`. Find real symbols and paths before editing. Do not
  invent roles, permission keys, collection names, fields or status transitions.
- Preserve existing routes, REST envelopes, Zod schemas, pagination, filters,
  normalization, error meanings and displayed fields. Infrastructure-only API
  seams may change behind existing callers where necessary; no product redesign.
- Preserve existing effective authorization: active principal, role grants,
  deny-only restrictions, organization/hierarchy scope and portal ownership.
  Re-resolve server-side. No browser-provided role/actor/sponsor is authority.
  A Better Auth provider role never grants AFHomes business permissions.
- Translate every SQL CHECK, unique index, foreign key, trigger, RPC, projection
  and RLS behavior that an enabled workflow depends on. MongoDB has no equivalent
  automatic application RLS; authorization must be explicit in every access path.
- Keep UUID string REST IDs and consistent reference types. The pinned Mongo
  adapter's `generateId: "uuid"` stores BSON UUIDs; the existing UUID callback
  was chosen to retain strings. Verify real round trips rather than assuming.
- Preserve business-number formats. Allocate atomically with counters and unique
  indexes; no max+1/count+1 or reuse of issued identifiers.
- Preserve exact money/rounding and integer points rules. Reuse existing decimal
  string/BigInt helpers; never replace financial arithmetic with floating point.
- Preserve date-only versus UTC timestamp semantics and business timezone rules.
- Use actual replica-set transactions for multi-document invariants. Pass the
  session to every participating operation; no concurrent operations on a single
  transaction session. Use conditional transitions and durable idempotency keys.
- Transaction callbacks may retry. Put external side effects behind a durable
  outbox/recoverable boundary; do not send email or upload files in a retried
  callback. Identity/staff/customer linking needs explicit failure recovery.
- TTL indexes perform cleanup, not authorization. Check expiry/status during
  redemption, approval and access checks.
- Do not mix Mongo identity sessions with unconverted Supabase service-role
  handlers. Do not dual-write or silently fall back to the original system.
  Until all endpoints are ported, an explicit local Mongo runtime must deny
  unconverted routes. Final active runtime must be independent of Supabase.
- Preserve private files, signed delivery, field projections, audit/history,
  protected-history deletion blockers and distinct deactivation/anonymization.
- Add focused behavior/denial tests before implementation, then meaningful real
  database and browser proof. Preserve assertion strength; do not delete tests,
  skip failures, open registration, disable CSRF, broaden roles or loosen flags
  to obtain passing results.
- Use official docs/installed types for pinned version-sensitive APIs. Reuse
  existing dependencies; add only necessary reviewed packages with lockfile.
- Work sequentially; do not spawn agents or configure extra model calls unless
  the user explicitly authorizes delegation. Keep changes scoped to each phase.

## 6. Execute these phases in order

For EVERY phase: inspect the source contract, implement the full vertical slice,
run focused tests and relevant regression checks, update the parity ledger and
record evidence. Continue to the next phase when local acceptance passes. Do not
ask for routine implementation choices. Stop dependent work only for a genuine
missing decision, unsafe action or failed gate; continue independent work.

### Phase 0 — Protect and establish the baseline

- Inspect branch, remotes, status and existing changes without changing remotes.
  Confirm target/source boundary. Preserve all current work and ignored secrets.
- Check Node/Corepack/pnpm, pinned dependencies and available local test tooling.
- Run/reuse current targeted checks; establish reproducible failures separately
  from historical report results. Never blame new regressions on old reports.
- Locate actual runtime entry points, route registration, frontend providers,
  body parsing, contract boundaries and enabled/disabled feature paths.
- Deliver `docs/mongodb/CONTINUATION-STATUS.md` with a phase checklist, current
  branch, boundary checks, latest evidence, blockers and exact next action.

Acceptance: protected source/target separation and an honest starting state.

### Phase 1 — Build the complete functionality parity ledger

- Create `docs/mongodb/FUNCTIONALITY-PARITY.md`.
- Inventory every enabled UI action/route, API method, background/operator
  dependency, RPC and required invariant. Include hidden ownership/projection,
  concurrency and failure behavior, not just page titles.
- Map each to source files/tests, Mongo collections/indexes/service replacement,
  auth/scope rules and acceptance tests. Mark NOT STARTED / IMPLEMENTED /
  UNIT VERIFIED / DATABASE VERIFIED / BROWSER VERIFIED / BLOCKED separately.
- Explicitly classify disabled modules and retired flows; preserve their source.
- Cover Sales, Finance, Customers/VIP activation, IST/OST, Sales Network,
  Organization, RBAC, Reports, existing forms/imports/files, customer/IST portals,
  account lifecycle, CMS and operational prerequisites used by enabled workflows.

Acceptance: no enabled feature can disappear unnoticed during conversion.

### Phase 2 — Local MongoDB integration and integrity foundation

- Prepare a disposable local replica-set test harness, scoped synthetic fixtures
  and explicit safe cleanup. Never read Atlas env as a test fallback.
- Keep production configuration guarded; introduce only the minimal explicit
  local test injection/configuration necessary to test actual driver factories.
- Implement reviewed collection/index/validator setup as an explicit operator
  step, not a side effect of import, app startup, health or ping. Execute only
  against this run's disposable local instance.
- Implement consistent ID/value mapping, counters, transaction/session handling,
  conditional transitions, duplicate-key/error translation and idempotency.
- Provide private local storage/captured-mail boundaries where needed for later
  phases; no real delivery or cloud credentials.
- Verify persisted UUID types/references, uniqueness, partial indexes, rollback,
  concurrent counters, retry behavior and rejection of unsafe test targets.

Acceptance: real local driver and transactions work, with no shared DB changes.

### Phase 3 — Correct authentication and the two account flows

- Replace the passwordless staff experiment with authorized temporary-password
  creation using supported Better Auth APIs, preserving source-specific policy.
- Implement sign-in/out, sessions, expiry/revocation, forced first-login password
  change, account recovery and the source's privileged MFA/assurance behavior.
- Resolve administrator-confirmed email semantics from source without requiring
  invitations or weakening mailbox verification in customer flows.
- Preserve staff/IST/OST/customer entry points and existing portal routing.
- Implement VIP code/link token issuance/redemption infrastructure and separate
  customer association/ownership, completed with customer data in Phase 5.
- Correct the current transport allowlist for required MFA/recovery endpoints
  only after their security flow is implemented; keep signup/admin HTTP closed.
- Mount raw identity handling before JSON parsing in a local Mongo runtime;
  preserve multiple cookies, limits, origin checks and sanitized failures.
- Protect cookie-authenticated BUSINESS mutations against CSRF too. Better Auth
  protects its own endpoints, not the whole existing business router.
- Test unauthenticated/temporary-password/partial-MFA/disabled/revoked sessions,
  replay/expiry, wrong-account activation, concurrent redemption and recovery.
  Use local synthetic privileged accounts only; no real bootstrap.

Acceptance: both approved account flows work with real local MongoDB; temporary
or insufficiently assured sessions cannot use business endpoints.

### Phase 4 — Organization, permissions and account lifecycle

- Port departments, staff, roles, role grants, assignments and deny restrictions.
- Preserve exact system-role protections, assignable-role subset rules and scope.
  Restrictions apply to Super Admin as defined in existing code.
- Implement fresh server principal resolution, separate customer ownership,
  permission-consistent navigation/direct-route/action/API/export behavior.
- Preserve profile/account changes, deactivation, logout-all, guarded removal and
  anonymization. Retain business-history blockers and audit events.
- Prove IDOR, cross-scope and privilege-escalation denials plus next-request
  enforcement after role/restriction/deactivation changes.

Acceptance: a valid identity alone grants no business access; source RBAC holds.

### Phase 5 — Catalog, customers, VIP activation and customer portal

- Port enabled card categories/plans/products, exact pricing/payment-scheme rules,
  customer directory/detail/search/profile and existing eligibility checks.
- Preserve confidential field projections and document access restrictions.
- Complete staff-issued VIP activation code/link, customer password choice,
  atomic linking, audit history, issue/reissue/revoke/expiry behavior from source.
- Port existing enabled customer dashboard/card/membership/payment-history and
  read-only points surfaces. Disabled redemption/service paths stay disabled.
- Test activation through UI/API/real DB, refresh persistence, already-linked and
  cross-customer cases. Account activation must not invent sale eligibility or
  bypass the membership/Finance business lifecycle.

Acceptance: customers and customer portal preserve source behavior and privacy.

### Phase 6 — IST/OST and Sales Network

- Port existing administrator-created IST/OST accounts with temporary passwords,
  accreditation, renewals, photos, AA identifiers, statuses, transfers and portals.
- Port referrals/genealogy/team visibility and exact-role transitions. Prevent
  cycles and unauthorized sponsor/team changes. Preserve existing valid referral
  contexts; do not reintroduce retired public account registration/invitations.
- Preserve immutable sale-time hierarchy snapshots. Current genealogy must not
  rewrite past sales/commission/report attribution.
- Port enabled public verification/search with existing privacy/readiness gates,
  minimal output and existing anti-abuse integration. Do not replace it with a
  new provider or weaken fail-closed configuration.
- Verify duplicate/invalid AA numbers, team changes, cycles, status/expiry and
  cross-team/customer access denials with persisted data.

Acceptance: network administration, permitted portals and historical attribution
work exactly as before.

### Phase 7 — Applications, reservations and official forms

- Port all enabled application/purchase wizard steps, holders, purchase terms,
  reservation agreements/schedules, review/approval/decline and continuation.
- Preserve draft/review/edit locks, required fields, validation, source lifecycle
  transitions, versioned/signed snapshots and generated document contents.
- Preserve continuation/payment-claim idempotency and authorized approval gates.
- Port required file/signature operations using private storage boundaries.
- Test create/review/correct/approve/continue flows, duplicate requests, stale
  versions, reload persistence, generated artifacts and denial cases.

Acceptance: source forms complete real workflows, not just save generic documents.

### Phase 8 — Sales, Finance, memberships and commissions

- Port sale creation/numbering/terms/hierarchy snapshots and full existing sales
  lifecycle, payment recording/verification/rejection/void/reversal/cancellation,
  reservations, Finance summaries/queues and permitted corrections.
- Use source calculations and status maps. Recorded/rejected/voided payments
  cannot count as verified funds. Preserve source restrictions on activation.
- Activate a sale atomically: recheck verified totals and eligibility, create
  exactly one membership, linked records/points/commissions and audit history.
- Preserve commission qualification/rates/eligibility, frozen hierarchy/terms,
  corrections and historical business snapshots. Never infer ancestry from a
  current team graph for a sale missing historical evidence.
- Preserve existing membership credentials/QR/fallback behavior and ownership;
  rotation is distinct from disclosure/recovery.
- Prove duplicate and concurrent payment/activation behavior, rollback, exact
  totals/rounding, immutable history, permission removal and retry outcomes.

Acceptance: a complete permitted purchase-to-payment-to-membership journey works
against real local MongoDB, and failed steps leave no inconsistent partial graph.

### Phase 9 — Imports, files, background jobs and recovery

- Port supported customer/member/IST/OST workbook formats, validation/review,
  resumable rows, claims, continuation, fingerprints, duplicate detection,
  per-row idempotency, audit/export and temporary-credential handling from source.
- Do not use existing Supabase data as test input. Use realistic synthetic files.
- Complete receipts/IDs/photos/signatures/CMS media storage: private authorization,
  size/type/path checks, short-lived delivery, replace/delete rules and metadata.
  MongoDB replaces database/auth; it is not automatically a private object store.
- Reuse an approved provider if verified configured; otherwise use a private
  local adapter for end-to-end proof and report the production-provider decision
  as blocked. Never silently publish files or choose a paid/cloud provider.
- Port required cleanup/readiness/scheduling and durable outbox/retries. No job
  registration against shared services. Preserve fail-closed privacy gates.
- Test partial failure/resume, duplicated delivery/claims, abandoned files,
  unauthorized download, job retries and relevant retention behavior.

Acceptance: supported imports/files/jobs are durable and recoverable locally;
external provider limitations are identified, not hidden by fake success.

### Phase 10 — Reports, analytics, exports, audit and CMS

- Port every enabled report/dashboard/export and existing CMS/public content
  behavior identified in the ledger, retaining filters, sorting, pagination,
  totals, date semantics, visibility and document formats.
- Use scoped MongoDB queries/aggregations and explicit projections. Authorize
  exports as strictly as screens. Retain audit append-only semantics.
- Verify report totals against source-rule synthetic fixtures with verified,
  rejected, voided, cancelled and historical-team cases; test scope boundaries.
- Redemption reports and operational service catalogs remain hidden/denied.

Acceptance: outputs reconcile to authoritative persisted business records with
the same effective permission and historical attribution rules.

### Phase 11 — Finish frontend integration and remove runtime Supabase coupling

- Replace browser Supabase SDK auth/session calls behind existing session
  providers, API clients and forms. Keep the existing React UI and layout.
- Preserve loading/error/retry, redirects/portal routing, forced change, recovery,
  MFA, expiry handling and query-cache clearing on logout/account change.
- Complete route registration/dev-server/body-parser/env integration. Update
  health/readiness to reflect MongoDB without writes or credential leakage.
- Audit every enabled runtime entry point for Supabase database/auth/storage/RPC
  dependencies, including dynamic calls and scripts used at startup.
- Remove active runtime coupling only after replacements pass. Historical SQL,
  disabled source and reference tests may remain clearly classified; do not
  delete protected source merely to make a text search return zero matches.
- Final Mongo runtime must function without Supabase credentials/network access.
  An unconverted enabled route is a blocker, never a silent fallback.

Acceptance: all enabled source workflows are integrated with MongoDB/Better Auth
through the preserved interface and cannot contact Supabase at runtime.

### Phase 12 — Full end-to-end parity and failure verification

- Run full relevant suites, typecheck, lint, builds and source/built env checks.
- Run actual MongoDB replica-set integration/concurrency tests and real browser
  workflows with network/console evidence, refresh and persistence checks.
- Cover authorized staff creation -> temporary login -> forced change -> allowed
  business access; denied access before change; privileged MFA; revoke/logout.
- Cover VIP activation by supported code/link -> password -> correct customer
  portal, plus expired/replayed/wrong-customer/already-linked cases.
- Cover organization/RBAC, customers, IST/OST/network, forms/reservations,
  Sales/Finance/activation/commissions, imports/files, reports/exports and CMS.
- Prove denied navigation/direct URLs/API mutations/exports and disabled modules.
- Test injected failures, replay/concurrency, permission changes, sensitive-field
  leakage, protected-history removal and exact-money report reconciliation.
- Verify browser assets contain no server credentials and requests do not
  reach Supabase. A mock-only pass or successful build is not acceptance.

Acceptance: every enabled ledger row has real evidence or an explicit blocker.
Do not declare the entire conversion complete while any enabled workflow is
stubbed, still uses Supabase, or lacks its required database/browser proof.

### Phase 13 — Prepare the reviewable handoff; protect remote boundaries

- Deliver `docs/mongodb/END-TO-END-REPORT.md` with implemented phases, commands,
  exact results, evidence paths, warnings and remaining blockers.
- Update the parity ledger and continuation status so a new session can resume
  without guessing. Include safe local run/test instructions and configuration
  NAMES only; never include credentials or temporary passwords.
- Prepare reviewed schema/index setup and deployment prerequisites as files,
  including recovery/backup considerations, but do not apply to Atlas or deploy.
- Clearly distinguish LOCAL VERIFIED, ATLAS NOT RUN and DEPLOYMENT NOT RUN.
- If local end-to-end work passes, report the concrete next approval needed for
  a named disposable Atlas test environment or other remote step. Do not treat
  this prompt as permission to write the existing `afhomes_dev` database.
- No commit/push/deployment until the user approves that specific action.

## 7. Verification commands and reporting discipline

Use current package scripts as authority. Known commands at handoff:

```powershell
git status --short --branch
corepack pnpm --filter api exec vitest run --maxWorkers=2
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm check:env -- --built
```

Do not run existing Supabase seed/migration/bootstrap or database test commands
against shared projects. Add clearly separate local Mongo integration/browser
commands where needed. Root unit tests do not prove MongoDB integration by
themselves. Keep test workload bounded; investigate timing/resource failures
without weakening assertions, disabling coverage or pretending retries are proof.

After every phase, report briefly:

1. What changed, mapped to preserved source behavior.
2. Files/contracts/routes and parity-ledger rows covered.
3. Checks actually executed, exact outcomes, cached versus fresh where relevant.
4. Database/browser proof and denial/concurrency cases covered.
5. Blockers, remaining risks, next phase and external actions NOT performed.

If context fills, update `CONTINUATION-STATUS.md` before stopping. Resume the
next unfinished phase; do not restart the source import or rewrite completed
infrastructure. Never claim a test result from a prior report as a fresh run.

Start now with Phase 0, then proceed through the local phases. Preserve AFHomes
functionality throughout. The goal is the SAME AFHomes system working on MongoDB,
not a different system that happens to use MongoDB.
