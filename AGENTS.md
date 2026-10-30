# AGENTS.md

## Active MongoDB conversion branch

30 October checkpoint: root tests are green (5,033 total; fresh API 3,133 and
Admin 1,017, five unchanged tasks cached). Typecheck/build/lint/env isolation pass.
Retained CMS tests are scoped on only in their test module; CMS stays disabled.
Strict-CA read-only source inventory covers 93 selected tables/1,291 columns/
254 foreign keys, with no business/password/file export. Runtime production scope
is prepared behind explicit settings, not enabled; setup tools stay development-
only. No shared DB/env/account/push/deploy changes. See
docs/mongodb/COMPLETION-CHECKPOINT-2026-10-30.md. Browser acceptance, full migration
adapters/reconciliation, durable real backups/restore, maintenance-only validator
apply and production initialization remain open. Preserve the existing owner.

29 October approved validator apply: user authorized the reviewed six validators.
The first collMod (card_sales) failed; read-only privilege inspection found the
configured application user has no applicable collMod grant. Independent BSON,
index and option checks verified all six collections/18 documents unchanged and
zero validators applied. Approval remains scoped/valid; do not broaden app-user
permissions, reset accounts or retry blindly. A separate ignored maintenance
connection is needed; see docs/mongodb/CORE-VALIDATORS-APPLY-RESULT.md. No env,
account, document, index, push or deployment changes. CMS remains last.

29 October validator preparation: six proposed core validators reuse contract
money/state rules and safe integer points. Strict disposable sales, purchase,
activation and historical/legacy import flows pass (69 targeted tests). The
read-only `pnpm mongodb:validators` preflight inspected 18 live core records,
found zero incompatible records and six missing validators. No target DDL/data
write ran. See docs/mongodb/CORE-VALIDATORS-REVIEW.md for exact scope and limits;
shared installation requires separate explicit approval. The CLI has no apply
mode. CMS stays last; browser, migration, durable backup and deployment stay open.

29 October password compatibility: the default-off server flag
AFHOMES_ENABLE_LEGACY_PASSWORDS enables only explicitly tagged source bcrypt
credentials; new/reset/changed passwords remain native. Thirty focused tests
pass, including disposable HTTP forced-change/upgrade and separate owner
preservation. See docs/mongodb/PASSWORD-COMPATIBILITY-VERIFICATION.md. This does
not export/import identities or enable the bridge on Atlas; preserve the owner.
The full API serial run with this addition passed 3,126 tests/196 files.
Root tests now run one workspace/worker at a time to avoid resource contention.
The full run completed without worker errors: 5,002 passed, 21 deferred CMS-related
failures (20 CMS screen expectations, one shared dialog scan). API typecheck,
environment isolation and scoped API lint pass. See
docs/mongodb/TEST-GATE-2026-10-29.md; the whole-repository gate is not green.
Keep CMS last.

29 October hosting decision: user chose a native DigitalOcean Droplet without
Docker, retaining MongoDB Atlas. `api/server.ts` is an opt-in hosted API behind a
loopback HTTPS proxy; `build:hosted` isolates public builds from runtime secrets.
Systemd/Nginx staging templates and persistent private filesystem support are in
deploy/digitalocean and docs/mongodb/DIGITALOCEAN-NATIVE-HOSTING.md. Existing
localhost behavior, afhomes_dev scope, owner and workflow gates remain intact.
Do not provision/deploy, change DNS/Atlas access, enable hosted writes/cleanup or
push these changes without the relevant authorization. Linux/TLS/browser acceptance
and production cutover are not complete. Keep CMS last and local artifacts local.

29 October mapping preparation: unmounted explicit-manifest business mapping now
preserves the current owner/assignments, remaps only declared scalar references,
keeps JSON evidence intact and blocks conflicts/unknown fields/credential import.
Six synthetic/native tests pass; see docs/mongodb/MIGRATION-MAPPING-DRYRUN.md.
This is not a full-source migration dry run or importer. Bcrypt compatibility,
durable real backups, full schema/file maps and browser acceptance remain open.
No Atlas/source data transfer or account changes; CMS stays last.

29 October intake/recovery: non-member Inactive/Cancelled intake and source update
semantics now have native proof. `pnpm test:mongodb:recovery` rehearses encrypted
BSON/schema/private-file restore after stopping a synthetic source, with restored
sign-in, forced-change preservation and tamper rejection. It accepts no URI or
existing target; runtime compatibility uses afhomes_dev only on a newly created
loopback server. See docs/mongodb/RECOVERY-REHEARSAL.md. Real backup/key recovery,
migration and browser acceptance remain open. No Atlas changes; keep CMS last.
206 import tests and 3 recovery tests pass; the continuation/recovery rerun has
17 passing tests after a scoped 30s two-upload workbook test budget. API typecheck,
targeted lint and environment isolation pass. Application request limits unchanged.

29 October financial continuation: flat reservation/down-payment/partial/fully
paid imports now create native frozen sale/payment history. Fully settled imports
enter payment_verified and the activation queue; partial imports require later
verified settlement before separate activation. This corrects the source legacy
payment_pending/activation mismatch without bypassing Finance. See
docs/mongodb/LEGACY-FINANCIAL-IMPORT-REPORT.md. No Atlas changes; CMS stays last.
Fresh full API verification: 3,108 tests / 192 files passed with two workers;
API typecheck, targeted lint and environment isolation passed. Browser acceptance,
migration compatibility and recovery remain incomplete.

29 October workbook flag proof: native HTTP guided download retains every source
field, marks the bad cell red with an explanation, and accepts the corrected
review workbook without stale errors. 203 focused tests pass; full API checkpoint
3,105 passes with two workers (before that additional regression). No timeout
limits were raised. See docs/mongodb/ANNOTATED-WORKBOOK-VERIFICATION.md. Actual
browser download acceptance remains unverified; keep CMS last.

29 October legacy member CREATE: flat Active VIP/Suspended/Expired histories now
restore exact verified settlement, original dates, zero/nonzero points and member
IDs in a native guarded transaction. 26 import-confirmation tests pass, including
rollback/concurrency/replay. See docs/mongodb/LEGACY-MEMBER-CREATE-REPORT.md.
Non-member financial legacy creation stays gated: source fully-paid imports use
payment_pending, which activation rejects. No Atlas changes. Keep CMS last.

29 October member-update compatibility: flat legacy member updates now preserve
source lifecycle rules, fresh ownership/tier checks, metadata and financial/points
history with native transaction/HTTP proof. Four new scenarios bring the focused
import suite to 184 passing tests. See LEGACY-MEMBER-UPDATE-REPORT.md in
docs/mongodb. Legacy financial/member CREATE and browser acceptance remain open.
No Atlas changes; preserve the existing administrator and keep CMS last.

29 October Pending compatibility: flat Pending CSV/standard XLSX and the downloaded
CSV template now confirm natively, with fresh source/identity checks, non-member
metadata preservation, permissions, referral revalidation and atomic audit/replay.
180 relevant tests, API typecheck, targeted lint and environment isolation passed.
See `docs/mongodb/LEGACY-PENDING-IMPORT-REPORT.md`. Financial/member legacy writes
remain gated; browser acceptance remains unverified. No Atlas data/schema changed.

29 October: user-approved historical schema setup completed on afhomes_dev.
Three empty collections/six unique indexes are verified; read-only canonical
schema and listed integrity checks pass. No business data or accounts changed.
See `docs/mongodb/HISTORICAL-IMPORT-TRANSACTION-REPORT.md` for exact apply scope.
This is not migration, browser or whole-platform acceptance. Keep CMS last.

28 October certified transaction checkpoint: guided historical imports now have
native HTTP/transaction proof for all six source lifecycle stages, immutable
cutover policy, original payment/membership dates and replay-safe remaining
points. Full API suite 3,089 passed. Atlas is still gated by three absent
historical collections/six unique indexes; no target apply ran. See
`docs/mongodb/HISTORICAL-IMPORT-TRANSACTION-REPORT.md` for exact scope and proof.
Flat/legacy writes remain blocked. Preserve source rules and keep CMS last.

