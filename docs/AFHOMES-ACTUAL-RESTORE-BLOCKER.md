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

## Owner decision and exact local-only handoff (2026-10-11)

Owner declined a temporary managed Supabase project. No cloud/paid resource is an approved next step. Preservation commit 02ff97d is local, directly above f8a1c61. All 15 indexed files passed path/content checks for secrets, backup files and debug probes. Stash OID and untracked debug-file SHA256 were identical before/after commit. No push.

### Environment requirements

An owner-controlled local Linux host or Windows Docker Desktop/WSL2 installation is required. Existing Windows plain PostgreSQL is NOT a restore target. Use a verified, digest-pinned Supabase PostgreSQL 17 image/package whose available supabase_vault version is 0.3.1; confirm registry/release metadata instead of deriving an image tag from managed build 17.6.1.166. PostgreSQL 18.6 pg_restore must be available to read the actual custom archive. PG18-written SQL compatibility with the PG17 target is tested by the real fail-on-error restore, not presumed.

The isolated stack must include:
- Vault, pgcrypto, uuid-ossp, pg_stat_statements and plpgsql at required versions.
- Supabase platform roles, schemas and compatible Auth/PostgREST services.
- A fresh UTF8 recovery database and owner-restricted persistent test volume.
- Loopback/private bindings only; production credentials absent; external SMTP, OAuth, webhooks, jobs and public network exposure disabled.
- Fresh local role passwords, JWT/signing/API credentials held in private environment files outside Git.
- Windows user's DPAPI profile for decryption. On a Linux restore host, decrypt on this Windows account and transfer only through approved encrypted transport into a restricted temporary directory.
- Sufficient disk for a database copy and a separate restoration/rollback copy. Storage receipt/photo file bytes are not included in this database archive.

### Ordered operator procedure — prepared, NOT executed

1. Record container/VM identity, image digest, host/port/database, server_version and available extension versions. Confirm the target is isolated and has no real pre-existing business data. Abort for source project ikaevepedpqygdlipsei, any other shared/remote target, mismatched extensions or accidental production credentials. Do not reuse a production port/connection variable.

2. Stop Auth/PostgREST workers and all jobs on this NEW test stack during import. Create a dedicated fresh database from template0, with UTF8 encoding, inside the isolated Supabase cluster. Keep initialized platform-role definitions at cluster level; point local Auth/PostgREST at the recovery database only after verification.

   CREATE DATABASE afh_recovery TEMPLATE template0 ENCODING 'UTF8';

   Record that this created database belongs to this isolated test environment before any restore command. The source database and existing local application database must not be changed.

3. Decrypt these files only inside the owner-only backup directory using Windows DPAPI CurrentUser:
   database.dump.dpapi
   roles-no-passwords.sql.dpapi
   authorization-schema.sql.dpapi

   Check each plaintext SHA256 against manifest.json / authorization-supplement-manifest.json before proceeding. Keep plaintext outside the worktree and never print SQL/record contents. The encrypted originals are immutable. Do not store passwords in procedure files.

4. Inspect archive listing with pg_restore 18.6 --list and verify the custom archive header and required table/data entries. This is inspection, not a restoration claim. Privately inspect the authorization supplements for custom roles, ownership, role memberships, grants/default grants and extension/platform statements.

5. Build a reviewed role script that creates only missing required roles and role memberships on this isolated cluster. Do not replay CREATE ROLE for existing reserved Supabase roles; reconcile expected attributes deliberately and document differences. Give login roles fresh local-only passwords through the private operator environment. Do not import production role passwords. Validate that all owner names referenced in schema SQL exist.

6. Render archive pre-data and post-data SQL using pg_restore 18.6 into protected temporary files, without customer data. Compare these to authorization-schema.sql. Prepare a separate explicit ownership/ACL supplement because the original archive omitted ACLs/ownership statements. Do not execute the complete schema supplement alongside archive schema creation, which would duplicate tables/functions. Do not broadly grant authenticated or anon writes as a workaround. This merge requires target inspection; it is not an automatic unreviewed text filter.

7. Set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD only in the private operator session for the VERIFIED isolated afh_recovery database. Do not pass a password-bearing URL in command arguments or echo it.

   Core archive restore:
   pg_restore --single-transaction --exit-on-error --dbname=afh_recovery database.dump

   Supplying connection settings through PG* variables prevents credential output in command arguments. Restore into the dedicated empty database, not the initialized shared/default application database. Do not use --clean against any existing business database. Do not silently omit Vault, Auth, Storage metadata or migration history entries to make errors disappear.

   For an all-or-nothing combined archive/authorization restore, instead render pg_restore --file archive.sql database.dump into protected local storage and invoke psql with ONE transaction containing the reviewed missing-role script, rendered archive SQL and ownership/ACL supplement:
   psql -X --dbname=afh_recovery --single-transaction --set=ON_ERROR_STOP=1 --file=reviewed-roles.sql --file=archive.sql --file=reviewed-ownership-acls.sql

   Choose this combined method only after private review of archive SQL, including any transaction-control statements. Do not execute both restore alternatives. Supabase's downloaded-platform-backup CLI start procedure is not assumed compatible with this custom archive.

   On any error, rollback/drop ONLY the proven-owned test database after checking identity; preserve encrypted originals and sanitized errors. A PG18-to-PG17 incompatibility requires a reviewed remedy or a separately approved PG17-format recapture, not silent schema editing or an upgrade of shared Supabase. No such recapture is presently authorized.

