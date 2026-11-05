# MongoDB conversion log (archived from AGENTS.md)

> **Historical reference, not standing instructions.** Archived verbatim from
> `AGENTS.md` lines 1–444 at commit `d89023d` (original SHA-256
> `9df3435bbe2e701af741218212ef2d9562421a4cb34ff8a2799ac6d54d1fc9fa`) on 2026-11-04.
> Dated checkpoints 26 Oct – 3 Nov 2026; later entries supersede earlier ones.
> Approvals recorded below were scoped to their date and action; they are **not**
> authorization for any future change. Current rules: root `AGENTS.md`.

<!-- archive-body-start -->
# AGENTS.md

## Active MongoDB conversion branch

Latest owner decision (3 November): fresh native MongoDB operation. Do not
combine or import Supabase history into Atlas. Historical source/identity/file
mapping and merge-conflict reviews below are archived preparation, not active
runtime blockers. Preserve Supabase, existing MongoDB records, administrator,
password and assignments; "fresh start" does not authorize deleting/resetting
anything. Keep capture archives and unmounted preparation code intact. Focus on
native workflow correctness, measured performance and remaining browser proof.
See docs/mongodb/NATIVE-READINESS-2026-11-03.md for current verification scope.
3 November native checkpoint: fixed UTC/Manila date disagreement in OST form
validation and Create/Convert defaults. Full API rerun passes 3,281 tests/223
files; contracts 319/23, focused Admin 18/5, typecheck, scoped lint, environment
isolation and both SPA builds pass. Earlier whole runs were interrupted by PC
sleep/time jumps; the clean run used temporary process-scoped sleep prevention,
restored afterward, without relaxing application/test expiry or timeout rules.
Synthetic loopback load: 240 requests/8 workers, zero failures, p95 83.08 ms.
No Atlas capacity claim or full browser acceptance is implied.
Later 3 November acceptance: a 10,000-customer / 2,400-request / 20-worker hosted
workload exposed default directory enrichment before pagination. The corrected
default page preserves derived-filter ordering and passes real-Mongo equivalence
tests. Full API now passes 3,284 tests/224 files; hosted build/built env isolation
pass. Browser QA observed synthetic IST/OST creation with AA numbers, immediate
OST accreditation and a blank same-document repeat OST form. Tablet badge wrapping
is corrected and visually checked; 32 focused UI tests/typecheck/hosted rebuild
pass. Public-result/role/purchase browser acceptance remains pending. See
docs/mongodb/LOCAL-RELEASE-ACCEPTANCE-2026-11-03.md. The owner
confirmed there is no Droplet deployment yet: production-mode local proof only.

Latest migration preparation (2 November): 83 definitions (44 domain adapters and
39 empty-source guards) plus
separate identity/counter planners and a digest-approved local file copier are
unmounted. Explicit timestampPrecision=preserve-source retains raw timestamp
evidence; default behavior still rejects nonzero microseconds. Never auto-link
non-owner accounts by email except the three explicitly reviewed test-account
aliases. Source export is now explicitly approved and an
encrypted capture of 93 tables/595 rows/10 private files has source-free raw
staging verification. The owner calls the three colliding identities test
accounts and approved history aliases preserving native passwords/profiles/roles.
The approved archive decodes 420 rows; points, finance, forms, import, audit, rule/policy history, document metadata and legacy OST/
document source checks pass. One of ten archived private files has no business
link and stays blocked for ownership review. Historical document read schemas
retain old signature fields and tier/activation time without changing write forms.
The three source import jobs / 30 rows reconcile. The owner chose native
revalidation/resumption. Mapped jobs preserve evidence and carry a mandatory
revalidation gate on bulk/direct continuation writes. Native parse now accepts
an explicitly selected archived job and creates one linked fresh review with
transactional retries/audit rollback; Job history exposes Revalidate workbook.
Original evidence stays gated and immutable apart from lineage metadata. No
source jobs were imported to Atlas and browser acceptance remains deferred.
Legacy OST member IDs must match staff/auth identity snapshots; expired dates,
original form data and sponsor snapshots stay historical. Old referral codes map
to history-only legacy_referral_codes, never active referral capabilities. Source
renewals/conversions are empty-only guarded until their adapters are reviewed.
Identity-document metadata stays file-transfer-gated until owner aliases and
original/copied bytes verify. A source-free disposable rehearsal copied/linked
both actual archived ID files and proved identical replay without auth identities.
Profile-photo planners preserve the protected owner's photo and block replacing
existing native photos; their runtime linking/apply remains unmounted. One
unlinked private object stays preserved and unresolved. No Atlas import ran.
The 148 historical audit events retain exact bigint IDs/timestamp evidence and
unchanged payloads. Actor mapping requires auth identity snapshots, not staff-only
bindings. Known credential/government-ID payload keys block the plan without
redacting the source or returning private values; no live audit import ran.
Commission rules preserve exact rates/date ranges and keep target_id aligned with
the generated typed FK after aliases; overlapping active ranges block planning.
Source privacy/MFA settings go only to migration_source_* history collections,
never active policy. Existing approval, contacts, cleanup state and MFA remain
untouched. New history-collection setup requires the future reviewed apply.
All 93 captured tables/595 rows have explicit dispositions; empty guards do not
claim nonempty-domain migration support. A source-only native rehearsal inserts
418 records and nine identities, reconciles replay and preserves a synthetic
owner in a fresh loopback database. Four high-water counters include exact int64
points-ledger; a rollback probe verifies the next native ID is unused. The owner
selected preserve-both merging. A digest-bound metadata candidate retains native
references and complete source evidence for 46 differences; grants, activation,
prices/caps and department links cannot be bypassed. Nine missing role department
links, five business-key conflicts and one ledger-ID collision remain blocked.
No source reference history or merge was applied to Atlas.
It uses a separately unapplied points-ledger
validator proposal preserving legacy paired null deltas. Current Atlas validators
remain unchanged. Source-to-current-dev merging still has explicit conflicts.
The separately approved native VIP setup is applied: two existing native numbers,
unique index, nondecreasing counter, setup marker and one audit event. Encrypted
before/after comparison proves no other collection data changed; independent
restore passed. No source tombstones or credentials were imported into Atlas.
See docs/mongodb/MIGRATION-PREPARATION-2026-11-02.md and
docs/mongodb/SOURCE-MAPPING-REVIEW.md. The
dated scope descriptions below are historical; do not treat them as cutover proof.
See docs/mongodb/SOURCE-CAPTURE-AND-REHEARSAL-2026-10-31.md. No Atlas data import
or active native identity/business-flow rehearsal was performed by this capture.

