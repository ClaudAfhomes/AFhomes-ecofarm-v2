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
the module catalog) | `packages/shared` (BigInt money) | `packages/config`
(`VITE_`-only) | `packages/ui` (tokens + primitives). Branch `orly/develop` @
`62b0bfc`, 26 commits ahead of `origin/orly/develop`. `SESSION.md`,
`docs/security/`, `docs/supabase/CURRENT-SCHEMA.sql` churn and untracked
`docs/testing/` are user items — do not touch.

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

## This session's work (UNCOMMITTED)

### A. Membership template v2 — the guided workbook (largest change)

- `api/_lib/customer-import.ts`: `MEMBERSHIP_TEMPLATE_V2_SECTIONS` — Primary =
  FIRST NAME, MIDDLE NAME, LAST NAME, SUFFIX, BIRTHDAY, AGE(ref), GENDER,
  CITIZENSHIP, CIVIL STATUS, TIN NO., MOBILE NO., EMAIL ADDRESS, ADDRESS
  LINE 1, CITY / MUNICIPALITY, PROVINCE, OCCUPATION / BUSINESS NAME, OFFICE /
  BUSINESS ADDRESS, EMPLOYED POSITION, RA NO, STATUS. Supplementary =
  SUPPLEMENTARY FIRST/MIDDLE/LAST NAME and ADDRESS LINE 1/2 (parts JOIN into
  the single `supplementary_full_name` / `supplementary_address` columns),
  then BIRTHDAY, AGE(ref), GENDER, CITIZENSHIP, CIVIL STATUS, TIN NO., MOBILE
  NO., EMAIL ADDRESS, OCCUPATION / BUSINESS NAME, OFFICE / BUSINESS ADDRESS,
  EMPLOYED POSITION. Related + Package identical to legacy. Vocabularies:
  `TEMPLATE_STATUS_OPTIONS` (round-trips `mapSourceStatus`, asserted),
  `TEMPLATE_TIER_OPTIONS`, `TEMPLATE_PAYMENT_METHOD_OPTIONS`.
- `membershipTemplateV2SectionedXlsx()` / `membershipTemplateV2Csv()` are what
  the endpoints serve; the legacy builders (`membershipTemplateSectionedXlsx`,
  `membershipTemplateCsv`, `membershipTemplateXlsx`) stay as fixtures proving
  already-filled old downloads still parse.
- Dropdowns: `XlsxColumn.validation` (`api/_lib/report-export.ts`) emits
  `<dataValidations>` AFTER `<autoFilter>` — XSD order sheetData → autoFilter →
  dataValidations is load-bearing. Guards fail loud: values may not contain
  commas/quotes; inline list ≤250 chars.
- Multi-sheet routing: `workbookLooksV2()` — ANY v2-ONLY header (FIRST NAME,
  ADDRESS LINE 1, CITY / MUNICIPALITY, PROVINCE…) picks the GUIDED merge. Do
  NOT route by "headers ⊆ v2 vocabulary": Related and Package tabs are
  IDENTICAL in both layouts.
- Guided flat path: `isV2MembershipTemplate` (exact positional, order-sensitive
  — duplicates forbid name matching) → `remapV2TemplateMatrix` (positional;
  part columns fold per row, keys = join keys; AGE lands in `dropped` → per-row
  warning "Reference-only column was ignored"). Joins overlay AFTER
  `matrixToRecords` (keyed by rowNumber), so a part column can never collide
  with an import key. Both remaps parse with `COMPANY_IMPORT_EXTRA_COLUMNS`.
- Merge rules (both layouts): all-blank tabs PAD (member with no supplementary
  imports); tabs that both carry rows must match counts (error names each
  sheet); guide sheets (`readme|instructions|guide|example(s)`) skipped; the
  handler surfaces the merge's own message (names the exact tab) instead of the
  generic single-worksheet hint.
- Specs: `membership-template.spec.ts` (v2 endpoint shape, dropdown XML read
  from raw bytes — ZIP entries are STORED/uncompressed, guided + legacy
  round-trips through `/parse`), `customer-import.spec.ts` (v2 merge/remap,
  exact-flat detection, band rows BOTH layouts), `customer-imports.spec.ts`.
