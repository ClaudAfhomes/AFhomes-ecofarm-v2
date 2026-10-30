# MongoDB completion progress and reviewed apply scope

30 October migration preparation: the pure dry-run mapper preserves bigint IDs,
range-checks quantities, resolves parent aliases before permission comparisons,
and supports explicit field renames, timezone-aware millisecond timestamps and
date-only validation, required-field checks and strict boolean checks. Complete
access/assignment column/PK/not-null/boolean/UUID/time declarations match the
recorded source inventory. Canonical UUIDs are checked before/after alias mapping,
including target reference reuse and protected-owner IDs. No identifiers are
rewritten. Write-requires-view and nonempty-deny CHECKs now have exhaustive
boolean-combination proof; other domain CHECKs/types/lifecycle rules stay open.
Six organization/access definitions now live in migration-access-manifest.ts:
departments, modules, roles, grants, assignments and restrictions. Source metadata,
text/int32/code checks, complete single-column FKs and native unique indexes are
checked in the combined disposable load, including a new assignment and empty
replay. Reference flags/timestamps must agree; native role-name collisions block
the plan. This remains a reviewed subset; full staff/identity/business mappings
and reconciliation are still required.
Source assignment `assigned_at` maps to native `created_at`.
Date-only values remain calendar text; no age rule or timezone shift is applied.
Conflicting grants/denies, unsafe renames, invalid dates and cycles block the plan.
Nonzero microseconds still require a preservation policy. Source checksums and
nested history remain intact; owner/profile/assignment protections stay enforced.
Three disposable mapping loads cover native indexes, types and replay; see
SOURCE-MAPPING-REVIEW.md for proof and remaining table/state/nullability/reference,
identity/file/counter work. No real export/import, account change, push or deployment.

30 October membership error repair: embedded transaction/audit panels now respect
the same shared feature-path flags as their disabled Reports APIs, in addition
to permissions. No routes or modules were enabled. Forty membership/flag tests,
Admin typecheck/scoped lint/env isolation and native Chrome absence/Points/card-
control checks pass. A separate malformed synthetic payment fixture was corrected
with native HTTP contract proof (11 sales tests); the full serial API suite also
passed 3,134 tests/198 files. API typecheck/scoped lint pass. The running QA row is
still old and needs a fresh fixture start. See MEMBERSHIP-DISABLED-PANELS-FIX.md. The
application wizard reached Certify but was not submitted; full acceptance stays open.

30 October browser continuation: existing Super Admin dashboard, customer lookup,
nonblank VIP card identifier, 2,000 total / 1,400 weekday / 600 weekend points,
session retention after full reload/repeated search, and customer overview
scrolling now have direct Chrome proof. No business/account writes ran. Separate
fresh disposable browser QA now uses 127.0.0.1 to isolate its cookies from real
localhost. Synthetic password-change handoff is pending. See
BROWSER-ACCEPTANCE-2026-10-30.md; full role/workflow/console/network acceptance
remains open.

30 October: automated quality gate is green: 5,033 tests, fresh API/Admin with
five unchanged tasks cached; typecheck/build/lint/env isolation pass. CMS remains
disabled. Strict TLS source metadata refresh succeeded (93 selected tables,
1,291 columns, 254 foreign keys); no business/password/file export. Explicit
production namespace guard preparation and disposable sign-in passed, without
changing environments or initializing production. Small local read-load and
10,000-row index proof are recorded. See COMPLETION-CHECKPOINT-2026-10-30.md for
exact results, cache/measurement limits and the six remaining acceptance gates.
This supersedes the earlier red automated gate below, not its historical result.

29 October approved validator apply: fresh reviewed preflight still matched
(18 compatible records). The first collMod failed; the app database user lacks
the required privilege. Execution stopped and independent options/BSON/index
checks verified all six collections/18 documents unchanged; zero applied.
See CORE-VALIDATORS-APPLY-RESULT.md for a separate maintenance-user connection
handoff. Existing approval stays valid; no app grants/accounts/env files were
changed. Browser, migration, recovery and deployment gates remain open.

