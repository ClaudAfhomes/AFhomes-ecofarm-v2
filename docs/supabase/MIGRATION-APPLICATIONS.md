# Confirmed scoped live migration applications

This log records observed live applications, not the state of every repository migration. `CURRENT-SCHEMA.sql` remains a context-only repository manifest/table inventory and must never be executed as SQL.

## 2026-10-16 — approved reconciliation and company workbook RPC

- Target independently verified as AF Homes project `ikaevepedpqygdlipsei`.
- User explicitly approved these two migrations. The reconciliation was revised and retested only after verifying it was still unapplied, to preserve a newer live accreditation RPC.
- Applied from source commit `ab40757` using the guarded repository runner with `--approve-production --only=20261130000003,20261206000003`.
- Successful files, in order:
  - `20261130000003_afhomes_reconcile_membership_sale_team.sql`
  - `20261206000003_afhomes_company_customer_workbook.sql`
- Post-apply observation: `2026-10-16T13:39:09.594Z`.
- Live history: **77 → 79** entries. The added version set is exactly the two approved versions; no history entries removed or unrelated versions changed.
- Repository manifest: **88 files / 60 public tables**. Live catalog also contains **60 public tables**. File count and live history entry count are different concepts.

### Verification

- Local skipped-history/newer-RPC regression suite: **30 checks passed**.
- Full disposable PostgreSQL suite: **2,542 / 2,542 passed**.
- Live post-check: all **7 existing accreditation/numbering/import function definitions and ACLs** match their preflight fingerprints.
- The newer **7-argument** `manage_sale_team_accreditation` remains present. No older 6-argument overload was introduced.
- Existing `commit_customer_import_row` body was preserved exactly in its private legacy delegate; the public dispatcher now supports company workbook imports.
- New staff-lookup/company-commit/legacy-delegate functions exist. Staff lookup and public commit are executable by `service_role`, denied to `authenticated`; the private company helper remains denied to direct `service_role` execution.
- The complete repository RLS invariant audit returned **zero violations** before and after application.
- No seed, bootstrap, invitation, customer import, payment, membership activation or other business-row test mutation was performed.
- Deployed authenticated import/browser behavior was not retested as part of this migration task.

### Unchanged history differences

These repository migrations remain absent from live history and were **not applied or stamped** by this operation:

- `20261030000001_afhomes_customer_directory_id_filter.sql`
- `20261031000001_afhomes_customer_directory_payment_filter.sql`
- `20261127000001_afhomes_catalog_policy_management.sql`
- `20261131000001_afhomes_application_referral_chain.sql`
- `20261131000002_afhomes_application_referral_staff.sql`
- `20261131000003_afhomes_customer_lookup_module.sql`
- `20261204000001_afhomes_customer_ssot_alignment.sql`
- `20261205000001_afhomes_network_members.sql`
- `20261206000001_afhomes_role_department.sql`
- `20261206000002_afhomes_role_drop_description_admins.sql`

Existing history versions `20261012075439` (label `afhomes_catalog_policy_management`) and `20261203000002` (no label) have no matching versioned file in this checkout. Their history and live implementations were preserved. The live SSOT import bodies already matched the repository December 4 implementation despite that version being absent from history; absence of a version record alone must not trigger blind replay.

## 2026-10-17 — OST lifecycle reconciliation, migration 09 (develop integration)

- Target independently verified as AF Homes project `ikaevepedpqygdlipsei` (connection identity `postgres.<ref>`, session/transaction pooler); the runner additionally refuses any other target.
- The eight OST migrations `20261208000001`–`08` were applied live earlier on 2026-10-17 from the older checkout `AFhomes-claud-develop-vscode` (bodies frozen; corrections delivered forward). This session re-verified all eight present in live history, read-only.
- User explicitly approved (approval B, scoped) applying exactly the single remaining version from this checkout:
  - `20261208000009_afhomes_develop_transfer_integration.sql` — file SHA-256 `C867F8EC3E2DC477195BD1A3A04DEE9DA6FC7761CAA34DD7ED9461A8F3BD229B` (matches the approved and committed bytes at `15abff0`, working tree unmodified).
