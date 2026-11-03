# Active MongoDB workspace

26 October 2026. Continue in **`C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2`**, repository
`ClaudAfhomes/AFhomes-ecofarm-v2`, local branch **`claud/mongodb-conversion`**.
The user selected the folder already open in VS Code. Do not return to the
separate `afhomes-mongodb` repository or change branches without their instruction.

## Transfer and preservation

The branch was created from local `claud/clean-develop` at
`dc98db6ade45ee46143d43eb6bc1871c0735476a`. Existing uncommitted CMS/website work
was retained. The MongoDB delta was computed against its original develop snapshot
`f512c1416550feaf0c79a6bb204c51d08fa990f6` and applied as working files:
122 files, including two clean three-way merges in navigation and contract exports.
All 22 unrelated modified tracked files were checked byte-for-byte unchanged.
Existing untracked CMS sources and UI package exports were retained. No files were
deleted, staged or committed. Local backups and the transfer manifest are ignored
under `.tmp-bin/mongodb-transfer-1tdu7qdd/`.

The original `.env.local` was neither read nor copied by the transfer; its file
metadata was checked unchanged. Only the placeholder `.env.example` was included.
Root package identity and the source README/AGENTS guide are preserved.

## Runtime and next work

28 October latest: [portal sales repair](PORTAL-SALES-REPAIR-REPORT.md) implements
native Team Sales/overview, self-only recorded participation for VD/SSM/SM/OST,
forced-change sign-out/login redirection, and Mongo-only OST first-login setup.
Accreditation sidebar entries were removed by request; Reports/CMS feature flags
are off with source retained. 247 API + 59 admin + 17 web + 2 shared tests passed;
TypeScript/env/lint passed. Browser Super Admin overview is verified; per-role
manual browser acceptance remains pending. Existing applications name participants
but the two active sales name Super Admin as seller; never rewrite attribution
or commission history to make participant records count as direct seller sales.

28 October latest: [GSD lookup permission](GSD-CUSTOMER-LOOKUP-REPORT.md) restores
the missing source view-only grant. Core setup now includes it for new canonical
employee/admin roles. After explicit approval, one existing employee role grant
was added in `afhomes_dev` with an audit; all prior grants, assignments and
restrictions were verified unchanged. GSD uses `/employee/customer-lookup`.
Five native setup/GSD HTTP and 36 navigation/route/lookup tests passed, plus API
TypeScript and environment isolation. Refresh the existing GSD menu/session;
authenticated browser acceptance remains pending.

28 October latest: [day points correction](DAY-POINT-ALLOWANCES-REPORT.md) ports
the missing allowance attribution for all native adjustments and annual resets,
initializes activation buckets, corrects the recording preview and invalidates
lookup caches. All two existing accounts were reviewed; one missing adjustment
allocation was reconciled with an audit. Total/debt and original ledger amounts
and dates are preserved. The affected customer's lookup now includes both day
balances. 35 focused tests plus API/admin typechecks, targeted lint and environment
checks passed; actual browser interaction remains unverified.

28 October: [VIP/points/scroll repair](VIP-POINTS-SCROLL-REPAIR.md) adds transactional
VIP issuance on applications/activation, native manual points adjustments and
shared dialog scroll-lock ownership. The reported customer already has a VIP
number; a read-only directory/lookup check confirms it is returned. No live
customer/points repair was executed. Reload existing browser pages; authenticated
browser acceptance is still pending. Services and Redemption remain disabled.

28 October latest: [points-tier reference setup](POINTS-REFERENCE-SETUP-REPORT.md)
was explicitly approved and applied to `afhomes_dev`. The command exited 0,
inserting BRONZE 25000, SILVER 40000 and GOLD 60000. Post-apply reads verify exactly
one row per tier; three active card plans remain. Guarded points-only setup has
15 passing native setup/sales/points tests plus API TypeScript/env checks. No real
activation was executed and no financial records were changed by the setup. The
user should retry activation. Do not silently seed configuration from API requests.

