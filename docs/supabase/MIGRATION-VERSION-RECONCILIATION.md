# Historical migration-version reconciliation

The current `develop` and `claud/develop` histories both contain these immutable files:

- `20261130000001_afhomes_membership_company_fields.sql`
- `20261130000001_afhomes_sale_team_accreditation.sql`

`supabase/apply-migrations.ts` records the 14-digit version as its primary key. Once one file records `20261130000001`, the runner skips the other. The ordinary disposable harness previously executed both filenames, so its passing result alone did not prove this history case.

New migration `20261130000003_afhomes_reconcile_membership_sale_team.sql` has a distinct version and sorts after both original files and before later dependent migrations. The earlier position is deliberate: a late repair would not help a partially initialized database reach a dependent migration that had already failed.

The repair restores the nullable company columns using idempotent DDL. It installs accreditation objects only when that historical feature is wholly absent. A complete installation keeps its existing functions, overloads, ACLs and trigger unchanged, including the newer seven-argument accreditation RPC. A partial installation stops for review. It does not replay the historical `import_legacy_member` implementation, update customer values, renumber existing AA identifiers, reapprove staff, backfill accreditation, or rewrite applied migration history. Both original duplicate-version files remain immutable.

`scripts/update-schema-index.mjs` regenerates the context-only `CURRENT-SCHEMA.sql` index. After this addition it contains **88 migration files and 60 public tables** (previously 87 / 60). The repair introduces no new logical tables or columns beyond the two historical migrations' intended objects.

## Local verification

Run from the repository root, sequentially because the disposable harness shares its data directory:

```powershell
$env:AFHOMES_TEST_PG_PORT='55451'
node packages/db-testing/scripts/test-migration-version-reconciliation.mjs
$env:AFHOMES_TEST_PG_PORT='55450'
node packages/db-testing/scripts/test-db-local.mjs
node scripts/update-schema-index.mjs
git diff --check
```

The focused suite excludes either historical file, proves the expected missing prerequisite, installs the repair, tests existing customer/AA preservation, reapplication, accreditation lookup, browser ACLs, all later migrations and zero RLS invariant violations. It also models the newer seven-argument RPC and numbering overload, verifies unchanged bodies/signatures/ACLs, confirms six supplied arguments still resolve without ambiguity, and proves partial schemas fail closed. Result: **30 checks passed across both skipped-history cases**.

The full disposable PostgreSQL suite passed **2,542 / 2,542 checks**, including customer import, SSOT alignment, referral-chain linkage and cleanup. Script syntax checks and `git diff --check` passed. No application/API/UI implementation changed in this maintenance commit.

## Live application boundary

Read-only preflight on 2026-10-16 used the existing project database configuration because the connector could not access AF Homes. The connection was independently checked against project `ikaevepedpqygdlipsei`; no credentials were copied or logged. Both approved versions (`20261130000003`, `20261206000003`) were confirmed pending. The pending repair was revised only after that confirmation, to preserve the newer live seven-argument RPC instead of introducing an older ambiguous overload. No applied migration was edited.

Preflight found 10 other repository migrations absent from live history and two live history versions absent from this checkout. Existing SSOT import function bodies already match the December 4 source despite that version not being recorded. Those history differences must not be "fixed" by stamping, replaying or applying unrelated migrations. Only the two approved versions were subsequently applied and verified; see [MIGRATION-APPLICATIONS.md](MIGRATION-APPLICATIONS.md). The 10 other pending migrations and both pre-existing history versions were left unchanged.

Before any separately authorized live apply, verify the exact project and recorded versions read-only, inspect which original objects actually exist, check the new version is pending, and obtain authorization for the exact migration. Do not rename an already applied file, delete a version record, infer that one recorded version proves both original bodies ran, or automatically apply other pending migrations. This index and runbook are never executable migration SQL.

## PR 11: workbook/network version collision

The current `develop` tip `7627f50` introduces `20261206000003_afhomes_network_members_link_reconcile.sql`, sharing the version of the already-applied `20261206000003_afhomes_company_customer_workbook.sql`. Both original files are preserved unchanged. New forward migration `20261206000006_afhomes_reconcile_workbook_network_version.sql` restores missing network links and installs the workbook functions only when that feature is wholly absent. Complete workbook functions, including newer implementations and ACLs, are preserved; partial installations fail closed for review. No migration history is rewritten.

The focused disposable test `test-workbook-network-reconciliation.mjs` models either original version having executed alone. It checks legacy import preservation, both staff foreign keys, service/private execution boundaries, repeat application, partial-state refusal and RLS invariants. Run this and the older reconciliation, company-workbook and full database suites sequentially: the disposable harness shares its data directory even when ports differ.

`CURRENT-SCHEMA.sql` is regenerated from the combined 92 files and 60 public tables. This merge does not apply any SQL live. The three incoming migrations and the new reconciliation require target-specific history and catalog inspection before any separately approved live operation. The earlier ten missing history versions are already covered or superseded live as verified on 2026-10-16; they must not be treated as a fresh pending application list.

Local merged-tree verification: the workbook/network collision suite passed 20 checks, including preservation of a deliberately newer dispatcher body; the earlier collision suite passed 30 checks; the company workbook suite passed 26 checks after all 92 migration files; and the full PostgreSQL suite passed 2,553 / 2,553 checks. RLS invariant queries returned zero violations. These results use disposable loopback PostgreSQL and do not prove managed Supabase or deployed browser behavior.

The combined unit/component suite passed: Admin 857, API 2,377, Web 252, Contracts 286, Shared 41, UI 221, Config 6. Typecheck passed all seven workspaces, lint completed with zero errors (warnings remain), and both app builds passed.

When checking this single-branch checkout, explicitly fetch `refs/heads/develop:refs/remotes/origin/develop`. Its configured default fetch only updates `claud/develop`; an ordinary fetch can leave `origin/develop` stale and does not prove PR mergeability.