- Applied with the guarded repository runner: `npx pnpm db:migrate -- --approve-production --only=20261208000009`; runner exit 0; wall clock 2026-10-17T11:52:01.403Z → 11:52:13.717Z.
- Live history: **92 → 93** entries; the added version is exactly `20261208000009`; last version `20261208000009`. All pre-apply history rows (including both live-only versions) unchanged.
- Pre-apply recovery checkpoint: fresh encrypted logical backup + verified restore rehearsal (see the operator records under `C:\Users\SSD-CLAUD\afhomes-backups\2026-10-17\RESTORE.md`); transaction fault-injection proof for the runner sequence.

### Verification (read-only, post-apply)

- Pre/post state snapshots (SELECT-only): **28/28 checks passed**. Only expected deltas: history +1; functions 224 → 227 (added `private.ost_kind_transfer_authorized`, `private.sync_ost_renewal_accreditation`, 12-argument `public.transfer_sale_team_member`); 5 re-delivered bodies changed; constraint `mutation_requests_operation_check` = 14-operation union including `sale_team.transfer` (validated); `ost_members_origin_required` rewritten to `num_nonnulls(application_id, conversion_id) >= 1`; `private.ost_ist_conversions.from_upline_staff_id` now nullable; trigger `ost_renewal_accreditation_sync` added. All 76 tables compared before/after: no business-table row counts changed; the only difference is the history row itself.
- Live function bodies for all eight functions 09 owns (4 guards re-delivered, `install_direct_ost_accreditation`, both `transfer_sale_team_member` overloads, the sync function) are whitespace-normalized equal to the committed file.
- Both transfer overloads present: 11-argument transitional wrapper and 12-argument request-aware form; both `service_role`-only (`anon`/`authenticated` denied, and `has_function_privilege` false); owner `postgres`. `install_direct_ost_accreditation` `service_role`-only; the two new private helpers fully revoked.
- `supabase/security/rls_invariants.sql`: all six queries returned **zero rows**.
- Managed PostgREST (read-only metadata and non-mutating GET dispatch probes; no transfer issued): both RPC names resolve in the schema cache (anon receives `42501 permission denied for function`, not `PGRST202`), while an unknown function name and a wrong-argument call both return `PGRST202`. No request executed any transfer.
- Runner re-check after apply: `applied already : true`; zero SQL executed.
- No business-row test mutation of any kind was performed. No seed, bootstrap, invite, payment, membership, points or transfer action occurred.
- The deployed Members build (11-argument call shape, `develop` @ `b64c513`) remains compatible: the wrapper keeps that call working while the new 12-argument form requires this migration; code rollback stays available.

### Unchanged history differences

These repository migrations remain absent from live history and were **not applied or stamped** by this operation (11 files, unchanged by the apply):

- `20261030000001_afhomes_customer_directory_id_filter.sql`
- `20261031000001_afhomes_customer_directory_payment_filter.sql`
- `20261127000001_afhomes_catalog_policy_management.sql`
- `20261131000001_afhomes_application_referral_chain.sql`
- `20261131000002_afhomes_application_referral_staff.sql`
- `20261131000003_afhomes_customer_lookup_module.sql`
- `20261204000001_afhomes_customer_ssot_alignment.sql`
- `20261205000001_afhomes_network_members.sql`
- `20261206000001_afhomes_role_department.sql`
- `20261206000002_afhomes_role_drop_description_admins.sql`
- `20261206000006_afhomes_reconcile_workbook_network_version.sql`

The two live-only history versions `20261012075439` and `20261203000002` remain as recorded above.

Any further history reconciliation, live migration, or business-data test requires its own appropriate scope. No credentials, signed URLs or customer data belong in this log.


## 2026-10-17: direct OST password creation, migration 10

User approved migration 10 subject to safety and verification checks. Applied
only `20261208000010_afhomes_direct_ost_password.sql` to existing project
`ikaevepedpqygdlipsei` at 2026-10-17 20:49 SGT (12:49 UTC).
SHA-256: `5D60A0DA23BDFFFBC5983B41DD804507D52289571E12E684AF04A502222DED61`.
The file is now applied and immutable; its earlier draft comment is historical.

Preflight verified the target and TLS certificate, 93 history entries through
09, absence of migration 10 and the new RPC, and exact agreement of the live
legacy direct-install body with the repository's migration 09. The first
connection stopped on an untrusted certificate chain; the successful connection
used the existing Supabase root CA with rejectUnauthorized=true. No TLS trust
store or platform settings were changed.

Exact scoped helper: `node --use-system-ca .tmp-bin/release-review/apply-10.mjs --apply-approved`.
It pins the above hash and only this version. It executes the migration's
function/ACL statements and the history insert inside one enclosing transaction,
with 5-second lock timeout, preserving atomic DDL/history recording. No broad
migration runner or earlier missing migrations were executed.

