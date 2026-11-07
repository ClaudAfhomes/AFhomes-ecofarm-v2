# Local session and migration fixes — 2026-10-24

Work stayed on `claud/clean-develop`. No shared database writes, migration applies, commits, pushes or deployments.

## Stale account caused the genealogy 403

Local Admin and Web portals intentionally share a Supabase cookie across ports. Signing into OST replaced that cookie while an already-open Admin tab retained the Sales Manager's identity and query cache. Requests therefore used the OST token against the manager's genealogy, and the API correctly denied them. Authorization was not widened.

Admin session resolution now clears the old principal/cache when identity changes, ignores superseded resolutions, and rechecks on window focus. In development, supported Cookie Store change notifications also detect shared-cookie changes immediately; focus remains the fallback. The Cookie Store event behavior is described in the [platform standard](https://cookiestore.spec.whatwg.org/). Cookie contents are never logged.

An OST identity reaching an existing staff screen now returns through the existing staff login portal router, which hands off to the Web OST dashboard. It no longer renders a stale IST screen or a missing page.

Browser proof:

- Signed in as Roberto Alcantara, Sales Manager. His genealogy loaded with his own node, Mariel Soriano's downline node, and read-only SSM/VD head names.
- Left that manager tab open and signed in as Mariel through the other local portal.
- Without reloading the manager tab, it automatically moved to `http://localhost:5183/ost/dashboard` and displayed Mariel's OST account.
- Evidence: `outputs/browser-import-2026-10-24/genealogy-fixed.png` and `account-switch-fixed.png`.

## Version-keyed migration replay

Three historical versions have two original files each: `20261130000001`, `20261206000003`, and `20261215000001`. The repository's runner records a version once. The native Supabase CLI instead stops when it encounters the second file with that version.

The first two collisions already had forward repairs. Added `20261215000002_afhomes_reconcile_customer_id_search_path.sql` for the third: it restores the company customer ID generator and search-path hardening if either original was skipped. It preserves issued IDs, counter high-water marks and later allocator improvements. Historical originals were not renamed or edited.

The local staging helper selects the first sorted file per known historical version and includes every forward repair. It refuses unknown duplicate versions, missing repairs, unexpected existing staging files, and destinations outside a dedicated `.tmp-bin` directory. It copies unchanged SQL bytes and never connects to a database. The root migration archive deliberately retains the original duplicate versions; run the native CLI against the prepared local project, not directly against that archive.

For a new disposable local project:

```powershell
supabase init --workdir .tmp-bin/local-supabase
corepack pnpm db:prepare:local
# If another stack is running, assign unused ports in this generated config first.
supabase start --workdir .tmp-bin/local-supabase
```

For another dedicated `.tmp-bin` project, pass its path to the helper:

```powershell
corepack pnpm db:prepare:local .tmp-bin/my-local-supabase
```

This is a disposable local startup workflow, not authorization to change shared migration history or use it as a hosted deployment manifest.

## Fresh checks

- Admin focused session, restoration, genealogy UI and permission tests: **18 passed**.
- API genealogy visibility/authorization: **30 passed**; upline and unrelated-member detail restrictions remain enforced.
- Admin TypeScript and targeted ESLint: **passed**.
- Known-collision manifest assertions: **passed**, including rejection of unknown collisions and missing repairs.
- Existing skipped-history recovery suite: **30 checks passed** across both November histories. Updated only its outdated AA-number and existing-overload fixtures to match current invariants.
- New December customer-ID recovery suite: **both skipped-history cases passed**, including repeated apply, existing ID preservation, private function ACLs, later migration replay and preservation of the later allocator definition.
- Native Supabase CLI fresh start/reset on isolated PostgreSQL port **59322**: **143 unique migration versions recorded**, covering all **146 source files** through the three forward repairs. Every RLS invariant query returned zero violations. The original import browser stack on 58321/58322 was preserved.
- Full local DB suite: **1,452 passed, 4 failed**. Failures match the previously documented baseline: two purchase review-reason expectation mismatches, `PURCHASE_TERMS_VERSION_FROZEN` fixture cleanup, and `RESERVATION_ALREADY_EXISTS` in the obsolete reservation fixture. This is not a green full-suite or release claim.

Logs remain in ignored `.tmp-bin/browser-e2e-stack/`: `session-final.log`, `session-typecheck-final.log`, `session-lint.log`, `genealogy-auth-tests.log`, `old-reconciliation.log`, `id-reconciliation.log`, `cli-reset.log`, and `db-full-final.log`. Local generated credentials are deliberately excluded from this report.