28 October historical-review checkpoint: certified guided-workbook upload and
native continuation review now preserve source permission/history checks. See
`docs/mongodb/HISTORICAL-IMPORT-REVIEW-REPORT.md`. Certified confirmation and legacy
business import writes remain 501; this is review proof, not migrated history or
full cutover acceptance. No Atlas records changed. CMS stays last.

28 October latest: IST/direct OST creation now has its own bounded 45s transaction
budget rather than inheriting the ordinary client's 15s budget. Two accelerated
deadline regressions first failed 503 and now pass. 35 native member/photo tests,
API TypeScript and environment isolation passed. See
`docs/mongodb/MEMBER-CREATION-DEADLINE-REPORT.md`; the original browser retry is
pending and this does not prove its sole cause. Preserve credential/account rules.

The user selected one-time Supabase data migration preparation, not ongoing sync.
Read-only live inventory is complete; see
`docs/mongodb/ONE-TIME-DATA-MIGRATION-PLAN.md`. Passwords are bcrypt in the source,
and the existing MongoDB owner has an email/ID collision with the source owner.
Preserve that owner and resolve mappings before import. Backup/export, a full
transformation dry run and target apply are NOT RUN. CMS remains last.

27 October latest: ordinary company-workbook confirmation, source commit/recovery
and import-backed application creation now use native transactions. See
`docs/mongodb/IMPORT-CONFIRMATION-REPORT.md`. 156 relevant API and 56 React tests
passed, including imported application -> reservation -> claim matching -> full
verified payment -> membership activation on a disposable HTTP/Mongo runtime.
Preserve canonical receipts, stale-review checks, original terms, private fields
and verified-only accounting. Flat/legacy business confirmations and certified
historical writes still return 501. Browser acceptance is pending. CMS stays last.
The older entries below describe earlier checkpoints, not current blockers.

27 October latest: workbook upload/review jobs, row pagination, templates and
cancellation are native. See `docs/mongodb/WORKBOOK-REVIEW-REPORT.md`. The source
and MongoDB handlers share the existing parsers/validators. Preview evidence is
persisted atomically and creates no business records. 260 relevant API and 25 UI
tests passed, followed by 11 native HTTP tests after bulk-write tightening.
Business confirm/source recovery, import-backed application completion and
certified history remain blocked. CMS stays last; preserve existing CMS work.

27 October latest: ordinary company-workbook continuation review and application
intake now have native readers with ownership/permission checks, deduplicated
pagination, masked private values and actual purchase stages. See
`docs/mongodb/IMPORT-CONTINUATION-REVIEW-REPORT.md`. 76 targeted API and 42 UI
tests passed. No customer or source is created by these readers. File parse,
job commit, source recovery writes and certified history remain unported;
certified continuation and unported writes fail closed. CMS stays last.

27 October latest: imported-payment claim review, receipt upload/download and
hold/reject/match/record now use native MongoDB transactions. See
`docs/mongodb/IMPORT-CLAIM-RECONCILIATION-REPORT.md`. Preserve stale-review checks,
duplicate-payment decisions, private single-use upload grants and verified-only
totals. Claim recording reuses the purchase recorder; it cannot verify money.
Workbook import/commit and source continuation remain unported. CMS stays last.

27 October latest: controlled OST applicant corrections now use native append-only
ledger transactions and a shared current-applicant projection for member detail.
See `docs/mongodb/OST-APPLICANT-CORRECTIONS-REPORT.md`. Preserve original account,
registration and frozen renewal snapshots, reason/address checks, both management
permissions, replay protection and field-only audits. 97 relevant API tests and
24 existing OST React tests passed;
new browser acceptance remains pending. CMS stays last.

27 October newest: native member profile/account edits and recorded staff sales
involvement are implemented with disposable HTTP/browser proof. See
`docs/mongodb/MEMBER-PROFILE-REPORT.md`. Preserve temporary-password enforcement,
strict scope, field-only audits, frozen sale/AA history and CMS-last ordering.
Controlled IST/OST kind conversions now have native transaction/HTTP proof; see
`docs/mongodb/MEMBER-KIND-CONVERSION-REPORT.md`. OST-to-IST also passed browser
submission/reload. IST-to-OST browser acceptance remains pending because the
computer-use connection became unavailable. Preserve the same login, date-free
new IST identities, AA history and immutable historical sale snapshots.

User instruction on 27 October: **CMS last**. Preserve existing CMS work while
finishing remaining native business workflows. OST expired-term team transfers
are now converted and browser-verified; generic referral writes cannot bypass
transfer/renewal approval. See `docs/mongodb/MEMBER-TEAM-TRANSFER-REPORT.md`.

27 October continuation: native ID intake/private delivery, core purchase through
activation, VIP portal payments, and dashboard overview/trend have disposable
HTTP/browser proof. See `docs/mongodb/IDENTITY-PURCHASE-ACCEPTANCE.md`. Normal
reservation claim-panel reads are native; imported claim reconciliation and
certified attribution remain blocked. Preserve existing source role/snapshot rules.


This checkout is `ClaudAfhomes/AFhomes-ecofarm-v2`, local branch
`claud/mongodb-conversion`. The user explicitly selected this existing VS Code
folder. Preserve its existing uncommitted CMS and other work. MongoDB changes were
transferred from the separate `afhomes-mongodb` workspace using the original
`develop` snapshot as the merge base; do not copy that workspace wholesale.

The administrator is already bootstrapped **in the current Supabase system**,
as confirmed by the user. A **separate MongoDB Super Admin** was then explicitly
authorized and created on 26 October 2026; see
`docs/mongodb/ADMIN-BOOTSTRAP-REPORT.md`. Preserve both accounts. Do not rerun
bootstrap to reset credentials or repair assignments.
Preserve its identity, password and
assignments; do not bootstrap or reset it. Staff onboarding uses administrator-set
temporary passwords and enforced first-login changes, never invitations. VIP
customers still activate through single-use, expiring codes/links and choose their
password. The private Better Auth admin handler must never be mounted.

User clarification on 26 October 2026: OST uses direct creation and is already
accredited when created. Do not introduce a registration/endorsement journey.
The user also requested removal of MongoDB MFA. Native authentication is now
password-only, with the mandatory temporary-password change and RBAC preserved;
the original Supabase MFA code remains intact. See
`docs/mongodb/ACCOUNT-CREATION-SEARCH-REPORT.md` for scope and local proof.

On 26 October 2026 the user explicitly approved the additive core initialization
of `afhomes_dev`. It completed, adding missing canonical roles/departments and
required indexes without changing existing administrators or their assignments.
See `docs/mongodb/CORE-READINESS-REPORT.md`. This is not permission for bootstrap,
data migration, deployment or unrelated remote writes. The user deferred paid
cloud storage: the real development launcher now defaults to persistent private
files under the user's home folder `.afhomes/private-storage/afhomes_dev`, with
signed downloads. Hosted runtimes still require explicit S3 configuration.
The user subsequently authorized the current develop reference catalog: three
plans are configured and verified; see `docs/mongodb/CATALOG-READINESS-REPORT.md`.
Native public
settings/retention are implemented, with readiness derived from real worker health.

27 October continuation: native private ID intake/review and signed ID images in
Customer Lookup are implemented. The core purchase flow was browser-verified
through activation and active-VIP lookup using disposable records. See
`docs/mongodb/IDENTITY-PURCHASE-ACCEPTANCE.md` for proof and remaining boundaries.
The actual public browser test remains unverified after external widget failure;
no privacy approval or real hostname gate was bypassed.