Verified before commit: one new `install_direct_ost_password(uuid,uuid,uuid,date,date,text)`
SECURITY DEFINER RPC with `search_path=pg_catalog, pg_temp`; execution denied to
anon/authenticated and allowed to service_role. All existing public/private
functions and their ACLs, table catalogs, and public/private/Auth/Storage row
counts were unchanged in that transaction. RLS invariant queries returned zero
rows. Committed history was then re-read: 93 -> 94, old rows unchanged, only
20261208000010 added, new RPC visible. No business RPC was called, no account
created, and no business data changed by this apply.

Local proof: 135 targeted API tests and 155 disposable PostgreSQL checks passed
again during release review. Both application builds passed via direct pnpm
scripts; Turbo's launcher could not locate pnpm, so that wrapper did not pass.
Earlier form/contracts tests and workspace typechecks are recorded in the OST
password handoff. No managed Auth sign-in, authenticated browser UAT, staging,
commit, push or deployment was performed. Application changes remain local;
this entry confirms the database prerequisite, not live feature acceptance.

Ignored evidence: `.tmp-bin/release-review/migration-10-preflight.json` and
`migration-10-applied.json`. No credential values or customer records are in
this documentation. The helper loaded existing credentials only for the
approved migration operation; values were not printed.


## 2026-10-17: expired OST team transfer, migration 11

User explicitly approved only migration 11, followed by the scoped commit and
push to claud/develop. Applied only
`20261208000011_afhomes_ost_team_transfer.sql` to existing project
`ikaevepedpqygdlipsei` at 2026-10-17 21:47 SGT (13:47 UTC).
SHA-256: `22D873A390E25C483317F1358639AB5B2E71BFFB346FEDE00986567392792FDC`.
The applied file is immutable; its original LOCAL DRAFT header is historical.

Preflight verified TLS with the existing Supabase root CA, project and username,
94 history entries through migration 10, the exact migration-09 genealogy guard
body, and absence of 11 and all new objects. No mismatch was found.

Command: `node --use-system-ca .tmp-bin/release-review/apply-11.mjs --apply-approved`
from the integration checkout. The ignored helper pinned the hash, used a
5-second lock timeout and advisory migration lock, stripped only the outer file
BEGIN/COMMIT in memory, and committed DDL, verification and one history row in
one repeatable-read transaction. No other pending migration was run or stamped;
the previously documented unrelated history differences remain untouched.

Verified: one empty private RLS-enabled `ost_team_transfers` ledger; one
immutable UPDATE/DELETE trigger; two new functions (private immutable-history
helper and public `transfer_ost_team(uuid,uuid,uuid,uuid,text)`); only the
existing genealogy guard definition changed. Runtime roles have no ledger
privileges. New RPC execution is service_role-only; anon/authenticated are
denied. Private helper execution is denied to all three runtime roles.
Function search paths are restricted to pg_catalog, pg_temp. All existing
function/table ACLs, other function definitions, table catalogs and existing
triggers were preserved. Existing public/private/Auth/Storage row counts were
unchanged within the apply transaction; the new ledger had zero rows. RLS
invariant queries returned zero rows. Post-commit history, functions, table
catalogs and triggers were re-read successfully: history 94 -> 95, old history
unchanged, exactly version 20261208000011 added.

No business RPC was invoked, no account created, and no business-data action
performed. No Vercel change, deployment or production promotion was performed.
Local proof before release: 138 targeted API tests, 36 admin tests and 177 real
disposable PostgreSQL checks passed; workspace/API typechecks, scoped admin lint
and both application builds passed. Synthetic local Chrome checked the team
transfer dialog. Authenticated live workflow/persistence remains unverified.

Ignored sanitized evidence: `.tmp-bin/release-review/migration-11-applied.json`.
Existing gitignored credentials were loaded only by the approved helper;
no credentials or customer records are written here.

## Prepared locally only — 2026-10-18 — IST identity and member workbook jobs

**NOT APPLIED. PENDING AUTHORIZATION.** Initial implementation prohibited live
SQL. The owner subsequently approved read-only preflight only on 2026-10-18:
TLS-verified target `ikaevepedpqygdlipsei`, transaction read-only ON, 95 history
entries through migration 11, migrations 12/13 and new import tables absent.
The 12 inspected prerequisite function overloads match their repository baseline
bodies after whitespace/comment normalization. No live mutation was authorized.

