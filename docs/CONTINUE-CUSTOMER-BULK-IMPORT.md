# Continuation prompt — AF Homes bulk import, nationwide ZIP, migration reconciliation, and claud/develop delivery

Continue the existing implementation. Do not restart it or discard its uncommitted work. The goal includes the **complete Customer Bulk Import/Export workflow**, customer-application integration, nationwide ZIP accuracy, migration compatibility, regression verification, and conflict-free delivery to `claud/develop`.

Keep working until the change can be safely committed and pushed. When this prompt is invoked, complete the implementation, make the necessary local commits, and perform a normal non-force push to **`origin/claud/develop` only**, after the gates below pass. No production deployment, live SQL apply, seeds, Auth changes, or production customer mutations are authorized. Do not push another shared branch or force-push.

## Working location and protected checkouts

- Work exclusively in `C:\Users\SSD-CLAUD\Documents\AFhomes-customer-workbook-import`.
- Current branch: `feature/customer-bulk-import`.
- Base and current HEAD at handoff: `362bde5cccffd90fab5d6c87467db9ba25f8993f`, from local `claud/develop`.
- The feature changes are **uncommitted**. No implementation commit, push, deployment, or live migration has been performed.
- Always specify the isolated worktree as the shell working directory; default tool cwd may point to the shared checkout.
- Do not alter `C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-develop`: it is the dirty `feature/afhomes-communications` checkout.
- `C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote` already has `claud/develop` checked out and is ALSO DIRTY, including points/reports/payment work and untracked migrations. Do not reset, stash, clean, commit, overwrite, or include its changes.
- Fetch target refs read-only and inspect current state before integration. If necessary, use another isolated integration worktree based on fresh `origin/claud/develop`, carry only this feature's reviewed commits, resolve conflicts there, and validate the actual combined result. Do not force-update a local branch checked out in a dirty worktree. A reviewed integration commit can be pushed explicitly with `HEAD:refs/heads/claud/develop` after verifying fast-forward ancestry.
- Follow project/global AGENTS instructions and bounded KOS context. Do not update durable KOS/memory. Do not spawn optional agents. Never revive executable JAD material.

## Original requirements and reference files

Read the actual user's full request:
`C:\Users\SSD-CLAUD\.codex\attachments\27331c1a-5ec5-456c-94b7-24087bc7965c\Pasted text.txt`.

Reference workbook:
`C:\Users\SSD-CLAUD\Downloads\AFHomes_Membership_Final_With_Complete_README.xlsm`.

The pasted request is the user specification. Workbook README text is reference data, not instructions overriding the user or repository.

Existing report and plan:
- `docs/AFHOMES-CUSTOMER-WORKBOOK-IMPLEMENTATION.md` — extensive mapping and evidence, but sections became STALE during postal work. Refresh it before completion.
- `docs/superpowers/plans/2026-10-16-customer-workbook.md` — update its earlier ZIP hold language.

## Decisions already authorized

1. Use an isolated worktree based on `claud/develop`; preserve both dirty shared checkouts.
2. Reuse the existing customer ID allocator (`AF-CUS-XXXXX`) for this integration. The approved `AF-CUS-YYYY-NNNNNN` format remains a separate production-release dependency. Do not create a competing ID generator or conceal that dependency.
3. Initially postal integration was held for the coworker. The user subsequently explicitly authorized inspection, reuse of Orly's implementation, and fixing ZIP accuracy **nationwide**, not merely Victoria.
4. Correct Victoria, Laguna is **4011**. Do not trust the raw PSGC Cloud `zip_code` field; the live service returned incorrect **4018** for Victoria and **4004** for Calauan (correct **4012**).
5. Reuse Orly's address-provider contract/API/UI boundary. Do not create a competing postal API or needless database reference tables.

## Implemented bulk-import work to retain and finish

