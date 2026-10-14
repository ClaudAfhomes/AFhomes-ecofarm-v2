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
(`VITE_`-only) | `packages/ui` (tokens + primitives). Branch `orly/develop`; ALL
session work UNCOMMITTED. `SESSION.md` + `docs/security/` churn and
`docs/supabase/CURRENT-SCHEMA.sql` (untracked) are pre-existing user items — do
not touch.

## Standing user preferences (apply without asking)

- Membership template: exactly ONE download per format. `template/xlsx` =
  README + 4 data tabs; `template/csv` = section band row + headers (one file,
  no zip). No duplicate/parallel template buttons. Company columns are 44
  verbatim headers (IST/OST removed); legacy 45-column uploads still accepted.
- Verbatim company header text/order/duplicates preserved. Never invent
  business semantics (no name-splitting, no value translation, no hierarchy
  inference).
- User-facing copy: every sentence max 5–6 words.
- Admin console speaks PAGES, not internals: human-readable module names only
  (never raw keys, never role slugs, no View/Create/Update/Delete jargon). Role
  access = one "Can access" checkbox per page; staff overrides = one
  "Deny access" per page. No bulk "View all" control anywhere.
- Grouped modules are dropdowns; a single-module group (Dashboard) is a flat
  row; a multi-module group opens pre-expanded when the role/staff already
  holds a grant in it.
- Application drafts are hand-entry only (`/admin/customers/applications/new`
  has no file import; bulk entry lives in the Import/Export workspace).
- Guards ship with failing-first evidence; flakes: jsdom timing + zip-bomb
  timeout under parallel load → `--maxWorkers=2`; never adjust assertions to
  force a pass.
- Prettier is NOT a gate in this checkout: `--check` warns on unmodified files
  too (CRLF checkout artifact). Gate on `tsc` + `eslint`. Never `--write`
  pre-existing formatting.

## This session's work (UNCOMMITTED)

### A. Membership template → 44 columns, sectioned XLSX, band-row CSV

- `packages/contracts/.../customer-import.ts`: `MEMBERSHIP_TEMPLATE_COLUMNS` =
  44 verbatim headers, duplicates kept (ADDRESS ×2, EMAIL ADDRESS ×3, AGE ×2,
  FULL NAME ×2).
- `api/_lib/customer-import.ts`: `MEMBERSHIP_TEMPLATE_SECTIONS` (Primary 0–15,
  Supplementary 15–28, Related 28–35 = SVD/SSM/SM/REFERRER/VIP RECOMMENDER/
  CONTACT NO./EMAIL ADDRESS, Package 35–44), guide sheets skipped
  (`readme|instructions|guide|example(s)`), `membershipTemplateSectionedXlsx`
  (tinted headers, tab colors, zebra, 20 blank rows), `membershipTemplateCsv`
  (band row + 44 headers), `looksLikeSectionBandRow` (strips band on upload,
  ≥15 cells must match), `isCompanyMembershipTemplate` (exact positional 44);
  legacy 45-column layout still parsed; foreign multi-sheet stays rejected.
- Served by `api/_handlers/customer-imports.ts` (`membership-template.xlsx` /
  `.csv`). Specs: `membership-template.spec.ts`, `customer-import*.spec.ts`.

### B. Applications/new rework + referral chain (migrations 000001/2)

- `/admin/customers/applications/new`: ONE `Save & Submit` (no separate Submit;
  submit-schema check + single-flight inside), `New Register` register option,
  Valid ID upload-only (FileField + "Uploaded ✓ / Required / Missing" chip),
  dropdowns for suffix/sex/citizenship/civil status, auto postal code (PSGC),
  TIN/phone validation (`input.ts`, `HumanInput.tsx`, `normalize.ts`).
- Chain selects in `official-forms-fields.tsx` (`chainOptions`): SVD
  (vice_director), SSM (senior_sales_manager), SM (sales_manager), Referrer
  (ost); active staff only, downline-scoped by chosen upline, gaps allowed,
  cycles stopped, lapsed-accreditation OSTs excluded.
- `20261131000001`: adds `customer_applications.svd_name|ssm_name` + re-delivers
  `save_customer_application`.
- `20261131000002`: 4 nullable staff refs; server resolves ids to ACTIVE staff
  of the exact level role, refuses chains contradicting
  `referral_relationships` (gaps OK), snapshots `*_name` from
  `staff_users.full_name` when an id is given (client text ignored), legacy
  text passthrough otherwise. No commission/money semantics.
- Specs: `official-forms-chain.spec.ts` (admin),
  `application-referral-chain-migration.spec.ts` (api, asserts re-delivery does
  not broaden grants), `supabase/db-integration.ts` chain section (gaps kept,
  legacy text stored, disagreement/wrong-role/malformed-id refused, cleanup).

### C. Module catalog + Customer Lookup module (migration 000003)

- `packages/contracts/.../afhomes.ts`: `MODULE_CATALOG` (32 modules, 8 groups:
  Dashboard, Organization, Sales & Customers, Finance, Network, Operations,
  Governance, Website), `moduleLabel()`, `groupedModuleCatalog()` — the ONLY
  place labels/groups live; mirrors the `public.modules` seed.
- New module `operations.customer_lookup` ("Customer Lookup"). The screen was
  authorized by `operations.redemption` before (a till key), so the Roles
  listing could not show it.
- `20261131000003`: upserts the module row + view grants (employee keeps till,
  gains lookup; admin oversight; nothing else changes). Mirrored in
  `MIGRATION_SEEDED_GRANTS` (`role-baseline.ts`).
- `api/_handlers/memberships.ts` customer-lookup authorizes the new key; nav
  entry + `EXTRA_GATED_ROUTES` use it; the employee-only nav special case is
  gone — `navItemsForPermissions(permissions)` (roleSlug param deleted).
