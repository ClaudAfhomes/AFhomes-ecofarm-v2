# AF Homes actual-backup restore gate — 2026-10-11

## Result

**BLOCKED: no compatible local Supabase runtime.** No new restore attempt was made in plain PostgreSQL. No actual-backup migration or authenticated isolated integration run was claimed.

Infrastructure inspection began 21:04 Philippine time and reached the specific blocker within ten minutes, inside the 60-minute limit. Checkpoint f8a1c61, authentication work, safety stash and existing preservation edits remain intact.

## Actual archive verified

- DPAPI CurrentUser encrypted database.dump.dpapi: 985849 plaintext bytes, checksum verified by decryption.
- Magic PGDMP; CUSTOM archive; gzip; archive version 1.16-0; 1173 TOC entries.
- Source PostgreSQL 17.6; writer pg_dump 18.6. The installed pg_restore 18.6 reads the archive.
- Restoring custom format requires pg_restore; it must not be passed directly to psql as a SQL file. Supabase's downloaded-platform-backup start procedure is not automatically interchangeable with this manual archive.
- PostgreSQL documents that output from a newer pg_dump is NOT guaranteed to restore into an older major server, even when originally dumped from that older server. Thus this PG18-written archive's SQL compatibility with PG17 remains an actual restore gate; archive readability alone does not prove it.
- Archive extension entries: pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp.
- Live read-only verification: PostgreSQL 17.6, Supabase build 17.6.1.166; vault 0.3.1 in vault, pg_stat_statements 1.11, pgcrypto 1.3, uuid-ossp 1.1, plpgsql 1.0. Vault secrets count is zero; no secrets were read.
- Original archive has zero ACL entries. It was captured with no-owner/no-acl and cannot alone prove equivalent privileges/function ownership. Database dumps also omit cluster role definitions.

Metadata is recorded in supabase/recovery/actual-backup-metadata.json. No backup data or decrypted SQL is in the repository.

## Authorization gap secured read-only

Additional encrypted, checksum-verified backup supplements were captured read-only in the same owner-only secure backup directory; original archive unchanged:
- roles-no-passwords.sql.dpapi: 6173 bytes; role passwords excluded.
- authorization-schema.sql.dpapi: 856439 bytes; schema, ownership, grants, RLS/functions/triggers for authorization restoration/review.
- authorization-supplement-manifest.json records hashes and explicitly says restored=false.

These are NOT staged. All plaintext inspection/capture files were removed; only encrypted backups/manifests remain. Existing interrupted backup materials were untouched. Supplements are not a substitute for applying and verifying correct role/ownership/ACL configuration on an isolated restore.

## Source baseline (read-only, not restored evidence)

- 10 points accounts; 167000 points; 11 original ledger records; 39 migration records.
- 23 customers; 10 memberships; 18 card sales; 20 payments; 10 commissions; 308 audit events; 23 Auth users.
- All six expected platform roles are present; 46 row policies; 68 application/private SECURITY DEFINER functions.
- SHA256 of concatenated canonical original ledger JSON, ordered by id:
  3fc3e01f8182dd1e35c90745ac846a7266e22553ca0a7e8f36b2ec55f9e12bc1
- The earlier 39 migration-record fingerprints and account/cache reconciliation are preserved in managed-preflight-manifest.json. Recheck before use; ongoing source activity can make snapshots stale.

The failed initial baseline query used a nonexistent card_payments name. Catalog inspection confirmed public.payments; the corrected read-only query above succeeded. No shared SQL writes occurred.

## Exact infrastructure blocker

- Docker command, Docker Desktop common installation paths, Docker services and Docker engine named pipes absent.
- Podman, Rancher Desktop and VirtualBox common installation paths absent.
- wsl.exe exists, but Windows reports the Windows Subsystem for Linux is NOT installed; no usable distro.
- Supabase CLI package is installed (package metadata 2.117.0), but executable discovery hit a sandbox telemetry-file EPERM. This is separate from the decisive missing container runtime.
- Supabase's native stack supports Linux amd64/arm64 and Apple-silicon macOS, **not Windows**.
- Only plain PostgreSQL 18 is installed; it cannot provide the required Supabase Vault extension. No further plain-PostgreSQL restore was attempted.
- No Docker image was pulled or tag invented. The live Supabase build is not an assertion that an identically named registry image exists.