28 October latest: [application approval deadline](APPLICATION-APPROVAL-DEADLINE-REPORT.md)
reproduces and fixes a transaction-timeout 503 in approval with an explicit 45s
session budget. 35 native purchase/import/document tests passed, including atomic
approval rollback and replay with one reservation/deposit; API TypeScript/env
checks passed. The real application remains submitted with zero reservations and
approval events, checked read-only; the user should retry Approve. The separate
"valid subject" 400 is from document lookup, whose failing URL was not supplied.
Browser approval acceptance remains pending. No real application was approved by
the agent and no financial records were inserted or edited.

28 October latest: customer application submission for Nagtipunan/Quirino was
blocked because the pinned postal row is named `Nagtipunan (Abbag)` while PSGC
returns `Nagtipunan`. Added a province-scoped alias verified against
https://phlpost.gov.ph/zip-code-locator/ (3405), preserving the original reference
row and strict unknown/ambiguous holds. Both runtimes and the address selector
share this resolver. Replaced the misleading "leave blank" hint with reference
review guidance. 56 API and 35 form tests passed, including real disposable HTTP
creation/submission with verified geography, server-owned ZIP persistence and
rejection of an unrelated province alias. API/admin TypeScript, env isolation and
targeted lint passed (existing React refresh warnings). The live address lookup
requires authentication (401 without a cookie); no real customer was created or
modified for verification. The user should retry Submit on the existing form.

28 October user acceptance: the user confirms both IST and OST creation now
succeed. A follow-up UI bug retained the previous OST form's inputs for the next
account. Members now mounts the OST dialog only while open, so closing/success
discards that form instance and reopening starts fresh, including credentials,
photo, geography and request ID. Failed submissions remain mounted for correction.
The new real-page close/reopen regression first failed on the previous name;
37 Members/OST React tests now pass. A live browser retry of the reset is pending.

28 October latest: [member creation transaction deadline](MEMBER-CREATION-DEADLINE-REPORT.md)
fixes a reproduced inherited-timeout 503 for both IST and direct OST. The bounded
45s account-creation transaction preserves the ordinary 15s client budget and all
account/AA guards. 35 native tests plus API TypeScript/env checks passed. The user's
actual browser retry remains pending; no real member was created for testing.

The user selected [one-time data migration preparation](ONE-TIME-DATA-MIGRATION-PLAN.md).
The Supabase connector lists a different project, but the existing direct source
PostgreSQL configuration verified `ikaevepedpqygdlipsei` and allowed read-only
inventory. Source: 9 staff, 10 auth users, 2 customers, 2 sales, 4 payments,
2 memberships and 10 private files. Target business records are empty; preserve
its existing administrator. Source bcrypt passwords need tested compatibility,
and the owner email collision needs explicit ID remapping without replacement.
No source data export, target import or synchronization was performed. Implement
backup/manifest/transform dry-run gates before target apply; CMS stays last.

28 October immediate priority: [local sign-in diagnostics](LOCAL-LOGIN-DIAGNOSTICS.md).
The user reports owner login and IST creation failures. Native login no longer
mislabels service outages/throttling as wrong credentials. 56 shared and 16 login
React tests passed; shared/admin TypeScript and environment isolation passed.
Owner identity/assignments were preserved. API3084/admin5184 were initially
unreachable, then both returned HTTP 200 at the final session-endpoint probe;
the user's `pnpm dev` must stay running for live diagnosis. No
real password reset or successful owner sign-in has been established. Resolve
these reports before resuming conversion; the prior 19 native member/runtime
checks do not prove the user's actual account or failed member submission.

