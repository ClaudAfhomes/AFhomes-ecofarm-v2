# SESSION.md — Chat Handoff Context

> **Protocol:** This file holds the latest handoff only. When the user says
> `handoff context to @SESSION.md`, REPLACE this entire file with the new
> session's context (do not append; delete stale sections). Keep it dense:
> decisions, patterns, open threads, and verification state. No prose essays.

## Stack (unchanging)

pnpm + Turborepo. `apps/web` (:5173; marketing + `/customer/**` + `/ost/**`) |
`apps/admin` (:5174, `/admin/`) | single Vercel Function `api/router.ts` →
`api/_lib/router.ts` → `api/_handlers/**` → Supabase Postgres + Auth.
`packages/contracts` (Zod SSOT; `lifecycle.ts` owns statuses; `afhomes.ts` owns
the module catalog; NEW `customer-ssot.ts` owns the 62-column customer master
list) | `packages/shared` (BigInt money) | `packages/config` (`VITE_`-only) |
`packages/ui` (tokens + primitives). `SESSION.md`, `docs/security/`, untracked
`docs/testing/` are user items — do not touch. `docs/supabase/CURRENT-SCHEMA.sql`
was refreshed BY AGENT on explicit "update schema" trigger this session (83
files); its own header documents the re-run workflow.

## Standing user preferences (apply without asking)

- Membership template: exactly ONE download per format. `template/xlsx` = the
  GUIDED workbook (README + Primary/Supplementary/Related/Package; split name
  and address columns; fixed-value DROPDOWNS). `template/csv` = band row +
  guided headers, one file — CSV CANNOT carry dropdowns (state that plainly,
  never fake it). Legacy 44-column and 45-column company uploads still parse.
  Never split FULL NAME by code: the guided download carries explicit
  FIRST/MIDDLE/LAST/SUFFIX columns (operator-entered parts) instead.
- Dropdown values come only from the application form's pick-lists and the
  import validator's vocabularies (SUFFIX, SEX, CITIZENSHIP, CIVIL STATUS,
  tiers, payment schemes/methods, canonical statuses). Never invent values.
- User-facing copy: every sentence max 5–6 words. In detail areas the user
  names explicitly, ALL links become `ui` Buttons with ≤2-word labels that
  navigate via router.
- Admin console speaks PAGES, not internals (no raw keys/slugs, no
  View/Create/Update/Delete jargon). Role access = one "Can access" checkbox
  per page; staff overrides = one "Deny access" per page. No bulk "View all".
- Grouped modules are dropdowns; Dashboard is a flat row; multi-module groups
  pre-expand when the role/staff already holds a grant in it.
- Application drafts are hand-entry only (`/admin/customers/applications/new`
  has no file import; bulk entry lives in the Import/Export workspace).
- Guards ship with failing-first evidence; flakes: jsdom timing + zip-bomb
  timeout under parallel load → `--maxWorkers=2`; never adjust assertions to
  force a pass.
- Prettier is NOT a gate: `--check` warns on unmodified files too (CRLF
  checkout artifact). Gate on `tsc` + `eslint`. Never `--write` pre-existing
  formatting; on files that carry user WIP, diff against `prettier <file>` with
  line endings normalized to see only your own lines.
- The user edits files in parallel with the agent. Re-read shared files before
  editing; leave diffs that are not yours alone.

## This session's work (UNCOMMITTED) — customer-record SSOT alignment (largest)

User supplied the company master list (Primary 24 / Supplementary 22 / OST-IST
7 / VIP Package 9 = 62 cols). Decisions locked: ONE mobile field (MOBILE NO.),
headers verbatim (BARANGGAY, SVD (NAME)…), supplementary address stays JOINED
text, exports renamed to SSOT vocabulary + system columns, anonymize clears
company columns, register copies holder basics, legacy B-day redirected,
primary address editable in company dialog.

