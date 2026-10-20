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

- `orly/develop` @ `c761210 "chore: track workflow pack (graphidian + opencode)
  and keep it @-detectable"` — working tree has UNCOMMITTED changes:
  - Staged earlier this session: `CustomerCompanyEditDialog.tsx`,
    `CustomerDetailPage.tsx`, `official-forms-applications.tsx`,
    `CustomerCompanyEdit.spec.tsx`, `CustomerDetailPage.spec.tsx`,
    `20261210000005_afhomes_backfill_stated_package_from_application.sql`.
  - Unstaged: `.taste-skill/after/index.html`, `.taste-skill/masthead-harness.mjs`
    (user WIP — design-taste harness, leave alone).
- Migrations run through `20261210000005` in the disposable DB; production
  applies recorded in `docs/supabase/MIGRATION-APPLICATIONS.md`. The new
  backfill migration is NOT yet applied to production (approval-gated).
- Pre-existing failures (documented, not from this session): lint 2 errors in
  `MemberWorkbookDialog.spec.tsx:154` (`_approved`, `_pw` unused); DB section 77
  OST team transfer (`"the fresh IST validity starts today": expected <today>,
  got null`). Do not touch.

## Last session's work (UNCOMMITTED) — "Package and Payment (company stated)" repair

Four focused edits, all admin-side (one new SQL migration):

1. `official-forms-applications.tsx` `payload()` now sends
   `statedVipPackage: tier` and `statedPaymentTerms: paymentScheme`, so the
   application's selected card tier + payment scheme flow through the existing
   mirror (`coalesce` on `customers.stated_vip_package` /
   `stated_payment_terms`) instead of staying NULL.
2. `CustomerCompanyEditDialog.tsx` — VIP Package and Payment Terms selects now
   carry a `Not Recorded` placeholder option (`value: ''`), so a genuinely unset
   stored value no longer masquerades as the first card/scheme. `orNull` keeps
   `''` out of the saved payload.
3. `CustomerDetailPage.tsx` — PAYMENT TERMS now renders via
   `paymentSchemeLabel(...)` (e.g. `spot_cash` → `Spot Cash`), mirroring the
   existing PAYMENT TYPE pattern. Unknown/free-text values pass through.
4. `supabase/migrations/20261210000005_afhomes_backfill_stated_package_from_application.sql`
   — idempotent, coalesce-only backfill of `stated_vip_package` /
   `stated_payment_terms` from each customer's latest linked application
   (only where NULL). Applied cleanly on the disposable DB; production apply
   pending explicit approval.
5. Regression tests: `CustomerCompanyEdit.spec.tsx` (placeholder for null) and
   `CustomerDetailPage.spec.tsx` (`Spot Cash` rendering).

Gates run this session: `CustomerDetailPage.spec.tsx` 17/17 + `OfficialFormsPages.spec.tsx`
40/40 + `CustomerCompanyEdit.spec.tsx` 5/5 green; `tsc --noEmit` (admin + supabase)
clean; `eslint` clean on touched files; admin build green; `pnpm check:env` PASS;
`pnpm test:db:local` 2666/2667 (only the pre-existing section 77 failure).
Lint root (`pnpm lint`) still red on the pre-existing `MemberWorkbookDialog.spec.tsx`
errors — not touched.

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
- Production apply of `20261210000005` (backfill) — approval-gated, not run.

## Verify (from root)

```sh
pnpm test                     # canonical gate (turbo --concurrency=2 -- --maxWorkers=2)
pnpm typecheck                # turbo 7 + tsc -p supabase
pnpm lint                     # 2 pre-existing errors in MemberWorkbookDialog.spec.tsx
pnpm check:env
pnpm test:db:local            # 2666/2667 (pre-existing section 77 failure)
pnpm test:db:harness          # blocked by the pre-existing section 77 failure
```

Focused (green this session):

```sh
pnpm --filter @afhomes/admin exec vitest run src/features/business/CustomerDetailPage.spec.tsx  # 17
pnpm --filter @afhomes/admin exec vitest run src/features/business/OfficialFormsPages.spec.tsx  # 40
pnpm --filter @afhomes/admin exec vitest run src/features/business/CustomerCompanyEdit.spec.tsx # 5
```
"