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
`SESSION.md`, `docs/security/`, untracked `docs/testing/` are user items — do
not touch. `docs/supabase/CURRENT-SCHEMA.sql` refreshes BY AGENT only on
explicit "update schema" trigger.

## Standing user preferences (apply without asking)

- `@ponytail` active (full): smallest complete change, house components first,
  no new deps, finish callers/tests/fixtures. End replies with skipped + risk.
- Membership template: ONE download per format. `template/xlsx` = GUIDED
  workbook (README + sections, split name/address, DROPDOWNS). `template/csv`
  = band + headers (CSV cannot carry dropdowns — state plainly). Legacy
  44/45-col uploads still parse. Never split FULL NAME by code.
- Dropdown values only from form pick-lists + validator vocabularies. Never
  invent values. Subsets allowed (Member sex Male/Female; civil status
  Single/Married/Widowed/Separated).
- User-facing copy: every sentence max 5–6 words. Detail areas user names:
  ALL links become `ui` Buttons with ≤2-word labels via router.
- Admin speaks PAGES not internals. Role access = one "Can access" per page;
  staff overrides = one "Deny access" per page. No bulk "View all".
- Grouped modules are dropdowns; Dashboard flat; multi-module groups
  pre-expand on existing grants.
- Application drafts hand-entry only (no file import on `.../new`).
- Guards ship failing-first; flakes: jsdom timing + zip-bomb timeout under
  parallel load → `--maxWorkers=2`; never adjust assertions to force a pass.
  Never two admin suites in parallel in one workspace.
- Prettier NOT a gate (CRLF artifact). Gate on `tsc` + `eslint`. Never
  `--write` pre-existing formatting; on user-WIP files diff vs
  `prettier <file> | tr -d '\r'`, touch own hunks only.
- User edits in parallel. Re-read shared files before editing; leave foreign
  diffs alone; never restore what the user deliberately removed — flag it.
- Version control: never stage/commit/push/branch/tag/stash/reset or GitHub
  actions unless explicitly commanded in-session. Working-tree edits are work.
- Passwords/TIN/gov-IDs never returned, never in audits (masked reads only).
- No `select('*')` on wide rows; filter in SQL; Free-quota rules per
  `docs/supabase/SUPABASE-FREE.md`.

## This session's work (UNCOMMITTED)

### A. Departments: ID hidden + polish
- `AfHomesDepartmentsPage.tsx`: no ID/Code/Staff/Status columns; table is
  Department Name / Staff / Actions. Avatar-initial + name cell, `StatusChip`
  staff count (`Empty`/`N staff`), local `SearchField`, header count
  (`N units for staff assignment.`), `EmptyState` actions, carded sticky-header
  table. Delete disabled with "Reassign staff before deleting." when staffed.
- Spec headers pinned `['Department Name','Staff','Actions']`, asserts no ID.

### B. Staff directory rework (then user-simplified to Edit + Delete only)
- Table now Code (`employeeNumber`) / Name / Email / Role / Status / Added.
  No ID, no AA Number, no sales numbers in cells.
- Hierarchy roles (VD/SSM/SM/OST) excluded from list, role filter, create/edit
  pickers (UX only; server unchanged). Status filter All/Active/Suspended.
- Full Edit dialog (role/department/status via `updateAfHomesStaff`).
- **User then removed**: Restrictions dialog, test-purge UI, Suspend/Activate
  row actions. Row actions are now Edit + Delete only. Delete visible to Super
  Admin only, never self/super-target (server already refuses).
- Obsolete specs removed (`staff-lifecycle` purge + restrictions describes);
  `AfHomesStaffDirectory.spec.tsx` rewritten (columns, hierarchy exclusion,
  Edit/Delete visibility, edit save). Responsive fixture staff role is now
  `employee` (was `sales_manager`, correctly excluded).

### C. Staff detail: Edit + Delete only
- `AfHomesStaffDetailPage.tsx`: header actions Edit + Delete only (Delete =
  Super Admin, non-self, non-super-target). Bottom "Back to staff" link AND
  header Back button removed. Invited/Activated fields removed (Temporary
  password state kept). Inline assignment/access cards replaced by one Edit
  dialog (role/department/status; status sent only when explicitly changed so
  legacy standings never flip silently). Hero polished (surface + shadow).
- `staff-lifecycle.spec`: self-edit case rewritten, detail Edit/Save case
  added, `Delete Permanently`→`Delete` labels.

### D. Roles: Delete disabled when staffed
- `AfHomesRolesPage.tsx`: Delete disabled + "Reassign staff before deleting."
  when `assignedCount > 0` (server already 409s). Spec case added in
  `role-access-review.spec.tsx` (13/13).