2 November full workspace runs: API 3,271/221 files, Admin 1,021/111, web 267/23,
contracts 317/23, shared 56/7, config 7/1, UI 237/35: 5,176 tests pass. Later
unmounted migration-only additions pass 140 tests/24 files plus archived-source
rehearsal. Typecheck/env isolation/scoped lint pass; SPA builds use valid cache.
Shared address-cache fixes, bounded HTTP/files, immediate permission changes and
points contention pass locally; production capacity/browser acceptance are unproven.
Fresh read-only target readiness found no missing reference collections or
indexes and no declared core data inconsistencies (66 collections, six validators).
This does not complete migration, native file linking or browser acceptance.

31 October operations: six previously approved core validators are installed and
read back strict/error with unchanged business/administrator/credential hashes.
Local AES-GCM backups and a daily 21:00 signed-in-user task have real encrypted
capture/independent restore proof. The key is Windows DPAPI-protected; there is
no off-device/portable-key protection. Maintenance credentials are in ignored
.env.mongodb-maintenance.local and expire 1 November at 09:49 Singapore time.
See docs/mongodb/LOCAL-BACKUP-AND-VALIDATOR-SETUP-2026-10-31.md. Do not apply the
separate tier proposal or migrate source data under the six-validator approval.

30 October migration preparation: the pure, unmounted dry-run mapper supports
exact bigint IDs, safe integer quantities, dependent natural-key matching,
explicit field renames, UTC millisecond timestamps, dates, required fields and
strict booleans and canonical UUIDs before/after alias resolution. Reviewed
access/assignment column/PK/nullability/boolean/UUID/time declarations match the
recorded inventory. Write-requires-view and nonempty-deny source CHECKs
are enforced; remaining domain CHECKs/types are not yet covered.
Reusable definitions for six organization/access tables are in
api/_lib/migration-access-manifest.ts; full source metadata/FK checks and disposable
tests use them directly, including actual organization index setup. Text/int32 and
source code/slug CHECKs are validated; reference flag/history conflicts block reuse.
The reviewed staff definition adds all 13 source fields and source email/status
checks. Full staff planning requires source/target ID/email-only auth snapshots;
missing/conflicting/duplicate identities block output, and non-owner IDs cannot
be coalesced by email. Credential/provider state and counters remain separate.
31 October: the full 23-field network profile definition adds declared staff
references and source sex/civil-status/PSGC CHECKs, with native unique-index,
owner-preservation and empty-replay proof. Private fields stay out of diagnostics;
address-reference, accreditation, genealogy and file reconciliation remain open.
The catalog component in api/_lib/migration-catalog-manifest.ts adds six category
and 29 plan fields, source CHECKs, exact strings and conflict-blocking reuse after
category alias resolution. Native catalog indexes/storage/replay are proven only
in disposable tests; real catalog/economic reconciliation remains open.
The points-tier definition adds the four source fields with positive safe-integer
caps and actor remapping. Baseline reconciliation detects unrelated target changes;
the file verifier reads declared copies only and never transfers files. The new
tier validator/index is a separate unapproved proposal, proven only locally.
See docs/mongodb/MIGRATION-RECONCILIATION-AND-FILES.md for scope and open gates.
Runtime does not mount these eleven definitions; remaining business mappings
are still required.
Different grants/denies, unsafe renames, invalid dates and dependency cycles block
the plan. Nonzero microseconds remain blocked pending a preservation policy.
Raw source checksums, historical JSON and the protected owner/profile/assignments
stay intact. Three disposable mapping loads prove native storage/replay boundaries;
no real import or routing change ran. Full table/state/reference,
identity/file/counter mapping and real reconciliation remain open. See
docs/mongodb/SOURCE-MAPPING-REVIEW.md; preserve the existing administrator.

30 October membership follow-up: embedded Transactions and History use the shared
feature-path guard as well as permissions before rendering/querying Reports APIs.
Do not enable Reports/Redemption or widen the conversion allowlist to bypass these
UI errors. Active points/payments/card controls stay permission-gated. See
docs/mongodb/MEMBERSHIP-DISABLED-PANELS-FIX.md for regression/browser evidence and
the independently corrected synthetic payment fixture. Fresh API: 3,134 tests/
198 files pass; membership/UI: 40 tests pass; API/Admin typecheck and scoped lint
pass. Full browser acceptance
remains unfinished; preserve the existing administrator and real business data.

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

