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

- `orly/develop` @ `50511e6 "enhance: IST/OST functionalities"` — working tree
  CLEAN (this file's rewrite is the only pending change). The last session
  ships entirely in that one commit: 18 files, admin-only — zero
  `api/`/contracts/SQL changes.
- Rounds before it (committed): guided IST/OST import + export (`f9d9cbe`,
  PR #16); member-details → validity/renewal link (`bdf5f6c`); approved team
  moves separated from accreditation conversion (`29237cc` — added
  `OstTeamTransferDialog` + `POST /members/:id/team-transfer`); OST province
  lookup + creation form (`76118ba`); OST password onboarding (`3039b51`);
  OST lifecycle + forward migration 09 + production apply logged (`15abff0`,
  `3d85b13`).
- Migrations run through `20261208000011_afhomes_ost_team_transfer.sql`;
  production applies are recorded in `docs/supabase/MIGRATION-APPLICATIONS.md`
  (latest entry = 00011). No SQL in this round; `pnpm test:db:*` untouched.

## Last session's work (COMMITTED `50511e6`) — admin UI round: short copy + the OST/IST member surfaces

**1. `/admin/ost/members/:id` full redesign (UI-only)** — `OstAccreditationPages.tsx`
(+ `.module.css`), `OstApplicantUpdate.tsx`, `ost.spec.tsx`. Component
`OstAccreditationHistoryPage` (the same file also holds `OstManualRegistrationPage`
and `OstImportExportPage` — untouched this round).

- Header: identity meta line (ID chip · name · sponsor); summary chips moved
  directly under the header as one `role="group"` row (`.badges`,
  `aria-label="Accreditation summary"`), ahead of the admin-only
  `SaleTeamAccreditationCard`; the page description paragraph is gone.
- Facts over inputs: the accreditation term renders as a facts strip (not form
  fields); the renewal form is grouped (labels ≤3 words, "Reason" one-row); the
  success alert renders inside the renewal panel under submit (was page
  bottom; a rare failed refetch after submit hides it — accepted).
- Applicant panel + renewal-details dialog share one page-local responsive
  grid `.fieldColumns` — written doubled (`.fieldColumns.fieldColumns`) to
  out-rank the shared `DetailFieldGrid`; 1 col below 720px, auto-fit above; the
  dialog lands at 2 cols from 560px.
- Applicant dialog "Proposed changes" gets `.changeBlock`/`.changeList`; the
  page copy contract is pinned (≤5-word sentences, ≤3-word input labels, no em
  dashes, no notes under inputs); skeleton mirrors the panels.

**2. `/admin/ost/members` list page removed**

- Deleted `OstMembersPage.tsx` + `.module.css`; route + lazy import removed
  from `App.tsx`; its 3 spec tests deleted; a new regression test pins the
  details back button ("Back to members") → `/admin/network/members`.
- Kept: `getOstMembers()` (the details page still uses it), API `/ost/members`,
  `network.ost_members` module (reports + member-dialog gate).
- Stale bookmarks fall to the catch-all `*` → `NotFound`. OST screens have NO
  `navigation.ts` entries — deep links only; entry = `/admin/network/members`
  → member dialog → **Renewal**.

**3. IST/OST member dialogs + accreditation card (same commit)**

- NEW `TransferToIstDialog.tsx` (+ spec) — OST → IST conversion. Member keeps
  record + login; the held AA number is retired into accreditation history
  ("never renumbered") and an AAI successor is issued. UI mirrors server gates:
  accreditation must check `expired` (`getAccreditation('members', id)`),
  target IST position + immediate head, reason ≥5 chars; posts
  `transferMemberSchema` `direction: 'OST_TO_IST'` to `POST /members/:id/transfer`
  (idempotent via `requestId`). Wired in `MembersPage` (`convertToIstId`);
  entry = MemberDetailDialog footer "Transfer to IST" (OST members only;
  admin/super_admin + `network.members` update gate, mirroring the RPC).
- `MemberDetailDialog`: footer "Close" removed (dialog X remains); "Validity /
  renewal" → "Renewal"; transfer label = "Transfer team" (OST) / "Transfer to
  OST" (IST).
- `TransferMemberDialog` = dual-mode wrapper: OST → `OstTeamTransferDialog`
  (genealogy team move via `POST /members/:id/team-transfer`); IST → inline
  Convert-to-OST form (title "Convert X to OST", submit "Convert to OST").
- Copy sweep (same styling pass): `CreateOstDialog` (notes removed; "Sponsor";
  "Complete now"/"Save as pending"; "Sales Managers failed to load."),
  `MemberFormDialog` (all field notes removed — ZIP suggestion, blank-ID,
  account/head hints; "Provinces failed to load." / "Cities failed to load." /
  "Pick a province first." / "Reload the page.").
- `SaleTeamAccreditationCard` (+ NEW `.module.css`): status chip moved to the
  card header with a per-status tone map; "Accreditation" detail row dropped;
  action area wrapped (`.actionButtons`); note = "Uses approved OST validity
  dates.". Shared by dashboard, My Account, IST staff detail, OST page.

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

## Verify (from root)

```sh
pnpm test                     # canonical gate (turbo --concurrency=2 -- --maxWorkers=2)
pnpm typecheck                # turbo 7 + tsc -p supabase
pnpm lint
pnpm check:env
pnpm test:db:local            # only when SQL changes (none this round)
pnpm test:db:harness
```

Focused (re-run green at `50511e6`, 2026-10-18):

```sh
pnpm --filter @afhomes/admin exec vitest run src/features/ost src/features/network-members  # 81 (7 files)
pnpm --filter @afhomes/admin exec vitest run src/app                                        # 77 (10 files)
pnpm --filter @afhomes/admin exec vitest run src/app/staff-lifecycle.spec.tsx               # 14, run solo
```

Last verified: the focused runs above GREEN post-commit; `tsc --noEmit` clean,
`eslint` clean, `@afhomes/admin` build green (OstMembersPage chunks gone) —
pre-commit on this identical tree. Root `pnpm test` NOT re-run this round (its
last full green predates recent rounds: api 2313 · admin 846 · contracts 286 ·
web 252 · ui 221 · shared 41 · config 6 — re-run it as the next gate). DB
suites untouched (no SQL). Browser pass still open.