See `docs/mongodb/WORKSPACE-HANDOFF.md`, `CORE-WORKFLOWS-REPORT.md` and
`PHASE5-INTEGRATION-REPORT.md` under `docs/mongodb/` for current
scope and evidence. Production routing still uses Supabase. On this branch,
`pnpm dev` now launches the user-requested real MongoDB localhost: admin 5184,
web 5183, API 3084. Only converted reads and account/password changes are
enabled against Atlas; commercial writes and automatic schema setup are blocked.
`dev:mongodb:local` remains the separate disposable synthetic runtime.
Earlier phase checkboxes do not prove
full migration or browser parity. Tests must not target Atlas. Redemption and
operational Services remain disabled, with their source preserved.

Never print credentials or raw MongoDB errors. Keep `.env.local` untouched and
ignored. No existing-data migration, existing-database writes, real-admin changes,
commits, pushes or deployments without explicit authorization.

pnpm + Turborepo monorepo for the **AF Homes Ecofarm** platform (membership-card
business). Stack: **React 19 + Vite 8 SPAs → TanStack Query → Vercel Functions
REST API → Supabase Postgres + Supabase Auth**.

> **This file is the authority for the AF Homes codebase.** The retired JAD
> Realty reference material (`legacy/`, `CHANGELOG.md`, and the old JAD `docs/`
> tree) was removed from the repo during cleanup. Do not reintroduce it and do
> not implement from JAD DTOs, table names, statuses, or permission models —
> they do not carry over to the AF Homes schema. (The current `docs/` tree —
> `docs/security/`, `docs/supabase/` — holds AF Homes material and is exempt
> from that removal.)

> Supabase Free-plan capacity (quotas, meters, and the six phased
> implementation plans) lives in `docs/supabase/SUPABASE-FREE.md` (SSOT),
> with plans in `docs/supabase/solutions/`. Read the SSOT before changing
> queries, projections, polling, indexes, uploads, or Auth surfaces.

## Current state (Phases 1–5 delivered below; later phases summarized after Phase 5)

### Phase 1 (complete)

- **Database** — `supabase/migrations/20260926023325_afhomes_phase1_foundation.sql`:
  21 tables, `private.has_permission()`, SELECT-only RLS, 3 private storage
  buckets, append-only `audit_events`.
- **AuthZ** — `api/_lib/afhomes-access.ts`; principal re-resolved per request.
- **API** — `admin/afhomes/{session,roles,departments,staff,dashboard}`, `/health`.
- **Admin SPA** — Dashboard, Staff, Departments, Roles & Permissions.

### Phase 2 (complete — foundation only, no consumer portals)

Four new migrations, all prefixed `20260927…afhomes_phase2_*`:

| File | Contents |
|---|---|
| `…_business_foundation.sql` | `referral_relationships`, `points_accounts`, `points_ledger`, `customer_onboarding_tokens`; customer/sale/payment/membership/commission columns; the new sale, customer and commission status CHECKs; partial unique indexes; 2 new modules |
| `…_rls.sql` | RLS on every new table, SELECT-only grants, and the four narrowed/widened Phase 1 policies |
| `…_rpc.sql` | `private.money`, `private.hash_token`, `private.new_fallback_code`, `private.new_qr_token`, `public.sale_financial_summary`, `record_card_payment`, `verify_card_payment`, `activate_card_sale`, `correct_referral_upline` |
| `…_support_functions.sql` | `next_customer_number`, `next_sale_number`, `issue_customer_onboarding_token` |

API families (`api/_lib/router.ts`, data-driven `BUSINESS_FAMILIES`;
`admin/afhomes/*` is dispatched separately before them):
`card-products`, `card-categories`, `customers`, `sales` (+`payments`),
`memberships` (+`points`), `commissions`, `referrals`, `genealogy`,
`analytics`, `reports`, `ost`, `ost-accreditation`, `documents`, `queues`,
`official-forms`, `customer-imports`, `earning` (points earning),
`redemptions`, `cms`, `address` (read-only PSGC reference), plus the
unauthenticated `auth/customer/activate` + `auth/portals` and the
ownership-based `customer` portal family. Handlers in `api/_handlers/`.

Contracts live in `packages/contracts/src/schemas/` (~56 files). `lifecycle.ts`
is the **single source for the core sale-lifecycle statuses and their legal
transitions** (customer, sale, payment, membership, commission, application,
reservation — each with a transition map); newer domains own their own enums
(import jobs, documents/OCR, genealogy, official-forms signatures, OST,
redemption). Handlers, contracts and tests import these instead of
re-declaring them.

Pure rules: `api/_lib/commerce.ts` (commission, totals, spot cash, sellability,
seller resolution). `api/_lib/handler-kit.ts` is the shared handler plumbing.

Admin screens: `apps/admin/src/features/` — `business/` (Card Products,
Customers, Card Sales, Payment Queue, Activation Queue + commission
qualification), plus `redemption/`, `documents/` (ID review queue),
`genealogy/`, `memberships/`, `network-members/` (Members, member dialogs,
OST team transfer, workbook import), `ost/`, `cms/`, `reports/`, `account/`,
`address/`, `auth/`, `afhomes/` (session, roles, departments, staff,
dashboard). The directory is the source of truth; the list above names the
headline areas.

### Phase 3 (complete — customer account activation and the customer portal)

One migration, `20260927000005_afhomes_phase3_customer_portal.sql`:

- `public.claim_customer_onboarding_token(p_token_hash, p_auth_user_id, p_purpose)`
  — the atomic redemption. Locks the token row **and** the customer row, then in
  one transaction links `customers.auth_user_id`, consumes the token, and appends
  `CUSTOMER_AUTH_ACTIVATED`, `CUSTOMER_ONBOARDING_TOKEN_CONSUMED` and
  `CUSTOMER_ACCOUNT_LINKED`. Idempotent (`CLAIMED` / `ALREADY_LINKED`), and
  `FOR UPDATE` is load-bearing: without it the compare-and-set on `consumed_at`
  is a read-then-write race.
- `public.reissue_membership_credentials(p_membership_id, p_customer_id, p_actor_id)`
  — **rotates** the QR token and fallback code rather than recovering them, and
  returns the new plaintext exactly once. Ownership and the customer's own
  status are re-checked in SQL so a handler bug cannot rotate someone else's card.
- **Column-level SELECT grants** on `customers`, `memberships`, `points_ledger`
  and `points_accounts`. RLS picks the ROW; only the grants pick the COLUMNS.
  Without this, `authenticated` held a table-wide `SELECT` and a customer could
  read their own `government_id_number` through PostgREST.

API: `POST /auth/customer/activate` (unauthenticated) and `GET /customer`,
`/customer/membership`, `/customer/points`, `/customer/points/ledger`,
`POST /customer/membership/credentials` (authenticated). `api/_lib/customer-access.ts`
resolves a customer from **ownership only** and imports nothing from the staff
authorization path.

Portal: `apps/web/src/features/customer/` — login, activate, dashboard, card,
points, profile. `/customer` and `/customer/login` are real routes in the
existing public SPA, so no Vercel output or `vercel.json` change was needed.

### Phase 4 (complete — staff redemption of customer points)

One migration, `20260928000001_afhomes_phase4_redemption.sql`:

- `redemption_items` — the catalog. **Database-backed**, so no item is ever
  hardcoded in a component. `points_cost bigint`, not money: no decimal text, no
  `private.money`, no rounding. Deactivated, never deleted.
- `redemptions` — the auditable transaction, with **snapshots** of the item code,
  name, price and of the balance before/after. Snapshots are why a catalog edit
  cannot rewrite history. `status` includes `voided` and the void columns exist so
  a future rule has a home, but **nothing writes them** and a CHECK makes a
  half-recorded void impossible.
- `public.redeem_membership_points(...)` — the whole transaction in one function,
  because PostgREST cannot span statements and a handler cannot hold a row lock
  across requests. **Lock order is fixed and total: membership → customer → item
  → points account.** The points-account lock is taken *before* the balance is
  read, which is the concurrency control; the price is read from the catalog, and
  the acting staff member is re-validated inside the function.
- Idempotent per `(redeemed_by, idempotency_key)`, checked **after** the locks so
  a retry returns the original receipt even once the token/balance has moved.
