# Customer company workbook import/export — local implementation report

Date: 2026-10-16. Branch: `feature/customer-bulk-import`. Base:
`362bde5cccffd90fab5d6c87467db9ba25f8993f` (local `claud/develop`; the remote
`claud/develop` has since advanced to `b89c320`, onto which delivery integrates).
Worktree: `C:\Users\SSD-CLAUD\Documents\AFhomes-customer-workbook-import`.
Nothing deployed or live-applied. The shared communications checkout was not changed.

## Acceptance status

Independent implementation is available for review and local testing. This is **not a production acceptance PASS**.
Nationwide postal resolution is implemented against a pinned, license-verified reference snapshot with explicit
review holds wherever coverage is weak or ambiguous — it is not backed by any live postal service.
Mail-code candidates that cannot be resolved uniquely remain explicit review holds.
The existing `AF-CUS-XXXXX` allocator is reused as authorized; `AF-CUS-YYYY-NNNNNN` remains a separate production-release dependency.
Authenticated managed-stack browser acceptance and actual live migration-history compatibility remain unverified.

## Reused architecture

- Existing import jobs/rows, permissions, REST family, validation, audit events and `commit_customer_import_row` transaction boundary.
- Existing `import_legacy_member` identity allocator/creation path, customer directory and registered referral hierarchy.
- Existing bounded ZIP/XML reader, report ZIP/CRC writer and exact-decimal validation; no dependency added.
- Existing address-provider PSGC hierarchy; workbook reference sheets are not geographic authority.
- Existing application holder contracts, application form controls, API client, query invalidation, loading buttons and confirmation dialog.
- Existing staff/customer authorization separation and read-only browser database grants.

## Input/output support

| Format | Status |
| --- | --- |
| Company XLSX | Four aligned entry sheets parsed by explicit Excel row; all ten source sheets preserved on download/export. |
| Company XLSM | Same parser; embedded VBA is never executed. The actual reference XLSM parses as one literal customer row. |
| Download template | Sanitized XLSX: sample entry data, cached strings, VBA and author metadata removed; reference tabs, dropdowns and derived formulas retained. |
| Export | Company XLSX; current identity overlaid on committed company details. TIN omitted. Authoritative system status readout appears separately in README; entry-tab status/package values remain source claims. |
| Legacy flat CSV/XLSX | Existing workflow retained; strict 11-digit contacts and Proper Case apply to imported identities. Existing explicit historical finance import behavior is separate from company workbook claims. |
| Google Sheets | Existing link-readable flat CSV export supported. Private-sheet OAuth and direct four-tab Google workbook acquisition are not configured. Download as XLSX and upload for the company four-tab layout. |

Upload/archive budgets remain bounded. 5,000 populated customer records are covered; 5,000 formula-only rows are ignored.
Excel 1900/1904 serial dates and ISO/MM/DD/YYYY text dates are supported. Excel's fictitious 1900-02-29 is rejected.
Unsupported formulas are rejected; only known derived age/postal formula treatment is permitted, without evaluation.

## Complete entry-field mapping

Primary starts with `RA NO â†’ ra_number` (reference/conflict check) and `STATUS â†’ stated_status` (unverified claim).
The following fields appear on both Primary and Supplementary. Supplementary uses the same keys with `secondary_` prefix.

| Workbook header | Import key | Meaning |
| --- | --- | --- |
| FIRST NAME | first_name | Customer identity / holder first name |
| LAST NAME | last_name | Customer identity / holder last name |
| MIDDLE NAME | middle_name | Optional identity / holder middle name |
| SUFFIX | suffix | Approved suffix; N/A becomes empty |
| BIRTHDAY | birth_date | Validated date / application holder DOB |
| GENDER | sex | Approved company choice / holder gender |
| AGE | age | Derived completed years; workbook formula/cache not trusted |
| CITIZENSHIP | citizenship | Application holder citizenship |
| CIVIL STATUS | civil_status | Exact approved dropdown / holder civil status |
| PERMANENT ADDRESS LINE 1 | address_line_1 | Structured address / application holder |
| PERMANENT ADDRESS LINE 2 | address_line_2 | Optional structured address / application holder |
| PROVINCE | province | Existing PSGC province name/code resolution |
| CITY | city | Existing PSGC locality scoped to province |
| BARANGGAY | barangay | Existing PSGC barangay scoped to locality |
| POSTAL CODE | postal_code | Unverified candidate only; explicit review hold |
| LANDLINE | landline | Optional strict 11-digit string |
| EMAIL | email | Lowercase validated email |
| TIN NO. | tin | Restricted source/application detail; excluded from export/audit |
| MOBILE NO. | mobile | Strict 11-digit string, leading zero retained |
| OCCUPATION / BUSINESS NAME | occupation | Application holder occupation/business |
| OFFICE / BUSINESS ADDRESS | business_address | Application holder business address |
| EMPLOYED POSITION | position | Application holder position |

