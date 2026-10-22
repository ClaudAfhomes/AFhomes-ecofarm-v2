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
- **Added copy gets reviewed and stripped.** The user removed a section heading
  and its explanatory note after I added them. Do not add headings, captions or
  notes that only restate a label; make the layout carry the meaning.
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

### Tooling facts (verified this session)

- **Visual pass without browser tooling:** Chrome IS installed at
  `C:/Program Files/Google/Chrome/Application/chrome.exe`; `agent-browser` is
  NOT installed. Headless screenshot works:
  `chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars
  --virtual-time-budget=3000 --window-size=W,H --screenshot="ABSOLUTE.png"
  "file:///ABSOLUTE.html"`. **The `--screenshot` path must be ABSOLUTE** — a
  relative path fails with "Access is denied". A static harness built from the
  SHIPPED css + the real markup is an acceptable substitute for an
  auth-gated route; say "verified in harness, not in the live app".
- **Harness CSS extraction:** a regex that grabs `.cls { … }` FLATTENS `@media`
  blocks, so inner rules apply globally and the screenshot lies. Parse
  brace-aware, keep the `@media` wrapper, and strip a leading CSS comment
  before testing the prelude for `@media` (a comment before `@media` hides it).
- **Graphify `check-update` can give a FALSE NEGATIVE.** It reported "nothing
  pending" while the graph still described code deleted 4 commits earlier.
  Verify by querying a symbol that changed, or `git diff --name-only
  <built_at_commit>..HEAD` over source files. `built_at_commit` is NOT bumped
  by `graphify update`.
- **Graphify `graphify label` needs an LLM key** (GEMINI/GOOGLE). None is set
  here, so communities renamed by the rebuild keep hub-derived names.

## Repo state (verified 2026-10-22)

- `develop` @ `5c48c1b "fixes: delete permanent"`. Production project is
  `ikaevepedpqygdlipsei`, last applied migration `20261212000004`.
- **Committed by the user this session (their work, not mine):** `48e642b` +
  `60f2bc0` + `41ccbae` + `5c48c1b` — the customer PURGE feature:
  `supabase/migrations/20261213000001_afhomes_customer_purge.sql`,
  `api/_handlers/customers.ts` (DELETE now calls `public.purge_customer` and
  removes storage objects; the 409 `PROTECTED_HISTORY` blocker list and the
  `POST /customers/:id/anonymize` route were DELETED), `api/_lib/testing/
  supabase-fake.ts` (a hand-written JS mirror of the SQL), admin customer
  delete UI, `docs/supabase/CURRENT-SCHEMA.sql` regenerated.
