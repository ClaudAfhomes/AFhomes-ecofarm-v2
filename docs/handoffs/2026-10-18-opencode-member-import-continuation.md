# OpenCode continuation: finish IST/OST import release

Checkpoint: 2026-10-18, Asia/Singapore. Repository evidence overrides this note.

## Task and limits

Finish ONLY the existing IST/OST bulk import/export, corrected template downloads,
preview, canonical persistence, hierarchy resolution and identity-preserving re-import.
The user wants this delivered on `origin/claud/develop` with only the necessary
live migrations. Do not restart implementation, widen the feature or repair history.

Latest explicit operating instruction: read-only remote checks and local testing
only. **Writes are NOT confirmed paused. Do not execute live migrations 12/13.**
No staging, commit, merge, push, deployment, live Auth mutation or real import is
currently approved. Request explicit approval of the concrete release scope.
No production/main release, force push, new Supabase project, paid service,
dependency installation or credentials in Markdown. Do not invent success/status.

## Start here

- Feature worktree: `C:\Users\SSD-CLAUD\Documents\AFhomes-member-company-import`.
- Feature branch: `feat/member-company-import-20261018`.
- HEAD: `9f44ecc50744a6501a4df0b966b4f7d525bf4530`.
- Last observed remote `claud/develop` equals that HEAD. Recheck before Git writes.
- Clean release checkout: `C:\Users\SSD-CLAUD\Documents\AFhomes-claud-develop-ost-release`,
  branch `claud/develop`, HEAD `f9d9cbe900146d4f81605e1a62b560cec55bc6a3`,
  a verified ancestor of the feature baseline. Neither index contains staged files.
- Original checkout `C:\Users\SSD-CLAUD\Documents\AFhomes-claud-develop-vscode`
  has 11 unrelated modified/deleted paths. Preserve it; do not copy/stage its work.
- Read the applicable AGENTS.md and the relevant sections of
  `docs/handoffs/2026-10-18-member-company-import.md`. Its older check counts are
  historical; the final corrected-template and readiness sections are newer.
- No optional agent delegation. No KOS/memory write-back.

## Implemented behavior: preserve it

- IST is an employee. AAI issuance uses the existing number registry; new ISTs
  have no accreditation start/expiry/renewal. Preserve every old AAI/date/history.
- OST retains approved accreditation dates/signatures and AAO. New manual OST
  creation/import requires an active SM with the complete active SSM/VD chain.
- First-time IST workbook hierarchy resolves VD -> SSM -> SM before confirmation.
- New names store UPPERCASE; mobiles store canonical +63 through shared contracts.
  Excel/preview show conservative Proper Case and 11-digit 09 text. Equivalent
  09/+63 phones match for duplicates. Do not rewrite historical canonical values.
- MATCH preserves accounts, IDs, profiles, genealogy, identifiers and history.
- New imported Auth identities use undisclosed random passwords, unconfirmed
  email and no invitation. Separate verified recovery controls access.
- Use the existing Members endpoints, shared parser/contracts and durable jobs.
  Do not add another importer. Export omits full TIN/ID numbers and secrets.
- Preserve corrected XLSX parts. Do NOT rerun the legacy sanitizer on these assets.

The two assets exactly match the final supplied uploads:

| Asset in packages/contracts/assets/ | SHA256 |
| --- | --- |
| member-ist-template-v2.xlsx | FA5C06BF0776CE72A724C4B64E9F7DAA326B7DFE05DC48AB716C5B2F452D0D2C |
| member-ost-template-v2.xlsx | D877139A24EB4FC31D8FE039A275961079EE26F0B103CCEF9546E3207A03F6BD |

Headers already match the shared mapping. Both have Date Helper; IST entry tabs
remain Identity/Team/Details; OST also has Accreditation. README, hidden helpers,
geography, validations, formatting and formulas are preserved. Actual authorized
template downloads changed only Teams and populated active registered heads.

## ONLY these two release migrations

| File in supabase/migrations/ | SHA256 |
| --- | --- |
| 20261208000012_afhomes_ist_employee_identity.sql | B081D4E71285D6B10A1F6B06E547C9FB7C0619C56C17FB80E76AB97B41CCD59A |
| 20261208000013_afhomes_member_workbook_jobs.sql | 1814E44F3B81F644E0FB5689877A23F6586F3BE9EC5CEA53A6D15B38E19F0F4B |