- **Column-level repair:** `memberships.points_balance` was written as `0` by
  Phase 2's activation and never maintained, so the staff identifier lookup had
  been reporting `pointsBalance: 0` for a member holding 60,000. The Phase 4
  migration backfills it from `points_accounts` (the authoritative balance) and
  the redemption function keeps it in step.

**No new module keys.** `operations.redemption` and `operations.catalog` already
existed from Phase 1, so redemption adds no authorization vocabulary.

API: `GET /redemptions/resolve`, `GET|POST /redemptions/items`,
`PATCH /redemptions/items/:id`, `GET|POST /redemptions`, `GET /redemptions/:id`.

Staff screens: `/admin/redemption` (identify → price → confirm, with a real
browser QR camera scanner), `/admin/redemption/history`, `/admin/redemption/items`.
The camera decoder is `jsqr`, run **locally**; no frame is ever uploaded.

**Still not built (deliberately):** OST standalone app (OST lives inside the
public SPA, `apps/web/src/features/ost/`), NFC (none exists and none is
planned), commission payout as money movement (a payout *reference* marker
exists on commissions — "WHEN and BY WHOM, never HOW MUCH or TO WHOM" — but no
batching, schedule, method or tax handling), scheduled/auto renewal (OST
renewal is a manual submit/approve/endorse/reject workflow), notifications.
Transactional onboarding email over SMTP is wired (`customers.ts`, `sales.ts`
via `api/_lib/customer-onboarding-email.ts`); there is no bulk/marketing mail.
**No final-commission-qualification rule exists in this codebase** — the
`final_qualification_pending → earned` transition is deliberately a manual,
permission-gated, audited decision with mandatory notes. Do not invent it.

### Phase 5 (complete — production readiness, no product change)

One migration, `20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql`, and
one new command. No business rule changed.

The two Phase 2 migrations `…0001` and `…0003` were corrected in the working
tree *after* being first written. A runner **skips any version it has already
recorded**, so a database that recorded the defective versions will never
receive the corrected bodies. Migration 9 therefore re-delivers the four
execution-found fixes as a new, forward-only, **idempotent** file:
`private.money()` (no `rpad` truncation), `verify_card_payment()` (every column
qualified, because its `OUT` parameters are named `sale_id`/`status`),
`spot_cash_started_at` (`coalesce`, not a self-assignment), and
`commissions.ost_id` (nullable, so a staff beneficiary is legal).

It is safe to apply to a database of unknown provenance: applying it to an
already-correct database changes nothing.

`pnpm test:db:harness` is new. It runs the real suite **twice** against a
disposable loopback PostgreSQL — once normally (must exit 0, must run section 37,
must restore every table) and once with `AFHOMES_DB_TEST_INJECT_FAILURE`
armed (must exit **non-zero**, must report the abort, and must **still** run
`finally` cleanup). The flag is refused for any remote target, so it can never
be aimed at a development or production database.

Prior readiness assessment (the `docs/` runbook was removed during cleanup, so
re-verify before relying on this): **Verdict: NOT READY** — there is no
development/staging Supabase project, so the managed stack (PostgREST, GoTrue,
Storage) has never been executed. Note (2026-10-14): the shared production
project has since gone live and serves traffic (`docs/supabase/SUPABASE-FREE.md`
2026-10-13 snapshot), so this verdict predates live operation — re-verify it
against the Supabase Dashboard rather than relying on it.

### Later phases (delivered after Phase 5 — summarized, not narrated)

Roughly 106 further migrations, `20260930…` through `20261210…`. Grouped by
family; filename prefixes are the pointers, full bodies are authoritative:

- **Roles/permissions baseline** (`20260930…_role_permission_baseline`) and
  **function hardening** (`…_phase17…`, `…_self_search_path_hardening`,
  `…_claim_rpc_authorization`, `…_claim_lifecycle_repair`,
  `…_private_trigger_execute_grants`, `…_readonly_auth_recovery`,
  `…_staff_business_security`).
- **CMS & marketing site** (`…_phase6_cms_foundation` — `afhomes-cms-media`
  bucket, `cms_*` tables; public pages in `apps/web/src/marketing/`).
- **Genealogy** (`…_phase7_genealogy`; UI in
  `apps/admin/src/features/genealogy/`).
- **OST registration, accreditation and renewal workflow**
  (`…_phase8_ost_registration`, `…_ost_accreditation_workflow`; manual
  submit/approve/endorse/reject — no scheduled auto-renewal exists).
- **OST team transfer / conversion** (`…_ost_team_transfer`,
  `…_develop_transfer_integration`, `…_ost_ist_conversion`): OST → IST
  conversion and genealogy team moves via `OstTeamTransferDialog` and
  `POST /members/:id/team-transfer` (migration 00011; live authenticated
  check still unverified — see SESSION.md open threads).
- **Card management & plans** (`…_phase10_card_management`,
  `…_phase19_card_plan_description`, `…_card_plan_order`,
  `…_vip_payment_schemes`, `…_official_vip_benefits`).
- **Identity OCR & document security** (`…_phase12_identity_ocr`,
  `…_document_scope_security`; `extracted_data`/`reviewed_data` on
  `identity_documents`, review queue in `apps/admin/src/features/documents/`).
- **Analytics & reports** (`…_phase14_analytics`; `reports` API family).
- **Customer imports & directory** (`…_customer_import_jobs`,
  `…_customer_directory_*`, `…_fix_customer_application_plan_field`,
  `…_application_psgc_address`).
- **Customer workbook & guided XLSX** (`…_customer_ssot_alignment`,
  `…_mirror_application_onto_customer`, `…_mirror_every_application_path`,
  `…_mirror_referral_names_on_customer`,
  `…_mirror_government_id_*`): guided workbook / SSOT alignment, mirror
  application data onto customer, mirror referral names + government ID.
  Column vocabulary is internal (not a public contract).
- **Application purchase flow & official forms** (`…_application_purchase_flow`,
  `…_official_forms`, `…_official_vip_benefits`).
- **Services catalog** (`…_service_tier_discounts`, `…_service_publication`,
  `…_server_service_prices`, `…_service_policy_status`,
  `…_service_photo_management`, `…_service_staycation_eligibility`,
  `…_operational_service_payments`; `afhomes-service-images` bucket).
- **Points engine evolution** (`…_points_rebuild`, `…_retire_points_spending`,
  `…_restore_points_spending`, `…_reserved_point_settlement`,
  `…_point_refund_compensation`, `…_refund_earning_consistency`,
  `…_preserve_legacy_points`, `…_points_position_service_acl`,
  `…_fix_customer_points_position`, `…_promotion_stacking`,
  `…_sale_tier_choice`, `…_commit_keeps_tier_discount`).
- **Customer-initiated redemption & refunds**
  (`…_customer_redemption_approval`, `…_external_service_refunds`;
  `CustomerRedemptionsPage`, `CustomerRefundHistory` in the portal).
- **Idempotency & identifiers** (`…_mutation_idempotency`,
  `…_operational_sale_idempotency`, `…_business_ids`, `…_customer_code`,
  `…_legacy_business_id_upgrade`, `…_membership_code_upgrade`,
  `…_random_membership_number_allocator`).

## Layout

- `apps/web` (`:5173`) - public SPA + **customer portal** (`/customer/**`).
  Production base `/`.
- `apps/admin` (`:5174`) - staff operations SPA. Production base `/admin/`.
- `api/` - **one** Vercel Function (`api/router.ts`) dispatching through
  `api/_lib/router.ts`. Handlers in `api/_handlers/**` (underscore dirs are not
  functions). `api/dev-server.ts` runs the same router locally on `:3000`.
- `packages/contracts` - Zod request/response contracts. **Single source** for
  shared types; never re-declare them in apps.
- `packages/config` - typed public env (`loadPublicEnv`).
- `packages/shared` - framework-free exact-decimal money helpers.
- `packages/ui` - design tokens + shared primitives.
- `supabase/` - migrations, reference seed, Super Admin bootstrap, RLS audit.
  `supabase/apply-migrations.ts` hard-fails if a non-`afhomes_` file appears in
  `supabase/migrations/`.

