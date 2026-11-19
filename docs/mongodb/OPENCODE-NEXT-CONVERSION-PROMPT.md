# OpenCode continuation: finish the existing AFHomes MongoDB conversion

You are continuing an existing implementation. Execute the authorized local work;
do not start a new application, redesign AFHomes, or replace its workflows.

## 1. Workspace and authority

- Work in `C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2`.
- Repository: `ClaudAfhomes/AFhomes-ecofarm-v2`.
- Existing branch: `claud/mongodb-conversion`.
- Do not switch branches or work in the separate `afhomes-mongodb` checkout.
- The working tree contains substantial uncommitted conversion and unrelated
  CMS/website work. Preserve all of it. Inspect before editing; never reset,
  clean, replace the checkout or copy another repository wholesale.
- Read the repository `AGENTS.md` and its required bounded Knowledge OS context.
  Read these current project handoffs next:
  - `docs/mongodb/WORKSPACE-HANDOFF.md`
  - `docs/mongodb/CORE-WORKFLOWS-REPORT.md`
  - `docs/mongodb/ADMIN-BOOTSTRAP-REPORT.md`
  - `docs/mongodb/PHASE5-INTEGRATION-REPORT.md`
  - `docs/mongodb/CONVERSION-PLAN.md`
  - `docs/mongodb/FUNCTIONALITY-PARITY.md`
- Older prompts, reports and parity rows can be stale. Verify against current
  files and newer handoff sections. Do not redo implemented modules because an
  older checklist says NOT STARTED. In particular, the MongoDB administrator
  now exists, and default local `pnpm dev` has changed.

## 2. Non-negotiable product behavior

The goal is the same AFHomes system using MongoDB, with its React interface,
contracts, permissions and business behavior preserved. Do not build a simplified
replacement or invent missing business policy. Preserve Sales, Finance,
Customers, IST/OST, Sales Network, Organization/RBAC, Reports and existing portals.

- Better Auth + MongoDB is the approved authentication direction.
- Staff onboarding uses administrator-set temporary passwords followed by a
  mandatory server-enforced first-login password change. NEVER send staff
  invitations or restore passwordless/email-setup onboarding.
- VIP/customer onboarding uses a single-use expiring activation code/link; the
  customer chooses their own password. Preserve ownership and replay checks.
- The original administrator is in Supabase and remains unchanged. A separate
  MongoDB Super Admin was explicitly bootstrapped afterward. Preserve BOTH
  accounts, passwords, MFA, identity IDs and assignments. Do not bootstrap,
  reset, replace or provision another real administrator. Do not use the real
  administrator or private credential files as test fixtures.
- Redemption and operational Services remain disabled through the existing
  shared feature flags. Preserve their source; do not remove or enable them.
- Preserve exact permission vocabulary, deny-only restrictions, current role
  semantics, customer ownership and server-side authorization. UI guards alone
  are insufficient. Identifiers do not authorize actions.
- Keep government ID numbers write-only and absent from responses/audits.
- Keep exact-decimal money strings and shared BigInt helpers. No floating-point
  money arithmetic or client-supplied trusted totals.
- Historical sale economics, beneficiary and hierarchy snapshots are immutable.
  Never recompute old attribution from current genealogy.
- Only verified money counts. Membership activation must recheck full verified
  payment in its transaction. Commission final qualification remains manual,
  permission-gated and audited. Do not invent an automatic earning rule.
- Preserve current source zero-points-at-activation and period/allowance rules.
  Inspect the latest source migrations instead of using older allocation rules.

## 3. Database, secrets and authorization boundaries

- Atlas project: AFHomes MongoDB; cluster: Cluster0; DB: `afhomes_dev`.
- Intended DB user: `afhomes_dev_app`; connection variables are server-only
  `MONGODB_URI` and `MONGODB_DB` in ignored root `.env.local`.
- Never print connection strings, passwords, cookies, tokens, hashes, private
  credential-file contents, raw driver errors or full environment-file content.
