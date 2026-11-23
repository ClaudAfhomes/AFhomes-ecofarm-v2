# Customer import template simplification

Date: 2026-10-25
Branch: claud/clean-develop
Status: Implemented locally; no release or shared database apply.

## Intent

Make the current guided workbook easier to fill while preserving existing system validation, historical data, normal workflow routing, and legacy workbook support.

## Approach

Recommended: simplify the existing guided workbook and retain optional related sheets. A single flat sheet would duplicate customer fields for multiple payment rows and lose the current Gold supplementary-holder relationship. A separate new importer would duplicate working behavior. Keep the existing parser, preview, confirmation, identifiers, and server generator.

## Concrete changes

- Customers: remove Age, Contract total, Payments stated, Remaining balance, and Payment term months for VIP ID from the new layout (42 to 37 columns). Recompute totals server-side and derive months from the selected approved payment scheme.
- Supplementary Holders: remove calculated Age (23 to 22 columns). This sheet is only used when applicable to a Gold purchase.
- Sales Team: remove calculated recommender contact/email (8 to 6 columns); resolve them from the selected registered staff account. Preserve referrer/recommender attribution and authorized team resolution.
- Payments: retain separate payment rows and evidence/reference fields. Claims do not become verified payments merely because a workbook says fully paid.
- Group required purchase/identity inputs first. Collapse optional profile detail columns. Use concise headers, existing address/staff dropdowns, clear input styling and a short Start Here sheet.
- Do not remove genuinely distinct dates, activation/status facts, approved prices/discounts, historical balances, or IDs merely because they look similar.

## Automation

The workbook includes an editable proposed VIP ID in column C. Its formula combines the supplied purchase/contract date, an existing ID sequence or five-digit row sequence, tier, approved payment scheme, and contract classification. Users may replace the formula with a comparison value to resolve duplicates. This proposed value does not issue or reserve an official ID; the separate supplied official-ID field remains editable and is validated by the system. Blank official IDs are allocated uniquely by the server only on confirmation.

A supplied valid VIP card ID is preserved. A blank value requests server allocation on confirmed import, never an Excel-generated sequential number. Continue using the current generator settings/rules: YYMMDD + server sequence NNNNN + tier B1/S1/G1 + cash C01 or approved installment TMM + contract flag S. New N issuance remains disabled; existing authorized historical N IDs remain preservable. Allocation happens once and identifiers cannot be reused.

The generated VIP card ID is also the purchase reference. Preserve existing Customer IDs or use the existing customer-number allocator when blank. Derive payment duration from the approved scheme, not a second editable number. Default new contract classification to Standard; retain explicit classification for historical IDs and reject contradictions.

Historical balances are existing usable balances, not a fresh Annual Welcome Gift. Preserve current 70/30 allowance and historical settled-commission behavior. Status routing, pending workflow and finalized-sale reporting do not change.

## Compatibility and proof

Create a new mapping version and retain parsers for versions 1-6 and legacy company layouts. Keep previous manifests immutable. Validate the actual generated XLSX, XML/table/formula ranges and Excel opening compatibility. Test blank/provided IDs, all tiers and supported payment schemes, historical N handling, related-sheet links, multiple payments, pending/finalized routing, duplicate/reimport idempotency and old templates. Use disposable local data only.

## Boundaries

Preserve the unfinished CMS edits and unrelated artifacts. No shared migrations, live imports, commits, pushes or deployments. If generator behavior needs changing rather than simply reusing it, report the difference before altering issuance rules.

## Validation and downloadable review workbook

Added user requirement (2026-10-25): after upload, flag incorrect data and provide a downloadable copy retaining both correct and incorrect source data, with notes explaining each problem.

- Validate all safe-to-read rows rather than aborting the workbook at the first ordinary field error. A bad mobile number, email, date, VIP ID, amount, address, status, or staff link becomes a field/row error in preview.
- Retain every original data row and original entered value. Store source sheet/row/column provenance before normalization so notes and highlights identify the actual originating cell, including Payments, Sales Team, and Supplementary Holders.
- Add Download Review Workbook to the preview/result. Export all original rows, highlight error cells in red and warning cells in amber, and add clear per-row Review Status, Error Details, and Warning Details. Include sheet, original Excel row, field label, actual value and correction guidance. Do not change bad values automatically or imply that warnings are errors.
- The downloaded review workbook remains editable and re-importable. Annotation columns are explicitly recognized and ignored by the importer; never silently discard unknown user data. Correcting a flagged cell and uploading again must clear the issue when valid.
- Original numeric identifiers and phone strings must retain leading zeros. Formula-like input is written as literal text. The report does not execute workbook formulas or external content, copy private credentials, or expose unrelated customers.
- Preserve internal relationship links and blank-ID generation requests. Validation never consumes the official VIP sequence or creates customer/sale/payment records. Generated IDs are allocated only on authorized confirmation.
- Block invalid rows from committing. Good rows remain visible; report which rows are ready and which need correction. Preserve the current explicit confirmation behavior for eligible rows rather than silently importing anything.
- Keep file-level rejection for unreadable/corrupt/encrypted/malicious workbooks, unsupported layouts, macros, dangerous external relationships, and resource-limit breaches. Explain when no safe annotated workbook can be produced.
- Reuse existing field/message validation_errors and validation_warnings. Current guided parser throws early for some field errors; revise these paths to collect review issues without weakening commit validation. Persist validation reports only under current authorized import-job access.

Acceptance tests include multiple invalid fields across multiple tabs, all original rows retained, correct source-cell highlighting, actionable notes, leading-zero preservation, formula-injection safety, warning/error distinction, failed-row commit denial, correction/reupload, and unchanged historical balances/IDs/commissions. No shared data writes or migrations are authorized.
