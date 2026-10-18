# OpenCode Continuation: AF Homes IST/OST Bulk Import/Export Release — Stage 2 Blocked on OST Portal Enforcement

Checkpoint: 2026-10-18, Asia/Singapore. Repository evidence overrides this note.

## Task and Limits

Finish the existing IST/OST bulk import/export release with minimal-downtime deployment. The implementation is complete and locally verified. Stage 2 (live deployment) is **blocked on one safety issue**: OST portal lacks `must_change_password` enforcement.

Do not restart implementation or expand scope. Preserve all corrected templates, existing AAI/AAO numbers, IST employee identity without accreditation, OST annual accreditation, manual sponsor restrictions, VD→SSM→SM genealogy, UPPERCASE names, +63 mobile storage.

## Current State Summary

### What's Done (All Locally Verified)

| Layer | Status | Evidence |
|-------|--------|----------|
| **Migrations** | 4 split migrations ready (12a, 13a schema-first; 14, 15 function-second) | SHA-256 verified, runner-safe |
| **API/Contracts** | All changes merged, tests pass | 87/87 API, 313/313 contracts |
| **Admin UI** | Batch password field, shared temp password per batch | 6/6 dialog tests |
| **Import/Export** | Preview, durable jobs, MATCH/CREATE, export/re-import | 78/78 disposable PG gate |
| **Authentication** | `must_change_password` enforced at API gateway for admin | `authorizeAfHomes.ts:384-392` |
| **Build/Deploy** | Admin + Web builds pass, SEO 12 routes, env isolation | All green |
| **Git** | 40-file manifest, clean indexes, fast-forward ancestry | `release-scope.mjs` passes |

### The Blocker: OST Portal `must_change_password` Gap

**Location:** `api/_handlers/ost.ts` — `GET /ost/me` endpoint (lines 220-243)

**Problem:** The OST portal endpoint does NOT check `must_change_password`. An imported OST account with the shared temporary password can access `/ost/me` and potentially other OST endpoints without forced password change.

**Contrast:** Admin endpoints all route through `authorizeAfHomes` which enforces the flag at `afhomes-access.ts:384-392`. Customer portal uses a separate ownership-based system.

**Required Fix:** Add `must_change_password` check to OST portal, or route through `authorizeAfHomes`.

---

## Migration Plan (Zero-Downtime)

### Phase 1: Schema (Backward Compatible — Zero Downtime)
| Migration | SHA-256 | Purpose |
|-----------|---------|---------|
| `20261208000012_afhomes_ist_employee_identity_schema.sql` | `873F01C332449DE436A4C115BF735FE41BEE9F7E7857255AA59D503FADA4B9CF` | Nullable `starts_on`/`expires_on`, CHECK constraints |
| `20261208000013_afhomes_member_workbook_jobs_schema.sql` | `66BC08A751BB6CA7869457EF99802EB65538A49C533942ED05AE9A662A2EB04E` | New tables `member_workbook_jobs`, `member_workbook_rows` |

### Phase 2: Functions (Requires Coordinated Deploy + Targeted Pause)
| Migration | SHA-256 | Purpose |
|-----------|---------|---------|
| `20261208000014_afhomes_ist_employee_identity_functions.sql` | `F35EDEE08583002832F7A8C0F2264CE08474E8886ACC846F1AA1104DCC37D639` | Replaces `issue_ist_employee_identity`, `get_sale_team_accreditation`, `manage_sale_team_accreditation`, `transfer_sale_team_member` |
| `20261208000015_afhomes_member_workbook_jobs_functions.sql` | `6B870BE699B1BB196978D4340A7F74ED5411396CDD48D200AE82BBB0C47AF8C7` | New public RPCs, replaces `install_direct_ost_password` |

**Original migrations 12/13 archived in `supabase/migrations/archive/`** — ignored by runner.

---

## Deployment Sequence (Stage 2)