Supplementary is an attached Gold application holder in the protected committed source detail, not a second membership or independently activated customer account. Silver/Bronze supplementary data is rejected. No secondary holder is fabricated.

| Related header | Import key / behavior |
| --- | --- |
| SVD (NAME) | vd_name; unique active registered vice director |
| SSM (NAME) | ssm_name; unique active registered senior sales manager |
| SM (NAME) | sm_name; unique active registered sales manager |
| REFERRER (NAME) | referrer_name; registered staff match, frozen resolved referrer ID |
| VIP RECOMMENDER (NAME) | recommender_name; application detail |
| CONTACT NO. | recommender_contact; strict 11 digits |
| EMAIL ADDRESS | recommender_email; validated lowercase |

Supplied managers/referrer must agree with existing registered ancestry; no genealogy edges are invented.

| Package header | Import key / behavior |
| --- | --- |
| VIP PACKAGE | vip_tier; GOLD/SILVER/BRONZE application selection |
| PAYMENT TERMS | stated_payment_scheme; approved label to existing scheme code |
| REGULAR PRICE | stated_regular_price; exact-decimal claim |
| DISCOUNT | stated_discount; exact-decimal claim |
| TOTAL AMOUNT | stated_total; exact-decimal claim |
| RF | stated_rf; exact-decimal claim |
| PAYMENT TYPE | stated_payment_method; approved label to existing method code |
| REF NO | stated_reference; unverified evidence reference |
| DATE | stated_date; normalized real date |

README and five PSGC reference/index sheets are preserved, never imported as customer records.
Exact source header order is required. Shared contracts own headers, mappings and approved choices, including the source spelling `Seperated`.

## Validation, preview and conflicts

Imported names use Proper Case for uniformly upper/lowercase tokens, retaining intentional internal casing, apostrophes, hyphens and Roman suffixes.
Contacts must contain exactly 11 digits without separators or spaces. Birthdays must be real, past and plausible; age is computed from DOB.
Primary/secondary geography is validated independently against existing scoped PSGC functionality. An unavailable provider is a retryable validation error.
Postal candidate data is never copied to authoritative `customers.address.postalCode`.

Preview persists protected staging rows, not customers. It exposes row/field errors, mapped source labels, age, claims and existing-customer review links; TIN values are hidden.
Server preview paging and bounded 100-row confirmation batches avoid one enormous request. Partial preview persistence marks the job failed; confirmation is resumable and audited.
Duplicate identities in a file mark both rows as conflicts. Existing verified identity disagreements and changed company snapshots require review; identical committed snapshots skip.
Reviewers correct the source or use the existing authorized customer screen, then re-preview. There is no import override that silently overwrites a conflict.
Row locks and email/RA advisory locks protect concurrent retries. Legacy updates also recheck protected identity under lock before mutation.

## Customer/application and financial behavior

Company confirmation creates searchable prospect identity and validated structured address through the existing transaction path.
Other holder/package claims remain attached in protected import detail. Explicit **Load imported customer details** fills the existing editable application form.
The prefill endpoint requires both customer-create and import-view permission. Switching customers clears imported details; late responses cannot fill a different customer's form. Failed lookups have a retryable error.
Consent, signatures, identity documents, payment evidence and application approval are never fabricated. No application is automatically submitted or approved.

Company `Fully Paid`, `Active VIP`, package price/RF and payment references do not create verified payments, sales, memberships, points, commissions, refunds or activation.
The dedicated PostgreSQL test checks ledger counts and balances, unauthorized actors, browser/private-function ACLs, retry and concurrent CREATE/SKIP behavior, audit payloads and directory discovery.
No privileged key, real customer fixture or original source XLSM was added to tracked project files.

## Migration and schema index

