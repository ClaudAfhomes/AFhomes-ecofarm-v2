# Import workflow after the develop merge

Verified locally on `claud/clean-develop`, merged HEAD `47e7d37b4c125227d87a1a07b0d0c05954219ff8`.

## Canonical workflow

Ordinary application approval calls `decide_purchase_application_once`. It automatically creates and executes the reservation and records the included ₱10,000 fee. That payment is **recorded, not verified**. Finance verifies receipts, collects the remaining balance, and finalizes the reservation into a sale. Full verified payment is required before the separate membership activation.

Historical import reuses the existing import job, row, source, continuation, reservation, sale, membership, and points models. It must not replay ordinary approval and invent another reservation-fee receipt, signature, or customer consent. Certified historical settlement is recorded as historical certification; actual individual receipts are retained where supplied.

| Imported state | Destination |
| --- | --- |
| Pending, no verified money | Application |
| Reservation paid | Reservation / Finance review |
| Down payment or partially paid | Finance collection |
| Fully paid, not active | Activation queue; no automatic activation |
| Already active with actual membership dates | Existing/canonical active membership and confirmed points |
| Inactive, expired, suspended, cancelled | Historical membership state; no spendable opening credit |

Existing applications, payments, issued identifiers, and historical facts are preserved. Conflicting or insufficient evidence returns review requirements rather than silently overwriting records.

## Identifiers

- Customer ID is separate from VIP card ID.
- VIP card ID is the purchase reference: `YYMMDDNNNNNVTPMMS`.
- The existing server allocator owns the sequence. Cash uses `C01`; installment duration follows the approved scheme, not an invented `T12` entitlement for every tier.
- New issuance is Standard (`S`) only. New Non-Standard (`N`) issuance remains disabled.
- A supplied historical `S` or `N` identifier requires certified historical import unless it already matches the registered customer's issued number. Classification must agree with the suffix.
- Issued numbers cannot be changed or cleared. A private retention table records ownership and survives customer deletion, preventing reuse. It does not allocate numbers or replace the official sequence.

Workbook mapping 6 adds an explicit contract-type field. Mappings 1–5 remain supported. A blank VIP ID is allocated during confirmation; preview never predicts a sequence. The examples in the template are illustrative, not issued IDs.

## Confirmed points

The imported balance is an already-confirmed remaining balance, not a new annual award. Blank means unknown; zero is explicit. A repeated import cannot restore spent points, and a changed opening baseline requires reconciliation. Applicable allowance is determined by actual service/stay dates in Philippine time. Weekday and weekend balances cannot be exchanged.

## Evidence and boundary

Fresh import checks after reconciliation: 198 API tests, 69 Admin UI tests, 311 contract tests, and all seven workspace typechecks passed. The disposable PostgreSQL suite passed the 30 status/tier matrix, preview contract parsing, ID preservation and allocation, Standard-only issuance, historical Non-Standard preservation, manual-ID denial, identifier immutability and reuse denial, points idempotency, dated settlement/refunds, concurrency, and RLS invariants.

Evidence: `.tmp-bin/import-final-api.log`, `import-final-ui.log`, `import-final-contracts.log`, `import-final-typecheck.log`, and `import-final-db.log`.

No shared migration, live import, commit, push, or deployment was performed. The local frontend/API still point to shared production Supabase; authenticated mutation browser E2E remains unverified. These focused import results do not supersede the broader release blockers in `VERIFICATION-STABILIZATION-2026-10-23.md`.

## Excel compatibility repair

The user found that Excel could not open the delivered file despite parser and renderer success. Two OOXML defects were repaired: a duplicate empty `definedNames` container and out-of-order Customer cells (`AP` before `AO`) after column remapping. Export regression tests now check a single names container and ordered, unique cells.

Both the delivered asset and a freshly generated download opened normally in installed Microsoft Excel through its workbook API, read-only. Each retained eight sheets, the 42-column Customers table, contract-type and province dropdowns, 1,725 defined names, and the linked purchase range. The asset and deliverable have identical SHA-256 hashes. Parser/renderer acceptance alone must not be treated as Excel compatibility proof.