## Commands (from root)

```sh
pnpm install
pnpm dev            # turbo dev servers
pnpm test           # vitest run (all workspaces)
pnpm typecheck      # tsc --noEmit (all workspaces + supabase/ scripts)
pnpm lint           # eslint
pnpm build          # turbo run build
pnpm format         # prettier --write . (Prettier is NOT a gate; do not --write pre-existing formatting — see Conventions)
pnpm check:env      # environment isolation guard (see "Environment")

pnpm db:migrate                 # apply supabase/migrations (guarded)
pnpm seed                       # reference plans only; no people, no money
pnpm seed:demo                  # preview-only; refuses the production project
pnpm bootstrap:superadmin       # idempotent Super Admin bootstrap (see below)

pnpm test:db                    # Phase 2 DB integration suite (needs a dev DB URL)
pnpm test:db:local              # …against a disposable local PostgreSQL it boots itself
pnpm test:db:harness            # …and proves the suite fails closed on an injected fault
pnpm test:security:db           # security-focused DB checks (see package.json)
```

Local API: `pnpm exec tsx api/dev-server.ts` (`:3000`; Vite proxies `/api`).

> `pnpm` is invoked through corepack. If `turbo` reports "Unable to find package
> manager binary", `pnpm` is not on `PATH` — use `npx pnpm <cmd>` or run
> `corepack enable` to put a `pnpm` shim on `PATH`. (A previously referenced
> untracked `.tmp-bin/pnpm.cmd` shim does not exist in the tree — do not rely
> on it.)

Single spec: `pnpm --filter api exec vitest run <path>` (same per workspace).

## Database integration suite

The unit suite is **fully offline** and never needs a database. The SQL, however,
is only truly proven by executing it, so there is a second, opt-in suite:

| Command | Target |
|---|---|
| `pnpm test:db:local` | Boots a **disposable local PostgreSQL**, applies `supabase/db-testing/supabase-shim.sql` then every migration, runs the suite, deletes the server. Loopback only. |
| `pnpm test:db` | An explicitly approved development database, via `AFHOMES_TEST_DATABASE_URL`. |

Safety, all fail-closed with exit code 2:

- No `AFHOMES_TEST_DATABASE_URL` → refuses, explains both commands.
- A `*.supabase.co` / `*.pooler.supabase.com` host with **no** `AFHOMES_TEST_PROJECT_REF` → refuses; the suite never guesses its target.
- `AFHOMES_TEST_PROJECT_REF` equal to the production ref → refuses by name.
- Only synthetic, per-run-prefixed data; removed on exit. No real customer data.
- No connection string, password, key or token value is ever printed.

`supabase/db-testing/supabase-shim.sql` reproduces the Supabase platform objects
the migrations assume but never create (`auth.users`, `auth.uid()`, the
`anon`/`authenticated`/`service_role` roles, `storage.buckets`/`storage.objects`).
**It is a test fixture and must never be applied to a real Supabase project.**
`pnpm db:migrate` does not read it.

## Database invariants

- **Browser roles are read-only.** `anon` and `authenticated` are revoked from
  every AF Homes table and granted only `SELECT`, gated by RLS policies that
  call `private.has_permission()`. All writes go through service-role handlers
  or narrowly scoped `SECURITY DEFINER` functions. Before adding any
  `anon`/`authenticated` policy, confirm it is SELECT-only.
- **No Super Admin password exists anywhere.** The first Super Admin is created
  by a server-controlled `auth.admin.inviteUserByEmail`; the owner sets their
  own password via the Supabase-hosted recovery flow. The same is true of
  customer onboarding: a hashed, single-use, expiring **token** is issued; the
  customer sets their own password.
- **Money is exact-decimal text** with a `CHECK` regex on every money/rate
  column. No float math anywhere — use the `BigInt` helpers from `@afhomes/shared`
  (TypeScript) and `numeric` + `private.money()` (Postgres). `to_char` is
  deliberately unused in the money path.
- **A sale is a frozen commercial record.** `card_sales` stores
  `cash_price_snapshot`, `minimum_down_payment_snapshot`,
  `yearly_points_snapshot`, `commission_rate_snapshot` and
  `expected_commission_snapshot`. Never recompute a historical sale from
  `card_plans`; never hand-edit a snapshot.
- **Only VERIFIED money counts.** `recorded` is not money yet, `rejected` and
  `voided` never were. Every total, balance and activation decision comes from
  the payment rows on the server.
- **Activation requires full verified payment, re-checked inside
  `public.activate_card_sale`.** A down payment, an existing Auth user, a seller
  action or a frontend button can never activate a membership. The function is
  idempotent: an already-active sale returns its existing membership.
- **Deny-only restrictions** (`staff_permission_restrictions`) can subtract from
  a role but never add to it; the same rule is enforced in
  `permissionsAreSubset()`.
- **Identifiers never authorize anything.** `memberships.qr_token_hash` and
  `fallback_code_hash` are two identifiers for the **same** row, both stored as
  SHA-256 hashes, both 256-bit/4-byte random with no customer data encoded. They
  are returned in plaintext exactly once at issuance and are never re-displayed.
  `GET /memberships/resolve` is the only path from an identifier to a
  membership, and its response deliberately carries no customer PII.
- **Government ID numbers are write-only.** Stored on `customers`, never
  returned; the API exposes `governmentIdMasked`. They must never appear in an
  `audit_events` payload. The browser roles additionally have **no `SELECT`
  privilege on the columns at all** — see the Phase 3 migration.
- **`auth.users` is a platform table.** On a real Supabase project `anon` and
  `authenticated` are granted `USAGE` on schema `auth` and `SELECT` on
  `auth.users` by default, which means a signed-in customer can read every
  account's email through PostgREST. AF Homes never does this, and the customer
  principal is always resolved server-side with the service role, so no AF Homes
  code depends on it. If that platform default ever needs closing, it is a
  project-level `revoke` **outside** the migrations (the migrations must not
  fight the platform), and it must be verified on a real Supabase project — the
  local shim deliberately grants only `USAGE`, so it cannot prove either way.
- **Storage buckets.** Private: `afhomes-customer-ids`, `afhomes-ost-ids`,
  `afhomes-payment-receipts`, `afhomes-service-images` — all non-public;
  object delivery must use short-lived signed URLs from an authorized server
  API. Public: `afhomes-cms-media` (marketing content) — read-only public
  delivery; uploads and deletes stay server-side via the service role.
- **Migration discipline:** one idempotent migration per change, prefixed
  `afhomes_`, with the validation queries in the file header and a down note.
  After each batch run `supabase/security/rls_invariants.sql` (empty = PASS) and
  `pnpm test:db:local`.
- **Customer workbook import:** the guided XLSX template (guided workbook +
  44-column company layout) and the legacy 45-column layout are both still
  parsed (`customer-import.ts` remaps the legacy layout, dropping the retired
  `OST/IST NAME` column with a warning). The workbook column vocabulary
  (`TEMPLATE_*_OPTIONS`, `WORKBOOK_PAYMENT_METHODS`, etc.) is an **internal**
  import/validator detail, not a public API contract — do not document it as
  a public contract. See `docs/AFHOMES-CUSTOMER-WORKBOOK-IMPLEMENTATION.md`.

### Defects that only real PostgreSQL execution found

Text assertions and the in-memory Supabase fake both passed while the database was
broken. These were found by running the SQL, and each now has a tripwire:

- `private.money()` wrapped its result in `rpad(x, 1, '0')`. **`rpad` truncates**,
  so every formatted total collapsed to its first character — `60,000.00` became
  `"6"`. Every `sale_financial_summary` figure was wrong. Never length-cap a
  formatted value with `rpad`.
- `verify_card_payment` declared OUT parameters named `sale_id` and `status`, so
  its own unqualified `where sale_id = ... and status = 'verified'` was ambiguous
  and the function failed on **every** call. **Alias and qualify every table
  inside a `returns table` function.**