- Keep `.env.local` ignored and out of Git. Preserve existing credentials and
  unrelated environment settings. No dependency additions without a concrete need.
- NO existing Supabase data migration, remote SQL apply, real-data mutation,
  Atlas business initialization, new indexes/seeds/backfills, real-account
  changes, invitation/email delivery, commit, push or deployment without explicit
  separate authorization. Earlier bootstrap/account-setup approval is not blanket
  approval for commercial data writes or complete schema setup.
- Do not deploy to DigitalOcean, Vercel or another host.
- Mutation tests must create NEW disposable loopback MongoDB replica sets and
  synthetic accounts/data. Never aim tests at `.env.local`, Atlas or Supabase.
- Read-only Atlas verification is permitted; keep it narrow. Do not initialize
  Better Auth or call a supposedly read-only workflow if it can write sessions,
  indexes, periods or other records without appropriate authorization.
- Continue independent local implementation while a remote action is gated.
  Prepare a concrete initialization/enablement proposal before asking for approval.

## 4. Current runtime: preserve this setup

The root `pnpm dev` command now runs
`tsx watch api/scripts/dev-mongodb-admin.ts`:

- Admin: `http://localhost:5184/admin/login`
- Public app: `http://localhost:5183`
- Native API: `http://localhost:3084`, proxied by both SPAs at `/api/v1`.
- Root `.env.local` selects `VITE_AUTH_PROVIDER=mongodb` and these localhost URLs.
- The launcher isolates browser environment variables and keeps server secrets out.
- `api/_lib/mongo-development-access.ts` allows converted reads and account
  sign-in/password/MFA operations, while blocking commercial mutations. It must
  not be removed to make a test or screen appear successful.
- The earlier dashboard error came from the account-only outer gate. Dashboard
  reads are now allowed and validated against `afhomes_dev`. Investigate fresh
  errors before changing code or authentication.
- `pnpm dev:mongodb:local` is DIFFERENT: it starts a fresh disposable synthetic
  runtime. It does not authenticate the real Atlas administrator.
- Production routing still uses the inherited Supabase router. Local MongoDB
  startup does not mean production cutover is complete.
- Do not kill unrelated servers or user terminal processes. Reuse/check ports;
  restart only processes you own or that the user explicitly asks you to restart.

## 5. Reuse what is already implemented

Inspect the native services under `api/_lib/`, especially:

- `mongo-runtime.ts`, `mongodb.ts`, `afhomes-access.mongo.ts`,
  `auth.ts`, `auth-verify.mongo.ts`
- `organization.mongo.ts`, `dashboard.mongo.ts`, `dashboard-projection.ts`
- `catalog.mongo.ts`, `customers.mongo.ts`, `customer-directory.mongo.ts`
- `sales.mongo.ts`, `commissions.mongo.ts`, `queues.mongo.ts`
- `memberships.mongo.ts`, `customer-activation.mongo.ts`,
  `customer-handlers.mongo.ts`, `customer-points.mongo.ts`
- `referrals.mongo.ts`, `genealogy.mongo.ts`, `genealogy-model.ts`
- `testing/mongo-replica.ts`, `testing/phase5-fixture.ts` and native integration specs.

These include real local HTTP/replica-set proof for cookie auth, forced password
change, MFA, Organization, catalog/customer CRUD, direct-sale payment/activation,
commissions, membership cards, GSD lookup, deactivation and referral/genealogy.
They are not complete proof of application-origin purchase/reservation workflows.

Keep canonical UUID string IDs and current public business-number formats. Do
not introduce ObjectId conversions from unused early MongoDB drafts. Some
unmounted old helpers are incompatible; do not mount them as shortcuts.

Shared pure source mappers/projections already serve both persistence paths.
Reuse contracts, exact-money helpers, document generators and established layers.
Do not introduce a generic Supabase/PostgREST/RPC emulator.

