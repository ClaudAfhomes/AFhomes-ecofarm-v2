# SESSION.md — Chat Handoff Context

> **Protocol:** This file holds the latest handoff only. When the user says
> `handoff context to @SESSION.md`, REPLACE this entire file with the new
> session's context (do not append; delete stale sections). Keep it dense:
> decisions, patterns, open threads, and verification state. No prose essays.

## Stack (unchanging)

pnpm + Turborepo. `apps/web` (:5173; marketing + `/customer/**` + `/ost/**`) |
`apps/admin` (:5174, `/admin/`) | single Vercel Function `api/router.ts` →
`api/_lib/router.ts` (`BUSINESS_FAMILIES`) → `api/_handlers/**` → Supabase
Postgres + Auth. `packages/contracts` (Zod SSOT; `lifecycle.ts` statuses;
`afhomes.ts` module catalog; `customer-ssot.ts` 62-col registry;
`member.ts` sales-network Members) | `packages/shared` (BigInt money) |
`packages/config` (`VITE_`-only) | `packages/ui` (tokens + primitives).
`SESSION.md`, `docs/security/`, `docs/testing/` are user items — do not touch.
`docs/supabase/CURRENT-SCHEMA.sql` refreshes BY AGENT only on explicit
"update schema" trigger.

## Standing user preferences (apply without asking)

- `@ponytail` active (full): smallest complete change, house components first,
  no new deps, finish callers/tests/fixtures. End replies with skipped + risk.
- UI rounds are UI-only: no handler/contract/SQL/history edits, no new deps;
  preserve every flow and permission; inspect before implementing; desktop/
  tablet/mobile; gate on focused vitest + `tsc` + `eslint` + admin build; end
  with a short report. ONE named surface at a time — wait for the next.
- User-facing copy: every sentence max 5–6 words. Surface rules the user states
  win (e.g. `/admin/ost/members/:id`: sentences ≤5 words, every input label
  ≤3 words, NO em dashes, NO notes under inputs). Detail areas user names:
  ALL links become `ui` Buttons with ≤2-word labels via router.
- The user pinpoints UI by devtools class name (`description_1t2i4_51` =
  PageHeader `.description`).
- Membership template: ONE download per format. `template/xlsx` = GUIDED
  workbook (README + sections, split name/address, DROPDOWNS). `template/csv`
  = band + headers (CSV cannot carry dropdowns — state plainly). Legacy
  44/45-col uploads still parse. Never split FULL NAME by code.
- Dropdown values only from form pick-lists + validator vocabularies. Never
  invent values. Subsets allowed (Member sex Male/Female; civil status
  Single/Married/Widowed/Separated).
- The admin app speaks PAGES, not internals. Role access = one "Can access"
  per page; staff overrides = one "Deny access" per page. No bulk "View all".
- Grouped modules are dropdowns; Dashboard flat; multi-module groups
  pre-expand on existing grants.
- Application drafts hand-entry only (no file import on `.../new`).
- Guards ship failing-first; flakes: jsdom timing + zip-bomb timeout under
  parallel load → `--maxWorkers=2`; never adjust assertions to force a pass.
  Never two admin suites in parallel in one workspace.
- Prettier NOT a gate (CRLF artifact). Gate on `tsc` + `eslint`. Never
  `--write` pre-existing formatting; on user-WIP files diff vs
  `prettier <file> | tr -d '\r'`, touch own hunks only.
- User edits in parallel — and commits mid-session. Re-check `git status`/
  `git log` before assuming state; re-read shared files before editing; leave
  foreign diffs alone; never restore what the user deliberately removed — flag it.
- Version control: never stage/commit/push/branch/tag/stash/reset or GitHub
  actions unless explicitly commanded in-session. Working-tree edits are work.
- Passwords/TIN/gov-IDs never returned, never in audits (masked reads only).
- No `select('*')` on wide rows; filter in SQL; Free-quota rules per
  `docs/supabase/SUPABASE-FREE.md`.

## Repo state