- `verify_card_payment` set `spot_cash_started_at = v_sale.spot_cash_started_at`,
  a self-assignment that copied the existing `NULL` straight back, so the instant
  the window opened was never recorded. Use `coalesce(col, now())`.
- `commissions.ost_id` was `NOT NULL` from Phase 1 while Phase 2's new beneficiary
  CHECK allows a **staff** beneficiary. The two constraints contradicted each
  other and no commission could be created for a VD/SSM/SM/Admin sale. When a
  migration generalises a column's meaning, re-read the old constraints.
- **Phase 3:** `authenticated` held a table-wide `SELECT` on `public.customers`,
  so a customer who legitimately passed the self-read policy could read their own
  `government_id_number` through PostgREST. **RLS is row-level; it says nothing
  about columns.** Narrow browser grants to an explicit column list on every
  table a browser role can read.
- **Phase 3:** `claim_customer_onboarding_token` checked `consumed_at` before the
  already-linked branch, which made its `ALREADY_LINKED` outcome **unreachable
  code** — a client retrying after a lost response got "already used" instead of
  the success it had earned. Idempotency must be decided **before** the
  consumption and lifecycle checks.
- **Phase 3:** `reissue_membership_credentials` gated on the *membership* status
  but not the *customer* status. A suspended member's membership row is still
  `active`, so the database would have accepted a rotation that the handler
  refused. A `SECURITY DEFINER` function must re-check every precondition the
  handler checks — the handler is not the security boundary it appears to be.
- **Phase 4:** `memberships.points_balance` was written as `0` by Phase 2's
  activation and never maintained, while `points_accounts.balance` held the real
  figure. The staff identifier lookup had therefore been reporting
  `pointsBalance: 0` for a member holding 60,000 points. Repaired in Phase 4 and
  kept in step. **A denormalized column nobody maintains is worse than none.**
- **Phase 4:** `findNavSubItem` in `apps/admin/src/app/navigation.ts` used
  first-match prefix matching. Once a dropdown held both `/admin/redemption` and
  `/admin/redemption/items`, the catalog screen resolved to the *workflow's*
  module key and checked the wrong permission. The longest match now wins. This
  was UX-only (the server still refused), but the guard must not check the wrong
  permission.

### False passes: harness bugs that hid real behaviour

Recorded because each one let a suite be green while testing nothing:

- A denied statement aborts the enclosing transaction, so every probe after the
  first in a shared transaction reported "current transaction is aborted"
  instead of its own reason. Wrap each write-denial probe in its own
  `SAVEPOINT`.
- The in-memory Supabase fake's `splitTopLevel` did not trim, so
  `"a, customers!inner(status)"` produced a spec with a **leading space**: the
  embed key became `" customers"` and the table name `" customers"` matched no
  declared link. Every embed in the codebase resolved to `undefined` in silence
  and callers read a `?? {}` fallback. Phase 2 and Phase 3 tests passed only
  because none of them asserted an embedded value. **The fake now trims, and its
  embed resolution tries both directions of a relation.**
- The fake never returned `count` at all, so `meta.total` silently fell back to
  the page size and pagination was untestable. It now returns the pre-pagination
  total, as PostgREST does.
- A test fixture used an all-lowercase QR token, so a "does not case-fold" case
  passed for the wrong reason. A real QR token is base64 and mixed case.
- **Phase 5:** section 37 of the DB suite — the reconciliation checks — lived in
  the `catch` for sections 1-36, so on a green run it **never executed**. 493
  checks passed with zero assertions about the migration the phase exists for.
  Section 37 now runs on the successful path, and `pnpm test:db:harness` asserts
  it appeared in the output. **A check that only runs once something else has
  already broken is not a check.**
- **Phase 5:** the abort report sat *inside* section 37's own `catch`, so a
  throw anywhere in sections 1-36 produced a short, entirely green run and
  **exit code 0**. The report now lives in the outer `catch`, and the injection
  flag plus the harness prove the non-zero exit. **Silence is not a pass.**
- **Phase 5:** two of section 37's three assertions were invalid and *failed
  against a correct database* — a `length === 9` check on `'60000.00'` (it is 8),
  and a self-assignment regex that matched the **comment inside the function**
  documenting the old defect, because `pg_proc.prosrc` retains comments. A third
  compared `prosrc` byte-for-byte, measuring hand-typed whitespace rather than
  behaviour. All three now assert semantics, and one guards that the migration's
  explanatory comments are never deleted to satisfy a regex.
- **Phase 5:** cleanup asserted only `count(customers) == 0`, and the synthetic
  **inactive** staff member was never pushed onto `createdStaffIds` — so it
  survived every run, forever, while the check passed. Cleanup now resolves its
  id sets from the database (recorded ids **union** run-prefix marker) and
  verifies every table is back to its **pre-run row count**. **A cleanup check
  that inspects one table is not a cleanup check.**

The lesson is recorded deliberately: **a schema that compiles is not a schema that
works, and a test that cannot fail is not a test.** `pnpm test:db:local` and
`pnpm test:db:harness` are the only things that would have caught these.

## Conventions

- Styling: CSS Modules per component; tokens in `@afhomes/ui`. `@/*` maps to
  `apps/<app>/src`.
- Tests colocated as `<target>.spec.ts(x)`. Both apps use
  `renderWithProviders` from `src/test/utils.tsx` (fresh retry-free
  `QueryClient`, `MemoryRouter`, resolved `SessionProvider`). `installMockApi`
  and the `@afhomes/mock` package were removed with JAD - do not reintroduce them.
- API handler tests use the in-memory Supabase fake in
  `api/_lib/testing/` (`supabase-fake.ts`, `fixtures.ts`). It supports unique-key
  enforcement, column defaults, and read-only vs write-only error injection, so
  tests exercise real handler code (real resolver, real Zod, real query chains)
  without a database. It is excluded from the Vercel upload.
- All HTTP goes through `apps/<app>/src/lib/api/client.ts`
  (`request`/`requestList`), which validates against `@afhomes/contracts`. No
  ad-hoc `fetch` in features.
- Client route guards are **UX only**; the server is the security boundary.
- Prettier: `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`.
- Input rules live in `packages/contracts/src/schemas/input.ts` (single
  source): person names are Unicode-letters-only and stored UPPERCASE, phones
  reject alpha and canonicalize PH mobile to `+63`, emails stay lowercase,
  money stays exact-decimal strings, birth dates must be past and plausible.
  Emails, passwords, tokens, URLs, UUIDs, hashes, keys, paths and notes are
  never case-folded. Frontend normalizes on submit (`apps/admin/src/lib/normalize.ts`);
  handlers normalize the optional fields on write; imports normalize rows.
  Historical records are never rewritten.
- Live search uses `useDebouncedValue` (`apps/admin/src/lib/`, ~300ms) with the
  debounced term in the queryKey; staged `applied` filters sync from the
  settle callback, never from a sync setState-in-effect. Latest query wins by
  key change; superseded results are isolated from the active query state.
  Already-started network requests are not guaranteed to be cancelled.
- Freshness is mutation invalidation first (redeem also invalidates
  `['reports']`; activation also invalidates `member-lookup`/`memberships`/
  `reports`), plus conservative polling on operational lists (5s import jobs,
  15s finance/activation/history/member-lookup, 30s reports/audit/OST/
  applications/commissions/memberships/customer points). No Supabase Realtime
  subscriptions: browser roles hold no table privileges to subscribe to, so
  polling the authorized service-role endpoints is the cross-session channel.
  Logout clears the whole QueryClient in both apps.
- Money/count display has one implementation each (`@afhomes/shared`):
  `formatMoney`/`formatCount` fail loud on malformed input;
  `formatMoneyOrDash`/`formatCountOrDash` render nullish as a placeholder;
  `formatCompactMoney` abbreviates chart axes. Never concat `₱{…}`.
  Server instants shown to members use the shared UTC helpers; the staff
  console stays browser-zone (`apps/admin/src/lib/format.ts`) on purpose.
