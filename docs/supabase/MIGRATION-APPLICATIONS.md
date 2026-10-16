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

Any further history reconciliation, live migration, or business-data test requires its own appropriate scope. No credentials, signed URLs or customer data belong in this log.
