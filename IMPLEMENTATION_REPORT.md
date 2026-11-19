# Customer import and stay-date allowances - local verification

Latest status (2026-10-24): mapping 6 and the ten-customer browser import/re-import passed against isolated real local Supabase Auth/PostgREST. Customer routing, identifiers, points and involved IST/OST visibility were verified. Cross-portal identity synchronization and local CLI migration staging are also verified. See [browser evidence](docs/import/BROWSER-IMPORT-VERIFICATION-2026-10-24.md) and [session/migration fixes](docs/import/LOCAL-SESSION-MIGRATION-FIXES-2026-10-24.md). The broad DB suite remains 1,452 passed / 4 documented failures; earlier dated suite limitations below are retained. Shared migration application and full browser activation/redemption/refund acceptance are not verified. The sections below record the earlier development checkpoints.

Date: 2026-10-23. Working branch: claud/clean-develop. Read-only develop reference/deployment: 77d7436b112c92ef0971a50702efbbea2729ab79.

## Implemented locally

- Workbook mapping v5 uses the official VIP card ID as the purchase reference; Customer ID remains separate. Blank IDs generate server-side. Linked tabs can select Customer ID or email until VIP issuance. Mappings 1-4 remain supported.
- Uses the existing company Customer ID trigger and develop VIP allocator, with serial-boundary protections. No competing VIP registry.
- Certified historical imports create canonical applications, reservations, verified historical settlement records, sales and memberships as applicable. Fully paid awaiting activation stays distinct from already active. No invented customer consent or individual cash receipts.
- Active historical points are confirmed remaining balances. Blank does not mutate points; zero is explicit. A membership has one immutable baseline; repeat imports after spending cannot restore points. Changed balances require reconciliation. Inactive memberships receive no spendable import credit.
- New historical memberships require actual activation/expiry dates; matched memberships retain actual dates. Missing facts remain in review.
- Actual service dates govern separate weekday/weekend allowances. Overnight dates exclude check-out. Whole points divide equally over nights, with remainders assigned in chronological order. Monday-Friday uses weekday points; Saturday-Sunday uses weekend points. Classification is server-controlled.
- Approval reservations, settlement and refund attribution preserve the separate allowances. Missing legacy service dates require a fresh dated request. Processing timestamps never substitute for service dates.

## Evidence

Focused disposable PostgreSQL suite passed 30 status/tier routing cases, repeat imports after spending, generated-ID reuse, counter boundaries, mixed-night classification, concurrent weekend approvals, settlement/refund retries and RLS invariants. Focused API run: 372 passed; subsequent workbook/read-model subset: 64 passed. Admin focused run: 49 passed. Customer approval UI: 6 passed. Contracts points: 13 passed. Typecheck passed all 7 workspaces; build passed both SPAs; lint had zero errors and existing warnings. Workbook rendered and parser round-trip checked.

## Verification and stabilization

See [the stabilization report](docs/import/VERIFICATION-STABILIZATION-2026-10-23.md) for corrections, exact baseline reproduction, commands/evidence, and release limits.

- Lookup surname privacy and Finance search/input regressions are corrected. Staff lookup uses maskedLastName throughout, preserving the persisted allowance display.
- Final complete API suite: 2,685 passed (serial worker, 15-second test timeout; the concurrent build/test run had one five-second workbook timeout).
- Final complete Admin run: 953 passed, 21 failed. Nineteen failures reproduce on the reference commit. The two additional loading failures passed a serial rerun of both files (47 passed); the failed full run is still reported as failed.
- Complete web/customer/OST suite: 260 passed. Focused final Finance/Lookup checks: 59 passed; receipt/genealogy checks: 23 passed.
- Complete disposable import and actual-stay-date points suite: PASS, including settlement, refunds, idempotency, and concurrent approval. STAY_SERVICE_DATES_REQUIRED is unchanged.
- Workspace typecheck, Supabase script typecheck, both SPA builds, and lint: PASS (existing warnings remain).
- The broad DB run remains NOT GREEN: 1,447 passed, four failures. Excluding the four pending migrations independently reproduces the same four failures (1,606 passed). The original historical hierarchy failure was a stale assertion and is corrected without inventing historical ancestry. Remaining review-reason errors, cleanup/version freezing, and automatic-reservation fixture compatibility are documented explicitly.
- An isolated read-only export of reference commit 77d7436b112c92ef0971a50702efbbea2729ab79 independently reproduces 19 application UI failures (18 tests pass). These expect controls or wizard actions removed by that reference version. The reference checkout was not edited.

Authenticated browser acceptance is NOT COMPLETE. Localhost reaches Admin Login, but both local frontend and API connect to the shared production Supabase project. Import, activation, redemption, and refund mutations there would violate the current no-shared-writes boundary. No live mutation was attempted. Later DB sections after the baseline abort are NOT RUN by the broad suite.

No shared migrations, live writes, commit, push, or deployment were performed. All new migrations remain pending. Original OpenCode files were preserved under ignored .tmp-bin/import-repair-original before repair.

## Workbook

`docs/import/templates/AFHomes_Customer_Import_Template_Auto_VIP_ID_2026-10-23.xlsx` matches the downloadable asset in `packages/contracts/assets/customer-workflow-template.xlsx`.

## Import focus after merged develop

Local branch fast-forwarded to the user's merged remote HEAD `47e7d37b4c125227d87a1a07b0d0c05954219ff8`; local work was preserved and overlap conflicts resolved. The official December 18 VIP migrations are now tracked from develop and were not edited.

Current business rule: `S` Standard, `N` Non-Standard; new issuance is Standard-only. Previously issued historical N IDs require certification and are preserved. Manual assignment through customer edit is refused; the field is read-only. A pending forward migration retains issued-number ownership after deletion and prevents change, clearing, or reuse.

Workbook mapping 6 exposes contract type while retaining mappings 1-5. Current focused proof: 198 API, 69 Admin UI, 311 contracts, all workspace typechecks, and the disposable PostgreSQL import/status/points/identifier suite pass. See [the merged workflow](docs/import/MERGED-DEVELOP-IMPORT-WORKFLOW.md). Shared migration application and authenticated mutation browser acceptance remain NOT VERIFIED.

## Imported sales account visibility and commission cutover

Follow-up implementation adds recorded IST/OST involvement to their sales screens and freezes the original import's commission treatment. Fully paid/active and fully settled inactive history creates no new commission; unpaid imports retain configured rules and normal manual qualification. Previously recorded settled entries remain auditable but cannot be qualified or paid again. See [implementation and fresh local evidence](docs/import/IMPORTED-SALES-COMMISSION-CUTOVER-2026-10-23.md). The full database suite still has the four documented baseline failures; no shared migration or release action was performed.