- `20261208000012_afhomes_ist_employee_identity.sql`: date-free IST employee AAI
  issuance in the existing identifier registry; retain all legacy records and
  old dates; OST still requires term dates. Existing management and conversion
  signatures remain, with IST employment separated from annual accreditation.
- `20261208000013_afhomes_member_workbook_jobs.sql`: private durable provenance,
  identity matching, reserved account claims, transactional canonical persistence,
  safe job history/export, and sealed-import-only legacy OST identifier support.
- `CURRENT-SCHEMA.sql` regenerated: 108 migration files / 60 public tables.
  It remains context-only and must never be applied as SQL.
- Local disposable PostgreSQL: member workbook gate 78/78, including forward
  upgrade preservation, the OST profile persistence regression and six existing
  RLS invariant queries returning zero rows; existing OST lifecycle gate 177/177.
- Review packet, exact hashes, field mappings and remaining acceptance work:
  `docs/handoffs/2026-10-18-member-company-import.md`.

Real local GoTrue/PostgREST and Chrome acceptance subsequently exercised IST
hierarchy creation, OST registration/profile persistence, issued identifiers and
export/re-import matching. A local SMTP capture subsequently proved IST/OST
one-use recovery, password login and correct portal access with unchanged IDs.
External email delivery and hosted deployment remain unverified. Exact evidence and the updated
migration-13 checksum are in the review packet above.

No live apply, live Auth mutation, production import, deployment or remote Git write
occurred. A separately approved coordinated migration/application window must
prevent old clients from creating/reading new date-free IST records mid-release.
Do not replay unrelated older history-missing migrations.

### Local split preparation and OST password fix - 2026-10-18

The former combined draft migrations 12/13 were split locally into active schema
files 12/13 and function files 14/15; this does NOT record a live application.
The exact four checksums and local OST password-enforcement fix are recorded in
`docs/handoffs/2026-10-18-opencode-member-import-continuation-v2.md`.
Current local gate: 81/81, with schema-only legacy preservation/getter checks,
then function migrations and canonical import tests. No migration body changed
during the password fix. CURRENT-SCHEMA.sql remains the existing synchronized
110-file context index. The old two-migration live wrapper now refuses the
four-file plan; do not use it or infer authorization from its CLI flags.
Live pause, a fresh pre-change restore-verified backup, a rehearsed phase-aware
executor and explicit scoped approval remain required before any live apply.

### Release safeguard rehearsal - 2026-10-18 (NOT a migration application)

Fresh encrypted application/Auth backup was taken through a repeatable-read,
read-only snapshot of project `ikaevepedpqygdlipsei`. Disposable restore verified
104 table counts and data digests, all 95 history rows (through version 11),
and zero unvalidated constraints. The same restored snapshot then rehearsed
ONLY versions `20261208000012` through `20261208000015`: rollback then commit,
history 95 -> 99, existing table data preserved. This history delta is LOCAL.

The new four-file runner pins exact bytes and checks schema then function phases
inside one transaction. Local fault injection after each DDL body/history insert
passed 35 checks. The database maintenance model passed 132 local checks.

A newly executed privilege regression failed against draft migration 15's
seven-argument direct OST installer (public execution was allowed). The unapplied
draft now retains the existing six-argument signature and explicitly restricts
execution to `service_role`. PostgreSQL workbook gate: 86/86; restored-backup and
fault-injection rehearsals passed again. Migration 15's new SHA-256 is
`6d550f2540343b50d0a67254295bcb95dd9c6231a9611fe7c20b332643fe0e9c`.
`CURRENT-SCHEMA.sql` was regenerated. No applied migration was edited.

The owner authorized a temporary live pause test. The first test installed and
removed 15 deny triggers and project-level WAF rules, with no migration/history
change or business-row mutation. Database denial passed. HTTP coverage was NOT
accepted because Vercel Authentication intercepted most unauthenticated probes.
Both project firewall rule sets/enabled states and the database guard objects
were restored. Authenticated HTTP retest results are recorded separately in the
latest handoff; do not treat temporary-test evidence as an active release pause.