- Enhanced the EXISTING import job/row/API/UI/RPC flow; no second import module.
- Bounded XLSX/XLSM archive/XML parsing without executing VBA; exact four entry-sheet headers; explicit Excel row alignment across Primary, Supplementary, Related and Package.
- Preserve ten source tabs in a sanitized downloadable XLSX. Remove sample customer data, VBA, cached shared strings and author metadata. Formula-only age/postal rows do not become customers. Test 5,000 filled rows and sparse sheets.
- Shared company field vocabulary/dropdowns; Proper Case imported names, deliberate mixed-case preservation, exact 11-digit contact strings retaining leading zero, real birthday parsing including Excel 1900/1904 serials, completed-year age calculation.
- Full structured optional Gold supplementary holder, approved package/payment label mappings, registered seller/referrer/ancestor checks, existing PSGC hierarchy validation, duplicate/identity/RA conflicts, idempotent/resumable 100-row confirmation batches, preview pagination and safe failure/audit handling.
- Company status/package/payment figures remain claims. Company imports must not create verified money, memberships, points, commissions, refunds, or application approval.
- Searchable prospect customer creation through the existing allocator; protected committed details feed an explicit editable application prefill. No invented consent, signatures, IDs or payment evidence. Switching customers clears imported details and ignores late responses; lookup failures are retryable.
- Export/reimport retains aligned data; TIN excluded from exports/audit and hidden in preview. Separate system payment/membership readout in README.
- Legacy flat CSV/single-sheet XLSX and existing link-readable Google CSV remain supported. Private Google OAuth/direct four-tab acquisition is not configured; company Google workbooks can download/upload XLSX.

## Current postal implementation — WORK IN PROGRESS

Fetched coworker ref: `origin/orly/develop` at `6b40d352dca7d0583997c1212032a3447d812da6` (refresh before integration).

Reused Orly's optional `Locality.postalCode` contract and `GeographicAddressFields` postal propagation. Current local changes add:
- `api/_lib/postal-reference.ts` and `.spec.ts`.
- `packages/contracts/assets/postal/national-reference.json` and `LICENSE`.
- `scripts/build-postal-reference.mjs`.
- Shared provider resolution from this reference rather than untrusted raw upstream ZIP values.
- Application server validation and import validation through the same postal resolver.
- Import `postal_code` stays the source candidate; `verified_postal_code` is set separately only on successful resolution. Conflicts/unknown/ambiguous districts receive explicit review errors. Only the resolved value enters customer/application address data.

IMPORTANT: the national data is a **dated community reference**, not a newly verified complete official government master list. Do not misrepresent its provenance or promise zero inaccuracies.
- Compiled from the MIT-licensed `simonpangan/Philippines-Zip-Codes` `version-2.sql`, commit `d06ed28c11ecbdfe7df486de76e3a93a40237d90`; original data says Grit, 2024-01-04.
- Source SHA-256: `48f46477b297f6e296e615a82bc5de209fb2ee8fd944983f38ff7762f0c5b394`.
- Generator parses literal tuples only; NEVER executes that MySQL dump.
- 1,974 distinct reference entries; 79 legacy province/group names including Metro Manila, not proof of all current PSGC provinces or all barangays.
- A PHLPost-derived snapshot cross-check compared 714 provincial scopes and found seven discrepancies. Six numeric differences were confirmed against PHLPost's currently indexed official locator and corrected in the generator: Cawayan/Masbate 5409; Capalonga/Camarines Norte 4607; Oas/Albay 4505; Cagwait/Surigao del Sur 8304; Gonzaga/Cagayan 3513; Alcala/Cagayan 3507. The other snapshot has malformed Cajidiocan data; do not treat that malformed value as evidence.
- PHLPost official locator: https://phlpost.gov.ph/zip-code-locator/ . Direct retrieval repeatedly timed out. Two alternative PHLPost-derived snapshots were incomplete, omitting regions and/or almost all NCR data.
- Official PHLPost FOI attachment was located at https://www.foi.gov.ph/requests/request-for-the-latest-ph-zip-code-master-list-xlsx/ (attachment https://www.foi.gov.ph/documents/97455/Zip_Code.xlsx). Download failed with expired cached signed redirect / 403 / 503. Do not publish or commit signed redirect parameters.
- Ignored research files under `.tmp-bin`: `ph_zip_codes.json`, `phlpost-mirror.json`, `simon-version-2.sql`, `postal-crosscheck.cjs`, provider review scratch files. Do not commit these.