- **Working tree — leave all of it alone unless the user says otherwise:**
  - User WIP (6 files, do not touch): `CustomerDetailPage.tsx`,
    `CustomerDetailPage.module.css`, `CustomerDetailPage.spec.tsx`,
    `CustomerRecordActions.tsx`, `CustomerRecordActions.spec.tsx`,
    `official-forms-applications.tsx` (the "Load offer" button removal —
    the user confirmed it is INTENTIONAL, keep it removed).
  - Mine (this session): `official-forms-reservations.tsx`,
    `OfficialFormsPages.module.css`, new `reservation-source-panel.spec.tsx`.
  - Graphify artifacts (regenerated by `graphify update .`, never hand-edited):
    `graphify-out/{graph.json,graph.html,GRAPH_REPORT.md,manifest.json,
    .graphify_labels*.json}`, `graphify-out/cache/*`, plus new untracked
    `graphify-out/2026-10-22/` (the tool's backup of the previous graph) and
    `graphify-out/cache/ast/v0.9.92-s17-*/`.
- `20261213000001_afhomes_customer_purge.sql` is COMMITTED but NOT applied to
  production (prod is at `20261212000004`) → it can still be corrected in
  place rather than by a forward-only fix.
- **Pre-existing failures (verified at HEAD, NOT from this session):**
  - `src/features/business` = 30 failed / 387 passed, in 3 files:
    `application-actions.spec.tsx` (16 — "Unable to find a label with the text
    of: First name", "Export XLSX", "Reopen to re…"), `PurchasePaymentsPage.
    spec.tsx` (11 — missing "record a payment" / "verify" / "reject" controls,
    "receipts for" region), `final-blockers.spec.tsx` (3 — "Unable to find …
    role button and name 'Submit'"). The specs expect controls the current
    pages no longer render. Do not "fix" them by weakening assertions.
  - `pnpm lint`: admin 1 error + 24 warnings; web 8 warnings, 0 errors. The
    error is `CustomerRecordActions.tsx:36 '_onChanged' is defined but never
    used` — in the USER's WIP file.
  - DB section 77 OST team transfer (`"the fresh IST validity starts today":
    expected <today>, got null`) still blocks `pnpm test:db:harness`.
- Gates this session: `pnpm typecheck` clean (7/7 + `tsc -p supabase`);
  `pnpm check:env` PASS (668 browser / 279 server files); `pnpm lint` 1 error
  (user WIP) + 32 warnings; admin build green; focused admin specs 68/68;
  whole `src/features/business` 387 pass / 30 fail (failure list byte-identical
  to the pre-change baseline). `pnpm test:db:local` NOT run (no SQL change).

## Last session's work (UNCOMMITTED) — reservation source panel redesign

Scope: ONE surface — the `aria-labelledby="reservation-source-heading"` section
of `ReservationAgreementEditorPage` (`/admin/sales/reservations/new`, same
component serves `/admin/sales/reservations/:id`). UI-only: no handler,
contract, SQL, migration, dependency or permission change.

1. `official-forms-reservations.tsx` — Card sale + Source Customer Application
   now sit in one `<fieldset>`/`<legend>` named "Source" (exposed as
   `role="group"`); "Auto-fill from sale" moved OUT of the layout grid to sit
   under the Card sale control it acts on (`size="sm"`, outside the `<label>`
   so it cannot activate the select); "Imported Tier" moved to its own band
   separated by a rule; the copy caption became a "Linked source" strip
   (application number + holder name + `StatusChip`) with `aria-live="polite"`.
2. `official-forms-reservations.tsx` — `holderFullName()` lifted to module
   scope, shared by the copy effect and the strip. Null-guarded `primary`
   (the copy effect already had `if (!app.primary) return;`; without the guard
   a thin application payload crashed the page).
3. `OfficialFormsPages.module.css` — new scoped classes only
   (`.sourceLayout`, `.sourceGroup`, `.sourceGroupTitle`, `.sourceFields`,
   `.sourceField`, `.sourceAction`, `.sourceContext`, `.sourceLinked*`).
   Shared `.panel`/`.panelTitle`/`.panelNote`/`.filterLabel`/`.editorGrid`/
   `.note`/`.actions` NOT touched (other panels share them).
4. Copy round (user-requested): the "Imported context" heading and the
   "Display only. Server decides." note were REMOVED. `--sourceTitleSpace`
   (`calc(var(--text-caption) * var(--line-height-body) + var(--space-3))` =
   31.2px) reserves the legend's line so the tier control stays level with the
   other two; the ≤1023px stacked rule drops the reservation.
5. New `reservation-source-panel.spec.tsx` — 6 tests. Failing-first proved:
   restoring HEAD's markup makes 5 of 6 fail (the 6th is the
   behaviour-preservation test and must pass on both).
6. `align-items: start` on `.sourceFields` — added after the visual pass
   caught a stretched grid track pushing the application select out of
   alignment. A DOM test could not see this.

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
  parallel load → 14/14 solo. A combined 3-suite run flaked where each suite
  passed solo — always re-run solo before calling a failure real.
- Prettier check on a copy: keep the extension, use the repo `.prettierrc.json`
  via `--config`, add `--end-of-line auto`. Known pre-existing deviations:
  `OstAccreditationPages.tsx` (~5), `OstApplicantUpdate.tsx` (~2), `App.tsx` (1,
  `/admin/network/members` route), `official-forms-reservations.tsx` (imports
  at 16–76, `<dl` at ~195, and ~988/1177/1442). This round added ZERO to
  those files — don't "fix" them.
- A native `<select>` with no matching option defaults to the first option; use
  an explicit empty placeholder option when a null stored value should read
  "Not Recorded" (see `CustomerCompanyEditDialog`).
- PostgREST `count: 'exact'` is only returned when the query is built with
  `{ count: 'exact' }`; `readBoundedRows` reads it per chunk — keep that option
  on any query that relies on the total.
- A `<Select>` inside a `<label>`: the `aria-label` on the control OVERRIDES
  the wrapping label, so `getByLabelText` and `getByRole('combobox', {name})`
  can disagree. Keep both strings identical or the spec will pick one.
- `getSales`/`getCustomerApplications` load asynchronously: wait for the
  `<option>` before driving a `<select>`, or `selectOptions` throws
  "Value … not found in options".
- A `<fieldset>`/`<legend>` group is queryable as
  `getByRole('group', { name: '…' })` — the cheapest way to assert that a
  control is (or is not) inside a group.

## Open threads / unanswered offers

- **Customer-purge review (HIGHEST VALUE — the migration is committed but
  unapplied and the SQL is unproven).** Findings, all VERIFIED against source:
  1. The purge SQL is **never executed by any test** — only the in-memory
     fake (`api/_lib/testing/supabase-fake.ts:1255`) mirrors it; no
     `supabase/db-integration.ts` section covers it.
  2. `identity_documents` is deleted BEFORE `customer_application_documents`,
     but `customer_application_documents.identity_document_id → identity_
     documents(id)` is NO ACTION (migrations use explicit `on delete`, 223
     occurrences, so absence = RESTRICT) → 23503 and the whole purge aborts.
     The later `identity_document_id in (select id from identity_documents …)`
     subquery is DEAD (the rows are already gone).
  3. `customer_applications.recommender_customer_id` is unhandled → a customer
     who recommended someone else's application cannot be purged.
  4. Four child tables are filtered by the wrong column and leave survivors
     that block their parent: `redemption_quotes` (by `approval_customer_id`),
     `earning_claims` (by `customer_id`), `customer_external_import_receipts`
     (by `source_id`), `customer_import_payment_claims` (by `source_id`),
     `customer_application_documents` (missing `payment_id`).
  5. The migration silently changes a shared guard's contract:
     `private.guard_application_purchase_terms` branch 2 went from
     `APPLICATION_TERMS_IDENTITY_INVALID`/23514 to `PURCHASE_TERMS_REVIEW_
     REQUIRED`/55000 → `packages/db-testing/scripts/test-purchase-gate3.mjs:600`
     asserts `/23514.*APPLICATION_TERMS_IDENTITY_INVALID/` and will FAIL. That
     script is NOT wired into `pnpm test:db:local`, so it fails silently.
  6. `payments.receipt_storage_path` is a free-form CLIENT string
     (`packages/contracts/src/schemas/finance.ts:60`, no format validation);
     the handler splits it on the first `/` and calls `storage.from(bucket)`.
     A crafted path can make the purge delete objects from ANY bucket the
     service role can reach (including public `afhomes-cms-media`). Needs a
     bucket allowlist.
  7. Storage objects are removed BEFORE the transactional RPC, so an RPC
     failure leaves DB rows pointing at unrecoverable files.
  8. `afhomes.allow_customer_purge` is set `on` and never reset → the
     immutability guards stay bypassed for the rest of the transaction.
  Fixing 2/3/4/5 + adding a DB suite section is the minimum before any
  production apply. THE USER DECLINED the delete/deactivate UI work ("don't do
  this") — but the SQL defects above were never addressed.
- Optional copy pass (offered, not started): "Card sale" vs "Source Customer
  Application" label wording. Touch points: `final-blockers.spec.tsx:291`,
  `final-blockers.spec.tsx:272,285`, `reservation-detail-panel.spec.tsx:411`.
- Live authenticated visual pass of the reservation source panel — NOT done
  (no staff session; `agent-browser` not installed). Verified in a static
  harness built from the shipped css at 1440/900/390 only.
- The 390px panel overflows the viewport — PRE-EXISTING house
  `Select`/`filterLabel` behaviour (the BEFORE render overflows identically),
  not introduced by the redesign. Untouched deliberately.
- Graphify community labels are STALE for 51 communities (renamed by hub after
  the rebuild). `graphify label` cannot run without a Gemini/Google key.
- Graphify is otherwise CURRENT: rebuilt to 8516 nodes / 25554 edges /
  415 communities; the deleted `customerDeleteBlockers` node is gone;
  `purge_customer` and the new spec are indexed; `check-update` clean.
- Carried-forward (verify before acting): UUID once seen in Members view (user
  must name the cell/screenshot); departments delete grant (Super Admin only);
  single MOBILE slot; duplicate Create Reservation buttons; Q1–Q7; RA/STATUS
  sets; stated-figure semantics; reservation picker paging; re-download
  `docs/testing/membership-template.xlsx`; AA numbering shapes (AUTO
  `AA-XXXXXXXXXXXX` vs MANUAL `^AA[A-Z0-9]{4,12}$` — unify or keep; 1-yr
  auto-validity unconfirmed); live authenticated check of the OST team transfer.
- Production apply of `20261210000005` (backfill) + `20261211000001/2` +
  `20261211000003/4/5` + `20261212000001..4` — approval-gated, not run.
- `pnpm test:db:local` + `pnpm test:db:harness` not re-run this session; run
  before relying on any migration. Pre-existing section 77 failure still
  blocks the harness.

## Verify (from root)

```sh
pnpm test                     # canonical gate (turbo --concurrency=2 -- --maxWorkers=2)
pnpm typecheck                # turbo 7 + tsc -p supabase  (clean this session)
pnpm lint                     # 1 error (user WIP CustomerRecordActions.tsx:36) + 32 warnings
pnpm check:env                # PASS this session
pnpm build                    # admin build green this session
pnpm test:db:local            # NOT run this session (no SQL change); 2666/2667 expected (pre-existing section 77)
pnpm test:db:harness          # blocked by the pre-existing section 77 failure
```

Focused (green this session):

```sh
pnpm --filter @afhomes/admin exec vitest run --maxWorkers=2 \
  src/features/business/reservation-source-panel.spec.tsx \
  src/features/business/reservation-detail-panel.spec.tsx \
  src/features/business/OfficialFormsPages.spec.tsx          # 68/68
```

Known-failing (pre-existing, byte-identical failure list vs the pre-change
baseline — do not "fix" without a decision):

```sh
pnpm --filter @afhomes/admin exec vitest run --maxWorkers=2 src/features/business
# 387 pass / 30 fail: application-actions (16), PurchasePaymentsPage (11), final-blockers (3)
```