Authenticated follow-up PASS: all 231 deployment/alias URLs and the 88 affected
route/method combinations proved WAF denial, after explicitly retrying eight
transport failures. Unrelated route probes remained outside the deny rule.
Temporary WAF rules/enabled-state changes and database guards were removed;
the original AA-search rate limit remains intact. One intermediate cleanup
failure was recovered and verified separately. Final retry cleanup passed.
Live history remains 95 through `20261208000011`; versions 12-15 are still NOT
live-applied. See the latest v2 handoff for evidence files and approval boundary.

### APPROVED LIVE APPLY - 2026-10-18: IST/OST company workbook release

The owner explicitly approved only the four migrations below, the reviewed
46-file feature commit and a normal push to `origin/claud/develop`. Target:
the existing shared project `ikaevepedpqygdlipsei`. Feature commit: `b63e906`.
This entry supersedes the earlier unapplied status for these four versions.

| Version / file | SHA-256 |
| --- | --- |
| `20261208000012_afhomes_ist_employee_identity_schema.sql` | `873f01c332449de436a4c115bf735fe41bee9f7e7857255aa59d503fada4b9cf` |
| `20261208000013_afhomes_member_workbook_jobs_schema.sql` | `66bc08a751bb6ca7869457ef99802eb65538a49c533942ed05ae9a662a2eb04e` |
| `20261208000014_afhomes_ist_employee_identity_functions.sql` | `f35edee08583002832f7a8c0f2264ce08474e8886acc846f1aa1104dcc37d639` |
| `20261208000015_afhomes_member_workbook_jobs_functions.sql` | `6d550f2540343b50d0a67254295bcb95dd9c6231a9611fe7c20b332643fe0e9c` |

- Both project WAF pauses and 15 database deny guards were active before apply.
  Current project-wide rule equivalence, fresh authenticated per-project probes
  and the earlier identical-rule 231-host proof established HTTP coverage;
  direct database denial was reverified. No other active writers were reported.
- A new encrypted read-only snapshot was taken AFTER pausing writes:
  `C:\Users\SSD-CLAUD\afhomes-backups\2026-10-18T12-29-18-483Z-pre-member-import`.
  Disposable restore verified all 104 included table counts/data digests and
  migration history 95. Rehearsal on that restore rolled back, then committed
  ONLY these four migrations. Storage binaries/platform settings are excluded.
- Fresh live preflight: history 95 through version 11; all 12 prerequisite
  function bodies matched. The pinned phase-aware executor applied these four
  file bodies and version records in ONE transaction, checking schema then
  functions. No unrelated history-missing migration was replayed.
- Live COMMIT succeeded. Independent post-commit read-only verification:
  history 99, exact selected four-version delta, restricted private import
  tables, eight service-only RPCs and 17 active maintenance guards. Existing
  row counts in all 111 inspected public/private/Auth/Storage tables were
  unchanged; complete accreditation identity/history digests also matched.
- Evidence: local ignored `live-four-migrations-applied.json` and the cutover
  journal under `.tmp-bin/member-acceptance/`. They contain no credential values.
  The schema context index was regenerated from repository migrations.
- At this entry's time the new Preview is not yet verified and maintenance is
  still active. Resume only after the compatible Preview and older-host
  isolation are verified. No production `main` promotion is authorized.

### Post-apply release and resume verification - 2026-10-18

Feature `b63e906` and cutover evidence `35c49fc` were normally pushed only to
`origin/claud/develop`. The compatible Preview reached READY for `35c49fc`;
its branch alias is `afhomes-ecofarm-v2-git-claud-develop-afhomes.vercel.app`.
Older hosts on both projects retain affected-route isolation, preserving
unrelated firewall rules. Only the verified deployment and branch alias are
allowed through those rules.

At `2026-10-18T12:43:26.778Z`, the guarded resume removed exactly 17 temporary
triggers and their guard function. Independent read-only verification confirmed
history 99, all four version records, zero maintenance guards, eight restricted
service-only RPCs and empty import-job tables. Direct probes confirmed new-host
health 200, invalid application authentication 401 without WAF denial, and an
old-host member request 403 with WAF denial. Signed-in directory reload and
IST/OST import-dialog checks passed; no production import/account was created.
Hosted saved downloads/roster exports and native Excel/Sheets remain unverified.
Full details and local evidence locations are in the continuation handoff.

### APPROVED LIVE APPLY - 2026-10-19: Customer import continuation

The user separately approved ONLY `20261208000016_afhomes_customer_import_continuation.sql` after feature commit `8082c81` was pushed to `claud/develop`. Target: existing shared project `ikaevepedpqygdlipsei`. No production website promotion, data recovery, account import or payment mutation was included.