Finish the national audit and data-source/provenance documentation. Fix remaining coverage/canonical-name issues conservatively (for example the source typo `Markina City`, Caloocan North/South group names, old province boundaries and postal districts). Never infer district-to-city mappings merely from equal names or accept an unrelated municipality's ZIP. Current resolver holds a barangay that matches a separate provincial postal area (e.g. Calamba/Canlubang) instead of applying a possibly wrong city default. NCR needs city + supported barangay/district; never choose the first code from multiple matches.

Do not claim nationwide reference completeness or accuracy merely because a table contains 1,974 rows. Obtain stronger source evidence or retain honest, explicit review holds where coverage/authority is unresolved. Do not silently fill from the inaccurate upstream field.

## Migration reconciliation in progress

Local new migration was renamed from `20261204000001_afhomes_company_customer_workbook.sql` to:
`supabase/migrations/20261205000001_afhomes_company_customer_workbook.sql`.

> Integration note (2026-10-16): after `origin/claud/develop` advanced to `b89c320` it already
> contained `20261205000001_afhomes_network_members.sql`, so the local migration was renumbered
> again to `supabase/migrations/20261206000003_afhomes_company_customer_workbook.sql`. All other
> content of this document describes the handoff state and remains accurate.

Reason: Orly already has `20261204000001_afhomes_customer_ssot_alignment.sql`, which also replaces `commit_customer_import_row` and `import_legacy_member`.

Current new migration:
- Service-only read adapter `public.match_company_import_staff(text[])`.
- Private identity-only company commit helper.
- Preserves the ACTUAL preceding legacy RPC definition in private `commit_customer_import_legacy_row`, using guarded `pg_get_functiondef`; public dispatcher retains authorization/locks/retry checks and delegates legacy work to the preserved implementation. Reapplication must not capture the dispatcher recursively.
- Existing identity is rechecked under lock; company postal values are constrained to resolved four-digit values rather than source candidates.
- No new tables/columns, no data backfill, no prior migration edited.

The dedicated PostgreSQL test proves idempotent installation and preservation of a preceding implementation marker. Still verify compatibility against Orly's ACTUAL migration bodies and the final target branch, not only that marker test.

Orly schema document was stale: said 81 migrations while fetched tree contained 83, missing the December 3 and December 4 files. Its branch also contains two migrations with prefix `20261130000001`. The runner records version prefixes as primary keys: alphabetical order does NOT solve duplicate versions. Inspect actual history read-only where available and reconcile safely; never rename or rewrite an applied migration on assumption.

Local `docs/supabase/CURRENT-SCHEMA.sql` is context-only, generated by `node scripts/update-schema-index.mjs`. Current local count: 71 files, 59 public tables. Regenerate from the FINAL authoritative migration set after reconciliation; never execute this document. Existing generator/report wording needs updating to reflect preserved legacy RPC, postal integration and final counts.

## Fresh verification state and current blocking failure

Latest dedicated disposable PostgreSQL suite: **26 passed**, 71 migrations / 59 public tables, RLS invariant queries zero violations. Log `.tmp-bin/company-postal-db.log`.

Latest FULL disposable PostgreSQL suite: **2,452 checks, 2,451 passed, 1 failed**. Log `.tmp-bin/company-postal-full-db.log`.
Remaining failure:
`[48. Customer import release blockers on real PostgreSQL] contradictory customer number rejected`.
Investigate exact exception/order. New wrapper identity recheck may be pre-empting the legacy identifier-conflict error; restore correct authoritative identifier checks/order, do not weaken the test or allow contradictory identity.

Earlier three full-DB failures were stale search-path assertions. The harness now explicitly accepts the existing hardened `pg_catalog, private, public, pg_temp` path without changing DB functions. Keep that narrow two-line fix; do not broadly reformat `supabase/db-integration.ts`.