- Business query keys come from `features/business/queryKeys.ts` (pinned by
  `queryKeys.spec.ts`); invalidation uses the matching scope, never a literal.
- Mutations use `useBusinessMutation` (`apps/admin/src/lib/`), which coalesces
  same-payload double submits and runs different payloads concurrently.
- Form controls come from `@afhomes/ui` (`Select`, `TextField`, `DateField`,
  `TextAreaField`, `FileField`, …). Labeled primitives mark optional fields
  with "(Optional)", so specs assert the marked name. `required` mirrors the
  original control: adding it where none existed hard-blocks submission
  through native validation. Multi-selects, checkboxes, number/url inputs,
  and hidden+Button file uploads keep sanctioned native patterns.
- Admin routes split per feature (`React.lazy` in `apps/admin/src/app/App.tsx`, shell-mounted
  `Suspense` in `AdminLayout`); the chart library loads behind its own
  skeleton. Specs that render routes await the chunk (`findBy*`, longer
  timeouts for first-transform). Never stub the global `URL` constructor with
  a plain object: dynamic `import()` needs `new URL()` (subclass it).

## Authorization architecture

One effective-permission model, evaluated in two places that must agree:

```
Supabase Auth user
  -> staff_users            (must exist, status must be 'active')
  -> staff_role_assignments (must exist)
  -> roles                  (must be is_active)
  -> role_permissions       (per-module view/create/update/delete)
  MINUS
  staff_permission_restrictions  (deny-only; can never add)
  = effective permission (super_admin is granted every module by slug)
```

- **Backend (authoritative)** — `private.has_permission()` in Postgres for RLS,
  and `authorizeAfHomes(req, module, action)` in `api/_lib/afhomes-access.ts`
  for handlers. The principal is resolved **per request**; there is no cache, so
  a permission change takes effect on the very next call with no client
  cooperation.
- **Frontend (UX only)** — `canViewModule()` / `navItemsForPermissions()` in
  `apps/admin/src/app/navigation.ts` decide what is *visible*; `RequireRole`
  gates *direct URL* entry. Both read the same `afHomesSessionSchema` payload
  the API returns, so there is no second definition to drift. Hiding a link is
  never the only control — every action is re-checked server-side.

Enforced invariants (each has a named regression test):

| # | Invariant | Test |
|---|---|---|
| A | A user restriction removes access, never adds it | `api/_handlers/authorization.regression.spec.ts` |
| B | A user cannot assign a permission they do not hold | same |
| C | An Admin cannot alter or deactivate the Super Admin | same |
| D | System roles cannot be deleted or defanged | same |
| E | A direct URL cannot bypass nav permission filtering | `apps/admin/src/app/authorization.regression.spec.tsx` |
| F | Client permission state cannot authorize a server action | both suites |
| G | Inactive staff cannot use staff APIs with a valid session | api suite |
| H | A permission change applies on the next resolution | api suite |

### Customer authorization is a SEPARATE system

There are now two authorization models, and they never meet:

```
STAFF    auth.users -> staff_users -> roles -> role_permissions
                       MINUS staff_permission_restrictions
CUSTOMER auth.uid() -> customers.auth_user_id -> customer -> membership
```

- Customer access is **ownership**, never permission. There is deliberately **no
  `modules` row** for the customer portal, so `private.has_permission()` cannot
  express it and a customer can never be granted a staff capability.
- `api/_lib/customer-access.ts` imports nothing from `afhomes-access.ts`. A
  signed-in staff member who also owns a customer record gets customer access to
  **that one customer** and no staff capability through the portal.
- A suspended or cancelled customer may read their own profile (so the
  restriction is legible) but the server refuses their membership and points,
  and `reissue_membership_credentials` refuses in SQL too — not only in the
  handler.
- RLS decisions are re-proven on real PostgreSQL in `supabase/db-integration.ts`
  sections 22–24, which impersonate two different members and assert what the
  *database* returns. RLS picks the row; **column grants pick the columns.**

## Card credentials are rotated, never recovered

`memberships.qr_token_hash` and `fallback_code_hash` are SHA-256 hashes, so a
code cannot be displayed on demand without weakening at-rest security. Instead
`reissue_membership_credentials` mints fresh values, replaces the hashes (so the
previous codes stop working immediately) and returns the plaintext exactly once.
The portal therefore shows a "request a new code" action, never a stored code.
The QR payload is the opaque token alone — no name, no customer number, no
government ID. **No NFC.**

## Redemption: the points transaction

Three rules, and every one of them is load-bearing:

1. **Scanning spends nothing.** `GET /redemptions/resolve` is a read. Points move
   only on `POST /redemptions`, inside `public.redeem_membership_points`. A member
   is routinely scanned more than once while an item is chosen, so a scan must
   never be able to spend anything.
2. **The client sends no figures.** The request carries only the membership, the
   item, the quantity and a de-duplication reference. There is no `pointsCost`,
   `balance`, `status` or `redeemedBy` field in the contract, so a tampered body
   cannot change what a redemption costs. The acting staff member is
   `principal.userId` from the session, and the database re-validates it anyway.
3. **The identifier authorizes nothing.** Resolving proves only that the caller
   presented a currently valid credential for some membership. Customer status,
   membership status, expiry and the staff permission are all checked separately,
   in `api/_lib/identifier.ts` and again in SQL.

`api/_lib/identifier.ts` is the single place a QR token or a fallback code becomes
a membership, so the two can never drift apart in their validation. The fallback
code is normalised by case and separator (its format is fixed and known); the QR
token is **not** case-folded, because base64 is case-sensitive.

Both new tables are **staff-only and unexposed**: `revoke all` from `anon` and
`authenticated`, so a direct PostgREST call has no privilege to abuse even if an
RLS policy were wrong. A customer reaches their own redemption history through
their points ledger, which is already RLS-scoped to them.

## Super Admin bootstrap