Known driver issue: MongoDB driver 7.7.0 `insertMany` can throw when used inside
a CSOT transaction with a configured client timeout. Bootstrap reproduced this
and avoids that path. Test new transaction code with the actual client timeout
configuration, using `createTestReplica({ timeoutMS: 15_000 })` where relevant.
Do not assume timeout-free loopback fixtures prove Atlas-client compatibility.
Do not disable timeouts, bypass transactions or silently upgrade dependencies.

Historical proof: full API 2,813 PASS / 157 files before later bootstrap/startup
increments; bootstrap four tests passed; latest startup/runtime/dashboard gate
checks 13 PASS / 3 files, with API typecheck and environment isolation passing.
These are previous results. Run fresh checks for your changes.

## 6. Immediate task: complete the purchase workflow on MongoDB

Implement the existing path end to end:

customer -> application -> purchase terms -> review/approval -> reservation ->
required signatures/evidence -> recorded payment -> Finance verification ->
purchase finalization -> sale/membership activation -> VIP account activation ->
existing portal and authorized generated documents.

This arrow describes coverage, not a replacement lifecycle: derive exact ordering,
statuses, permissions and prerequisites from current source code and latest SQL.

### Phase A: map the source contract and current gaps

Trace `api/_handlers/official-forms.ts`, its existing React callers, contracts,
helpers and ALL subsequent migrations that redefine or wrap each relevant RPC.
Do not translate only the first migration with a matching function name.

Important current source RPC entry points include:

`register_customer_application_once`, `complete_import_application_once`,
`create_customer_application_once`, `save_customer_application`,
`purchase_terms_proposal`, `review_application_purchase_terms_once`,
`submit_purchase_application_once`, `decide_purchase_application_once`,
`reserve_application_purchase_once`, `reserve_from_customer_application_once`,
`transition_purchase_reservation_once`, `save_reservation_agreement`,
`submit_reservation_agreement`, `record_reservation_payment_once`,
`verify_purchase_payment_once`, `finalize_reservation_purchase_once`,
`purchase_financial_summary`, `purchase_document`.

Also inspect source trigger/check/mirroring logic, seller resolution, address
validation, signatures, schedules, current-ID prerequisites, customer workbook
continuation and immutable generated-document evidence. Preserve them.

Record a concise endpoint/contract/permission/transaction matrix and implement
from it. This is discovery for execution, not permission to stop after a plan.

### Phase B: applications and purchase terms

Port create/register, detail/list, edit/save, submission, review, request-changes,
approval/rejection and purchase-term proposals/review. Preserve source visibility,
seller-of-record resolution, authoritative address checks, primary/supplementary
holder fields, mirrors onto customer records and existing document prerequisites.
Use native collections with explicit safe projections and validated inputs.

### Phase C: reservations and evidence

Port reservation creation/update/transitions, holder/schedule records, signatures,
frozen terms and evidence. Preserve exact source idempotency keys and business ID
generation. Make transitions/audits atomic. Never synthesize missing signatures,
ID approval or executed evidence merely to advance a status.

### Phase D: Finance, finalization and activation integration

Connect reservation-origin recording/verification and authoritative summaries to
the native Finance queues, then port finalization into the existing sale/card
activation path. Replace the current explicit application-purchase integration
refusal only after genuine evidence/finalization support is implemented.

Preserve reservation-versus-sale source ownership, exact totals, duplicate/replay
behavior, immutable price/rate/hierarchy snapshots and protected history. Use
transactions with conflict guards/unique constraints; two simultaneous requests
must not create two payments, finalized sales or memberships. Emit audits in the
same transaction. A failed audit must roll back the financial mutation.

Do not treat displaying a reservation in a queue as proof its lifecycle works.

### Phase E: documents, VIP activation and UI acceptance

Reuse existing authorized document generators, filenames, response contracts and
frozen purchase evidence. Preserve private upload/download controls. If object
storage is required, inspect the current storage plan and implement/test its
authorized local adapter; do not silently retain Supabase delivery in MongoDB
mode or select/configure a new paid provider without approval.

