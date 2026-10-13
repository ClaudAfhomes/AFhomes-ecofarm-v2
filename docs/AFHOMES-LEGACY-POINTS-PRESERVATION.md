# AF Homes legacy points preservation rehearsal — 2026-10-11

## Completed checkpoint

Local merge commit **f8a1c61**, parents **0a2bd52 / c6c3576**. The 14 useful authentication recovery files and recovery report are included. The fifteenth saved file, packages/db-testing/scripts/probe-tmp.mjs, remains untracked and was never executed or staged. Safety stash pre-orly-merge-auth-recovery-preserved remains intact. Nothing pushed.

Owner-confirmed real local Staff and Customer login remains a completed milestone. This continuation did not restart authentication or merge work. Shared customer points position is still blocked by the missing RPC/schema.

## Read-only managed evidence and preservation policy

A fresh read-only check of ikaevepedpqygdlipsei confirmed **39 recorded migrations, 10 accounts, 167000 authoritative points and 11 ledger entries**. No shared DDL/DML was sent. supabase/recovery/managed-preflight-manifest.json records nonidentifying balance/cache/ledger totals and SHA-256 fingerprints of all 39 original migration records. Recheck these fingerprints immediately before any approved migration; stop if changed.

| Account sequence (descending balance, no customer identifiers) | Account / ledger before | Membership cache before | Rehearsed account / ledger after | Cache after |
|---|---:|---:|---:|---:|
| 1 | 52000 | 52000 | 52000 | 52000 |
| 2 | 25000 | 0 | 25000 | 25000 |
| 3 | 25000 | 0 | 25000 | 25000 |
| 4 | 20000 | 0 | 20000 | 20000 |
| 5 | 12500 | 12500 | 12500 | 12500 |
| 6 | 12500 | 12500 | 12500 | 12500 |
| 7 | 10000 | 0 | 10000 | 10000 |
| 8 | 10000 | 0 | 10000 | 10000 |
| 9 | 0 | 0 | 0 | 0 |
| 10 | 0 | 0 | 0 | 0 |
| Total | **167000** | **77000** | **167000** | **167000** |

After columns are disposable synthetic rehearsal results, **not a shared migration result**. Five stale derived caches are corrected from independently matching authoritative accounts and ledger totals. This correction is auditable; no historical points account balance or original ledger entry is rewritten.

The first synthetic account includes historical redemption, reversal and correction entries. All 11 original ledger payloads/IDs survive. Eight nonzero accounts receive the historical cutover's negative entry and a new explicit positive cutover_baseline compensation: **27 ledger entries, net 167000**. No new points are invented. Compensation is excluded from earning caps; no unknown historical opening period value is fabricated.

## Exact allowlist and transaction requirements

The source-controlled supabase/recovery/legacy-points-allowlist.json is the exact **26-file ordered allowlist with SHA-256 hashes**. It begins at November 2 and ends at the new November 23 preservation migration. Previously applied files are unchanged.

Keep these two orphan migrations excluded:
- 20261030000001_afhomes_customer_directory_id_filter.sql
- 20261031000001_afhomes_customer_directory_payment_filter.sql

Required atomic sequence:
1. Verify approved target, backup restore gate, all original migration-record hashes and exact allowlist file hashes. Stop for mismatch.
2. Stop application financial mutations for the maintenance window. Begin ONE transaction with bounded lock/statement timeouts.
3. Execute supabase/recovery/legacy-points-preflight.sql: lock memberships/accounts/ledger/audit, snapshot exact historical records, refuse ledger/account discrepancies or evidence of a prior cutover. Stale membership caches are captured for audited correction.
4. Execute all 26 allowlisted files and record original source bodies in migration history inside this same transaction.
5. November 12 has its own top-level BEGIN/COMMIT. The reviewed atomicMigrationSql strips only this historical transaction envelope at execution; the original file/hash remains unchanged. Unknown transaction envelopes fail closed. Without this handling, the snapshot is dropped by an early commit.
6. November 23 verifies original payload preservation, records compensating entries and cache corrections, and reconciles all account/ledger balances before commit.
7. Commit only after the complete batch succeeds. Any failure rolls back every schema change, cutover/restoration entry and new migration record. After commit, restoration requires the separately verified backup; do not delete compensating history as a “down”.

The ordinary per-file migration runner now refuses a pending November 4 reset **before its first DDL**. Its exact-version check sends SELECTs only; the pre-existing schema/table creation in that nominally read-only branch was removed. Do not run the ordinary apply command for this recovery.

The tested batch currently lives in the disposable rehearsal harness. A shared apply entrypoint remains gated on verified platform restoration, owner approval and revalidated hashes; this report is not permission to execute shared SQL.

## Local verification

Command: corepack pnpm --filter @afhomes/db-testing exec node --import tsx scripts/test-legacy-points-recovery.mjs