12 safely separates IST identity from OST accreditation. It is an import
prerequisite, not an unrelated feature: the old contract requires IST dates.
13 adds private durable import jobs and transactional canonical persistence.
Keep the existing accompanying UI/contract compatibility changes in this release.
CURRENT-SCHEMA.sql is already synchronized; it is context, never executable SQL.

Last enforced read-only live checks: single project `ikaevepedpqygdlipsei`,
PostgreSQL 17.6, 95 migration-history rows through `20261208000011`, migrations
12/13 and their two tables absent. Twelve prerequisite function overloads match
the source baseline. No live write occurred. Eleven other history-missing versions
are deliberately EXCLUDED: do not apply, stamp, repair or repeatedly audit them.
Refresh only the exact prerequisite/history checks needed for this release.

## Verification already completed

- Corrected assets: full API 2,471/2,471; contracts 313/313; import dialog 6/6.
- Disposable PostgreSQL import gate: 78/78, including forward preservation,
  duplicate/idempotency, manual sponsor, authorization and rollback checks.
- Real local GoTrue/PostgREST/API: three IST hierarchy accounts and one OST;
  export -> preview MATCH -> confirm preserved counts/identities for both kinds.
- Earlier local authenticated browser and recovery checks passed; do not present
  them as new hosted acceptance or external SMTP-provider delivery proof.
- Fresh Admin/web builds and typechecks; contracts/Supabase typechecks;
  environment-isolation scan, SEO prerender (12 routes), whitespace checks passed.
- Existing large-bundle warnings remain. Desktop Excel/Google Sheets UNVERIFIED.
  Owner chose a manual Excel checklist and explicitly left Sheets unverified.
- No need to repeat green suites unless code changes or a concrete concern emerges.

## Maintenance findings: stop before live changes

Inventory is finished for the visible `afhomes` Vercel team; do not start a broad
new deployment audit. Ignored evidence under `.tmp-bin/member-acceptance/`:

- `maintenance-deployments.csv`: all 233 visible deployment records, URLs,
  states, branch/commit API versions where available, and aliases.
- `maintenance-inventory.json`: full sanitized metadata, 230 V2 deployments
  (216 READY) and 3 READY deployments in `claud-af-home-branch`.
- `maintenance-alias-targets.json`: all 11 visible aliases resolved. V2 main
  alias targets an ERROR deployment; do not assume production is running this work.
- `public-url-targets.json`: V2's current public/server URL configuration points
  at the shared project. Other project's target is UNKNOWN. Historical runtime
  targets are not proven by current configuration. Keep uncertain consumers in scope.
- `api-version-fingerprints.json`: checked source-file hashes at recent branch
  heads. Current claud/develop and develop contracts require non-null dates.
  Seven READY V2 deployments have no Git commit; they remain unverified.
- Public deployment GETs redirected to protection. No protected runtime acceptance
  was completed. Supabase Edge Function inventory was denied. Other teams,
  external scripts, local workers and credential holders were not independently
  enumerated. The owner subsequently confirmed no writers outside these two
  inventoried projects are active; preserve that distinction from technical proof.
- `maintenance-db-inventory.json`: 15 relevant live tables, ZERO pause triggers,
  54 candidate RPC/helper overloads; none inspected is callable by anon or
  authenticated. No cron.job table was present. Session snapshot is not a pause.

Local pause prototype: `maintenance-guard.sql` and `test-maintenance.mjs`.
Latest `maintenance-proof.json`: **132 checks passed**. A broad HTTP barrier
blocked POST/PUT/PATCH/DELETE before upstream work, including direct router/query
and encoded-path attempts; GET/HEAD/OPTIONS passed. This is a local HTTP model,
NOT verification of an installed Vercel firewall rule.

Database statement triggers block INSERT/UPDATE/DELETE/TRUNCATE on 15 staff,
genealogy, OST and AA tables, with no owner/service-role/session/header bypass.
Real local legacy/new RPCs were blocked. An in-flight write lock refused guard
installation atomically. The two new job-table guards were added INSIDE the
12/13 transaction, so all 17 guards commit together with the schema/history.
Removing the guard locally restored date-free IST issuance.

Recommended maintenance plan, NOT approved or applied:

1. Have the owner resolve unknown consumers and freeze new deployments/automation.
2. Obtain explicit approval for temporary project-level HTTP deny rules covering
   unsafe methods across every relevant alias/immutable deployment. This pauses
   ALL Vercel API writes, including unrelated finance/customer changes; disclose
   this wider maintenance impact. Do not silently install it or charge for a tool.
3. Install the reviewed DB guards atomically, with a short lock timeout. Drain
   in-flight requests first; abort on contention, never kill sessions implicitly.
4. Verify actual HTTP denial on every inventoried host, including direct requests;
   a 401/redirect/disabled button is NOT pause proof. Use approved safe negative
   probes and rollback-only database probes; never submit a real import as a probe.
5. Take and restore-test a fresh encrypted backup while the guards hold. Existing
   2026-10-17 app/Auth ciphertext checksums match their manifest, but the backup
   stops at migration 8 (92 history rows). It is stale for this cutover. Do not
   decrypt/export production records or read key files without the required scope.
   Record consistent snapshot, checksums, Auth/app restore order, counts/history,
   constraints, and separate Storage/platform-config coverage. Never restore live
   or create another Supabase project automatically.
6. Integrate the reviewed feature into the clean claud/develop release checkout,
   commit and normal-push ONLY after approval. Verify the exact new Preview SHA.
7. Apply ONLY hash-pinned 12 then 13 in ONE verified transaction while guards
   remain active; verify old history/data, history delta +2, RLS and service ACLs.
8. Verify the compatible hosted release. Then separately approve removing DB
   guards and allowing writes ONLY through verified compatible hosts. Keep old
   incompatible APIs blocked; they may also fail reads of new date-free IST data.
   Other previews/main are not updated by a claud/develop push.

Recovery: before commit, roll back the whole batch and retain the pause. After
commit, retain the pause and repair forward; do not drop data, restore the stale
backup, delete identities, or roll back to an incompatible API automatically.
Resume only after actual hosted checks and owner confirmation of the write paths.

## Prepared helpers and next actions

The ordinary migration runner can commit a file's DDL before its history insert;
this was reproduced locally. Do NOT use unfiltered db:migrate/db push here.
`scoped-release-core.mjs` and `apply-scoped-release.mjs` pin the two hashes,
verify TLS/project/history, preserve data and history in one transaction, and
maintain 15 -> 17 pause guards. The wrapper now also requires fresh real pause,
backup and consumer-resolution evidence in `maintenance-live-verification.json`.
That file DOES NOT EXIST. The missing-evidence refusal was tested without a live
connection. Do not fabricate it, remove its gate, or treat flags as approval.
`scoped-release-proof.json` records 20 earlier explicit atomicity checks; the
newer 132-check proof exercises the extended maintenance path.

Use direct installed Node binaries; pnpm/corepack can auto-install in this linked
dependency worktree. Do not install anything. Working examples:

```powershell
Set-Location 'C:\Users\SSD-CLAUD\Documents\AFhomes-member-company-import'
git status --short
git diff --cached --name-only
git diff --check
node .tmp-bin/member-acceptance/release-scope.mjs
# If a new failure/change justifies rerunning the local maintenance proof:
$env:AFHOMES_TEST_PG_PORT='55434'
node .tmp-bin/member-acceptance/test-maintenance.mjs
```

The explicit release manifest was 34 feature paths. This continuation adds one
handoff, so the review scope is now **35 paths**, pending fresh human approval.
The ignored release-scope helper includes this handoff and regenerates hashes.
Do not stage `.tmp-bin/`, Excel owner locks, credentials or synthetic artifacts.
Proposed commit: `feat(network): add IST and OST company workbook imports`.

Next assistant: present this focused cutover plan and remaining unknowns, then
request scoped approval for the maintenance/backup/Git/live operations actually
needed. Keep progressing within local/read-only authorization; do not keep
rechecking unrelated migrations or claim that live implementation is complete.

Latest owner update: no other writers are active. The main handoff's
"Focused implementation window - owner update 2026-10-18" section now contains
the concrete two-stage approval plan. Stage 1 is maintenance plus a fresh verified
backup ONLY; stage 2 is the reviewed import commit/Preview push and ONLY migrations
12/13, with a separately verified resume. Neither stage is approved yet.