- Tripwires: `afhomes-modules.spec.ts` (contracts: every key once, unique
  labels/order, unknown key falls back to the raw key), `module-coverage.spec.ts`
  (admin: every nav item + dropdown child + `EXTRA_GATED_ROUTES` path is a
  catalog module; destinations unique).

### D. Roles / Staff console simplification (final ask)

- `/admin/roles`: metric cards, search + type/status filters, chips + permission
  meter; NO slug under the role name; role link has no underline (hover shifts
  color).
- Role detail: hero = name + description only (no slug); Role card has no "Key"
  row; Permissions = accessible pages as grouped chips ("N of 32 pages
  accessible"; super_admin: "All pages - granted by slug, not by row.");
  `permissionGroups` memo deleted.
- `AfHomesRoleFormDialog.tsx`: ONE checkbox per page,
  `aria-label="<Page> access"`; group dropdowns with chevron + granted/total
  pill; "Page access — N of 32 pages accessible"; no bulk control; a page that
  keeps action rights shows a "Full" chip
  (`title="This role also keeps its action rights here."`).
- `AfHomesStaffPage.tsx` Restrict dialog: ONE "Deny access" per page
  (`aria-label="<Page> deny access"`), same list; deny-only Alert kept.
- Semantics (load-bearing): the four flags still exist and are server-enforced.
  Role dialog toggles canView only; CHECKING preserves stored
  canCreate/canUpdate/canDelete (an edit can never silently escalate);
  UNCHECKING clears all four (DB requires action ⇒ view). Staff dialog:
  checking sets denyView (server resolves it as no access at all); unchecking
  clears all four deny flags; an existing finer deny reads as checked and
  clears the same way.
- Specs: `role-access-review.spec.tsx` (10: labels, dropdowns, no bulk control,
  keep-and-clear flags), `staff-lifecycle.spec.tsx` (restrict dropdowns),
  `navigation.spec.ts` + `authorization.regression.spec.tsx` (single-arg calls).

### E. Company-column surfacing (carried from the previous handoff)

- Contracts `sales.ts`: 9 `stated_*` on create/update; handler `customers.ts`
  persists them, read masks TIN; `audit-sanitize.ts` redacts `tin|tax_id`.
- UI: `CustomerCompanyEditDialog.tsx` (37 verbatim fields, TIN blank-keeps) via
  Edit on `CustomerDetailPage` (`sales.customers:update` only); linked-record
  panel on the application editor; lookups/redemption/portal stay PII-free.

### F. Import/Export workspace + editor file-import removal (carried)

- Route `/admin/customers/applications/import-export` (gated by
  `governance.customer_import`); old URL deleted; Applications list has the
  gated `Import/Export Data` action; copy trimmed, Excel + CSV pickers side by
  side.
- The application editor has NO file import: the company-template mapping path
  and its spec are removed; the form-template + reservation IST path is
  untouched.

## Decisions (do not re-litigate)

- Module labels/groups live in contracts, mirroring the DB seed; the DB stays
  the authorization authority; UI never shows raw keys.
- Access is presented per PAGE; the 4 action flags are internal but never
  silently rewritten by an edit (preserve on check, clear on uncheck).
- No bulk "View all": a click must never grant a module the operator did not
  see (removed from both dialogs).
- Customer Lookup owns its module instead of borrowing a till key.
- Single-module groups are flat rows; multi-module groups are disclosures.

## Blocked / needs user action

- `pnpm db:migrate` for `20261131000001` / `…0002` / `…0003` — needs explicit
  approval. Until `…0003` is applied AND deployed, Customer Lookup breaks
  (handler authorizes a key the DB does not know yet).
- Dev API restart / redeploy to see handler + template changes.
- After that batch: run `supabase/security/rls_invariants.sql` (empty = PASS)
  and `pnpm test:db:local`.

## Carried open threads (older sessions, still unanswered)

- Q1 model authority, Q2 cutover scope, Q3 gate/product, Q4 missing 12 files,
  Q5 Master List, Q6 C2 authority, Q7 VIP DSC figure (exhaustively searched —
  absent).
- FULL NAME split rule (fail safe until decided); RA/STATUS value sets, RF,
  price/discount/total semantics, package/terms vocabularies verbatim
  uninterpreted; related names carry no hierarchy semantics.
- Tech debt: `toXlsxMulti` float mirrors pre-existing `toXlsx`;
  `CustomerCompanyEditDialog` reuses the detail CSS module; dialog
  normalization via `normalize.ts`; `updateCustomer` duplication (`services.ts`
  vs `services-customers.ts`); `StatedPackage` object; stated money-schema
  question.

## Verify (from root)

```sh
pnpm --filter ./apps/admin exec vitest run --maxWorkers=2   # 80 files / 801 tests
pnpm --filter ./packages/contracts exec vitest run          # 244
pnpm --filter ./api exec vitest run                         # 113 files / 2173
pnpm --filter ./api exec tsc --noEmit && pnpm --filter ./packages/contracts exec tsc --noEmit
pnpm --filter ./apps/admin exec tsc --noEmit && pnpm check:env
pnpm lint                                                   # 0 errors (web 8 warn, admin 21 warn — pre-existing)
pnpm test:db:local                                          # boots its own disposable PG
```

Last verified (final pass, AFTER the last UI edit): admin 801/801, contracts
244/244, api 2173/2173, tsc clean (admin/contracts/api), `check:env` PASS,
`lint` 0 errors, `test:db:local` 2490/2490. `pnpm test:db:harness` and
`rls_invariants.sql` were NOT re-run for the last batch (no RLS surface change)
— re-run if RLS/grants are touched.