New file: `supabase/migrations/20261206000003_afhomes_company_customer_workbook.sql`
(renumbered twice against `origin/claud/develop`: `20261204000001` was taken by the coworker's
`afhomes_customer_ssot_alignment`, then `20261205000001` by `afhomes_network_members`).
Adds service-only read adapter `public.match_company_import_staff(text[])`, the private company
commit helper, a private preserved copy of the preceding legacy row-commit body, and a dispatcher
that adds the identity guard while keeping the authoritative raw identifier-conflict checks first.
No prior migration changed. No tables, columns or data backfill added; the postal reference is a
compiled asset plus a resolver module, not a database object.

`docs/supabase/CURRENT-SCHEMA.sql` was absent on the approved baseline, so a context-only sorted manifest/table inventory was generated from actual migrations.
Regenerate with `node scripts/update-schema-index.mjs`; never execute the document as SQL.
Migration count **70 → 71**; public table count **59 → 59**, checked against disposable PostgreSQL.
The requested `SUPABASE-FREE.md`, `customer-ssot.ts` and split `services-customers.ts` also did not exist on this baseline; actual canonical modules were reused.
The connector exposed no usable matching AF Homes target, so no authoritative live history was read or guessed and no remote apply was attempted.

## Verification

- Dedicated disposable PostgreSQL company workbook suite: **26 passed** (71 applied migrations, 59 public tables, RLS invariants zero violations).
- Full existing disposable PostgreSQL suite: **2,452 passed / 0 failed / 2,452 checks**, including section 48 (customer import release blockers on real PostgreSQL) after the dispatcher was corrected to keep the authoritative raw identifier-conflict checks ahead of the new identity guard.
- RLS invariant SQL: zero violations in dedicated disposable PostgreSQL execution.
- Reference XLSM inspection: one literal customer record, without executing VBA or writing business records.
- API workspace: **2,176 passed** (108 files), including the nationwide postal resolver suite and provider propagation.
- Admin, contracts, shared, UI primitives, config and public app suites, plus root typecheck, lint and build: to be re-run on the integrated tree (`origin/claud/develop` @ `b89c320` plus this change) and recorded in the integration commit.
- Commands: `node packages/db-testing/scripts/test-db-local.mjs` (disposable port 55453), `node packages/db-testing/scripts/test-company-workbook.mjs` (disposable port 55449), `pnpm --filter api exec vitest run --maxWorkers=2`, `node scripts/build-postal-reference.mjs`, `node scripts/update-schema-index.mjs`.

Browser acceptance: **not executed against authenticated managed Supabase/API**. Component tests cover preview pagination, XLSM input, permissions, confirmation continuation, imported form data, customer switching and retry errors. These do not prove deployed persistence.
Native Excel rendering/recalculation is unverified. Automated OOXML parsing and export/reimport prove structural/data round trips, not Excel visual acceptance.

## Release dependencies and next gate

1. Authorized, scoped managed-stack application of the migration history on an approved environment; the combined tree is so far proven only on disposable PostgreSQL.
2. Replace the postal reference from an authoritative PHLPost/FOI machine-readable feed when one is obtainable; the review holds are the safety net until then.
3. Approved official ID format delivered by its existing workstream.
4. Authenticated end-to-end import/export/application acceptance on an authorized isolated environment, using synthetic customers; native Excel workbook verification.

No deployment or live database operation is authorized by this report.

## Nationwide postal reference (implemented)

Compiled from a pinned, license-verified snapshot: `simonpangan/Philippines-Zip-Codes`
commit `4ee5485c70430eda4f4060575230b326ab391b71` (the repository's MIT re-license commit of
2024-01-04; its `version-2.sql`, SHA-256
`48f46477b297f6e296e615a82bc5de209fb2ee8fd944983f38ff7762f0c5b394`, is byte-identical to the
earlier GPL-3.0-era commit — verified when the pin was chosen and documented here because the
pin/license pairing is easy to get wrong). The pinned commit's `LICENSE` (MIT) is shipped
byte-for-byte at `packages/contracts/assets/postal/LICENSE`. Data originates from Grit
(`grit.ph/zip-codes`) as of 2024-01-04; 1,974 entries. `node scripts/build-postal-reference.mjs`
re-downloads, hash-checks the dump and the license, and regenerates
`packages/contracts/assets/postal/national-reference.json`; it never executes the dump.

Corrections are explicit and minimal:
- Six PHLPost-audited ZIP corrections (`https://phlpost.gov.ph/zip-code-locator/`, checked 2026-10-16):
  Masbate/Cawayan `5409`, Camarines Norte/Capalonga `4607`, Albay/Oas `4505`, Surigao del Sur/Cagwait
  `8304`, Cagayan/Gonzaga `3513`, Cagayan/Alcala `3507`.