- NEW `packages/contracts/src/schemas/customer-ssot.ts` (exported from index):
  `CUSTOMER_SSOT_SECTIONS/COLUMNS/SECTION_BANDS`, vocabularies moved here from
  `api/_lib/customer-import.ts` (re-exported under old names). Registry pins
  order, targets, joins, dropdowns; `customer-ssot.spec.ts` (8) pins the
  verbatim blocks, key coverage, join shape, vocab-only dropdowns.
- Contracts: `barangay` into `CUSTOMER_IMPORT_COLUMNS`; `supplementary_mobile/`
  `email/landline` into extras; legacy position 17 → `supplementary_birthday`;
  `CUSTOMER_EXPORT_COLUMNS` rebuilt (SSOT order + 12 system columns);
  `sales.ts` +`barangay` address key, +`landline`/`supplementaryLandline`,
  read model +`firstName/middleName/lastName/suffix`.
- NEW migration `20261204000001_afhomes_customer_ssot_alignment.sql`
  (renumbered — first cut as …03000001 collided with the user's parallel
  `…_remove_test_customer` file; runner needs one file per version):
  `customers.landline` + `supplementary_landline` (nullable, no grants);
  register copies suffix/sex/landline/barangay; import CREATE persists
  landlines + line2/barangay/postalCode; UPDATE merges address PER KEY (no
  more 'Imported' clobber, no line1-gating).
- `api/_lib/customer-import.ts`: sections now re-export the registry; landline
  + supplementary singles validated/normalized (`company` object);
  hasSecondary Gold-guard covers supplementary keys (error names the used
  block); interim-52-col layout recognized (`isInterimV2Flat`,
  `workbookLooksInterimV2`, band strip) → handler fails it with "older
  template" message. `mergeV2SectionedTemplateSheets` matches TAB NAME first
  (Supplementary headers ⊆ Primary headers — pure header matching aliased
  both tabs to Primary; proven RED, fixed, green).
- `api/_handlers/customer-imports.ts`: interim interception (flat + sectioned);
  `buildExportRows` rebuilt (SSOT order, masked TINs, derived AGE, address
  parts, system columns).
- `api/_handlers/customers.ts`: read/create/update landline +
  supplementaryLandline; anonymize now NULLS all 37 company columns + landline
  (audit `companyStatedFieldsRemoved: true`).
- Admin: `CustomerDetailPage` Primary 24 + Supplementary 14 + Related `(NAME)`
  labels in exact SSOT order (`addressPartOf` per-key display);
  `CustomerCompanyEditDialog` edits line1/line2/province/city/barangay/postal/
  landline (falls back to stored on blank; TIN stays write-only); specs assert
  full label order + new fields.
- `supabase/db-integration.ts` NEW section 74 (30 checks): column
  existence/grants, register copy, CREATE persistence, per-key UPDATE merge,
  filled-vs-silent landline. Two execution-found fixes inside it: holder
  BARANGAY needs the code triple (holder CHECK), import rows need distinct
  row_numbers per job.
- `docs/supabase/CURRENT-SCHEMA.sql` refreshed on trigger: 83 files, 70
  tables (+2 migrations, +0 tables).

## Earlier uncommitted work (still in tree, superseded where noted)

- Interim 52-col guided template (FIRST NAME…, ADDRESS LINE 1, CITY /
  MUNICIPALITY, EMAIL ADDRESS…) is SUPERSEDED by the 62-col SSOT — do not
  reintroduce its headers; old §A handoff text describing it is stale.
- Register save fix (`official-forms-applications.tsx` register-branch
  validation) and the application detail redesign (workflow panel, buttons,
  `application-actions.spec.tsx` LocationProbe pattern) still stand.
- User refinements preserved: OfficialForms status card/record-groups CSS +
  spec, hint-line formatting, `phase2.spec.ts` FK-blocker rows, untracked
  `20261203000001_remove_test_customer…` migration, `docs/testing/`.

## Test patterns worth reusing

- Navigation assertions: catch-all route + `LocationProbe`
  (`aria-label="route"`, pathname+search); click; `waitFor` probe text.
- XLSX internals assert on RAW BYTES (entries stored uncompressed).
- Hoisted `vi.mock` factories cannot reference module constants — inline
  fixtures or `vi.hoisted`. Combobox commits on pointerdown — specs use
  `fireEvent.pointerDown(option)`.