29 October validator preparation: six core schema proposals now have native
insert/update/rollback proof and strict purchase/sales/activation/legacy and
certified-import compatibility (69 tests). Read-only live preflight found all
18 inspected records compatible, with six validators missing. The Atlas complex
metadata-filter issue was reproduced and resolved using the existing readiness
query pattern; a regression now covers that shape. See CORE-VALIDATORS-REVIEW.md.
No Atlas DDL/data changes or shared installer were introduced; explicit approval
is required before the reviewed six-validator apply. This is not full database
or platform completion. CMS remains last; other acceptance/migration gates stay open.

29 October password/test preparation: the full API suite passed serially before
the bridge addition (3,123 tests/195 files). Root tests now serialize workspace
and file execution to avoid process contention without skipping suites or
weakening assertions. A default-off tagged source bcrypt verifier is prepared;
30 focused tests pass, including real disposable HTTP first-change/native-upgrade
and separate owner preservation. The full API rerun with the bridge also passed
(3,126 tests/196 files). See PASSWORD-COMPATIBILITY-VERIFICATION.md.
No source export, Atlas/environment/account changes, deployment or push ran.
The complete root run finished without worker errors: 5,002 passed and 21
deferred CMS-related failures. API typecheck, environment isolation and scoped
API lint pass; root frontend lint passes with 32 existing warnings/cache hits.
See TEST-GATE-2026-10-29.md. The whole-repository gate remains red; CMS stays last.

29 October native hosting: user chose a DigitalOcean Droplet without Docker and
retained Atlas. An opt-in hosted Node API, isolated public build, persistent
private filesystem provider and systemd/Nginx staging templates are prepared.
92 relevant tests passed; final hosted/storage rerun: 9 passed. Hosted actual
build/typechecks/prerender/static assembly and built env isolation passed, plus
targeted lint and fail-closed CLI preflight. See HOSTED-RUNTIME-VERIFICATION.md
and DIGITALOCEAN-NATIVE-HOSTING.md. No cloud provisioning, deployment, network/DNS
changes, database/account changes or Git push occurred. Linux/TLS/browser and
production cutover remain open; current DB/auth scope is still afhomes_dev.

29 October business mapping preparation: an unmounted explicit-manifest planner
now preserves owner identity/assignments, remaps declared scalar references only,
retains frozen JSON evidence and exact money, reuses matching references, and
blocks conflicts, missing target snapshots, unsafe identities and credential
imports. Six mapping tests pass, including a native synthetic load; mapping and
recovery also passed together (9 tests). The main recovery test now shares its
full restore between fidelity and sign-in checks; repeated-target isolation still
has separate proof and the 30s case deadline is unchanged. API typecheck, targeted
lint and environment isolation pass. See `MIGRATION-MAPPING-DRYRUN.md`.
This is not a complete-source dry run, bcrypt bridge, live importer or cutover.
No source/Atlas data or existing accounts changed; browser acceptance remains open.

29 October intake edge cases and recovery rehearsal: Inactive/Cancelled non-member
intake now preserves source creation/update semantics without creating financial
or authentication records. A disposable encrypted BSON/schema/private-file
recovery rehearsal now restores after source shutdown, validates checksums,
indexes/validators, BSON types, original synthetic credentials/sign-in and forced
password change, and refuses corrupt archives/unsupported views. The command
`pnpm test:mongodb:recovery` provisions its own loopback servers only; it cannot
select an existing database. See `RECOVERY-REHEARSAL.md`. Real durable backup/key
recovery, migration compatibility and browser acceptance remain incomplete.
No real data was exported, no Atlas/administrator records changed and no push or
deployment ran.
Verification: 206 import tests and 3 recovery tests passed. The initial combined
run hit one 5s workbook round-trip timeout; its single multi-upload scenario now
has a bounded 30s test budget. Recovery/continuation rerun: 17 tests passed.
Assertions and application request limits are unchanged. API typecheck, targeted
lint and environment isolation passed. Full-platform/browser acceptance remains
unverified; these results do not replace a real backup or migration rehearsal.

