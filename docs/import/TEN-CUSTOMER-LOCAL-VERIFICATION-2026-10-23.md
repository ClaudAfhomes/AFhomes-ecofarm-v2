# Ten-customer workbook import verification

Result: **PASS**, 2026-10-23, branch `claud/clean-develop`.

The final workbook contains ten fictional customers with distinct realistic names, addresses, contact details, three VIP tiers, five supported payment schemes and eight statuses. No customer name contains QA or example markers. Emails use reserved `.test` domains; no messages were sent.

## What ran

```powershell
corepack pnpm --filter @afhomes/db-testing exec node --import tsx scripts/test-ten-customer-workbook.mjs
```

Exit code **0**. The same runner is available as `test:db:customer-workbook` in the DB-testing workspace.

The test reads `outputs/customer-import-2026-10-23/AFHomes_10_Customers.xlsx` through the production XLSX parser, row validator, application prefill contract, registered staff/genealogy resolver and geographic resolver. Geography was captured from the application's actual PSGC provider; codes and ZIP values are checked and persisted. It then stages the existing import jobs/rows and executes the production batch-preview and certified-history commit RPCs against a fresh disposable loopback PostgreSQL with all local migrations and the Supabase platform shim.

## Verified outcomes

| Customer | Tier | Payment scheme | Imported status | Destination | Usable points |
| --- | --- | --- | --- | --- | ---: |
| Miguel Santos | Bronze | Spot cash | Pending | Application | 0 |
| Isabella Mendoza | Bronze | Move A | Reservation Paid | Reservation | 0 |
| Rafael Bautista | Bronze | 4-month installment | Partially Paid | Finance | 0 |
| Camille Villanueva | Silver | Move B1, 40% / 12 months | Down Payment | Finance | 0 |
| Lorenzo Aquino | Gold | Move B2, 25% / 12 months | Fully Paid | Activation | 0 |
| Patricia Delos Reyes | Gold | Spot cash | Active VIP | Active membership | 10,000 |
| Gabriel Castillo | Silver | 4-month installment | Active VIP | Active membership | 17,500 |
| Sofia Mercado | Silver | Move B1, 40% / 12 months | Expired | Inactive membership | 0 |
| Adrian Fernandez | Bronze | Move A | Suspended | Inactive membership | 0 |
| Beatrice Salazar | Gold | Move B2, 25% / 12 months | Cancelled | Inactive membership | 0 |

- Exactly ten customers and unique Customer/VIP IDs after repeated confirmations and separate re-uploads.
- Five supplied Customer IDs and two supplied historical VIP IDs preserved; remaining IDs allocated by the server.
- Every persisted purchase reference equals its VIP card ID. All generated IDs end in `S`; a supplied historical `N` ID is preserved.
- Payment scheme snapshots, paid amounts and commercial totals persisted correctly. Historical amounts are source contract figures, not a new-sale price quotation.
- Province, locality, barangay and all three PSGC codes persisted on primary application holders.
- Patricia's spendable allowance is **7,000 weekday / 3,000 weekend**; Gabriel's is **12,250 / 5,250**, verified through the customer points-position function.
- Expired, suspended and cancelled memberships receive no spendable credit despite historical points in the source. Fully paid remains unactivated.
- Confirmation retries and separate uploads create no extra applications, reservations, payments, memberships or ledger entries.
- RLS invariants returned no violations.
- Microsoft Excel opened the final workbook normally, with eight sheets and 42 customer columns. A rendered customer range was visually inspected.

Detailed identifiers and locations are recorded in `outputs/customer-import-2026-10-23/import-results.json`; the fictional fixture is `docs/import/samples/ten-customer-workbook.json`.

## Limits and outstanding findings

This is parser/validator/database proof, **not authenticated browser or managed Supabase Auth/PostgREST E2E**. The HTTP upload handler and UI confirmation were not exercised in this test. Shared localhost configuration was not used, and the disposable database was stopped and removed afterward; these customers will not appear in the shared development app.

The workbook's staff names refer to local fixture accounts. Replace them with registered staff identities before using a different environment; these fictional customer records are not authorized for live import.

Location preparation exposed existing postal-reference gaps for **City of Dasmariñas / Salitran I** and **City of Meycauayan / Saluysoy**: PSGC resolves them, but the postal reference returns review. Silang and Santa Maria were used instead. No ZIP validation was bypassed; those two mappings remain unresolved.

No shared migrations, imports, commits, pushes or deployments were performed.