- `role_column_grants` shows OWNER rows via acldefault — always add
  `grantee in ('anon','authenticated','PUBLIC')`, like `rls_invariants.sql`.
- Holder `barangay` text needs the full 10-digit code triple or the holder
  CHECK fails; `customer_import_rows` needs distinct row_numbers per job.
- Shared files with user WIP: `prettier <file> | tr -d '\r'` vs file diff;
  touch only your own hunks.

## Decisions (do not re-litigate)

- SSOT registry is the single header/order/key source; downloads consume it.
- ONE mobile column per block (MOBILE NO.); MOBILE collapsed, never two fields.
- Supplementary names/address JOIN into stored text; AGE ref-only; TIN
  write-only; stated figures verbatim, never computed.
- Supplementary header set ⊆ Primary set → sectioned merge matches tab name
  first, header matching only for renamed tabs.
- Interim-52 files fail with the re-download message; legacy 44/45 keep
  parsing (legacy B-day → `supplementary_birthday`; legacy mobile/email stay
  on the notes path).
- Anonymize clears company columns; register copies holder basics; import
  UPDATE merges address per key with preserve-when-blank.
- Exports carry SSOT vocabulary; supplementary name/address export collapsed
  (storage has no parts to split back).
- Migration versions are unique; A-Z = apply order; the 20261130000001 pair
  is pre-existing.

## Blocked / needs user action

- `pnpm db:migrate` — needs explicit approval. Queue: `20261131000001/0002/`
  `0003` (carried; Customer Lookup breaks until `…0003` applied + deployed),
  user's `20261203000001_remove_test_customer`, mine `20261204000001`. Then
  `rls_invariants.sql` (empty = PASS). Nothing this session applied anywhere.
- Dev API restart / redeploy for handler + template + export changes.
- `docs/testing/membership-template.xlsx` is now TWO layouts old — re-download
  the guided template and refill.
- Micro-call left open: single MOBILE NO. kept its listed slot (after TIN
  NO.); move beside LANDLINE only on request.
- Two identical "Create Reservation" buttons — user may want one removed.

## Carried open threads (older sessions, still unanswered)

- Q1 model authority, Q2 cutover scope, Q3 gate/product, Q4 missing 12 files,
  Q5 Master List, Q6 C2 authority, Q7 VIP DSC figure (exhaustively searched —
  absent).
- RA/STATUS value sets, RF, price/discount/total semantics, package/terms
  vocabularies stay verbatim, uninterpreted; related names carry no hierarchy
  semantics.
- Tech debt: `toXlsxMulti` float/date handling mirrors pre-existing `toXlsx`;
  `CustomerCompanyEditDialog` reuses the detail CSS module;
  `updateCustomer` duplication (`services.ts` vs `services-customers.ts`);
  `StatedPackage` object; stated money-schema question.

## Verify (from root)

```sh
pnpm --filter ./apps/admin exec vitest run --maxWorkers=2   # 82 files / 806 tests
pnpm --filter ./packages/contracts exec vitest run          # 20 files / 259 tests
pnpm --filter ./api exec vitest run --maxWorkers=2          # 116 files / 2241 tests
pnpm --filter ./packages/ui exec vitest run                 # 215
pnpm --filter ./apps/web exec vitest run --maxWorkers=2     # 20 files / 250 tests
pnpm typecheck                                              # turbo 7 + tsc -p supabase
pnpm check:env
pnpm lint                                                   # 0 errors
pnpm test:db:local                                          # 2525 checks incl. new §74
pnpm test:db:harness                                        # 13/13
```

Last verified (after migration renumber): ALL green — admin 806, contracts
259, api 2241, ui 215, web 250; `typecheck` 7/7; `check:env` PASS; `lint` 0
errors; `test:db:local` 2525/2525 (cleanup PASS, tables restored);
`test:db:harness` 13/13. Evidence: merge-alias + grant-form + barangay-CHECK
+ row-number failures all proven RED on disposable PG, fixed, green.