- Canonical locality names: the source's `Markina City` spelling error → `Marikina City`, and the
  source's `Caloocan City (North)`/`(South)` postal-district parentheticals collapsed to
  `Caloocan City`, so a barangay/district lookup selects the district while a city-only lookup
  stays a multi-code review.
- `api/_lib/postal-reference.ts` maps current PSGC province names onto the reference's dated
  vocabulary (Davao de Oro = Compostela Valley, Samar = Western Samar, the Mindoro and Cotabato
  pairs, the Surigao del Norte spelling, Kalinga/Apayao and Maguindanao del Norte/Sur successor
  composites, Quezon). Older stored spellings keep working.

Rules kept load-bearing: resolution must be unique or it is a review hold (never the first code);
a barangay that names a separate provincial postal area (e.g. Calamba's Canlubang) is never folded
into the city default; raw PSGC Cloud `zip_code` values are never trusted (they disagreed with
PHLPost, e.g. Victoria, Laguna: provider `4018`, authority `4011`); NCR requires city plus a
supported barangay/district. `Davao Occidental` and `Dinagat Islands` have no reference rows and
remain honest review holds.

Consumer wiring: the PSGC provider propagates only a resolved `postalCode`; application holder
validation (`api/_handlers/official-forms.ts`) re-verifies the hierarchy server-side and refuses
unverified coded addresses; workbook import keeps `postal_code` as the source candidate and only
sets the authoritative value from a successful resolution — conflicts and ambiguity are explicit
review errors.

Coverage caveat, stated honestly: this is a dated third-party compilation, not a PHLPost feed; the
FOI/PHLPost machine list was not obtainable, and leaflet-grade national accuracy is not claimed.
Province aliasing was verified against the live PSGC Cloud `/provinces` list (82 provinces) on
2026-10-16.

## Actual changed files

The list includes new files and tracked modifications; ignored `.tmp-bin` probes/logs are excluded.

- `api/_handlers/customer-imports.spec.ts`
- `api/_handlers/customer-imports.ts`
- `api/_handlers/input-normalization.spec.ts`
- `api/_handlers/official-forms.ts`
- `api/_lib/customer-import.spec.ts`
- `api/_lib/customer-import.ts`
- `api/_lib/customer-workbook.spec.ts`
- `api/_lib/customer-workbook.ts`
- `api/_lib/customer-workbook-export.ts`
- `api/_lib/customer-xlsx.ts`
- `api/_lib/postal-reference.spec.ts`
- `api/_lib/postal-reference.ts`
- `api/_lib/psgc-cloud-provider.spec.ts`
- `api/_lib/psgc-cloud-provider.ts`
- `api/_lib/report-export.ts`
- `apps/admin/src/features/address/GeographicAddressFields.tsx`
- `apps/admin/src/features/business/CustomerImportExportPage.spec.tsx`
- `apps/admin/src/features/business/CustomerImportExportPage.tsx`
- `apps/admin/src/features/business/customer-import-prefill.spec.tsx`
- `apps/admin/src/features/business/final-blockers.spec.tsx`
- `apps/admin/src/features/business/import-cache.spec.tsx`
- `apps/admin/src/features/business/OfficialFormsPages.tsx`
- `apps/admin/src/features/business/services.ts`
- `docs/AFHOMES-CUSTOMER-WORKBOOK-IMPLEMENTATION.md`
- `docs/CONTINUE-CUSTOMER-BULK-IMPORT.md`
- `docs/supabase/CURRENT-SCHEMA.sql`
- `docs/superpowers/plans/2026-10-16-customer-workbook.md`
- `packages/contracts/assets/customer-company-template.xlsx`
- `packages/contracts/assets/postal/LICENSE`
- `packages/contracts/assets/postal/national-reference.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/schemas/address.ts`
- `packages/contracts/src/schemas/customer-import.ts`
- `packages/contracts/src/schemas/customer-workbook.ts`
- `packages/db-testing/scripts/test-company-workbook.mjs`
- `scripts/build-postal-reference.mjs`
- `scripts/sanitize-customer-template.ts`
- `scripts/update-schema-index.mjs`
- `supabase/db-integration.ts`
- `supabase/migrations/20261206000003_afhomes_company_customer_workbook.sql`