- SQL SHA-256: `33773120bceacfd747baac56d861cbbc0893195d592ba5ecc2b3ecffb5714758`.
- Fresh preflight: 109 history entries, maximum `20261208000015`; target tables and predecessor adapter absent; required functions present and pinned by definition hashes. No historical missing migration was replayed.
- The first attempt rolled back before commit because the temporary verifier incorrectly expected 15 public signatures instead of the 14 defined in the approved file. Read-only recheck confirmed unchanged history and absent new objects. Only that verifier count was corrected; migration SQL was unchanged.
- The exact approved SQL and its history row committed atomically at `2026-10-19T11:57:19.923Z`. History is now 110 entries with only version `20261208000016` added. PostgREST schema reload was requested.
- Before commit: all 113 existing public/private/Auth/Storage table counts were unchanged within the transaction; existing function definitions were unchanged except the intended public import dispatcher replacement. Its exact predecessor was preserved in the private adapter.
- Post-commit catalog checks: three private tables have RLS and no direct PUBLIC/anon/authenticated/service-role grants; 14 public RPC signatures are service-only; zero private helper execute leaks. An independent connection confirmed the history body matches the local file and successfully ran the read-only continuation list as an existing authorized actor. No business rows were created or repaired by these checks.
- Local ignored evidence: `.tmp-bin/customer-continuation-applied.json`; preflight and apply scripts are also ignored and contain no credential values.
- Preview deployment `dpl_54dZLxsqh4JUAP2wTec4CRMAW47B` for feature SHA `8082c819a697f1d5b3b7276db6c2dc21c4fb54e6` reached READY. Unauthenticated endpoint probes redirected to Vercel Authentication; no successful authenticated HTTP workflow is claimed. Native Excel Desktop/Online and signed-in private-receipt/reload acceptance remain unverified.

### APPROVED LIVE APPLY - 2026-10-19: Company Customer IDs and staff sales involvement

The user explicitly approved finishing the changes for commit/push with live migration. Scope: only versions 17 and 18 on the existing shared project `ikaevepedpqygdlipsei`, followed by `claud/develop` Preview. No production website promotion, seed, account import, historical repair or payment mutation was authorized or performed.

- `20261208000017_afhomes_import_company_customer_ids.sql`: SHA-256 `984458aa1c6ecdb2879500e1a505e674810ce87d7c7f39d0309c79720ec1154c`.
- `20261208000018_afhomes_staff_sales_involvement.sql`: SHA-256 `4bcf19e7478e61c4f2bdf5c9173f6062b3a323009d10efccc2ebe7b0dec27f1b`.
- Fresh preflight: 110 history entries ending at version 16; both candidates and their objects absent, zero normalized duplicate company IDs. Version 16's recorded body exactly matched its immutable repository file. The dynamic function patch prerequisites matched. Historical missing migrations were not replayed.
- Both exact files and history rows committed atomically at `2026-10-19T13:59:12.524Z`. History is now 112 entries ending at version 18. PostgREST schema reload was requested.
- All 116 preexisting public/private/Auth/Storage table counts were unchanged within the repeatable-read transaction. Customer, staff, genealogy, payment, membership and frozen sale hierarchy row digests were unchanged. Existing function definitions were preserved except the three intentionally changed by version 17.
- The annual counter has RLS and no direct PUBLIC/anon/authenticated/service-role access. All existing official IDs are covered by its high-water marks. The new general-summary RPC is service-only, checks staff/customer permissions, and exposes no private helper execute grants. An independent read-only connection confirmed both recorded file bodies, ACLs and the summary RPC using an existing authorized actor. No live test application or customer was created.
- Sanitized local evidence: `.tmp-bin/customer-release-applied.json`. The schema index was regenerated. Preview deployment verification is recorded separately in the release handoff.

### APPROVED LIVE APPLY - 2026-10-20: Externally verified customer history

The user authorized commit/push with the previously identified single live migration. Scope: only `20261208000019_afhomes_customer_external_verified_import.sql` on existing shared project `ikaevepedpqygdlipsei`, followed by `claud/develop` Preview. No production website promotion or automatic reconciliation of existing business rows was included.