29 October financial continuation: legacy Reservation Paid, Down Payment Completed,
Partially Paid and Fully Paid CREATE now use native frozen sale/payment writes.
Verified totals determine payment_in_progress/payment_verified, correcting the
source's incompatible payment_pending assignment. Fully paid imports reach the
activation queue; partial imports require remaining money to be recorded and
verified before separate activation succeeds. Rollback and overpayment rejection
pass. Fresh full API suite: **3,108 tests / 192 files passed**, using two workers;
API typecheck, targeted lint and environment isolation passed. Existing workbook
flags/download/correction proof remains covered. See
`LEGACY-FINANCIAL-IMPORT-REPORT.md`. Browser acceptance, remaining legacy edge
cases, migration compatibility and recovery remain open. No Atlas changes.

29 October legacy member CREATE and workbook flags: flat Active VIP/Suspended/
Expired creation now restores exact settlement, original dates/member identity
and replay-safe opening points in a native transaction. 26 confirmation tests
pass. The annotated guided XLSX download/correction round trip now also has
native HTTP proof for red source cells, explanations and retention of every
original source-field value. Latest focused run: 203 tests / 8 files passed.
Full API checkpoint: 3,105 tests / 192 files passed with two workers before the
additional annotation regression; the initial unrestricted run had two 5s
workbook timeouts. No timeout limits were raised. Static checks pass. See
`LEGACY-MEMBER-CREATE-REPORT.md` and `ANNOTATED-WORKBOOK-VERIFICATION.md`.
Non-member financial legacy CREATE remains gated by the source status mismatch;
browser, migration compatibility and recovery remain open. No Atlas changes.

29 October legacy member updates: existing member metadata and source-permitted
status transitions now confirm natively with fresh ownership/tier checks,
transactional audits, rollback and replay protection. Financial/points history
and activation dates stay intact. 184 relevant tests and API typecheck passed;
targeted lint and environment isolation also passed. See
`LEGACY-MEMBER-UPDATE-REPORT.md`. Legacy financial/member CREATE and browser
acceptance remain open. No shared database or account changes in this step.

29 October legacy Pending compatibility: CSV, standard-column XLSX and the
downloaded CSV template now confirm Pending customer intake natively, including
protected non-member updates. 180 relevant tests, API typecheck, targeted lint and
environment isolation passed. Financial/member legacy writes remain gated; browser
acceptance is still pending. See `LEGACY-PENDING-IMPORT-REPORT.md`. No Atlas data
or schema changed in this step.

29 October workbook acceptance: 59 focused import tests and API TypeScript passed
on a fresh rerun. Actual generated XLSX upload -> persisted review -> confirmation
-> saved purchase/membership/points now passes for Fully Paid and Active VIP
histories, with duplicate-confirm protection. This is disposable native HTTP/API
proof; browser UI acceptance and legacy business confirmation remain unfinished.

29 October: the separately approved historical schema apply completed. Three
empty collections and six unique indexes are verified on afhomes_dev. Fresh
read-only canonical setup/integrity checks pass (66 collections; 48 canonical
indexed collections; no declared gaps/inconsistencies). No business data migrated
or modified. Browser, legacy migration and recovery work remain unfinished.

Latest historical transaction checkpoint: all six guided-workbook historical
destinations now have native transaction/HTTP proof, including commission cutover,
actual membership dates and replay-safe remaining points. Full API suite: 3,089
passed. Atlas remains gated by three absent collections and six required unique
indexes. The exact read-only plan and unfinished items are in
`HISTORICAL-IMPORT-TRANSACTION-REPORT.md`; no target schema or business apply ran.

