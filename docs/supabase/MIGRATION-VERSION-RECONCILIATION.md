# Historical migration-version reconciliation

The current `develop` and `claud/develop` histories both contain these immutable files:

- `20261130000001_afhomes_membership_company_fields.sql`
- `20261130000001_afhomes_sale_team_accreditation.sql`

`supabase/apply-migrations.ts` records the 14-digit version as its primary key. Once one file records `20261130000001`, the runner skips the other. The ordinary disposable harness previously executed both filenames, so its passing result alone did not prove this history case.

New migration `20261130000003_afhomes_reconcile_membership_sale_team.sql` has a distinct version and sorts after both original files and before later dependent migrations. The earlier position is deliberate: a late repair would not help a partially initialized database reach a dependent migration that had already failed.

The repair restores the nullable company columns and canonical sale-team accreditation objects using idempotent DDL. It does not replay the historical `import_legacy_member` implementation, change newer customer import/SSOT functions, update customer values, renumber existing AA identifiers, reapprove staff, backfill accreditation, or rewrite migration history. No existing migration file is modified or renamed. The historical duplicate filenames remain documented compatibility history; their prerequisites are reconciled by the new version.

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

The focused suite excludes either historical file, proves the expected missing prerequisite, installs the repair, tests existing customer/AA preservation, reapplication, accreditation lookup, browser ACLs, all later migrations, preservation of the newer import RPC and zero RLS invariant violations. Result: **22 checks passed across both skipped-history cases**.

The full disposable PostgreSQL suite passed **2,542 / 2,542 checks**, including customer import, SSOT alignment, referral-chain linkage and cleanup. Script syntax checks and `git diff --check` passed. No application/API/UI implementation changed in this maintenance commit.

## Live application boundary

This repair is prepared and tested locally only. The available Supabase connector did not expose the AF Homes project, so its live migration history was not inspected. No other project was queried or modified.

Before any separately authorized live apply, verify the exact project and recorded versions read-only, inspect which original objects actually exist, check the new version is pending, and obtain authorization for the exact migration. Do not rename an already applied file, delete a version record, infer that one recorded version proves both original bodies ran, or automatically apply other pending migrations. This index and runbook are never executable migration SQL.
