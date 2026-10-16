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
the module catalog; `customer-ssot.ts` owns the 62-column customer master
list) | `packages/shared` (BigInt money) | `packages/config` (`VITE_`-only) |
`packages/ui` (tokens + primitives). `SESSION.md`, `docs/security/`, untracked
`docs/testing/` are user items — do not touch. `docs/supabase/CURRENT-SCHEMA.sql`
was refreshed BY AGENT on explicit "update schema" trigger (83 files); its own
header documents the re-run workflow.

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
  force a pass. Never run two admin suites in parallel in one workspace.
- Prettier is NOT a gate: `--check` warns on unmodified files too (CRLF
  checkout artifact). Gate on `tsc` + `eslint`. Never `--write` pre-existing
  formatting; on files that carry user WIP, diff against `prettier <file>` with
  line endings normalized to see only your own lines.
- The user edits files in parallel with the agent. Re-read shared files before
  editing; leave diffs that are not yours alone.
- Version control (AGENTS.md): never stage/commit/push/branch/tag/stash/reset
  or any GitHub action unless explicitly commanded in the current session.
  Working-tree edits are normal work; moving them into git is not.

## This session's work (UNCOMMITTED) — three builds on top of SSOT

### A. Template README acceptable values
- `api/_lib/customer-import.ts`: NEW `membershipTemplateV2ReadmeRows()`
  derives all lists from `MEMBERSHIP_TEMPLATE_V2_SECTIONS` (never hardcoded):
  7 guide rows + `CSV has no dropdowns` note + `Allowed values` header + 8
  field rows (STATUS, SUFFIX, GENDER, CITIZENSHIP, CIVIL STATUS, VIP PACKAGE,
  PAYMENT TERMS, PAYMENT TYPE). `membershipTemplateV2SectionedXlsx()` consumes
  it. CSV byte-identical (band + headers).
- Spec: README body equals builder rows, order/values match registry,
  guide sentences ≤6 words (`customer-import.spec.ts`, 76 tests).

### B. Lookup ↔ application ↔ reservation connected flow
- Contracts `customerLookupSchema` + `customerLookupFromDirectory` now carry
  `customerId` UUID (from `customer_directory.id`, already in `c.*`; no
  migration). Still no Membership Code field by design.
- `CustomerLookupPage`: card resolves LIVE from latest fetch by
  `customerNumber` (was frozen snapshot); new `Open record` →
  `/admin/customers/:uuid` and `View forms` →
  `/admin/customers/applications?search=<number>` buttons (≤2 words, router).
  `CustomerApplicationsPage` boots `search` from `?search=`.
- Back-link fixed: `official-forms-reservations.tsx` review alert pointed at
  nonexistent `/admin/sales/applications/:id` → `/admin/customers/applications/:id`.
- Reservation queue gained `from/to` DateFields: `reservationKeys.list` now
  `(status,tier,search,from,to,workOnly,page)` + service passthrough (service
  already accepted them). `queryKeys.spec` pin updated.
- `today()` (`official-forms-fields.tsx`) is now browser-zone (was UTC
  `toISOString`), matching console display.
- NEW `membershipKeys.customerLookupScope = ['customer-lookup']` (prefix pin
  in spec). App decide/review/reopen/submit invalidate reservation scope +
  lookup scope + reports; reservation save/submit/decide/reopen invalidate app
  scope + lookup scope (+ queue/reports on decide). Proposal double-key kept
  (no rename); picker still pages 200 (not switched to lookup search).
- Specs: lookup nav (2 LocationProbe cases, 25 tests), reservation back-link
  (1 case, 22 tests), `customer-lookup-authorization.spec` asserts `customerId`.

### C. Departments rework (ID + Name, no Code, full CRUD)
- Page (`AfHomesDepartmentsPage.tsx` rewritten): table ID + Department Name +
  Actions only; Code/Staff/Status columns gone; shared create/edit dialog with
  Department Name field only; Delete via ConfirmDialog, disabled with
  "Reassign staff before deleting." when `staffCount > 0`. NEW
  `AfHomesDepartmentsPage.spec.tsx` (4 cases).