Historical-review checkpoint: certified guided-workbook parsing and native review
now work with source permissions, frozen-history conflicts, points/VIP previews
and stale-review checks. Confirmation is still blocked; this is not a historical
data migration. See `HISTORICAL-IMPORT-REVIEW-REPORT.md` for local proof and the
remaining transaction work. CMS remains last.

Later checkpoint: the separately approved import initialization has now added
the five missing collections and twelve indexes. Fresh canonical setup/core
integrity checks pass. See `DATABASE-READINESS-2026-10-28.md` for current database
status; the earlier missing-collection observations below describe the first pass.

Workspace: `AFhomes-ecofarm-v2`, branch `claud/mongodb-conversion`.
Source reference: `origin/develop` at `f512c1416550feaf0c79a6bb204c51d08fa990f6`.
This is a progress report, not a full-platform readiness certificate.

## Implemented locally

- Canonical role setup includes the exact later source migration grants.
- A read-only role parity plan and digest-bound operator repair add absent rows
  only. Saved grants, deny restrictions, identities, passwords and assignments
  are preserved. Transactional audit failure rolls the repair back.
- Native imported account/list/commission visibility now follows
  `imported_purchase_scope`, `account_imported_sales` and
  `imported_sales_for_account`. Recorded source participation and current active,
  authoritative downline membership are both required for team visibility.
  Current hierarchy alone never invents historical participation.
- IST/OST portals and scoped analytics merge imported sales by sale ID. Expired
  membership status prevents historical sales counting as active. Customer names
  in the imported purchase list require customer-view permission. Previously
  settled commissions remain excluded from current qualification.
- Missing import provenance still fails closed rather than returning partial
  financial totals. This reporting work does not enable certified import writes.
- Two stale router tests now expect Reports and CMS to remain disabled.

## Read-only afhomes_dev permission review

Found 13 absent reference grant rows and zero differing saved grants. All deletes
remain false. The reviewed additions are:

| Role | Module | View | Create | Update |
| --- | --- | --- | --- | --- |
| Admin | governance.customer_import | yes | yes | yes |
| Admin | network.members | yes | yes | yes |
| Admin | operations.customer_lookup | yes | no | no |
| Admin | operations.payments | yes | no | yes |
| Admin | operations.sales | yes | yes | no |
| Employee | operations.sales | yes | yes | no |
| Finance | operations.payments | yes | no | yes |
| Finance | operations.sales | yes | no | no |
| OST | network.members | yes | no | no |
| Sales Manager | network.members | yes | no | no |
| Senior Sales Manager | network.members | yes | no | no |
| Senior Sales Manager | network.ost_registrations | yes | no | no |
| Vice Director | network.members | yes | no | no |

The five `operations.sales`/`operations.payments` rows belong to retained Services
source. Shared UI/API flags still disable Services, Redemption, Reports and CMS.
Permission reference repair does not enable those modules.

Read-only command:

```powershell
pnpm --filter api exec tsx scripts/prepare-mongodb-role-parity.ts --plan
```

Observed plan digest:
`2f5b943bb63cfbde682a344e6c3ec480acfa66618147cd6c597c328c3e9d5a9f`.
An approved apply requires `--apply --approve-role-parity=afhomes_dev` plus
`--approve-plan=<reviewed digest>`. A changed plan is rejected.

After explicit user approval, all 13 rows were added to `afhomes_dev` with an
atomic audit event. The post-apply plan reports zero missing rows and zero
differing saved grants. No existing grant, restriction, administrator or business
record was rewritten.

## Measured index work

MongoDB 8.0.0 disposable loopback replica; 10,000 synthetic rows per collection.
Same queries and result sets before/after, without hints:

| Query | Before docs / keys examined | After docs / keys examined | Results |
| --- | --- | --- | --- |
| Ancestor sale IDs | 10000 / 0 | 0 / 50 | 50 |
| Staff sales by period | 10000 / 0 | 50 / 50 | 50 |
| OST sales by period | 10000 / 0 | 50 / 50 | 50 |
| Imported referrer/recommender | 10000 / 0 | 100 / 102 | 100 |
| Original import source | 10000 / 0 | 1 / 1 | 1 |