`pnpm bootstrap:superadmin` is **idempotent** and never handles a password.
It is refused unless `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`AFHOMES_SUPERADMIN_EMAIL`, and `AFHOMES_ADMIN_URL` are all set and the project
host matches the expected ref.

Procedure (requires approval — do not run unattended):

```sh
pnpm bootstrap:superadmin -- --check   # validate config; no network
pnpm db:migrate                        # only when an approved migration is pending
pnpm bootstrap:superadmin              # reconcile after invitation approval
```

It reconciles every partial state: no auth user → invite; auth user without a
profile → create it; profile without an assignment → create it; wrong role →
correct it; already correct → report and change nothing. It deletes an auth
user on failure **only** when that run created it. A pre-existing user is never
destroyed.

The owner then accepts the invitation and sets their own password through the
Supabase-hosted recovery flow. No password variable exists anywhere.

## Health

`GET /health` (and `/api/v1/health`, and the daily Vercel cron) probes the
`modules` table. `ok` is the field to alert on:

| Condition | Status | Body |
|---|---|---|
| Database answers | 200 | `{ ok: true, db: "ok", service: "afhomes-api", time }` |
| Database errors/throws | **503** | `{ ok: false, db: "error", service: "afhomes-api", time }` |
| Supabase not configured | **500** | same shape, `ok: false` |

The response never contains credentials, keys, SQL, stack traces, or
environment values.

## Environment

Only `VITE_`-prefixed vars reach the browser. Browser-safe:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy fallback
`VITE_SUPABASE_ANON_KEY`), `VITE_API_BASE_URL` (default `/api/v1`),
`VITE_WEB_URL`, `VITE_ADMIN_URL`.

Server-only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (use
the transaction pooler, `:6543`), `AFHOMES_TARGET_PROJECT_REF`,
`AFHOMES_SUPERADMIN_EMAIL`, `AFHOMES_WEB_URL`, `AFHOMES_ADMIN_URL`,
`EMAIL_FROM`, `RESEND_API_KEY`, `DOCUMENT_HASH_PEPPER`, optional
`OCR_PROVIDER_URL` / `OCR_PROVIDER_API_KEY`.

Never commit `.env*`. Copy `.env.example` to `.env.local` for overrides.

`pnpm check:env` enforces the split directionally: browser code may read only
`VITE_`-prefixed `import.meta.env` values (plus Vite's own `DEV`/`PROD`/`MODE`/
`BASE_URL`/`SSR`) and never `process.env`; server code reads `process.env` and
never `import.meta.env`. Add `-- --built` to also scan `vercel-static/` and
`dist/` for server-only names. `packages/config`'s `loadPublicEnv` is the one
sanctioned whole-object read — it parses through a `VITE_`-only Zod object, and
`packages/config/src/env.spec.ts` pins that unknown keys are stripped.

## Known debt

- **Workspace packages were renamed `@jad/*` → `@afhomes/*`** (`@afhomes/contracts`,
  `@afhomes/shared`, `@afhomes/ui`, `@afhomes/config`, `@afhomes/web`,
  `@afhomes/admin`, `@afhomes/db-testing`; `api` was already neutral). The rename
  was deliberately done as one isolated, behavior-free change: never mix a
  repo-wide rename into work that touches authorization, and never narrow
  `vercel.json`'s `includeFiles: "packages/**"` — it is load-bearing for the
  deployed function.
- **Pre-existing DB suite failure (section 77 — OST team transfer):** the
  disposable Postgres suite (`pnpm test:db:local`) currently fails one check
  (`"the fresh IST validity starts today": expected <today>, got null`) in
  `public.transfer_sale_team_member` (OST→IST conversion sets `startsOn: null`).
  This predates the latest work and is unrelated to the Edit Stated Record /
  OST/IST NAME changes. Cause is unresolved (function vs. test expectation);
  investigate before relying on `pnpm test:db:harness` (which requires a clean
  exit 0). Do not silently adjust the assertion.

## Deployment

Single Vercel project, single origin:

- `/` → `apps/web/dist` (marketing pages, customer portal, OST/staff
  surfaces), `/admin` → `apps/admin/dist` (also served at the `/staff`,
  `/employee`, `/finance`, `/hr`, `/sales` aliases — see `vercel.json`
  rewrites)
- `/api/v1/*` → the single Function `api/router.ts`
- `/health` → readiness probe, also the only scheduled job (daily `0 0 * * *`)

Build chain: `pnpm typecheck:deploy` → `scripts/prepare-vercel-env.mjs` →
`turbo run build` → `scripts/assemble-vercel-output.mjs` (merges both SPAs
into `vercel-static/`). The leading typecheck is load-bearing: `turbo run
build` only builds the two SPAs (each runs its own `tsc --noEmit` first), and
nothing else in the chain typechecks `api/` — so without it a TypeScript error
in deployable API code would ship silently. `typecheck:deploy` is `turbo run
typecheck` (api, apps, shared packages) WITHOUT the `tsc -p supabase` half:
`supabase/` holds operator-only sources (migrations runner, seeds, bootstrap)
that `.vercelignore` deliberately excludes from the build context, so the full
`pnpm typecheck` fails on Vercel with TS5057. Full local validation always
runs `pnpm typecheck` (both halves). Never remove the typecheck step from
`vercel.json`'s `buildCommand`, and never "fix" a build by skipping API
typechecking.

- `functions["api/router.ts"].includeFiles` **must stay `packages/**`**.
  Narrowing it crashes the deployed function with
  `ERR_MODULE_NOT_FOUND .../@afhomes/contracts/src/index.ts`.
- Exactly **one** Vercel Function is discovered: `api/router.ts`. Everything
  under `api/_handlers/` and `api/_lib/` is underscore-prefixed, so Vercel never
  turns it into a function — keep it that way (the Hobby plan caps at 12).
- The only scheduled job is `/health` (daily `0 0 * * *`). The retired
  `/crons/commission-clearing` (JAD) is removed from `vercel.json`; **the
  previously deployed configuration keeps running until the next successful
  deploy**, so production will keep firing that stale cron until then.
- `VITE_WEB_URL`/`VITE_ADMIN_URL` are derived from
  `VERCEL_PROJECT_PRODUCTION_URL`. Do **not** set them in the Vercel env - that
  pins them to one host and breaks preview deployments.
- `installCommand` is `pnpm install --filter=!@afhomes/db-testing`, so the initial
  install covers 8 of 9 workspace projects and never touches
  `embedded-postgres`. Vercel still runs a second, unfiltered install
  (`Scope: all 9 workspace projects`) while processing function outputs — that
  reinstall is Vercel platform behavior, not a repo dependency: nothing in the
  codebase depends on `@afhomes/db-testing` (no manifest lists it, the `api/`
  function imports only `@afhomes/contracts` and `@afhomes/shared`, and there are no
  relative imports into `packages/`). The extra install succeeds silently
  because `allowBuilds` permits exactly the two `embedded-postgres` platform
  packages; the native binary is never loaded by the deployed function, which
  never imports the db-testing sources. Do not "fix" this by weakening pnpm
  security or by narrowing `includeFiles` (see above).

**Do not deploy, run migrations against production, or trigger remote crons
without explicit approval.**

## Version control

The agent must never stage, commit, push, publish, or otherwise alter git
state — no `git add`, `git commit`, `git push`, branch, tag, stash, reset, or
GitHub action (PRs, merges, releases) of any kind — unless the user has
explicitly commanded it in the current session. Reading history, status, and
diffs is always allowed. File edits in the working tree are normal work; moving
them into git is not.

## Knowledge vault & graph workflow

A curated Obsidian vault lives **outside this repo** at
`C:\Users\SSD-ORLANDO\Documents\DevVault` (never git-managed from here).
Layout: `00-Home/` (entry: `Home.md`, `Knowledge-Map.md`, `Agent-Workflow.md`),
`01-Projects/AF-Homes-Ecofarm/` (curated project notes), `02-Engineering-Standards/`,
`03-Learning-Log/`, `99-Templates/`, and `01-Projects/AF-Homes-Ecofarm/Graphify-Export/`
(the generated graph export). Rules:

- **Read only the relevant curated note before starting a task** — match by area:
  `Security-Notes`, `Business-Rules`, `System-Flows`, `Data-Model`, `API-Reference`,
  `Architecture`, `Testing-Guide`, `Known-Issues`, `Decisions`, `Lessons-Learned`,
  `Debugging-Patterns`. Never load the whole vault.
- **Structure and dependency questions go through Graphify first** —
  `graphify query/path/explain/affected` against `graphify-out/graph.json` — then
  read the source files it points to.
- **Verify every important finding against the actual source code.** The vault is
  a navigator, never truth: if a note contradicts this repository, the repository
  wins — and the note should be corrected.
- **Label findings** VERIFIED / INFERRED / UNVERIFIED / CONFLICTING (the vault's
  confidence vocabulary), exactly as the vault notes do.
- **The 7,881 generated notes under `Graphify-Export/` are read on demand only** —
  open a single note by symbol/file name; never iterate, copy or bulk-summarize
  them, and never hand-edit them (re-run `graphify export obsidian --graph
  graphify-out/graph.json --labels graphify-out/.graphify_labels.json --dir …`
  to refresh).
- **After a significant completed task, propose curated-note updates** (new
  lesson in `Lessons-Learned`, new invariant in `Business-Rules`, new issue in
  `Known-Issues`, dated entry in `Development-Log`). Apply curated-note updates
  only with the user's approval, except for appending a dated Development-Log
  entry that factually summarizes work already explicitly accepted by the user.
  This exception does not authorize changes to business rules, architecture
  decisions, security controls, or other approval-gated content.
- **Approval first for high-impact decisions**: business rules, architecture,
  security controls, permissions/RLS, migrations/deploy/crons — the same gate as
  the Deployment section above, whether or not the vault documents them.
- **Never store secrets, credentials, tokens, keys, connection strings or
  customer PII in the vault.** The vault mirrors repository knowledge, never
  environment values.