Connect VIP activation-code/link issuance and existing customer portal behavior.
Preserve the original React screens and API-client patterns. Correct persistence
and wiring; do not redesign the UI or replace the workflow with a new wizard.
Do not return fake success, blank identifiers, mock financial totals or synthetic
documents to hide an unimplemented route.

## 7. Required proof and completion gates

For each phase, execute meaningful tests against fresh disposable replica sets
and the actual native HTTP/cookie boundary. Cover:

- Complete happy path with intended staff roles, not only a bypassing Super Admin.
- Unauthenticated requests, wrong role/action, cross-customer/seller IDOR,
  permission changes and inactive/forced-password-change accounts.
- Invalid/stale transitions and missing/invalid required evidence.
- Exact-decimal money, recorded versus verified payments, partial/full payment,
  overpayment and all existing source-specific financial rules.
- Concurrent requests, identical retries, altered-payload retries and uniqueness.
- Transaction rollback on failure, including audit failure; no orphan identities,
  half-finalized purchases, duplicate memberships or modified historical snapshots.
- VIP token expiry, reuse, wrong purpose and ownership.
- Page/detail/queue counts, search/pagination and persistence after reload.
- Explicit private-field projections and no secrets in responses, audits or logs.

Run focused tests first, then appropriate API regression tests, workspace
typecheck, lint, builds and `pnpm check:env` for the changes. Report actual command
exit statuses and limitations. Do not weaken existing checks or treat an empty,
skipped, interrupted or failed worker run as PASS.

Browser acceptance must use a disposable local runtime and synthetic accounts.
Do not test mutations with the real Atlas administrator. If browser policy
requires the human to enter a new password, hand off that form; do not request
the password in chat. A build or API-only test is not browser workflow proof.

Only after local proof, prepare the exact business collection/index initialization
and mutation-enablement plan for `afhomes_dev`, including expected changes,
preconditions, refusal cases and verification. Keep the real-database write gate
in place until the user explicitly approves that concrete step. Do not run it
automatically or treat this prompt as remote initialization approval.

## 8. Remaining platform phases after the purchase path

Proceed in coherent, verified slices without rebuilding completed foundations:

F. IST/OST registration/accreditation, renewal, controlled team transfer/conversion,
Sales Network management, AA numbers/photos and public verification.

G. Private IDs/receipts/photos and document review/OCR, workbook/import persistence
and recovery/continuation, with protected-history lifecycle controls.

H. Analytics/reports/exports using frozen historical attribution and existing
scope rules; CMS persistence, remaining organization/security settings and jobs.

I. Full enabled-route audit, intended-role browser acceptance and a reviewed
production cutover plan. Keep disabled Redemption/Services code and flags intact.
No production cutover, deployment or push without separate approval.

When another domain is a real dependency of the current purchase slice, implement
only the existing behavior required for that dependency and verify it; do not
invent substitute business rules or expand into an unrelated redesign.

## 9. Handoff and reporting

Update the canonical project handoff/parity records with implemented routes,
fresh evidence, remaining gaps and exact next steps. Do not write project details
to global memory or Knowledge OS. Keep secrets and real administrator details
out of Markdown.

Distinguish IMPLEMENTED, LOCAL VERIFIED, BROWSER VERIFIED, ATLAS APPLIED and
DEPLOYED. Most are currently not the same thing. Do not mark the system complete
because login works or tests using mocks pass. Do not claim all Supabase
dependencies are gone while any enabled native workflow still uses one.

If context runs low, save a concise project continuation checkpoint with the
active files, completed checks and unfinished step. Resume from that point;
do not restart or re-bootstrap. Ask only for a genuinely missing business
decision or specifically required external authorization, and continue other
authorized local work while waiting.

Start by verifying the workspace/branch and current handoff, then implement
Phase A through E. The intended result is the original AFHomes purchase workflow
working against real disposable MongoDB, ready for a separately approved target
initialization and enablement step—not another scaffold or redesign.