27 October latest: [ordinary workbook confirmation and purchase continuation](IMPORT-CONFIRMATION-REPORT.md).
Company-workbook confirmation, source commit/recovery and import-backed
application creation are native. 156 API and 56 React tests passed. The combined
disposable HTTP test reaches membership activation from the imported application,
matches its claim to the existing deposit and enforces full verified payment.
Continue remaining flat/legacy and certified-history business processing,
reporting and browser acceptance; **CMS last**. No real records, environment,
administrators, remote indexes, commits or pushes changed at this checkpoint.
Older entries retain their historical results and have superseded blockers.

27 October latest: [native workbook upload/review](WORKBOOK-REVIEW-REPORT.md).
Existing file formats now share parsing/validation across both runtimes; MongoDB
persists private-safe paginated review jobs, serves templates and cancels jobs.
Preview does not create customers, applications or money. 260 relevant API and
25 UI tests passed; the final 11 native HTTP tests passed after short bulk
persistence. Continue job confirmation, source commit/recovery and import-backed
application transactions, then certified history/reporting and browser acceptance.
**CMS last**. Atlas data/indexes and environment files remain unchanged.

27 October previous: [native continuation review/intake](IMPORT-CONTINUATION-REVIEW-REPORT.md).
The ordinary imported-purchase panel and application prefill now read actual
MongoDB stages, source/customer proposals and versioned review state. Ownership
is filtered before source deduplication and pagination; TIN values stay private.
76 targeted API and 42 UI tests passed. File parsing, job/source commit/recovery,
import-backed application completion and certified historical processing remain
unported. Continue those, reporting and outstanding acceptance; **CMS last**.

27 October previous: [native imported-payment claim reconciliation](IMPORT-CLAIM-RECONCILIATION-REPORT.md).
Existing linked claims now support actual paginated reads, private receipt
upload/completion/download and Finance hold/reject/match/record. The purchase
recorder supplies exact money, evidence, audit and replay in the same transaction;
recording never changes verified totals. 115 relevant API tests and three UI tests
passed; final claim/gate follow-up passed 65. Workbook parsing/review/commit,
source continuation/recovery and certified historical import processing remain
unported. Continue those, then reporting/remaining acceptance; **CMS last**.

27 October previous: [controlled OST applicant corrections](OST-APPLICANT-CORRECTIONS-REPORT.md).
The existing Update Information endpoint now appends verified corrections in a
MongoDB transaction. Member detail and future renewals use the shared current
projection; original account/registration and submitted renewal snapshots stay
intact. 97 relevant API tests, 24 OST React tests, API TypeScript and environment
isolation passed.
New browser acceptance remains pending. Continue imports/claim reconciliation,
certified analytics/reporting and remaining business acceptance. **CMS last**.

27 October previous: [native IST/OST kind conversions](MEMBER-KIND-CONVERSION-REPORT.md).
Both directions now use the existing dialogs/contracts with native transactional
authorization, replay, preserved login/sale history and retired-AA lookup.
76 targeted API tests and 10 existing dialog tests passed; API TypeScript and
environment isolation passed. OST-to-IST passed Chrome submission/reload.
IST-to-OST browser acceptance remains pending after the computer-use connection
became unavailable. Complete-suite rerun remains NOT RUN. Continue remaining
official OST corrections, imports/reconciliation, reporting and acceptance;
**CMS last**. No real database records or environment files changed.

27 October previous: [native member editing and involvement](MEMBER-PROFILE-REPORT.md).
The existing profile editor now saves via an atomic MongoDB account/profile/head
transaction, with temporary-password enforcement, strict scope, field-only audits
and protected AA/sale history. The staff sales-involvement panel now reads actual
recorded participation, including original committed import provenance, without
using present genealogy. Browser edit/reload and populated-panel checks passed.
78 relevant API checks and final 20-case follow-up passed; API TypeScript and
source/built environment checks passed. Complete-suite rerun remains NOT RUN.
Next: controlled kind conversions/remaining official OST corrections, imports,
reporting and remaining acceptance. **CMS last**. See the report for exact limits.