- API (`admin/afhomes.ts`): POST accepts name-only, derives hidden `code`
  slug server-side (`deriveDepartmentCode`, rename leaves code untouched);
  NEW `PATCH departments/:id` (update) and `DELETE departments/:id` (delete,
  409 when staff assigned); all audited
  (`DEPARTMENT_CREATED/UPDATED/DELETED`) with per-action authorize
  (create/update/delete). No migration: `code` stays NOT NULL in storage.
- Specs rewritten in `afhomes.spec.ts` (create/409/denial/rename/404/rename-
  denial/delete/409/delete-denial + audit-write-500 body fix). Grants
  untouched: Admin holds create/update per baseline; delete is Super Admin
  (same as roles pattern). Test fixture admin lacks `can_delete` on
  departments, so DELETE specs use `TOKEN.superAdmin`.

## Earlier uncommitted work (still in tree)

- Customer-record SSOT alignment (62-col registry, migration
  `20261204000001_afhomes_customer_ssot_alignment.sql`, import/handler/admin
  updates, db-integration §74 with 30 checks). Full detail in prior handoff;
  condensed here to keep this file dense.
- Interim 52-col guided template SUPERSEDED by 62-col SSOT — do not reintroduce.
- Register save fix + application detail redesign (workflow panel, buttons,
  LocationProbe pattern) still stand.
- User items preserved: OfficialForms CSS + spec, hint-line formatting,
  `phase2.spec.ts` FK-blocker rows, untracked `20261203000001` migration,
  `docs/testing/`.

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
- Query-key scopes: every scope must be a prefix of the keys it clears (pinned
  in `queryKeys.spec.ts`); detail keys sit outside list scope by design.
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
- README value rows derive from the registry; CSV stays band+headers only.
- Lookup carries `customerId` but never a Membership Code (type-enforced).
- Departments: Code hidden from UI, server-derived immutable slug; no DROP
  COLUMN without approved migration. Admin delete-grant question left open.
- Reservation `from/to` keys are positional `(status,tier,search,from,to,
  workOnly,page)`; `today()` is browser-zone.

## Blocked / needs user action

- `pnpm db:migrate` — needs explicit approval. Queue: `20261131000001/0002/`
  `0003` (carried; Customer Lookup breaks until `…0003` applied + deployed),
  user's `20261203000001_remove_test_customer`, mine `20261204000001`. Then
  `rls_invariants.sql` (empty = PASS). Nothing this session applied anywhere.
- Dev API restart / redeploy for handler + template + lookup + departments
  changes.
- `docs/testing/membership-template.xlsx` is now THREE layouts old —
  re-download the guided template (now with README values) and refill.
- Open: Admin `organization.departments` delete grant (Super Admin only
  today); single MOBILE NO. slot (after TIN); two identical
  "Create Reservation" buttons — user may want one removed.

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
  `StatedPackage` object; stated money-schema question; reservation proposal
  double-key; application picker still pages 200 instead of lookup search.

## Verify (from root)

```sh
pnpm --filter ./api exec vitest run --maxWorkers=2          # 117 files / 2262 tests
pnpm --filter ./packages/contracts exec vitest run          # 20 files / 259 tests
pnpm --filter ./apps/admin exec vitest run src/features/afhomes --maxWorkers=2  # 7 / 59
pnpm typecheck                                              # turbo 7 + tsc -p supabase
pnpm check:env
pnpm lint                                                   # 0 errors
pnpm test:db:local                                          # 2525 checks incl. §74
pnpm test:db:harness                                        # 13/13
```

Last verified: ALL green — api 2262 (117 files); admin afhomes 59,
queryKeys 6, lookup 25, reservation-detail 22, OfficialForms 34,
application-actions 20, finance-queue 11; `tsc` clean (admin/api/
contracts); `lint` 0 errors. Full admin suite (82 files) not re-run this
session — run before release. Evidence: audit-500 body (strict schema
rejects extra `code`), fixture admin lacks departments `can_delete`
(specs use superAdmin), parallel admin suites exhaust workers (reran
sequentially).