```
1. Deploy feature branch → origin/claud/develop Preview (build passes)
2. Apply Phase 1 schema migrations (12a + 13a) — zero downtime
3. Deploy Vercel project-level WAF blocking POST/PUT/PATCH/DELETE on:
   /api/v1/members*, /api/v1/ost*, /api/v1/members/:id/transfer, /api/v1/members/:id/accreditation
   (Covers both afhomes-ecofarm-v2 and claud-af-home-branch projects)
4. Apply Phase 2 function migrations (12b + 13b) in SINGLE TRANSACTION
5. CREATE FRESH ENCRYPTED BACKUP + RESTORE-TEST → record evidence
6. Verify Preview: health, templates, import preview, auth recovery, export/re-import
7. Remove WAF → resume writes on compatible Preview ONLY
8. Other deployments (main, old Previews) REMAIN BLOCKED on IST/OST writes until upgraded
```

---

## Write-Pause Coverage (Verified)

| Mechanism | Coverage | Unaffected |
|-----------|----------|------------|
| Vercel Project-Level WAF (both projects) | 216 V2 READY + 3 claud-af-home-branch READY deployments | All GET/HEAD/OPTIONS; Customer, Finance, Sales, Memberships, Points, Commissions, Documents, CMS |

**Direct Supabase writers outside WAF:** Auth Admin API, Storage, Edge Functions — no active IST/OST writers confirmed (owner statement).

---

## Compatibility Matrix (Tested)

| State | Old API | New API | Evidence |
|-------|---------|---------|----------|
| Before any migration | Works | N/A | Baseline |
| After Phase 1 (schema) | Works | Works | 78/78 import gate |
| After Phase 2 (functions) | **Breaks** (IST null dates, OST legacy AA- rejected) | Works | Function behavior verified |

---

## Remaining Risks

| Risk | Status | Mitigation |
|------|--------|------------|
| OST portal lacks `must_change_password` | **BLOCKER** | Fix before Stage 2 approval |
| Old deployments issue incompatible writes | Accepted | WAF blocks until upgraded |
| Supabase Auth/Storage/Edge Functions outside WAF | Accepted | No active writers confirmed |

---

## Files Changed (40 Manifest Files)

```
.gitignore
api/_handlers/members.spec.ts
api/_handlers/members.ts
api/_lib/customer-xlsx.ts
api/_lib/member-company-workbook.spec.ts
api/_lib/member-company-workbook.ts
api/_lib/member-workbook-export.ts
api/_lib/member-workbook-handler.ts
api/_lib/member-workbook-jobs.spec.ts
api/_lib/member-workbook-jobs.ts
api/_lib/member-workbook-layout.ts
api/_lib/member-workbook-preview.ts
api/_lib/member-workbook.ts
api/_lib/ost-direct-create.ts
apps/admin/src/features/afhomes/SaleTeamAccreditationCard.spec.tsx
apps/admin/src/features/afhomes/SaleTeamAccreditationCard.tsx
apps/admin/src/features/network-members/MemberDetailDialog.tsx
apps/admin/src/features/network-members/MemberWorkbookDialog.spec.tsx
apps/admin/src/features/network-members/MemberWorkbookDialog.tsx
apps/admin/src/features/network-members/TransferMemberDialog.tsx
apps/admin/src/features/network-members/TransferToIstDialog.tsx
apps/admin/src/features/network-members/services.ts
apps/web/src/marketing/pages/SaleTeamSearch.tsx
docs/AFHOMES-BUSINESS-RULES.md
docs/handoffs/2026-10-18-member-company-import.md
docs/handoffs/2026-10-18-opencode-member-import-continuation.md
docs/supabase/CURRENT-SCHEMA.sql
docs/supabase/MIGRATION-APPLICATIONS.md
packages/contracts/assets/member-ist-template-v2.xlsx
packages/contracts/assets/member-ost-template-v2.xlsx
packages/contracts/src/schemas/member-workbook.ts
packages/contracts/src/schemas/sale-team.spec.ts
packages/contracts/src/schemas/sale-team.ts
packages/db-testing/scripts/test-member-workbooks.mjs
packages/ui/src/components/TextField.tsx
scripts/sanitize-member-template.ts
supabase/migrations/20261208000012_afhomes_ist_employee_identity_schema.sql
supabase/migrations/20261208000014_afhomes_ist_employee_identity_functions.sql
supabase/migrations/20261208000013_afhomes_member_workbook_jobs_schema.sql
supabase/migrations/20261208000015_afhomes_member_workbook_jobs_functions.sql
```