- `orly/develop` @ `a3cd8c6 "fixes: Package and Payment (company stated)"` —
  working tree has UNCOMMITTED changes (large, multi-area):
  - Modified (27 files): api (`customers.ts`, `queues.ts`, `sale-team.ts`,
    `list-search.ts`, specs), admin (BusinessActivationQueuePage, BusinessCustomersPage,
    CustomerDetailPage, PurchasePaymentsPage, official-forms-reservations, services,
    queryKeys, specs), web (SaleTeamSearch, Navbar), docs/CURRENT-SCHEMA.sql,
    contracts/sale-team.ts, supabase/db-integration.ts.
  - New untracked: `supabase/migrations/20261210000006_…_company_status_filter.sql`,
    `20261211000001_…_performance_indexes.sql`, `20261211000002_…_sale_team_photo.sql`.
  - User WIP (leave alone): `.taste-skill/after/index.html`,
    `.taste-skill/masthead-harness.mjs`.
- Migrations through `20261210000005` recorded committed; the three new
  migrations (`000006`, `20261211000001`, `20261211000002`) are UNAPPLIED
  to production (approval-gated) and not verified on the disposable DB this session.
- Pre-existing failures (documented, not from this session): lint 2 errors in
  `MemberWorkbookDialog.spec.tsx:154` (`_approved`, `_pw` unused); DB section 77
  OST team transfer (`"the fresh IST validity starts today": expected <today>,
  got null`). Do not touch.
- Gates this session: `pnpm typecheck` clean (7/7); `pnpm lint` 0 errors
  (admin 24 warnings, web 8 warnings, pre-existing); focused admin specs 42/42;
  focused api specs 19/19. `pnpm test:db:local` NOT re-run this session (new
  migrations unverified).

## Last session's work (UNCOMMITTED) — loading-speed + company-stated + UX polish

Theme: make Finance/Customer screens fast and push work to the DB; align the
customer directory's "Payment Status" with the company-stated `company_status`;
add seller profile photos to the public sale-team verification card.

1. `api/_lib/list-search.ts` — new `readBoundedRows()` (windowed read with
   exact count) alongside `readSearchRows()`.
2. `api/_handlers/queues.ts` — Finance queue now pushes search to PostgREST,
   bounds non-search reads to `limit+offset` instead of loading the whole
   population, batches reservation payments + sellers (no N+1), orders by the
   merge key. Activation queue supports `search`.
3. `api/_handlers/customers.ts` — `companyStatus` filter param forwarded to
   `customer_directory`.
4. `supabase/migrations/20261210000006_…_company_status_filter.sql` —
   `customer_directory()` gains `p_filters->>'companyStatus'` predicate on
   `company_status`.
5. `supabase/migrations/20261211000001_…_performance_indexes.sql` — trigram +
   join indexes for customer directory and finance queue (pg_trgm).
6. `supabase/migrations/20261211000002_…_sale_team_photo.sql` —
   `get_sale_team_accreditation` / `resolve_sale_team_accreditation_number`
   expose `staffId`; handler mints a 5-min signed URL from
   `afhomes-profile-photos` and strips `staffId` before response.
7. `packages/contracts/src/schemas/sale-team.ts` — `photoUrl` field.
8. `apps/admin/…/BusinessCustomersPage.tsx` — Payment filter replaced with
   company-status filter (Cancelled/Fully Paid/Partial/Installment/RF only/
   Refunded); VIP Tier filter; Payment Status column now shows `companyStatus`
   (or "Not Recorded"); VIP Tier falls back to `statedVipPackage`.
9. `apps/admin/…/BusinessActivationQueuePage.tsx` — search + eligibility chips,
   redesigned Activate dialog (progress bar, balance, validity-locked badge).
10. `apps/admin/…/PurchasePaymentsPage.tsx` — clickable rows open a detail
    Dialog instead of one panel per row.
11. `apps/admin/…/CustomerDetailPage.tsx` — VIP tier falls back to stated
    package; payment history lazy-loaded behind collapsed `<details>`.
12. `apps/admin/…/official-forms-reservations.tsx` — lazy sales/plans/
    applications queries gated on mode; loading/busy states on buttons.
13. `apps/web/…/SaleTeamSearch.tsx` — redesigned verification card with photo
    avatar; `Navbar.tsx` dark-top for `/sale-team-search`.
14. `apps/admin/…/queryKeys.ts` — `activationQueue` now takes a search string
    (breaking-ish: callers updated; spec updated).
15. Tests: `BusinessCustomersPage.spec.tsx`, `CustomerDetailPage.spec.tsx`,
    `queryKeys.spec.ts`, `customer-list-filters.spec.ts`, `sale-team.spec.ts`.

Gates run this session: `tsc` clean; `eslint` 0 errors; focused admin 42/42;
focused api 19/19; `pnpm check:env` not re-run (no env-touching changes);
`pnpm build` not run this session; `pnpm test:db:local` not run.

