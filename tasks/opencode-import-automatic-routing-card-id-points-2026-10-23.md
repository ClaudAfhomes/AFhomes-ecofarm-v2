# OpenCode task: AF Homes customer import — automatic routing + VIP control ID + historical Stay Points

## Project and exact inputs

- Repository: https://github.com/ClaudAfhomes/AFhomes-ecofarm-v2
- Read-only reference: `origin/develop`
- Only working branch: `claud/clean-develop` (preserve uncommitted changes)
- Actual workbook: `docs/import/templates/AFHomes_Customer_Import_Template_Auto_VIP_ID_2026-10-23.xlsx`
- No commit, push, production migration, production data mutation, or deployment without separate approval.

Open and parse the **actual** XLSX; do not assume that it is compatible just because it has the correct filename. Confirm worksheet headers, custom properties `AFHomesTemplate` and `AFHomesMappingVersion`, all payment joins, and cross-sheet purchase references. The workbook has no new `Historical Customer Status`, `Historical Certification / Source Reference`, `Existing Weekday Stay Points`, or `Existing Weekend Stay Points` columns. Never require those removed fields. Reuse the original `Existing document status (optional)` claim field, financial evidence, membership/card evidence, and source records for classification.

## What the user means by automatic import

After authorized upload, the existing importer must read each row across Customers, Payments, Sales Team, and Supplementary Holders; resolve existing canonical database records (do not trust names alone); **preview** the correct destination, monetary totals, card identity and points action; and upon explicit **Confirm**, atomically create/reconcile the records using current workflow services. No subsequent manual "New Application" entry, manual Finance row-by-row approval for a valid batch certification, or manual moving of records between modules. Keep valid independent operational approvals where business rules actually require them. Do not create a second importer or parallel queues.

### Inspect actual `develop` first

- `api/_handlers/customer-imports.ts` — current `POST parse`, validation, source rows, externally verified intake/commit.
- `api/_handlers/_customer-import-workflow.ts` — continuation and payment-claim routes.
- `api/_lib/customer-workbook-v2.ts` — metadata-locked v2 workbook parser.
- `packages/contracts/src/schemas/customer-workflow.ts` — canonical `WORKFLOW_COLUMNS` header manifest and mapping versions.
- `api/_lib/customer-workflow-export.ts` — official workbook generator.
- `api/_lib/external-customer-import.ts` — authoritative payment-driven routing summary.
- `api/_lib/customer-import-continuation.ts` — historical facts/recovery.
- `apps/admin/src/features/business/CustomerImportExportPage.tsx` and `ImportContinuationPanel.tsx` — preview and next actions.
- `supabase/migrations/20261208000019_afhomes_customer_external_verified_import.sql` — receipt, exact payment/reconciliation behavior.
- `supabase/migrations/20261208000016_afhomes_customer_import_continuation.sql` — existing continuation stages/destinations.
- `docs/handoffs/2026-10-20-external-customer-history-import.md` — as-built verified import behavior and active-member limitation.
- Compare only the relevant files and schemas to `claud/clean-develop`, including local uncommitted work and the user's existing `20261223000001_afhomes_customer_import_points.sql` if present. The linked remote `claud/clean-develop` may not contain local work.

### Status routing, based on evidence

- Pending with zero verified historical payments: existing Customer Applications stage (create the internal draft if needed; **never** require manual New Application after import).
- Reservation Paid with matched payment equal to included reservation fee: existing IST Reservation workflow and verified payment history.
- Down Payment / Partially Paid with verified amount >0 but below contract total: existing executed agreement and Finance collection with exact remaining balance.
- Fully Paid (verified or appropriately batch-certified remaining = 0), but not active: finalized verified sale and existing card-activation queue. **Do not mark active or grant points just because remaining balance is zero.** Preserve the existing certified-zero-balance no-payment-rows case if supported locally, without fabricating a fake cash receipt.
- Already Active VIP, with trustworthy activation/card/identity evidence: reconcile to an existing or properly represented active membership, preserve card details, and import eligible historical points once. Do not redo activation or automatic welcome gifts.
- Inactive / Expired / Suspended / Cancelled: preserve their history, route to existing inactive/review behavior; do not grant spendable points or silently reactivate.
- Conflicting identifiers, dates, money, activation, or status: explicit Review/Hold, with a specific reason. No guessed transitions.

## Official VIP control-number import and issuance

The workbook has optional **Existing VIP Control/Card Number**, plus VIP Plan, Payment Terms, VIP Purchase Date, Existing Card Activation Date, Existing Card Valid Until, Contract Classification (Standard/Non-Standard), and Payment Term Months. Use exact headers as inspected, rather than guessed column positions.

An existing historical official number must be validated, reconciled and preserved verbatim (case normalization only if officially permitted). An empty number must be **generated server-side only during authorized confirmed import** using the existing official allocator if implemented, otherwise propose or implement the smallest safe transactional allocator subject to ID rules. Do not use a client-side Excel sequence or `MAX()+1` race.

