# Development verification — 2026-10-23

Branch: `claud/clean-develop`. Starting local/remote commit: `4598786`. Fetch confirmed zero commits ahead or behind before staging. No force push, other-branch modification, deployment, seed, account change or production SQL apply is part of this finalization.

## Commit scope

Completed IST read-only portal, role-scoped Team Commissions, shared light styling on My Commissions/My Sales/Team Sales, route/navigation integration, accreditation date display, contracts and focused tests. Public accreditation results now show Registration Status rather than validity dates, with a matching test. Schema documentation records verified live state without claiming pending migrations were applied.

Separate unfinished work remains unstaged and intact:

- `api/_handlers/ost.ts`, the new public-app OST layout and pages, OST dashboard/services/tests, customer portal CSS, public-app routes, and OST contracts/exports. Two current OST login tests fail on duplicate `OST-000007` text. Review also found new list search expressions targeting a UUID with `ilike` and a joined sale field as a base-table field, and no focused API coverage for those new endpoints.
- Admin genealogy redesign CSS/pages/tests and `apps/admin/src/responsive.spec.tsx`. This introduces additional tree queries, missing hook dependencies, and regression mocks requiring separate completion. The small existing genealogy visibility helper required by IST is included; the redesign is not.
- Ignored environment files, operator probes, database audit JSON, logs, backups, build output and temporary files.

## Database: read-only verification

Verified directly through the existing guarded PostgreSQL connection, matching both database connection project identity and API project hostname to `ikaevepedpqygdlipsei`. The runner explicitly identifies it as **production/shared live**, not development. The connected Supabase plugin lists a different inactive project, so that project was not used.

At `2026-10-23T01:40:42.307Z`:

- History: 120 rows, latest `20261212000005`; no history writes performed. Before/after history is verified again before final Git delivery.
- Local files: 133; no new or modified migrations in this worktree.
- Existing duplicate local versions: `20261130000001`, `20261206000003` (previously documented; not repaired or renamed).
- Remote-only history versions: `20261012075439` (`afhomes_catalog_policy_management`) and `20261203000002` (name null). Their missing local provenance requires reconciliation; no fabricated migration files or history repair.
- All 60 public and 27 private table names match the repository schema index. Catalog contains 316 application functions, 38 non-internal triggers and 861 constraints. These counts do not prove definition equivalence.
- `supabase/security/rls_invariants.sql`: zero application findings; two existing platform cron policies, `cron_job_policy` and `cron_job_run_details_policy`, are reported by the broad audit. No permissions/policies changed.
- Read-only guarded preflight for `20261212000005` confirms already applied and reports the 13 older pending versions.

The exact pending production set is:

1. `20261206000006_afhomes_reconcile_workbook_network_version.sql`
2. `20261209000001_afhomes_mirror_application_onto_customer.sql`
3. `20261209000002_afhomes_mirror_every_application_path.sql`
4. `20261210000001_afhomes_mirror_referral_names_on_customer.sql`
5. `20261210000002_afhomes_mirror_government_id_on_review.sql`
6. `20261210000003_afhomes_mirror_government_id_from_application.sql`
7. `20261210000004_afhomes_drop_ost_ist_name.sql`
8. `20261210000005_afhomes_backfill_stated_package_from_application.sql`
9. `20261211000001_afhomes_performance_indexes.sql`
10. `20261211000002_afhomes_sale_team_photo.sql`
11. `20261211000003_afhomes_customer_directory_company_status_filter.sql`
12. `20261211000004_afhomes_customer_directory_active_vip_filter.sql`
13. `20261211000005_afhomes_application_purchase_terms_optional_reason.sql`

**Apply status: BLOCKED.** The request permits development applies but explicitly withholds unestablished production approval. This older set includes data backfills, destructive column retirement, constraint and function/ACL changes; it is not needed by the current read-only IST/UI work. Exact file/dependency/hash review, recovery backup verification and production-specific approval are required before any future apply. No backup was created or claimed verified because no apply was attempted.

## Schema documentation

`node scripts/update-schema-index.mjs` regenerated `docs/supabase/CURRENT-SCHEMA.sql`: the 133-file manifest and 87-table inventory were already current. Its generator and header now record the verified live history/inventory and outstanding differences. Existing conventions are preserved: this file is a **context index, not an executable schema or live dump**. No planned SQL is represented as deployed. Full column/function/trigger/index/view definition drift and remote-only history provenance remain unresolved; matching table inventories is limited proof.

## Fresh validation

| Command/check | Result |
| --- | --- |
| `corepack pnpm typecheck` | PASS, all seven workspace tasks plus Supabase script check |
| `corepack pnpm lint` | PASS, zero errors; 35 existing warnings |
| `corepack pnpm build` | PASS, both apps; existing bundle-size warnings |
| `corepack pnpm check:env` | PASS, 686 browser and 283 server files |
| `corepack pnpm test` | FAIL: API 2,674 passed / 7 failed; config 6, contracts 319, shared 41, UI 230 passed; root run stopped before complete Admin/Web results |
| API failure recheck: customer-imports + member-company-workbook, one worker | PASS, 47 tests; five initial failures were timeouts under the concurrent full run |
| Remaining full API failures | Two payment-queue customer/product search assertions in unchanged code |
| Relevant API tests within full run | PASS: IST 28; genealogy visibility 30; public search 19; public settings 5; authorization regression 36; auth verification 21; portal auth 17; router/coverage 19 |
| IST UI subset | PASS, 17 tests across two files |
| Public search + OST auth UI subset | 19 passed / 2 failed: all seven public-search tests pass; excluded OST auth has 12 passed / 2 failed |
| Shared Turnstile widget | PASS, one test; public-search API tests also exercise verification boundaries |
| Disposable full PostgreSQL suite | FAIL, 2,703 passed / 4 failed out of 2,707; cleanup passed |
| Disposable public-search PostgreSQL suite | PASS, 115 checks; all migrations executed locally and fixtures cleaned |
| Staged whitespace/secrets/artifact review | Performed before commit; no env, probe, backup or build artifacts included |

The four full database failures concern search-path assertion for `reconcile_external_customer_import`, historical-import referral attribution, and two purchase-review reason expectations. No migration or integration-suite source was changed by this commit. They are not waived as passes.

Authenticated local browser inspection of My Commissions, My Sales and Team Sales confirmed the shared light-theme class. Dark Reader was actively rewriting displayed colors; extension settings were preserved. No live commission, customer, payment or account mutation was used for testing. Deployed browser flows and a live Cloudflare challenge were not revalidated in this finalization.

Overall validation is **PARTIAL**. Git delivery of completed scope does not establish production release readiness or database synchronization. No manual Vercel deployment is authorized.