8. Before starting services or applying migrations, verify actual restored rows and authorization:
   10 points accounts, total 167000; all 11 original ledger entries and their canonical hash; 10 memberships with correct customer relationships; 23 customers, 18 card sales, 20 payments, 10 commissions, 308 audit events and 23 Auth users according to the recorded source snapshot.
   Restore all 39 migration records and compare full record fingerprints, not version count alone. Snapshot timestamp differences require review, not fabricated records. Compare schema, original policies, function ownership/EXECUTE/default privileges, column grants and role membership/attributes. Prove customer self-read and cross-customer denial and staff authorization. Inspect Vault/extension versions in the restored database.

9. Retain a verified local pre-migration snapshot of this restored copy. Run the exact 26-file selected batch in ONE transaction: hash preflight, locked legacy-points snapshot, original migrations with reviewed November 12 envelope handling, then explicit November 23 compensation. Keep the two excluded orphan migrations excluded. Do not run the ordinary per-file migration command. Check original payloads, authoritative totals 167000, five derived-cache repairs, ledger reconciliation, first-call RPC behavior, caps/debt, rollback and replay. Source/history mismatches abort. Nothing in this step targets shared Supabase.

10. Start compatible local Auth/PostgREST against the restored-and-migrated database using fresh local signing credentials and isolated role passwords. Configure a separate local API test process to these local endpoints; do not overwrite the existing confirmed-login configuration. Authenticate through this local Auth service; do not substitute test identity tokens for authenticated E2E. Verify Admin setup → GSD sale → Finance verification → customer personal claim → reservation/settlement/refund/history, plus restaurant denial without promotion. Keep service-role credentials server-side. Logs/screenshots must use nonsensitive output.

11. Record counts/fingerprints, transaction results and RLS denial outcomes. Delete only newly created plaintext working files after verification or abort; keep encrypted backups, original histories, the safety stash and debug file. Release remains blocked until this actual restored-copy chain passes.

### Cost and remaining blockers

No extra cloud/service expenditure has been authorized or incurred by this work. An existing owner-controlled compatible local host avoids cloud-resource charges; hardware/storage and any Docker licensing obligations depend on the owner's environment. No managed-project cost is quoted because the owner declined that option.

Current blockers: compatible local runtime not provisioned; actual full restore/PG18-to-PG17 compatibility and role/ACL restoration not yet demonstrated; 26 pending shared migrations intentionally unapplied; genuine isolated Auth/PostgREST points lifecycle and receipt/file recovery not yet verified.

This handoff is a prepared procedure, not evidence of successful execution.

Independent local checks: PointRedemptionApprovals.spec.tsx and CustomerRefundHistory.spec.tsx passed 7/7 tests (component tests using service mocks). Health, Admin points route and Customer points route returned HTTP 200; anonymous staff session and customer points APIs returned HTTP 401. Page reachability is not a logged-in browser E2E result. No new application defect was demonstrated, so no frontend/API implementation was rewritten.

## Recovery continuation — October 12, 2026

This entry supersedes earlier infrastructure-blocked statuses above; those entries remain historical evidence.

- Owner confirmed existing local Staff/Customer login works again after the original API (3000), Admin (5174), and Web (5173) servers were restarted. Orly changes remain merged at f8a1c61; HEAD remains 02ff97d. No authentication rewrite or configuration replacement was performed.
- Actual encrypted backup restoration passed in isolated Supabase PostgreSQL 17.6 with Vault 0.3.1. The original 26-migration preservation rehearsal and original ledger payload comparison passed, as recorded in the protected runtime verification report.
- Fresh isolated database inspection: 10 original points accounts retain 167,000 points; migration history contains 66 entries (39 original plus 27 selected forward migrations). All 27 repository allowlist hashes match. Historical migration files are unchanged.
- New 20261124000001_afhomes_points_position_service_acl.sql grants only service_role execution of private.release_point_reservations(uuid,uuid), required by customer_points_position. Fresh privileges: service_role=true, anon=false, authenticated=false. Real PostgreSQL pre-fix denial, post-fix access, replay and browser-role denial regression passed in the prior stabilization session.
- SALE_REFERENCE_CONFLICT now maps to controlled HTTP 409 instead of 500. Previous focused verification: 189 unit checks, 22 genuine GoTrue/PostgREST lifecycle checks, and 10 genuine HTTP duplicate/concurrency checks passed. Typecheck, lint and production build passed; existing warnings remained. These checks were not unnecessarily rerun in this continuation.
- Browser E2E remains UNVERIFIED: disposable browser identity setup did not complete. Working owner login on the original ports is a separate milestone, not proof of an isolated financial browser lifecycle. Private Storage uploads/downloads, device QR scanning and full desktop/mobile operational UAT remain unverified.
- Shared Supabase still lacks the selected new schema. No shared migration, points reset, Preview credential change, commit, push or deployment was performed in this continuation.

Next gates: complete disposable identity setup without storing passwords/tokens; verify the existing Admin/GSD/Finance/Customer browser workflow on isolated ports 15174/15173; verify private Storage separately; review precise staging inventory; obtain separate release authorization before any shared apply or deployment. The selected preservation runner, rather than a naive historical migration replay, is required to avoid the legacy cutover reset.