These are query-work measurements, not live Atlas latency or throughput claims.
Existing unique constraints remain intact. Conflicting names, nonstandard
collation and partial/hidden/TTL indexes require review, not replacement.

Prepared indexes on existing afhomes_dev collections:

- `card_sale_hierarchy_snapshots/read_ancestor_sales`:
  `(ancestor_staff_id:1, sale_id:1)`.
- `card_sales/read_staff_sales_period`:
  `(origin:1, seller_staff_id:1, created_at:-1, _id:1)`.
- `card_sales/read_ost_sales_period`:
  `(origin:1, seller_ost_id:1, created_at:-1, _id:1)`.

Three additional tested indexes are deferred while import collections are absent:
`customer_import_rows/read_import_referrer`,
`customer_import_rows/read_import_recommender`, and
`customer_import_purchase_sources/read_import_original_source`.
The operator does not create missing collections. Index DDL is not transactional;
an interrupted apply requires a fresh reviewed plan and preserves created indexes.

```powershell
pnpm --filter api exec tsx scripts/prepare-mongodb-performance.ts --plan
```

Observed digest: `7482db8cae0e8e09b2721d2d611270fced28cbb7e33cc595287f6e46f63ff2cb`.
An approved apply requires `--apply --approve-indexes=afhomes_dev` plus
`--approve-plan=<reviewed digest>`.

After explicit user approval, the three indexes on existing collections were
created and verified present in `afhomes_dev`. The three import indexes were
deferred; no missing collection was created and no existing index was dropped.

## Cache and acceptance limits

Existing browser queries already use a 30-second stale window, request deduplication,
mutation invalidation and private-cache clearing when identity changes/sign-out
occurs. Native JSON responses use `Cache-Control: no-store`. No shared financial,
authorization, CDN or Redis cache was introduced. An additional regression test
proved that import confirmation left an open IST sales query stale. Confirmation
now invalidates `ist-portal` and `team-sales` queries too; the test verifies an
active cached report refreshes after confirmation.

Fresh targeted native/reporting/router checks passed. Repository typechecks,
environment isolation, lint and build passed; lint has existing warnings and build
has existing large-chunk warnings. The first full API run had 3051 passing tests
and two stale flag expectations, subsequently fixed and passed in a focused rerun.
The subsequent full API run passed 3054 tests in 188 files. An additional native
HTTP test was then added to verify real-cookie imported purchase access and fresh
deny restrictions; its seven-test file passes separately.
The independent complete public/customer web suite passed 267 tests in 23 files.

The broad admin UI run had 975 passes and 39 failures. Eighteen failures were
resolved: retained Reports tests now explicitly enable their test fixtures,
forced-password redirect assertions wait for actual navigation, and an OST code
fixture no longer expires on the day the suite runs. The focused rerun, including
the new cache regression, passed all 49 tests. Twenty disabled-CMS UI expectations
and one CMS blocking-dialog scan remain unresolved and are deliberately retained
as failing evidence for the user's CMS-last phase. No test was skipped to hide
these failures. Therefore the whole-repository test command is NOT GREEN.

The existing Super Admin browser session loaded Genealogy/Team Sales Activity
after reload and exposed neither Reports nor CMS navigation. This is read-only
Super Admin smoke proof, not complete role-by-role browser acceptance.

Still incomplete: certified/legacy financial import confirmation; actual source
data export/transform and bcrypt compatibility; private file migration; backup/
restore drill; collection validators; full role-by-role browser acceptance;
complete shared initialization for the still-disabled import paths. The earlier
migration inventory is stale now
that afhomes_dev contains newly created business records. Refresh both sides before
any migration. No source writes, bootstrap/reset, migration, push or deployment
were performed in this completion pass.