## Fastest safe alternatives

1. An already available isolated Linux/Docker host with a verified Supabase PG17 image providing Vault 0.3.1, matching platform roles and the Auth/PostgREST services. This avoids another managed project and can prove real authenticated integration. Bind only locally/private, use fresh local JWT/service credentials, disable external email/webhooks/jobs, and restore customer/financial data only inside the restricted test environment. Do not use production write credentials for this stack.
2. If no such host is available, a separately approved disposable managed Supabase restore/test project is the practical alternative for this machine/deadline. It requires explicit target, project/data-copy authorization and confirmed cost. No project or branch was created, and the production restore_project tool was NOT invoked. Managed restoration of raw archives still needs schema/role handling; it is not guaranteed merely by creating a project.
3. Installing Docker/WSL here is possible in principle but is not a verified deadline-safe shortcut: Windows prerequisites/admin changes and possible restart are required. No OS installation/restart was initiated.

A paid managed project is not technically necessary if a compatible local/Linux host can be supplied. It is an approval-gated alternative when no such host exists.

## Restore acceptance gates still outstanding

Use the actual encrypted archive plus authorization supplements; choose the restore method only after inspecting the verified target and CLI help. Use a fresh isolated target and a bounded, fail-on-error transaction. Do not run --clean against a shared database. Preserve the archive; never silently skip Vault/platform objects and call it a full restore.

Required proof before migration:
- Actual account/ledger data, customer/membership relationships, sales/payments/commissions/audit history, Auth users and 39 immutable migration records match the source snapshot.
- Owner/ACL/RLS/default-grant/function-execute behavior and extension versions match the needed authorization model. Validate both customer ownership denial and staff permissions.
- No external mail, webhook, scheduled job or production financial write can escape the isolated test environment.
- Database backup covers Storage metadata, not stored receipt/image file bytes; those are separately required for real receipt-upload/download recovery.
- Restore differences caused by pg_dump18→PG17 must be documented/tested, never silently edited away.

Then rehearse the exact preservation-safe 26-file hashed allowlist in ONE transaction using the captured preflight and reviewed November 12 transaction-envelope handling. Prove account/ledger equality, original payload preservation, cache reconciliation, replay, annual caps/reversal debt, RLS and rollback. Finally run Admin/GSD/Finance/customer Auth/PostgREST integration against the isolated target using fresh local credentials. None of these actual-restored-copy gates has passed yet.

## Commit preparation

Preservation code remains the prior tested candidate: 50 disposable synthetic PostgreSQL/API checks, not actual-backup checks. Fresh focused verification this continuation: 17/17 migration safety/CLI/transaction-envelope tests passed.

Explicit staging includes only the preservation source/tests and nonsecret metadata/reports. Excludes all .env files, backups, local database data, generated artifacts and probe-tmp.mjs. Proposed local commit:
fix(db): preserve legacy points during atomic schema recovery

This would checkpoint tested preservation logic with an explicit BLOCKED real-restore status. It would not certify production readiness or authorize shared migration/push/deployment.

Final preparation: exactly 15 reviewed source/test/nonsecret-report files staged; debug probe remains untracked; no commit created. API and Supabase-script typechecks passed, 17 focused regressions passed, and staged diff --check passed. Two new SQL files had only trailing whitespace/BOM formatting normalized; the allowlist hashes were refreshed to match exact working-tree bytes. Hashes are byte-format-sensitive: any checkout line-ending conversion must fail the hash preflight and require a reviewed manifest refresh, not an automatic bypass.

Sources used for restore requirements:
- [Supabase runtime platform support](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes)
- [Supabase platform-to-self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [PostgreSQL pg_dump cross-version caveats](https://www.postgresql.org/docs/18/app-pgdump.html)