- Admin copy: XLSX card "Four tabs guide entry. Dropdowns included." CSV card
  "One file. No dropdowns."

### B. New Register save bug (`official-forms-applications.tsx`)

- Root cause: `saveAndSubmit` parsed the payload with
  `createCustomerApplicationSchema` (REQUIRES customerId) BEFORE the
  `!id && !customerId` register branch, so New Register always died with
  "Select a customer for this application." and `registerCustomerApplication`
  was never called.
- Fix: the register branch validates ONLY with
  `registerCustomerApplicationSchema` (`registerNewCustomer: true`, no
  customerId); the create contract guards only paths that carry a customerId.
  Consent check kept in both.
- Evidence: `OfficialFormsPages.spec.tsx` full-walk regression ("registers a
  new customer on Save & Submit when New Register is selected") — proven RED
  against pre-fix code via `git stash push -- <file>`, green after. The user
  later refined it (pointerdown option commits, schema-parsed
  `purchaseTermsProposalSchema` mock) — keep their refinements.

### C. Application detail redesign (four areas user named)

- Purchase workflow, Next step, Linked company record — read-only, Newly
  confirmed offer (on `/admin/customers/applications/:id`).
- ALL links → `ui` Buttons navigating via `useNavigate`, ≤2-word labels:
  Create Reservation, Continue Activation, Continue Payment, Open Reservation,
  Open Commissions, Open Customer; Record-actions Next step link → Create
  Reservation button.
- `PurchaseWorkflowPanel`: `styles.panel` + checklist `.workflowSteps` with
  `data-state=done|current|pending` marks (✓/→/○; success/brand/muted). Step
  labels shortened (Reservation created, Commission). Next step in
  `.workflowNext` (divider) with a button + ≤6-word hint; destinationless next
  steps render as `.note` text, no control.
- Linked record + offer sections: `dl` moved off the undefined `form-grid` to
  `snapshotGrid`/`snapshotField` (matches the user's status card).
- Copy ≤6 words/sentence ("This record predates stored evidence. Confirming
  adds your name, time and reason. Figures are not historical terms.";
  "7 days from first payment").
- Specs: `application-actions.spec.tsx` — navigation proven by CLICKING buttons
  against a `LocationProbe` route (`aria-label="route"`, prints
  pathname+search); href assertions removed; step-label assertions updated;
  queries scoped with `within(panel)` because Record actions and the workflow
  panel can BOTH show "Create Reservation".

### D. Parallel user WIP in the same files (do not clobber)

- `official-forms-applications.tsx`: status card (`statusHead`,
  `snapshotGrid`), record-actions grouping (`recordGroups`, `actionGroup`,
  `actionGroupTitle`), `focusApplicationForm`; two prettier-dirty hint lines
  (Decision / Cancel) are THEIR formatting — leave.
- `OfficialFormsPages.module.css`: user's status/record CSS + this session's
  appended `.workflowSteps/.workflowStep/.workflowMark/.workflowNext`.
- `OfficialFormsPages.spec.tsx`: user refined the register test.
- `docs/supabase/CURRENT-SCHEMA.sql` (large deletion churn) and untracked
  `docs/testing/` are user items.

## Committed earlier this session (context only)

Applications wizard (6 steps, Back/Next, Save & Submit in header + footer),
red Cancel beside Take a photo (`IdCapturePicker.showCancel/onCancel`),
postal-code UX + the Combobox reopen-on-click fix, plan-benefits artwork,
Recommender stepper badge fix (only entered chain/contact details mark done),
roles/staff console batch, Total Sales naming — user-committed (`cceefd9`,
`5892bcb`, `6c59098`, merge `62b0bfc`). The `@afhomes/contracts` Vite import
error was a stale node_modules workspace link — fixed by `pnpm install`, no
code change.

## Test patterns worth reusing

- Navigation assertions: render a catch-all route with a `LocationProbe`
  (`aria-label="route"`, pathname+search); click the button; `waitFor` the
  probe's text. Stronger than href checks and survives link→button changes.
- XLSX internals (dropdowns, XML order) assert on RAW BYTES: entries are stored
  uncompressed, so `<dataValidation …>` and list values are readable directly.
- Hoisted `vi.mock` factories cannot reference module constants — inline the
  fixtures (address hierarchy mock) or use `vi.hoisted`.
- Combobox options commit on pointerdown (fires before blur can revert the
  draft) — specs use `fireEvent.pointerDown(option)`.
- For shared files with user WIP: `prettier <file> | tr -d '\r'` vs
  `tr -d '\r' < <file>` diff shows only real formatting deltas; only touch
  your own hunks.

## Decisions (do not re-litigate)

- Guided template targets = existing import keys; no second pipeline.
- V2 workbook routing by v2-ONLY headers (Related/Package are shared).
- Supplementary name/address JOIN operator-entered parts into the single
  stored text columns — never derived from FULL NAME.
- AGE is reference-only (warned, never merged) in both layouts.
- CSV carries no dropdowns — a format limit, stated in the UI.
- New Register owns the register contract; the create contract owns the rest.
- Detail-area links are buttons; destinationless next steps are plain text.
- Module labels/groups live in contracts, mirroring the DB seed; the DB stays
  the authorization authority; UI never shows raw keys.
- Access is presented per PAGE; the 4 action flags are internal but never
  silently rewritten by an edit (preserve on check, clear on uncheck).
- Customer Lookup owns its module instead of borrowing a till key.

## Blocked / needs user action

- `docs/testing/membership-template.xlsx` (user's file, old company layout)
  fails on required names, STATUS `Paid`, birthday serial `37880`, related
  email typo. Re-download the NEW guided template and refill (dropdowns + split
  names). Old-layout files still parse; the required-name rule is unchanged.
- Dev API restart / redeploy to see handler + template changes.
- `pnpm db:migrate` for `20261131000001/0002/0003` (carried) — needs explicit
  approval; until `…0003` is applied AND deployed, Customer Lookup breaks
  (handler authorizes a key the DB may not know). Verify applied state first;
  then run `supabase/security/rls_invariants.sql` (empty = PASS) and
  `pnpm test:db:local`.
- Two identical "Create Reservation" buttons (workflow panel + Record actions
  → Next step) — user may want one removed or relabeled.

## Carried open threads (older sessions, still unanswered)

- Q1 model authority, Q2 cutover scope, Q3 gate/product, Q4 missing 12 files,
  Q5 Master List, Q6 C2 authority, Q7 VIP DSC figure (exhaustively searched —
  absent).
- FULL NAME split: RESOLVED for downloads (explicit operator-entered columns;
  code never splits). RA/STATUS value sets, RF, price/discount/total
  semantics, package/terms vocabularies stay verbatim, uninterpreted; related
  names carry no hierarchy semantics.
- Tech debt: `toXlsxMulti` float/date handling mirrors pre-existing `toXlsx`
  (validation lists added this session); `CustomerCompanyEditDialog` reuses the
  detail CSS module; dialog normalization via `normalize.ts`; `updateCustomer`
  duplication (`services.ts` vs `services-customers.ts`); `StatedPackage`
  object; stated money-schema question.

## Verify (from root)

```sh
pnpm --filter ./apps/admin exec vitest run --maxWorkers=2   # 82 files / 806 tests
pnpm --filter ./packages/contracts exec vitest run          # 251
pnpm --filter ./api exec vitest run                         # 115 files / 2225
pnpm --filter ./packages/ui exec vitest run                 # 215
pnpm typecheck                                              # turbo 7 + tsc -p supabase
pnpm check:env
pnpm lint                                                   # 0 errors (admin 23 / web 8 warn, pre-existing)
pnpm test:db:local                                          # boots its own disposable PG
```

Last verified (after the FINAL detail-page edit): admin 806/806, api 2225/2225,
contracts 251/251, ui 215/215; `tsc` clean everywhere incl. the supabase half
(admin re-verified after the last edit; api/contracts untouched since theirs);
`check:env` PASS (no env-touching change after it); `lint` 0 errors (warnings
pre-existing class). Evidence: register regression RED without the fix
(stash) / green with it; guided-template dropdowns asserted at byte level.
NOT re-run this session (no SQL/RLS surface change): `test:db:local`,
`test:db:harness`, `rls_invariants.sql` — re-run if migrations/grants are
touched.