27 October latest: [native OST team transfer](MEMBER-TEAM-TRANSFER-REPORT.md).
The existing expired-accreditation management-approved team move now has native
transaction/HTTP and Chrome-after-reload proof. A generic referral bypass was
closed. AA identity, term dates, login and historical sale snapshots are retained.
CMS is last by explicit user instruction. Continue with remaining member editing,
kind conversions and sales reads, then imports/reconciliation, reporting and
outstanding acceptance checks before CMS. No real business records or Atlas
configuration were changed by this continuation.


27 October checkpoint: [identity intake and purchase acceptance](IDENTITY-PURCHASE-ACCEPTANCE.md).
Native ID intake now works, including private delivery in Customer Lookup.
The core purchase flow was exercised in Chrome through activation, with active
VIP lookup afterward. Lists and auto-approval handoff regressions were fixed.
Full API 2,905 passed; focused UI 72 passed; type/lint/build/env checks passed.
IST/OST direct creation and masked photo disclosure passed native HTTP with the
real Cloudflare dummy verifier in a disposable preview. Its external browser
widget failed `300030`; live public privacy/configuration approval is still absent.
Latest follow-up: 106 focused API tests, 15 dashboard UI tests and the isolated
14-test workbook retry passed; API TypeScript/lint/build/env checks passed. A
wider API rerun was interrupted after an unrelated timeout, so the earlier full
2,905-test result is historical. Dashboard overview/trend are native and browser-verified after reload; their
pure source calculations are shared with the inherited handler. Normal-reservation
claim-panel reads query MongoDB; actual imported claims remain explicitly blocked.
Next unported surfaces include certified import attribution/reconciliation,
team-sales analytics subroutes, member changes, reports and CMS.

Latest catalog follow-up: [develop catalog and browser blockers](CATALOG-READINESS-REPORT.md).
The user approved configuring reference plans from the current `develop` branch.
Gold/Silver/Bronze and the membership category are now inserted in `afhomes_dev`,
with stored terms verified against commit `f512c14`; existing records were preserved.
Native purchase/account/search tests pass. The Identity blocker recorded in the
catalog report was resolved in the 27 October checkpoint above. Analytics
overview is now native; preserve its shared role/scope contract.

Latest checkpoint: [core readiness and approved Atlas setup](CORE-READINESS-REPORT.md).
The user approved additive core initialization for `afhomes_dev`; it completed
with nine missing roles and five departments added, while preserving existing
administrators and assignments. Native privacy settings and monitored retention
are implemented. The user deferred paid cloud storage: the real localhost launcher
now provides persistent private filesystem storage outside the repository with
signed downloads. See `PRIVATE-STORAGE-SETUP.md` for its location and session-only
core-write enablement command. The three develop reference plans are now active. Commercial
writes remain explicitly gated; full-platform cutover is not complete.

Current user clarification and continuation: [direct account creation and search](ACCOUNT-CREATION-SEARCH-REPORT.md).
OST is created already accredited in one action; do not introduce a new
registration/endorsement journey. Native Members creation, public disclosure and
purchase-to-Customer Lookup now have disposable HTTP coverage. The user also
requested removal of MongoDB MFA; password-change enforcement and RBAC remain.
Real Atlas writes/cloud initialization and complete browser acceptance are pending.

Newest continuation: [network and private storage checkpoint](NETWORK-STORAGE-REPORT.md).
Native AA management, manual OST renewal, ordinary OST portal reads and private
profile photos now have disposable HTTP proof. The actual renewal form was
submitted and verified after reload. Private S3-compatible storage was selected
by the user's delegated choice; cloud configuration and whole-platform acceptance
remain pending. This report identifies the unported initial-registration,
network-management, document/import and reporting work.

Latest continuation: [native purchase and IST verification](PURCHASE-NATIVE-VERIFICATION.md).
It replaces the placeholder purchase integration test with real native HTTP,
rollback, replay and VIP activation proof, repairs purchase/legacy agreement
behavior, and adds native IST reporting plus self-identity reads. Its evidence
and remaining-work list supersede older statements below about these paths.
Whole-platform conversion and real commercial initialization remain incomplete.