**50 real PostgreSQL/API checks PASS, exit 0**, plus disposable-cluster removal:
- Exact representative managed balance/cache distribution, 10 accounts/167000 points/11 historical entries.
- Original cutover genuinely executes, then explicit compensation preserves entitlements.
- Account/ledger discrepancy fails closed; injected batch failure rolls back schema, accounting and migration history.
- Synthetic custom-format backup restores into an independent local database with identical balances, ledger and 39 migration records.
- All historical ledger payloads and migration records remain unchanged; five cache repairs are auditable.
- Migration replay cannot duplicate compensation; standalone preservation without captured preflight refuses.
- First customer_points_position call preserves legacy balances and cap capacity. A fresh membership's first call creates its period and returns full capacity.
- Real router HTTP → simulated Auth/PostgREST transport → real PostgreSQL RPCs: Admin service/10% tier discount/earning rule, GSD exact-price sale, Finance verification, customer personal QR claim exactly once.
- Restaurant spending without promotion is denied.
- Staycation quote exposes quantity 2, gross 2000.00, no tier stacking, 1000 points at 0.5001, discount 500.10, cash 1499.90 and bounded expiration. Tampered approval payload is rejected without reservation.
- Staff cannot approve for the customer. Customer approval reserves without debit; full verified settlement debits exactly once.
- Partial/full points refunds, duplicate protection, separately recorded synthetic external cash repayment and earned-point reversal reconcile the test wallet from **52000 → 54000 → 53000 → 53500 → 54000 → 52000**. Other wallets remain unchanged. Customer history is returned through the API.

The HTTP transport uses test identities, not managed Supabase sessions. These results are real SQL/application integration, **not authenticated managed browser E2E**. Previously reported concurrency, promotion stacking, zero-cash, repayment, reversal-debt and refund tests were preserved; no unrelated full suite was repeated.

Focused CLI/write-boundary/atomic-envelope regression and typecheck results are recorded in the final delivery.

## Backup and restore gate

Read-only full custom pg_dump captured the shared database into a NEW owner-only directory:
C:\Users\SSD-CLAUD\Documents\AFHOMES-SECURE-BACKUPS\vip-preservation-20261011-204655

database.dump.dpapi is Windows DPAPI CurrentUser encrypted; plaintext was removed only after decrypt/checksum verification. Capture size: **985849 bytes**. Manifest records SHA-256 and capture time. No keys/passwords or customer records were added to this repository. Existing interrupted backups were untouched.

Attempted actual full restoration into a NEW owner-restricted disposable loopback PostgreSQL cluster failed:
**extension "supabase_vault" is not available**.

The isolated attempt and its plaintext working copy were removed; the encrypted backup remains. Synthetic application restoration passed. Full managed-backup restoration is **BLOCKED**, and pg_dump omits owner/ACL restoration and platform-global configuration. A Supabase-compatible local restore environment with required extensions/roles and owner/ACL recovery procedure is required before shared apply. DPAPI recovery also depends on this Windows user profile; off-machine disaster recovery has not been proven.

## Current gate

- Local merge checkpoint: PASS; no merge in progress.
- Preservation rehearsal and local application/SQL chain: PASS.
- New preservation changes: uncommitted for review.
- Shared migration: BLOCKED by actual backup restore compatibility and approval.
- Real authenticated full points browser E2E: BLOCKED by missing shared schema.
- Preview/push/deployment: not authorized; no secrets changed.

Next concrete action: establish a Supabase-compatible local backup restore target without creating another Supabase project, prove actual restore and revalidate the 39 migration hashes, then present the exact 26-file batch for owner approval. Do not reset 167000 points or suppress historical cutover accounting.

Final focused verification: 17/17 tests passed across apply-migrations.spec.ts, migration-write-boundary.spec.ts, migration-safety.spec.ts and atomic-migration.spec.ts. API typecheck and Supabase-script typecheck passed. git diff --check passed; no unmerged files, no staged follow-on changes, and no MERGE_HEAD. All 26 allowlist hashes matched. No Docker executable or local supabase_vault extension was available. Existing merged application build/tests remain the prior verified milestone; no SPA or deployed API behavior was changed by these migration-only repairs.

## Uncommitted source and evidence files

- supabase/apply-migrations.ts
- supabase/migration-safety.ts
- supabase/migrations/20261123000001_afhomes_preserve_legacy_points.sql
- supabase/recovery/atomic-migration.ts
- supabase/recovery/legacy-points-preflight.sql
- supabase/recovery/legacy-points-allowlist.json
- supabase/recovery/managed-preflight-manifest.json
- packages/db-testing/scripts/test-legacy-points-recovery.mjs
- api/_lib/atomic-migration.spec.ts
- api/_lib/migration-safety.spec.ts
- api/migration-write-boundary.spec.ts
- docs/AFHOMES-VIP-POINTS-LOCAL-QA.md
- docs/AFHOMES-LEGACY-POINTS-PRESERVATION.md

The existing untracked probe is excluded from this review/staging set. Backups, local PostgreSQL files and generated runtime artifacts are excluded.
