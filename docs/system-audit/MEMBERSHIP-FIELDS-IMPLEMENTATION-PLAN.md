# Membership Fields Implementation Plan (45-column company template)

- Date: 2026-10-14. Status: plan — implementation follows in the same session.
- Source of truth: the 45 headers in the task (order/capitalization/punctuation preserved verbatim in `MEMBERSHIP_TEMPLATE_COLUMNS`).

## Findings driving scope

1. Template/download/export infrastructure exists and is reused, not rebuilt: `toXlsx`/`toCsv` (`api/_lib/report-export.ts`), `sendFile` base64-JSON pattern + `template/xlsx|csv` routes (`customer-imports.ts:72,215-234`, module `governance.customer_import` view auth), UI `downloadFile` + `downloadTemplate` (`CustomerImportExportPage.tsx:47,235`).
2. Import pipeline (`parse → validateImportRow → confirm → commit_customer_import_row` RPC) has strict validators (unknown tier/scheme/status → row error; money coherence; duplicate matching; fully-paid gate). Aliasing is safe where validators decide; money/status/package values are NEVER translated (validator pass/fail only).
3. Commit persists a fixed normalized shape; citizenship/tin/occupation/position/business-address have no normalized target (dropped) — so they stay unmapped with explicit warnings rather than fake-mapped.
4. Header duplicates are load-bearing: `ADDRESS` ×2, `EMAIL ADDRESS` ×2, plus repeated BIRTHDAY/AGE/GENDER/etc. Name-keyed aliasing would merge primary and supplementary data — mapping is POSITIONAL, applied only when the header row exactly matches the 45-column spec; all other files keep current behavior.
5. `FULL NAME` (×2) cannot be split without inventing identity parse rules → BLOCKED with precise options (company split rule, or first/middle/last columns, or full_name storage). Rows without split names fail on required first/last with clear messages — safe failure, documented.
6. No supplementary-member entity exists (only import `secondary_*` note fields, Gold-only); no TIN/citizenship/civil-status/occupation storage; memberships hold no personal fields. No new data-entry form (would invent storage/semantics); no migration (no new storage).
7. `RA NO`, `STATUS` values, `RF`, price/discount/total semantics, package/terms values, role acronyms: meaning unestablished → neutral (unmapped or validator-decided), recorded as unresolved.

## Files changing

- `packages/contracts/src/schemas/customer-import.ts` (+ index export): `MEMBERSHIP_TEMPLATE_COLUMNS` (45 exact) + `MEMBERSHIP_TEMPLATE_POSITION_MAP` (45 entries: import key or null) — contract SSOT like existing column lists.
- `api/_lib/customer-import.ts`: `membershipTemplateXlsx/Csv` (text cols, widths) + `isCompanyTemplate(headers)` + `remapCompanyTemplate(matrix)` (positional rewrite + dropped list).
- `api/_handlers/customer-imports.ts`: `GET template/xlsx|csv` serve the single 45-column membership template (`membership-template.*` filenames) + remap hook in POST parse with dropped-header warnings.
- `apps/admin/.../CustomerImportExportPage.tsx` (+ spec): the unchanged button pair downloads the single template + explanatory note.
- Tests: api spec (45 headers exact/order via xlsx round-trip + csv; remap positions incl. duplicates; dropped warnings; parse-level flow), UI spec (buttons/endpoints), contracts export check.
- Docs: final report in `docs/system-audit/` (mapping table + unresolved + migration status: none).

## Field mapping (position → import key | IGNORED + reason)

Mapped (14): 1 STATUS→source_status; 3 ADDRESS→address_line_1; 4 BIRTHDAY→birth_date; 6 GENDER→sex; 10 MOBILE NO.→mobile; 11 EMAIL ADDRESS→email; 17→secondary_birth_date; 23→secondary_mobile; 24→secondary_email; 36 VIP PACKAGE→vip_tier; 37 PAYMENT TERMS→payment_scheme; 42 PAYMENT TYPE→payment_method; 43 REF NO→payment_reference; 44 DATE→payment_date.
Ignored (31): identifiers without established meaning (RA NO, RF); names needing split (FULL NAME ×2 — BLOCKED); derived AGE ×2; fields with no normalized target (CITIZENSHIP, CIVIL STATUS, TIN, OCCUPATION ambiguous, OFFICE, POSITION ×2, supplementary ADDRESS/contact block, related-persons block — owner ambiguous); money fields without established semantics (REGULAR PRICE, DISCOUNT, TOTAL AMOUNT).
Behavioral notes: unknown tier/scheme/status values → row errors (safe); STATUS=Active-class without payment history → 'Payment history required' (established economics rule, not invented); supplementary + non-GOLD → Gold-only error; money coherence rules unchanged.

## Validation / auth / sensitive data

- Reuse only: existing validators, duplicate matching (membership > customer_number > email), permission model (`governance.customer_import`), audit events, gov-ID-style masking conventions (no new PII logging; warnings name headers, never values).
- Template contains headers only, no personal data.

## Test plan

Template exactness (45/order/duplicates incl. repeated ADDRESS/EMAIL ADDRESS), xlsx validity via `parseXlsxMatrix` round-trip, csv twin, remap unit (41 mapped positions, 4 dropped, duplicate disambiguation), parse-level (mapped fields validate; dropped warn; FULL NAME rows error on required names), auth (module view for template; create/update for parse/confirm unchanged), UI single pair hits `template/xlsx|csv`, tsc + prettier + affected suites (customer-imports, customer-import, contracts, page spec).

## Unresolved (blocking only their own fields)

FULL NAME split rule; RA NO / STATUS value set / RF meanings; price/discount/total semantics; package/terms value vocabularies; SVD/SSM/SM/REFERRER/VIP RECOMMENDER mapping; supplementary storage model; UI data-entry sections (await storage decisions).
