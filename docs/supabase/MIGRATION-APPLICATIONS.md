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