- SQL SHA-256: `e64eee7c973bc506b12d7e24b5aaaf5fab6be2a2a978881b9512ef0c6d11f0d0`.
- Fresh preflight: 112 history entries through version 18; versions 16-18 matched immutable local file bodies; the new receipt table was absent and canonical finalizer patch prerequisites matched. Historical missing migrations were not replayed.
- The exact SQL and its history entry committed atomically at `2026-10-20T11:52:31.679Z`. History is now 113 entries, adding only version 19. PostgREST schema reload was requested.
- All 117 preexisting public/private/Auth/Storage table counts and all 12 protected business-table digests were unchanged within the transaction. No application, reservation, payment, customer, membership, commission or genealogy history was promoted or rewritten.
- Independent read-only postcheck confirmed the stored file body, RLS and restricted direct grants on the private receipt table, two service-only public entrypoints, no private helper execute leaks, and the exact preserved normal finalizer predecessor. The three intentionally changed existing functions are the finalizer dispatcher, import continuation projection and historical genealogy-capture guard; all other existing function definitions were unchanged.
- Sanitized ignored evidence: `.tmp-bin/external-import-preflight.json` and `.tmp-bin/external-import-applied.json`. Schema context regenerated. Local disposable PostgreSQL proved the routing, existing payment reuse, source-change rollback, idempotent reimports, subsequent balance collection, normal finalization and permission gates; new-mode Preview/browser acceptance is separate.

### APPROVED LIVE APPLY - 2026-10-20: Customer summaries and imported holder facts

The user approved only `20261208000020_afhomes_customer_purchase_summary.sql` and `20261210000006_afhomes_preserve_imported_holder_facts.sql` on shared project `ikaevepedpqygdlipsei`, with commit/push to `claud/develop` Preview. No production website promotion.

- SHA-256 respectively: `16c27ad352719bea627d4547dd80f82d85de2203f0c582fedc83952fad88dabe` and `f0d9b9c1821f711f7342a69aa218d463044eb18c4808bf2cbf8421e48c492cb6`.
- Guarded apply matched 113 history entries through version 19, both installed function hashes and both file hashes. No historical missing migrations were replayed.
- Both exact SQL files and history entries committed atomically at `2026-10-20T13:41:14.306Z`; history now contains 115 entries. PostgREST reload requested.
- Counts and complete row digests for all 83 public/private tables were unchanged in the transaction. Only the two intended function definitions/ACLs changed; ownership and all other public/private functions were preserved.
- Independent read-only postcheck verified stored SQL hashes, official Customer ID lookup, the existing Gold partial reservation totals, service-only directory access and restricted private mirror execution.
- Ignored evidence: `.tmp-bin/customer-summary-preflight.json` and `.tmp-bin/customer-summary-applied.json`. Canonical schema index regenerated. Browser acceptance is recorded separately.

### APPROVED LIVE APPLY - 2026-10-21: Public sale-team search repair and cleanup

The user approved only `20261212000002_afhomes_reconcile_public_sale_team_search.sql` on shared project `ikaevepedpqygdlipsei`, then separately approved enabling `pg_cron` and creating only the hourly `afhomes-sale-team-search-cleanup` job. No production website promotion was performed.

- SQL SHA-256: `48661964b40907fa686d4e012e738af7a72d428163548927c8c91997d501702b`.
- Preflight found version `20261212000001` recorded but its five search routines and three private search tables absent. The guarded runner applied only version `20261212000002`; 13 older pending versions were deliberately skipped. History increased from 116 to 117 entries.
- Independent postcheck confirmed only the approved version was added, eight protected business-table counts were unchanged, all five routines are service-role-only, the three private tables have RLS and restricted browser grants, and `supabase/security/rls_invariants.sql` returned no violations. Managed PostgREST exposes all five routines. The schema index was regenerated.
- Disposable PostgreSQL removed the missing search objects, applied the repair twice, and passed all 49 search/concurrency/privacy/ACL checks.
- The separately approved cleanup configuration installed `pg_cron` and scheduled `select public.cleanup_sale_team_search(30);` at `0 * * * *`. The script verified all unrelated jobs were unchanged; a subsequent read-only check matched the active job. The command also executed successfully against empty search tables. The first automatic execution was not yet observed at setup time.
- Retention is configurable through `AFHOMES_SEARCH_CONTACT_RETENTION_DAYS` (1-3650 whole days). After changing it, rerun `node scripts/configure-sale-team-search-cleanup.mjs --apply` with `AFHOMES_TARGET_PROJECT_REF=ikaevepedpqygdlipsei`, and update/redeploy the matching API environment. `--check` reads configuration without changing it. The public notice substitutes the same setting for `{{CONTACT_RETENTION_DAYS}}`.
- Sanitized preflight evidence is outside the repo under `C:/Users/SSD-CLAUD/afhomes-backups/search-repair-2026-10-21-preflight.json`; operator probes remain ignored. No credentials are recorded here. Public browser acceptance remains separate from database proof.

