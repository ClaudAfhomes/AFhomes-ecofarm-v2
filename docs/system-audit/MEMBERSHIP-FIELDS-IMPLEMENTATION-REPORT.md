# Membership Fields Implementation Report — 45-Column Company Template (final)

- Date: 2026-10-14 (UTC). Migration created and PROVEN on disposable PostgreSQL (`test:db:local` 2464/2464). No production migration, data, ZIP, or `docs/security/` changes.
- Tests: api targeted 320 + membership specs + company-fields + migration spec; UI 10 + 6; contracts 226; full api 2138/2139 (1 known load flake, solo-green); web 245; admin 799 (+1 flake, solo-green); shared 41. tsc clean (api, contracts, admin). Prettier clean on touched files (pre-existing HEAD warnings on sales.ts/customers.ts untouched).

## 1. Implemented behavior

- Single downloadable 45-column template (`GET template/xlsx|csv`, `membership-template.*`, header-only) — one XLSX + one CSV served from the existing template routes; the retired customer template builders were removed. Import/Export page keeps its single button pair plus an explanatory note.
- Combined customer record storage: forward-only migration `20261130000001_afhomes_membership_company_fields.sql` adds 37 nullable verbatim columns (personal/company, 12 supplementary, 8 related-person, 9 stated package/payment); both import RPCs persist them (CREATE via `company` object, UPDATE preserve-when-blank); shared gender CHECK; TIN write-only (no browser grant, masked read, never audited).
- Import: positional remap (41/45 mapped; FULL NAME ×2 + AGE ×2 warn, never split); new keys validated with reused schemas; unknown values fail rows safely; duplicate matching, fully-paid gate, audits unchanged.
- Manual create/update accept the fields with contract validation; reads mask both TINs; portal profile unchanged (explicit selects exclude new fields).
- UI: four exact-label read sections on the customer detail page; AGE derived from birthdays, never stored.
- Deliberately not built: name-splitting, money/status/package value translation, supplementary storage beyond verbatim columns, portal field exposure, new data-entry forms.

## 2. Files created or modified

- Created: migration `20261130000001_*`; `membership-template.spec.ts` (3), `customer-company-fields.spec.ts` (2), `phase33-membership-company-fields.spec.ts` (6); this report (+ earlier plan doc).
- Modified: contracts `customer-import.ts` (45 headers, position map, 29 extra keys) + index; `sales.ts` contracts (create/update/read schemas); `api/_lib/customer-import.ts` (builders, detect/remap, validators, normalized.company); `customer-imports.ts` handler (2 routes, parse hook, dropped warnings); `customers.ts` handler (pre-check from Phase 6 + company create/update/read); admin `services.ts`, `CustomerImportExportPage.tsx` (+ spec), `CustomerDetailPage.tsx` (+ spec).

## 3. Field mapping summary

Mapped (41): STATUS→source_status; ADDRESS(#3)→address_line_1; BIRTHDAY→birth_date; GENDER→sex; MOBILE→mobile; EMAIL→email; supplementary BIRTHDAY/MOBILE/EMAIL→secondary_*; CITIZENSHIP/CIVIL/TIN/OCCUPATION/OFFICE/POSITION (+supplementary mirrors, RA NO, related ×8, stated ×4)→new verbatim keys; VIP PACKAGE→vip_tier; PAYMENT TERMS→payment_scheme; PAYMENT TYPE/REF/DATE→payment_*.
Ignored with named warnings (4): FULL NAME ×2 (split BLOCKED — rows fail on required names), AGE ×2 (derived).
Entities reused, no parallel system, no JSON blobs for typed data, no duplicate-record paths.

## 4. 45 headers confirmed

Verbatim order asserted by xlsx round-trip deep-equal + csv count/ends + duplicate spot-checks (ADDRESS 3/16, EMAIL 11/35).

## 5. Download

Admin → Business → Customer Import/Export → Import tab → one card per format (Excel workbook guidance + plain-text CSV guidance, 45-column meta each) plus a mapping note. Same permission gate and file envelope as before.

## 6. Tests and results

New: template 3, company-fields API 2, migration 6 — all pass. Affected: 320-test customer/import batch, UI 10 + 5, contracts 226, full api 2146/2147 (sole known zip-bomb load flake, 20/20 solo-green), web 245, admin 799, shared 41, disposable-DB 2464/2464 (includes the new migration + import sections 46–47 that caught two transcription bugs pre-fix, both fixed with tripwire tests). Per user correction the template is SINGLE: `template/xlsx|csv` serve the 45-column company file (`membership-template.*`); retired customer builders removed; UI keeps one button pair.

## 7. Migration status

Created, applied to disposable local PostgreSQL only (via `test:db:local`), never to production. RLS invariants preserved (no new grants; verified by suite + structural spec).

## 8. Blocked / unresolved

FULL NAME split rule (bulk name-bearing imports fail safe); RA/STATUS-value/RF/price/package/terms vocabularies uninterpreted (stored verbatim or validator-decided); related names carry no hierarchy semantics (referral_relationships untouched); portal exposure deferred (least privilege); supplementary storage is verbatim (no secondary entity — matches existing secondary-note model).

## 9. User changes preserved

`docs/security/` deletions untouched; no unrelated cleanup; pre-existing prettier warnings left as found; business-rules Generator docs unmodified (company template is task-specified, not Generator-sourced).