### E. Members module (`network.members`) — full vertical slice
- Contracts `member.ts`: positions VD/SSM/SM/OST + labels + `MEMBER_UPLINE_ROLE`
  (VD none, SSM→VD, SM→SSM, OST→SM); profile (DOB, sex, civil, split address,
  tel/mobile, FB optional, TIN optional write-only, employer trio, gov
  ID type+number write-only, head link, `ostReferrerStaffId`); create requires
  head except VD, OST-referrer SM-only; read model adds profile fields (masked
  secrets), `ostReferrerName`, `aaNumber`. Module key + catalog (Members,
  Network, 56) + `MIGRATION_SEEDED_GRANTS` entry (admin v/c/u; hierarchy view).
- Migration `20261205000001_afhomes_network_members.sql` (UNAPPLIED, amended
  once pre-apply): `network_member_profiles` (21 cols), RLS + revoke-all, no
  browser policies; module row + genealogy-mirroring grants.
- API `api/_handlers/members.ts` + router family: list/search/position,
  `uplines` (head holders), `ost-referrers`, GET/PATCH `:id` (profile only,
  no head), POST (provisions Auth login + staff + profile + genealogy edge +
  IST AA auto-issue, 1-yr validity; dept must be SALES-code; OST gets no AA —
  rides OST approval flow). Secrets masked, audits identity-only.
- Admin `features/network-members/`: list (Code/Name/Position/AA/Status/Added,
  clickable rows, summary chips), Create dialog (Sales fixed+disabled, 4
  positions, required Head, SM-only optional OST Referrer Details, no hint
  lines), Detail dialog (full record + Edit + Delete). Nav child under Sales
  Network; route `/admin/network/members`; GUARDED entry.
- Specs: contracts 7, api 12, admin 5, departure 3 (`admin/staff-departure`:
  suspend/deactivate retires direct edges, active-only update untouched).

### F. Genealogy single-level + departure read-through + nav trim
- API `genealogy.ts`: reads ALL edges, `displayParent` walks through
  non-active heads to nearest active one (active edge always wins; cycles
  guarded). Counts/ancestors/chain all display-based. Shape unchanged.
- `admin/afhomes.ts`: `retireDownlineEdges` on PATCH-to-non-active +
  deactivate (+ audit counts). Delete stays blocked by genealogy refs.
- UI: list dropped Total; details Head panel (immediate head + read-through
  note), dropped descendant displays. Per-head View Genealogy button in
  `HeadCard` (aria-labeled per head; tree toggle untouched).
- Nav: OST Applications, OST Members, Referral Code entries REMOVED (pages and
  routes remain; specs untouched).

## Blocked / needs user action

- `pnpm db:migrate` — needs explicit approval. Queue: `20261131000001/0002/`
  `0003` (Customer Lookup breaks until `…0003` applied + deployed), user's
  `20261203000001_remove_test_customer`, `20261204000001` (SSOT), NEW
  `20261205000001` (Members). Then `rls_invariants.sql` (empty = PASS).
  Nothing applied anywhere by agent.
- Confirm: (1) AA 1-year auto-validity (agent assumption); (2) Restrictions +
  test-purge UI removal was deliberate (endpoints live); (3) UUID the user
  sees in Members view — agent proved no UUID renders; user must name the
  cell (Code vs AA vs dialog section) or screenshot.
- Dev API restart / redeploy for all handler + UI changes.
- `docs/testing/membership-template.xlsx` now FOUR layouts old — re-download.
- Open: Admin departments delete grant (Super Admin only); single MOBILE slot;
  duplicate Create Reservation buttons; Q1–Q7; RA/STATUS sets; stated-figure
  semantics; reservation picker still pages 200.

## Verify (from root)

```sh
pnpm --filter ./api exec vitest run --maxWorkers=2          # 119 files / 2283 tests
pnpm --filter ./packages/contracts exec vitest run          # 21 files / 277 tests
pnpm --filter ./apps/admin exec vitest run src/features/afhomes src/features/network-members src/features/genealogy src/features/ost src/app/authorization.regression.spec.tsx --maxWorkers=2
pnpm typecheck                                               # turbo 7 + tsc -p supabase
pnpm check:env
pnpm lint                                                   # 0 errors
pnpm test:db:local                                          # 2540 checks incl. §75 (15/15)
pnpm test:db:harness                                        # 13/13 (not re-run this session)
```

Last verified: api 2283 green; contracts 277 green; admin targeted
(network-members 5, genealogy 8 incl. head-button probe, ost, afhomes 77,
responsive 29, role-review 13) green; `typecheck` 7/7; `check:env` PASS;
`test:db:local` 2540/2540. Full 85-file admin suite last full run: 3 fails =
2 flakes (pass solo) + 1 stale-fixture since fixed; re-run before release.