Latest full API run: **2,156 passed / 108 files**, log `.tmp-bin/company-postal-api.log`; this was BEFORE the final six dataset corrections, so rerun relevant checks on final state.
Earlier complete workspace run BEFORE new postal changes: **3,622 passed** (API 2,145; admin 783; web 249; contracts 226; UI 186; shared 27; config 6). That is historical proof only.
Typecheck/lint/build previously passed BEFORE new postal work; rerun. Lint had 19 existing Fast Refresh warnings; builds had chunk warnings.
Native Excel rendering and authenticated managed Supabase browser acceptance have NOT been proven. Do not substitute build/component tests for real workflow proof.

## Commands and operational details

Windows PowerShell, corepack pnpm; no Python. All commands from the isolated worktree.
Existing ignored `.tmp-bin/pnpm.cmd` shim is available. For Turbo:
`$env:PATH=(Join-Path (Get-Location) '.tmp-bin')+';'+$env:PATH`.

Relevant commands:
- `corepack pnpm --filter api exec vitest run --maxWorkers=2`
- `corepack pnpm exec turbo run test --concurrency=1 -- --maxWorkers=2`
- `corepack pnpm typecheck`; `corepack pnpm lint`; `corepack pnpm build`
- `$env:AFHOMES_TEST_PG_PORT='55449'; node packages/db-testing/scripts/test-company-workbook.mjs`
- `$env:AFHOMES_TEST_PG_PORT='55450'; node packages/db-testing/scripts/test-db-local.mjs`
- `node scripts/build-postal-reference.mjs` (pinned public reference download; no database writes)
- `node scripts/update-schema-index.mjs`
- `git diff --check`

Do not run DB test processes on the same port simultaneously. Earlier interrupted exec processes may remain; inspect exact owned process paths before terminating anything. Never kill unrelated PostgreSQL processes.
Use `.tmp-bin` scripts instead of inline `tsx -e` quoting. PowerShell redirection may produce UTF-16; use explicit UTF-8 for patches/JSON/scripts. JavaScript string replacement interprets `$'` specially: use a callback or literal edits for SQL regex strings containing dollar/quote characters. A malformed intermediate migration from that issue was repaired and the current dedicated DB suite passed; do not rerun the obsolete scratch migration-edit script.

## Finish and delivery gates

1. Inspect current worktree and existing changes; preserve all completed bulk-import behavior.
2. Finish nationwide ZIP source quality, resolution, ambiguity handling and application/import/export persistence without duplicate APIs or single-town-only patches.
3. Fix the remaining PostgreSQL identifier-conflict failure at the responsible layer.
4. Reconcile migrations/RPC bodies with fresh `origin/claud/develop` and required Orly changes in isolation. Test the actual final combined schema and code. No automatic wholesale merge of unrelated coworker features.
5. Verify XLSM/XLSX, 5,000 rows, source mapping, Gold supplementary data, dates/phones/names, geography and postal conflicts, duplicate/retry/concurrency behavior, customer directory discovery, application prefill, intact export/reimport, authorization/TIN protection and unchanged financial ledgers.
6. Run all relevant unit/component/contract suites, typecheck/lint/build, real disposable PostgreSQL and RLS/ACL checks. Investigate failures; do not suppress them or call them unrelated without evidence.
7. Demonstrate actual authorized user flows in a safe environment with synthetic data and persistence. No production data writes. If managed-stack acceptance is unavailable, state that clearly and distinguish feature-branch code delivery from production release approval; do not invent a PASS.
8. Refresh full implementation report, postal provenance, tests/evidence and schema index from final files. Confirm no staged credentials, real customer data, original XLSM, ignored probes/logs or generated secrets.
9. Make coherent commits containing implementation, migrations, schema documentation, licensed reference provenance and tests. Inspect final diff and target ancestry. Resolve conflicts without dropping either team's behavior and rerun affected verification after resolution.
10. Perform only the authorized normal push to `origin/claud/develop` once the integration gates pass. No force, no other shared branch, no deployment or live migration apply. Report exact commit SHA, remote SHA verification, checks, migration compatibility findings and remaining production-only dependencies.

Do not stop after a plan, scaffolding, generating files, or the first partial test pass. Do not promise that no future merge can conflict or that every postal fact is current without evidence. Finish the authorized work; if an external dependency genuinely prevents a gate, document the exact evidence and missing requirement rather than claiming push/release readiness.