### APPROVED LIVE APPLY - 2026-10-22: Public verification settings

The user approved ONLY `20261212000003_afhomes_public_verification_settings.sql` on shared project `ikaevepedpqygdlipsei`, including updating only the existing hourly cleanup job, followed by commit/push to `claud/clean-develop`. No production website deployment was included.

- SQL SHA-256: `584ece6f2c39b0aae945af80c9a811422030961fab58e4a2334236a481442601`.
- Fresh preflight: 117 migration history entries, new table/version absent, required authorization and integer cleanup routines present. The guarded single-version runner applied only version `20261212000003`; 13 older missing versions were deliberately skipped. Independent verification found exactly this version added, for 118 total entries.
- The private singleton preserves the supplied enabled state, phone, approved notice and 30-day contact retention. Three new RPC signatures are service-role-only, security-definer and search-path pinned. Direct browser/service-role table access is revoked and RLS is enabled. Managed PostgREST successfully returned the saved configuration through the getter RPC.
- Eight protected business-table counts were unchanged. The existing integer cleanup function definition was unchanged. The existing active hourly `afhomes-sale-team-search-cleanup` job now runs `select public.cleanup_sale_team_search();`; other jobs were preserved. Saved retention changes therefore take effect on subsequent cleanup runs without rescheduling.
- The invariant audit has zero application findings; its broad policy query additionally reports the two platform cron policies `cron_job_policy` and `cron_job_run_details_policy`. Those policies were not changed. This is not an empty raw audit result.
- Local verification: 176 relevant API/route tests, 12 settings/navigation tests and 74 real PostgreSQL search/settings checks passed; typecheck, targeted lint, environment isolation, admin build and cleanup self-test passed. The full disposable DB suite retains four failures reproduced on the baseline without this migration; see the activation checklist. The schema index was regenerated from all 131 repository migrations.
- Sanitized ignored evidence: `.tmp-bin/public-settings-release-before.json` and `.tmp-bin/public-settings-release-applied.json` (managed API verification at `2026-10-22T02:26:37.041Z`). No production visitor contacts or accounts were created/changed. Administrator browser acceptance remains unverified because the current local session is an OST account.

### APPROVED LIVE APPLY - 2026-10-22: Daily public search-limit switch

The user approved ONLY `20261212000004_afhomes_public_search_daily_limit.sql` on shared project `ikaevepedpqygdlipsei`, followed by commit/push to `claud/clean-develop`. No production website deployment was included.

- SQL SHA-256: `a3eb8fc4600126f521ed63d918ab2331109ec091decbaf83b9a6389111114534`. A CLI-generated scaffold was ordered after existing future-dated dependencies; earlier applied files were not edited.
- Fresh preflight confirmed 118 history entries, prerequisite settings present and the new version/column absent. The guarded runner applied only version `20261212000004`, deliberately skipping the 13 earlier missing versions. Independent verification confirmed exactly this version added, for 119 total entries.
- The new private boolean defaults to true. The managed getter returns `dailyLimitEnabled: true`; prior settings are unchanged. Administrator saves reuse existing permission/role checks, optimistic revisions and audit events, and changes rotate the notice version. Disclosure enforcement consults the saved switch; requests never supply a quota bypass. Disabled mode still records disclosures and retains existing short-term attempt controls.
- Eight protected business-table counts, all scheduled jobs and all other public/private function definitions were unchanged. The three replaced functions remain service-role-only, security-definer and search-path pinned. Settings-table RLS and restricted direct grants remain intact. The invariant audit has zero application findings and the two unchanged platform cron policies described above.
- Local proof: 16 focused API tests, four admin UI tests, seven public search UI tests and 94 disposable PostgreSQL checks passed, as did full typecheck and targeted lint. Full DB suite and authenticated administrator browser acceptance were not rerun. The schema index was regenerated with 132 repository migrations.
- Sanitized ignored evidence: `.tmp-bin/daily-limit-release-before.json` and `.tmp-bin/daily-limit-release-applied.json`; managed API verification at `2026-10-22T02:51:04.878Z`. No live visitor contacts or accounts were created/changed, and the daily limit was not turned off by release verification.