---

## Next Agent Instructions

### Immediate Action Required

1. **Fix OST Portal Enforcement** — Edit `api/_handlers/ost.ts` to check `must_change_password` on `/ost/me` (and potentially other OST endpoints). Options:
   - Route OST portal through `authorizeAfHomes` with appropriate module key
   - Add explicit `must_change_password` check in `ost.ts` before returning data

2. **Verify Fix Locally** — Run `api` tests, `admin` tests, `contracts` tests, disposable PG gate.

3. **Stage 2 Approval** — Once fix verified, present corrected packet for explicit approval.

### Do Not

- Restart implementation or change scope
- Modify corrected Excel templates
- Run live migrations, Git push, or deployment without explicit approval
- Claim Supabase Auth enforces `must_change_password` natively (it's app-level)

### Reference Files

| Purpose | File |
|---------|------|
| Migration hashes | `.tmp-bin/member-acceptance/scoped-release-core.mjs` |
| Release manifest | `.tmp-bin/member-acceptance/release-scope.mjs` |
| Maintenance test | `.tmp-bin/member-acceptance/test-maintenance.mjs` |
| Schemas updated | `docs/supabase/CURRENT-SCHEMA.sql` |
| Business rules | `docs/AFHOMES-BUSINESS-RULES.md` |

---

**Authorization:** Local fixes, tests, and read-only production verification only. No live changes without explicit approval.

**Goal:** Fast, minimal-downtime IST/OST release without interrupting unrelated Customer, Finance, Sales, Membership, Points, or Commission operations.

## Verified correction - 2026-10-18: OST password enforcement fixed locally

This update supersedes the earlier "one blocker" and "write-pause coverage
verified" claims. No live action is authorized or has been performed.

- `api/_handlers/ost.ts`: `/ost/me` now reads its own canonical staff password
  flag before returning member data. Required change -> 403; unreadable security
  state -> 503; missing staff identity -> 404. OST member-list/detail reads also
  enforce the principal's password/MFA setup, matching accreditation routes.
- `apps/web/src/app/OstGuard.tsx` and `OstLoginPage.tsx`: the server-reported
  password flag takes precedence over active OST membership. Both direct entry
  and login route to the existing `/admin/profile` password-change flow.
  No new password system, permission model or migration was introduced.
- API and portal regressions failed before the fix, then passed. The workbook
  validation matrix's timeout is now 30 seconds because it repeatedly parses
  complete geographic workbooks under full-suite load; assertions are unchanged.
- Real disposable GoTrue/PostgREST/API verified an imported OST's flag blocks
  `/ost/me`, `/ost/members`, its member detail and accreditation records. Existing
  `session/password` clears the flag, the old password fails, and the same OST
  identity then enters its portal. Member creation remains denied. Email ownership
  was synthetically confirmed only in disposable Auth; email delivery was NOT
  tested. Existing read permissions were preserved, not assumed to be absent.
- Full API: 2,475/2,475 across 126 files. Full Admin: 892/892 across 92 files.
  Contracts: 313/313. OST portal: 11/11. Disposable PostgreSQL: 81/81 after
  extending the gate to the proposed schema-first order. API/web typechecks and
  the web production build pass. Existing jsdom navigation/scroll notices and
  large-bundle warnings remain. Actual local export/re-import MATCH confirmation
  also passed for both IST and OST without changing canonical table counts.
- The four migration hashes above and corrected template assets are unchanged.
  The explicit review manifest now contains 47 files: the previous 40 paths,
  this v2 handoff previously missing from the manifest, and six OST fix/test paths.
  Both indexes remain empty. No stage/commit/push/deployment/live SQL occurred.

### Remaining release corrections - do not infer Stage 2 readiness

1. Take and restore-verify a fresh pre-change backup BEFORE the first schema
   migration. The earlier sequence placing backup after function changes is
   unsuitable as the sole recovery checkpoint. Preserve any post-change backup
   as additional evidence only. Old history-92 backup is stale for history 95.
2. The gate now applies 12 -> 13, checks unchanged legacy identities/history,
   verifies the old getter still returns the original expiry and confirms the
   new IST issuance RPC is absent, then applies 14 -> 15 and runs the full import
   checks (81/81). This proves the measured local phase boundaries, not a hosted
   zero-downtime release or full old-API traffic compatibility. The new importer
   needs function migrations 14/15; do not enable it after schema-only 12/13.
3. The old ignored live wrapper still describes a two-migration authorization,
   expects history 97 and uses the old maintenance model. It now explicitly
   refuses a four-migration plan BEFORE reading credentials or connecting.
   Prepare/rehearse the phase-aware replacement before requesting live apply.
   Expected history for all four is 95 -> 99, subject to fresh target checks.
4. Targeted WAF coverage is PROPOSED, NOT live-verified. Include all affected
   mutation paths: members/imports, OST/accreditation/renewal, sale-team issuance,
   staff/role mutation aliases, bare API paths and direct router/query paths.
   Test safe denial and unrelated-route availability locally, then verify actual
   Vercel behavior only under explicit approval. The older 132-check broad HTTP
   model does not prove a narrower rule. Do not silently impose the old broad
   customer/finance write pause under the new minimal-downtime request.
5. Keep incompatible older deployments blocked after cutover; affected reads
   also need consideration when old contracts reject date-free IST identities.
   Scope service-key/direct database and in-flight writers separately from WAF.

Next work is ONLY the import release's phase-aware execution/pause proof, then
presentation of the corrected approval packet. Do not audit or apply unrelated
history-missing migrations. Local fixes/read-only checks remain the authorization
ceiling. Hosted acceptance, native Excel and Google Sheets remain unverified.

## Commit-scope review - 2026-10-18

- Fixed a form/API mismatch: durable import confirmation now reuses
  `createMemberSchema.shape.temporaryPassword` (8-128 characters), matching
  existing staff creation and the form. Boundary regressions cover 7, 8, 16
  and 129 characters. No password policy or Auth mechanism was invented.
- Removed the unused plaintext password argument from direct OST SQL calls.
  Password provisioning remains exclusively in the Auth call. The SQL's
  optional unused parameter is unchanged; no migration or migration hash changed.
  A regression asserts that the SQL payload contains no password parameter.
- Both regressions failed before the fixes; focused API checks passed 77/77.
  API typecheck and Admin production build passed; existing bundle warnings remain.
  The subsequent full API rerun passed 2,479/2,479 across 126 files.
- The explicit manifest now contains **46 files**, superseding the earlier 47:
  removing the password argument restored `ost-direct-create.ts` exactly to HEAD,
  so that path has no remaining change and is excluded. Ignored runtime files,
  credentials and the original checkout's 11 unrelated dirty paths are excluded.
- The clean `claud/develop` release checkout has fast-forward ancestry to the
  feature baseline. Remote `origin/claud/develop` still resolves to `9f44ecc`.
  Both indexes are empty. No staging, commit, push or live operation occurred.
- Git integration and live enablement are separate approvals. A push can create
  a Preview against the shared database; it does not apply the four migrations.
  Do not enable this release against that database until the scoped maintenance,
  backup and compatible migration/release sequence above is approved and verified.

## Shared batch-password login correction - 2026-10-18

The owner clarified that every newly imported IST/OST must be able to sign in
with their own email and one operator-chosen temporary password for the batch.
This supersedes prior claims that imported accounts require a separate reset or
email-confirmation workflow before first login.

- Durable import now uses `email_confirm: true`, matching existing authorized
  manual IST/OST creation. This is administrator provisioning, not proof of email
  ownership or email delivery. Public signup and global Auth settings are unchanged.
- Both workbook layouts require the chosen 8-128 character batch password and
  use it for every CREATE row. Removed the older layout's per-row random fallback.
  UI instructions explain immediate login, mandatory password change, unchanged
  MATCH passwords and resuming with the same batch password. No invitation is sent.
- Existing canonical `must_change_password` gates remain enforced. The password
  is sent only to Auth, not SQL/job records, exports, audit payloads or Markdown.
  Distribute it privately; shared temporary passwords expose every unchanged
  account in that batch if disclosed. They are not a permanent common password.
- Focused API: 77/77. Import-dialog tests: 7/7, including the same password on
  every IST/OST company row and the older layout. The Auth regression failed with
  pending email confirmation before the fix, then passed.
- Real disposable GoTrue/PostgREST/API: imported three IST hierarchy levels and
  one OST; all four signed in immediately with the same password, without any
  post-import Auth password/confirmation adjustment. All changed passwords using
  the existing endpoint; the old shared password failed and identities persisted.
  Protected OST routes refused access before password change and allowed the
  expected own-portal access afterward. Existing role/MFA rules remain unchanged.
- Both real export/re-import MATCH confirmations passed. Canonical table counts,
  Auth password hashes and email-confirmation values were unchanged. Finance,
  customer and points tables remained empty. No migration file changed.
- API/Admin typechecks passed. These are local results only. No staging, commit,
  push, deployment, live SQL or production Auth operation was performed.

## Release safeguards in progress - 2026-10-18

The owner approved the backup, pause verification and runner rehearsal. This
does not record approval to apply the migrations, stage, commit, push or deploy.
The following supersedes the earlier two-migration instructions and hashes.

- Fresh encrypted backup: `C:\Users\SSD-CLAUD\afhomes-backups\2026-10-18T11-50-20-678Z-pre-member-import`.
  One consistent read-only snapshot contains `auth`, `public`, `private` and
  `supabase_migrations`. The key is stored separately, outside this repository.
  AES-256-GCM decryption and disposable PostgreSQL restore both passed: all
  104 table counts/data digests and the 95 migration-history rows match;
  zero unvalidated constraints. Storage binaries/schema, platform/Auth/SMTP
  configuration, Edge Functions and cluster role secrets are excluded. Local
  role stubs and `--no-owner` restore do not prove full managed-platform recovery.
- The fresh backup was restored again and ONLY migrations 12-15 were rehearsed:
  rollback first, then commit; history 95 -> 99; existing table data preserved.
  No unrelated migration was replayed against that restored live snapshot.
- `.tmp-bin/member-acceptance/apply-four-migrations.mjs` is the replacement
  operator entry point. It refuses before credentials without explicit
  `--approve-live-12-13-14-15 --affected-writes-confirmed-paused` flags; flags are
  not human approval. It requires fresh verified maintenance/preflight/backup
  evidence, pinned migration bytes, matching prerequisite bodies and history,
  and 15 active database guards. One outer transaction applies stripped/pinned
  file bodies and version records, verifies the 12/13 schema phase, then 14/15
  functions, and extends guards to 17 tables before commit. Post-commit checks
  require history 99, private-table restrictions and eight service-only RPCs.
  It never resumes writes automatically. The retired two-migration wrapper
  remains disabled. Missing or stale evidence must stop execution.
- Local runner proof: 35 checks; failures injected after each of four file
  bodies and each history insert all rolled back schema and history. Local
  database maintenance proof: 132 checks, including in-flight lock refusal,
  owner/service-role denial, guard survival and safe local resume. Targeted HTTP
  rule model: 147 checks; unrelated customer/finance routes remain outside it.
- A new regression caught draft migration 15 recreating the direct OST installer
  with an unused seventh password argument and public EXECUTE privileges. It
  has NOT been applied live. Restored the existing six-argument signature and
  explicit service-role-only grants. Workbook database gate: 86/86, including
  anonymous/authenticated denial. `CURRENT-SCHEMA.sql` was regenerated.
  Migration 15 SHA-256 is now
  `6d550f2540343b50d0a67254295bcb95dd9c6231a9611fe7c20b332643fe0e9c`.
  The other three pinned hashes are unchanged. Runner and restored-backup
  rehearsals were rerun successfully with these corrected bytes.
- First live pause test installed and removed targeted project WAF rules and
  15 database guards. Database denial passed, but 218 HTTP results were Vercel
  Authentication 401, two timed out and only 11 proved WAF denial. This was NOT
  accepted as HTTP coverage. Both project rule sets/firewall-enabled states and
  the database pause objects were restored; history stayed 95. The existing
  AA-search rate-limit rule was preserved. No business data was changed.
- The authenticated HTTP retest is separate evidence; do not infer its outcome
  from this section. The installed `vercel curl` uses existing Vercel login to
  pass Deployment Protection; application requests still use an invalid token
  and empty payload so a missed WAF match cannot authorize a business write.

### Cutover and recovery boundary

Before the actual release, refresh the read-only preflight and backup after
writers are paused, then restore-verify it. The tested backup is a checkpoint,
not a promise that later writes were captured. Verify the current inventory,
HTTP rule and direct database guards again; temporary-test evidence is stale
once the pause is removed and is not accepted by the live apply entry point.

Use only the four named files in one guarded transaction. If anything fails
before commit, rollback and compare history/objects to the baseline; never
replay unrelated files or blindly retry an uncertain commit. If commit outcome
is uncertain, keep affected operations blocked and inspect history and RPCs
read-only. Do not run down migrations or restore over the shared database.
Backup restoration is a separately approved recovery operation with data-loss
and platform-recovery consequences, not an automatic rollback command.

The compatible application is the reviewed feature snapshot, not an older
deployment: older contracts can reject date-free IST identities. The subsequent
approved Git integration target is only `origin/claud/develop`, with explicit
file staging and remote-ancestry verification. A Preview must be verified against
the migrated database before its host/alias is allowed affected writes. Keep
older incompatible deployments blocked on affected routes until upgraded;
do not lift a project-wide rule for every historical URL. Database guards may
be removed only after that host restriction and compatible release are verified.
Do not deploy or promote `main` implicitly. Hosted business acceptance, desktop
Excel and Google Sheets are still separate, unverified checks.

## Safeguards result - 2026-10-18

- Authenticated Vercel WAF rehearsal PASS: 231/231 unique inventoried deployment
  and alias URLs returned `403` with `x-vercel-mitigated: deny`. Both projects'
  affected route/method matrices passed (88 combinations). The 10 unrelated
  health/customer/finance route checks were not denied by the maintenance rule.
  This verifies the temporary targeted rule, not hosted import functionality.
- The initial authenticated bulk run had three URL transport failures and five
  route/method transport failures. Those eight probes were retried sequentially
  under the identical rule and all returned confirmed denials. Evidence spans
  the original test and retry windows; timeouts were never counted as passes.
  An intermediate retry-helper CLI argument error was corrected before the
  successful retry. The original failed reports remain distinguishable from
  `.tmp-bin/member-acceptance/live-pause-consolidated-proof.json` (PASS).
- One intermediate second-project cleanup command failed. Manual recovery
  restored its original rule set/enabled state; independent read-only checks
  confirmed both projects had no drafts, no temporary database guard/function
  remained, and history was still 95 through version 11. The final retry also
  verified successful cleanup for both projects. No maintenance pause is active.
- Fresh encrypted backup/restore PASS; exact restored-live-snapshot migration
  rehearsal PASS (95 -> 99 locally); eight fault injections/35 checks PASS;
  database maintenance model 132 checks PASS; corrected workbook database gate
  86/86 PASS. Migration 15's corrected hash above supersedes all earlier hashes.
- A compatible-host isolation template passed 45 local checks covering affected
  reads/writes and direct query routing while leaving unrelated payments outside
  the rule. This is an unpublished template with an intentionally invalid host.
  Never publish that placeholder or describe future compatible-host acceptance
  as already verified. Substitute only the actual reviewed deployment host.
- The apply entry point additionally refuses a temporary-test proof: it requires
  `activePause: true`, a fresh verification time and a backup captured after the
  active pause starts. The completed test does not authorize or satisfy live apply.
- Scope remains 46 explicit files for the eventual commit. No staging, commit,
  push, application deployment, live migration or production Auth-user change
  occurred. Only the specifically approved backup/read-only inspection and
  temporary pause DDL/WAF test were performed live; temporary changes were removed.

The requested release safeguards are now rehearsed. Actual cutover remains a
separately scoped approval for only migrations 12-15, the reviewed 46-file commit
and normal push to `origin/claud/develop`. Reverify pause/backup/preflight during
that window, retain older incompatible deployments' affected-route isolation,
verify the new Preview, then resume only its approved compatible hosts. No
production `main` deployment or automatic business import is implied.