## Test gotchas (admin)

- `(Optional)` marker renders WITHOUT a space → query `'AA Number(Optional)'`.
- SweetAlert sets `aria-hidden` on the rest of the page while open — `ByRole`
  queries fail; `Swal.close()` first, or assert with `ByText`.
- Admin specs: no per-test mock reset — `vi.fn()` implementations persist;
  seed per test. `ost.spec.tsx` clears calls (`afterEach(vi.clearAllMocks)`)
  but that keeps implementations.
- ost fixtures: `getAccreditation` defaults to `terms: []` (renewal form and
  applicant dialog never co-render in specs); `management` mocked false for
  most users.
- Load flakes: re-run a flaked suite solo before believing it; root `pnpm test`
  pins `--maxWorkers=2`. `src/app/staff-lifecycle.spec.tsx` flaked once under
  parallel load → 14/14 solo.
- Prettier check on a copy: keep the extension, use the repo `.prettierrc.json`
  via `--config`, add `--end-of-line auto`. Known pre-existing deviations:
  `OstAccreditationPages.tsx` (~5), `OstApplicantUpdate.tsx` (~2), `App.tsx` (1,
  `/admin/network/members` route). This round added ZERO — don't "fix" those.
- A native `<select>` with no matching option defaults to the first option; use
  an explicit empty placeholder option when a null stored value should read
  "Not Recorded" (see `CustomerCompanyEditDialog`).
- PostgREST `count: 'exact'` is only returned when the query is built with
  `{ count: 'exact' }`; `readBoundedRows` reads it per chunk — keep that option
  on any query that relies on the total.

## Open threads / unanswered offers

- Browser visual pass of the redesigned OST page + the new dialogs (desktop/
  tablet/mobile) — NOT done (no browser tooling); responsive verified by code
  only.
- Offered, unanswered: rename `TransferMemberDialog` submit "Convert to OST"
  (line 202; dialog title "Convert X to OST"); shorten shared
  `OstOfficialFields` repo-wide, or add a compact flag; extend the copy/layout
  treatment to the other two pages in the same file —
  `OstManualRegistrationPage` (`/admin/ost/applications/new`) and
  `OstImportExportPage` (`/admin/ost/applications/import-export`); shared
  `OstAddressFields` "ZIP / postal code (Optional)" is 4 words (public web
  registration uses it); repo-wide `—` placeholder convention in
  `@afhomes/shared` format helpers.
- Carried-forward (verify before acting): UUID once seen in Members view (user
  must name the cell/screenshot); departments delete grant (Super Admin only);
  single MOBILE slot; duplicate Create Reservation buttons; Q1–Q7; RA/STATUS
  sets; stated-figure semantics; reservation picker paging; re-download
  `docs/testing/membership-template.xlsx`; AA numbering shapes (AUTO
  `AA-XXXXXXXXXXXX` vs MANUAL `^AA[A-Z0-9]{4,12}$` — unify or keep; 1-yr
  auto-validity unconfirmed); live authenticated check of the OST team transfer
  (migration-11 log: local pilot only, persistence unverified).
- Production apply of `20261210000005` (backfill) + the three new migrations
  (`000006`, `20261211000001`, `20261211000002`) — approval-gated, not run.
- `pnpm test:db:local` + `pnpm test:db:harness` not re-run this session; run
  before relying on the new migrations.
- Pre-existing DB section 77 failure still blocks `test:db:harness`.

## Verify (from root)

```sh
pnpm test                     # canonical gate (turbo --concurrency=2 -- --maxWorkers=2)
pnpm typecheck                # turbo 7 + tsc -p supabase  (clean this session)
pnpm lint                     # 2 pre-existing errors in MemberWorkbookDialog.spec.tsx
pnpm check:env
pnpm test:db:local            # not re-run this session; 2666/2667 expected (pre-existing section 77)
pnpm test:db:harness          # blocked by the pre-existing section 77 failure
```

Focused (green this session):

```sh
pnpm --filter @afhomes/admin exec vitest run src/features/business/BusinessCustomersPage.spec.tsx  # pass
pnpm --filter @afhomes/admin exec vitest run src/features/business/CustomerDetailPage.spec.tsx      # pass
pnpm --filter @afhomes/admin exec vitest run src/features/business/queryKeys.spec.ts                 # pass
pnpm --filter api exec vitest run _handlers/customer-list-filters.spec.ts _handlers/sale-team.spec.ts # 19
```