17-character immutable format: `YYMMDD` + `NNNNN` + `B1|S1|G1` + `C|T` + `MM` + `S|N`. Example `26101400001G1C01S`. Bronze B1, Silver S1, Gold G1; cash forces C01; valid installment months are zero-padded and bounded by the official policy. Standard -> S; Non-Standard -> N. Use the verified purchase/contract transaction date per official sale numbering rules; when only activation date is available, verify the permitted fallback and show this source in preview. When dates disagree or a source date is unproven, place the row on Review/Hold, not a silently selected arbitrary date. Preserve existing issued numbers and sequence uniqueness, including on reimport, concurrency, and cancellations.

**Important:** `AF-CUS-YYYY-NNNNNN` is the *customer ID*, not the VIP control/sale number. Internal `card_sales.sale_number`, `memberships.membership_number`, and printed VIP control number are not necessarily the same schema field. Trace the actual database relationships and preserve separate identifier domains. Persist the official control number to the authoritative unique record or registry linked to the correct `card_sales` sale, membership/card, and customer without overwriting unrelated existing IDs. Ensure read-back on customer detail, sale detail, activation queue and card print where appropriate. Do not invent an unreviewed column if a registry exists.

## Historical total points

The workbook contains only **Existing Stay Points Total**, not the two historical weekday/weekend fields. Import that total only for evidence-confirmed already-active VIPs, using the existing authorized points ledger and the local `cutover_baseline` implementation if present. Never overwrite ongoing balances, backdate fabricated redemptions or grant additional annual welcome points. Require one immutable opening-balance/audit receipt per original source/card/member with idempotent source hash and duplicate detection; same input reimport must not add points twice. If later redemptions have occurred, never reset current balance to the workbook's historical total. Blank means unknown; 0 is a real claimed zero.

Apply the approved 70/30 weekday/weekend **display allocation** automatically in the existing system if that is its actual policy; do not add weekday/weekend Excel columns. The derived display must not be mislabeled as proven actual historical spending balances, and must not weaken separate weekday/weekend redemption restrictions. If current single-balance ledger cannot enforce those restrictions, identify the discrepancy and use a safe documented reconciliation hold or a separately approved scoped fix, not an invented spendable category ledger.

## Technical changes

1. Update the single canonical `WORKFLOW_COLUMNS` manifest, schema/parser, strict workbook mapping/version compatibility, template exporter, and frontend preview. Continue to accept supported old template versions. Make the official download produce the same headers and metadata as the parser expects. Test actual attached XLSX, not a mocked CSV only.
2. Carry all new values from workbook through normalized row -> protected source -> validated preview -> atomic external-history commit -> durable database records -> customer and finance queries. No silent field drops or unknown-header-only warnings for supported fields.
3. Integrate with existing `commit_external_customer_import_row`, continuation APIs, receipt and ledger mechanisms; do not make imported history enter a separate queue tree.
4. Preview per row: customer match, effective status/evidence, target module/route, original vs generated VIP control number (preview only if not yet issued), monetary figures, points eligibility, points import/no-op/hold, conflicts, and resulting canonical links. Confirmation must revalidate a source hash/target version to prevent stale preview.
5. Secure all mutations with existing role permission/RLS. Make duplicate imports idempotent, with row locks and unique constraints appropriate to the actual schema; no external import should issue two card numbers or duplicate purchases/payments/points.
6. For already-active customers, preserve historical activation date and validity dates after validation; do not restart the VIP term just because an import occurred. Gold supplementary membership/card linkage must remain correct.
7. Keep `origin/develop` read only and make changes only on local `claud/clean-develop`. Preserve coworker changes and other modules. No live SQL.

## Required end-to-end acceptance tests (disposable database)

- Actual XLSX upload -> preview -> confirmed import -> read-back from database and the correct Admin module.
- Pending, Reservation Paid, Partially Paid/Down Payment, Fully Paid awaiting activation, already Active, and expired/inactive/cancelled: correct destination, no manual New Application step.
- Existing valid VIP control number preserved exactly; blank number generates official unique 17-character control; all Bronze/Silver/Gold, cash/installment, S/N; invalid dates and duplicate numbers held; concurrent issuance safe.
- Active VIP with total historical points: one ledger baseline, correct display behavior, no duplicate activation benefit; inactive and fully paid awaiting activation: **no** spendable points.
- Repeat same workbook, cross-job repeat, stale-preview confirmation, conflicting customer identities, same customer with multiple purchases, disputed paid totals, missing Payment rows with certified zero balance when supported, and post-import redemptions.
- Permission denial for unauthorized import/points adjustment; no customer detail leakage to unrelated users.
- Relevant parser, schema, API, Admin UI, DB integration and build/typecheck/lint tests; distinguish pre-existing baseline failures from newly introduced failures with evidence.

## Final report and delivery limit

Report branch SHA, exact `develop` reference SHA, differences addressed, files modified, workbook fields consumed, per-status destination, VIP ID persistence path/columns, points ledger design and 70/30 display caveat, missing approvals, tests passed/failed, schema/migration status, and read-back evidence. Finish implementation and verification locally; do NOT commit, push, deploy, or apply production migrations until explicitly instructed.