Latest core-workflow increment: [native core workflow report](CORE-WORKFLOWS-REPORT.md).
It adds native Organization, Sales/Finance/commissions, membership management,
GSD lookup, customer deactivation, referral/genealogy and address routes, with
2,813 passing API tests and final targeted rollback/HTTP proof. Full-platform
conversion and browser acceptance remain incomplete; see that report's gaps.

The original bootstrapped administrator is in **Supabase**, confirmed by the
user. Preserve it there. The user subsequently authorized a separate **MongoDB
Super Admin**, successfully created on 26 October 2026; see
[bootstrap scope and evidence](ADMIN-BOOTSTRAP-REPORT.md). This did not transfer or
reset the original identity. No further Atlas initialization is authorized.

Production routing still uses Supabase. The user subsequently requested MongoDB
as the default local development startup: `pnpm dev` launches admin 5184, web
5183 and API 3084, using the ignored root `.env.local`. Only nine non-secret
localhost settings were updated; existing credentials were preserved. Converted
reads and account/password changes are enabled; commercial writes remain
blocked until explicit initialization and workflow readiness. The dashboard's
former account-only 403 is removed, with native dashboard reads validated against
`afhomes_dev`. No business data/schema initialization was performed.

`corepack pnpm dev:mongodb:local`
starts only the converted native slice with fresh synthetic loopback replica-set
data, separate ports and isolated frontend environment. It does not load root
`.env.local` or touch Atlas. Never substitute the existing administrator for QA.

See [Phase 5 integration checkpoint](PHASE5-INTEGRATION-REPORT.md) for implemented
catalog, customer directory/CRUD, VIP activation, portal points and cookie staff
RBAC. Browser acceptance and later conversion phases remain outstanding.

The previous workspace's full run passed API (2,793), web (265), shared UI (234),
contracts (313), shared (51) and config (7). Admin completed 970 tests but two
workers failed to start; that full run exited nonzero. Focused native client/session
tests passed. Final lint there passed after adopting the existing deferred initial
session-resolution pattern. These are historical results, not proof of this merged
checkout. Re-run focused integration, affected frontend tests, typecheck, lint,
build and environment isolation here and record results below.

No existing-data migration, Atlas writes, real-admin bootstrap/reset, source branch
push or deployment is authorized. Staff invitations remain disabled; temporary
passwords and VIP activation codes/links preserve the approved flows.

## Verification in this checkout

- Frozen-lockfile install: PASS; cached packages reused, no version resolution.
- Native catalog/activation/customer/points/staff/RBAC/HTTP and route coverage:
  **30 PASS / 7 files** (`.mongodb-branch-api.log`).
- Affected native client/session, legacy identity, CMS model and previously
  unstarted chart/staff-activation tests: **38 PASS / 6 files**
  (`.mongodb-branch-admin.log`).
- Customer portal/recovery/default-off feature flags: **76 PASS / 3 files**
  (`.mongodb-branch-web.log`). Total focused checks: **144 PASS / 16 files**.
- Full workspace and operator typecheck: PASS (`.mongodb-branch-types.log`).
- Lint: PASS, zero errors; 32 admin and 9 web warnings remain
  (`.mongodb-branch-lint.log`). No rules or assertions were weakened.
- Both SPA builds: PASS, existing chunk-size warnings
  (`.mongodb-branch-build.log`). Source and final built environment-isolation
  guard: PASS (`.mongodb-branch-env-final.log`).
- Approved read-only Atlas ping from this checkout: PASS against `afhomes_dev`.
  Only `{ ping: 1 }`; no collections/indexes/data written
  (`.mongodb-branch-ping.log`). Credentials were not printed.

The full workspace unit suite was not repeated in this checkout. Real-browser
acceptance remains pending; builds and focused tests do not establish it. No
commit, push, deployment, existing-data migration or real-admin change occurred.
