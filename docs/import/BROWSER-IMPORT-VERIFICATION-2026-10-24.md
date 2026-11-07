# Local customer import browser verification — 2026-10-24

Follow-up: the stale cross-portal identity and local CLI startup issues described below have since been resolved locally. See [session and migration fixes](LOCAL-SESSION-MIGRATION-FIXES-2026-10-24.md) for fresh evidence and remaining baseline failures.

Branch: `claud/clean-develop`. No shared migration, shared import, commit, push or deployment performed.

## Environment

Real disposable local Supabase Auth, PostgREST and PostgreSQL on ports 58321/58322; isolated API 3301, Admin 5184 and Web/OST 5183. Existing shared-backed localhost apps were not used for writes. Six fictional local staff accounts use the real role assignments and sales hierarchy from the existing ten-customer fixture. Credentials remain in ignored local files and are omitted here.

All 145 root migration SQL bodies executed successfully in filename order. Normal CLI replay initially failed because two existing files share migration version `20261130000001`. For this local stack only, CLI migration replay was disabled and the exact SQL bodies were applied sequentially. This proves SQL behavior, not deployability of the migration history. Repository migration names were not changed.

## Passed

- Actual Chrome file chooser uploaded `outputs/customer-import-2026-10-23/AFHomes_10_Customers.xlsx` through Customer Import / Export with externally verified history enabled.
- Preview accepted ten rows across Bronze, Silver and Gold, different payment schemes and lifecycle states. Confirmation committed **10 inserted, 0 failed** through the real API and managed services.
- Reloaded job history retained the completed job and all ten rows.
- Database assertions confirmed all ten expected destination stages, tiers, verified payment totals and frozen purchase totals against `docs/import/samples/ten-customer-workbook.json`.
- Ten unique customer IDs and ten unique VIP IDs persisted. Every purchase reference equals its VIP ID. Supplied historical VIP IDs were preserved, including the supplied non-standard historical number; newly generated numbers end in S.
- Patricia has 10,000 Stay Points: 7,000 weekday and 3,000 weekend. Gabriel has 17,500: 12,250 weekday and 5,250 weekend.
- Sales Manager Roberto Alcantara's **Team Sales** rendered all ten imported records. Reload retained them. His personal My Sales had no imported records; the purchases belong to the recorded OST seller and are visible through his team scope.
- OST referrer Mariel Soriano's **Sales** rendered all ten imported records and retained them after reload. Her **Commissions** page showed zero entries and zero amounts.
- Six settled imports are marked **Settled before system**; four pending/unpaid records are **Subject to normal qualification**. Import created zero commission rows, preserving historical settlement and avoiding premature qualification of unpaid purchases.
- Database scope assertions returned all ten imports for VD, SSM and SM team scopes and for the two involved OST personal scopes. Only the SM and referrer OST were separately exercised in the browser.
- Re-uploading and confirming the identical workbook produced **0 inserted, 10 updated, 0 failed**. There remained exactly ten customers; IDs, membership statuses and points balances matched the first import exactly.
- Real Auth and application-session checks returned HTTP 200 for all six local accounts. Parse returned HTTP 201, import commit completed, and successful imported-sales reads returned HTTP 200. Final import-page and OST console captures contained no errors/warnings.

## Limits and observations

- This is local import acceptance, not a full release approval. Browser payment completion, activation, stay-date redemption/refund, public lookup, mobile/accessibility and all other portal roles were not rerun here.
- Separate genealogy requests returned HTTP 403 and the SM genealogy view displayed “Failed to load team.” Some IST requests also returned 403 during account switching. These are retained in the HTTP evidence; no claim is made that the entire portal is error-free.
- The duplicate migration version remains a migration-runner blocker and needs release reconciliation. No released migration was renamed to hide it.
- Earlier broad database suite failures remain separate from this focused successful import run; see prior stabilization notes.

## Evidence

`outputs/browser-import-2026-10-24/` contains:

- `import-success.png`, `history-reloaded.png`, `retry-history.png`
- `ist-team-sales.png`, `ost-imported-sales.png`
- `database-results.json`, `http-statuses.log`, `console.json`

The isolated local stack is left running for inspection. It contains only fictional test accounts and customers; it is not the shared develop database.
