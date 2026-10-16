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
  User also commits/rewrites the tree mid-session — re-check file contents
  before large steps.
- Version control: never stage/commit/push/branch/tag/stash/reset or GitHub
  actions unless explicitly commanded in-session. Working-tree edits are work.
- Passwords/TIN/gov-IDs never returned, never in audits (masked reads only).
- No `select('*')` on wide rows; filter in SQL; Free-quota rules per
  `docs/supabase/SUPABASE-FREE.md`.

## Repo state

- HEAD `4192f32 "fixes: sales network"` (`orly/develop`): the earlier rounds
  are committed — departments polish, staff directory/detail rework (Edit +
  Delete only), roles delete guard, members module slice, genealogy
  read-through + nav trim, AA AUTO/MANUAL, PSGC comboboxes + ZIP autofill,
  plaintext ID/TIN detail read. Those are in; do not re-do or re-add.
- Last session's work is UNCOMMITTED (below). The user concurrently edits
  `api/_lib/psgc-cloud-provider.*` — leave foreign diffs alone.

## Last session's work (UNCOMMITTED): Create/Edit member form parity

**Deliverable:** `apps/admin/src/features/network-members/MemberFormDialog.tsx`
(NEW, untracked) — ONE shared form both dialogs mount only while open;
`CreateMemberDialog`/`MemberDetailDialog` are thin parents. Same
sections/order/controls pinned by tests. Exports `MemberFormSeed` /
`MemberFormValues`; `EMPTY_MEMBER_SEED` lives in CreateMemberDialog.

- Edit parity (all save from Edit): Position, Head (+ reason), login Email,
  Temporary password, address codes, OST referrer, AA issue.
- Head: reason ≥3 chars only when the link actually moves; server validates
  the head as the immediate ACTIVE upline (self-head refused); write order —
  role assignment → retire old `referral_relationships` → insert new → profile
  `referrer_staff_id`; `UPLINE_CORRECTED` audit carries the reason.
- Position: server re-resolves the role (active + `permissionsAreSubset`);
  head must be re-picked for the new level (VD has none).
- Email/password: staff dupes 409, auth dupes 409; one `updateUserById` with
  `email_confirm: true` + password; reset sets `must_change_password = true`.
- OST referrer: SM-only, must be an active OST; leaving `sales_manager`
  clears it server-side.
- Address: codes travel as a pair and the server re-resolves them
  (`resolveMemberLocation`; mismatched pair 400); a carried ZIP wins, the
  published postal code is only the fallback.
- Client payload is diff-based: only changed facts travel; address codes only
  when the pair is present and changed; blank secrets = keep.
- AA in Edit: issued = read-only; missing = issue controls; Issue no longer
  closes the dialog — `MembersPage.viewing` is `viewingId`-derived from rows,
  so save/issue/poll refresh the record.
- Failed saves: SweetAlert popup + inline `role="alert"`.
- Fake: `updateUserById` accepts `email`/`email_confirm`
  (`hasEmail`/`emailConfirmed`), refuses taken emails; `applyAuthEmail`.
- `20261206000005` — header comment only (edits re-resolve when codes
  travel; ZIP stays the operator's).

**Uncommitted files:** admin `network-members/{MemberFormDialog.tsx NEW,
CreateMemberDialog.tsx, MemberDetailDialog.tsx, MembersPage.tsx,
MembersPage.spec.tsx}` · `api/_handlers/members.{ts,spec.ts}` ·
`api/_lib/testing/supabase-fake.ts` ·
`packages/contracts/src/schemas/member.{ts,spec.ts}` · migration `00005`
(comment). User's concurrent, untouched: `api/_lib/psgc-cloud-provider.{ts,
spec.ts}`, the ZIP-fallback test in `members.spec.ts`, `00005` header wording.

**Tests added:** admin MembersPage 20 (parity, full-change save: position +
head + reason + email + password, failure popup); api members 39 (position
move, reason required, candidate refusals, email/pw rotation, dupe 409 with
no writes, address re-resolve + half pair); contracts member 16.

## Test gotchas (learned this session)

- `(Optional)` marker renders WITHOUT a space → query `'AA Number(Optional)'`.
- SweetAlert sets `aria-hidden` on the rest of the page while open — `ByRole`
  queries fail; `Swal.close()` first, or assert with `ByText`.
- Admin specs: NO per-test mock reset — `vi.fn()` implementations persist
  across tests in a file; seed what each test needs.
- Load flakes: re-run a flaked suite solo before believing it; root `pnpm
  test` already pins `--maxWorkers=2`. Mid-session turbo failures (address
  assertions + 5s timeouts) were a moving tree + load; final run is green.

## Blocked / needs user action

- **Migrations UNAPPLIED (explicit approval required):** `20261206000003`
  (link reconcile — fixes live PGRST204 `ost_referrer_staff_id`),
  `20261206000004` (7-arg `manage_sale_team_accreditation`, `p_aa_number`),
  `20261206000005` (`province_code`/`city_municipality_code`). Command:
  `npx pnpm db:migrate -- --approve-production`; then
  `supabase/security/rls_invariants.sql` (empty = PASS).
- **Order: migrate BEFORE deploying this round's API.** Members list now
  selects the new code columns → 500 without `00005`; live create-member
  PGRST204 needs `00003`; manual AA needs `00004`.
- **API restart/redeploy** for all handler + UI changes (incl. plaintext
  ID/TIN detail read).
- After deploy: retry live Create Member; a lingering PGRST204 is only a
  schema-cache reload (`NOTIFY pgrst, 'reload schema'`) — no DDL.
- **Confirm AA numbering shapes:** AUTO issues `'AA-' || 12 shuffled`
  (`AA-XXXXXXXXXXXX`); MANUAL accepts `^AA[A-Z0-9]{4,12}$` (dashless; the
  form prefix-locks `AA` and auto-uppercases via `withAaPrefix`) — unify or
  keep? (1-yr auto-validity is still an unconfirmed assumption.)
- `pnpm test:db:local` NOT re-run this round (no SQL bodies changed; only a
  migration comment) — run it with the migration approval.

## Carried-forward opens (earlier sessions — verify before acting)

UUID once seen in Members view (user must name the cell/screenshot); Admin
departments delete grant (Super Admin only); single MOBILE slot; duplicate
Create Reservation buttons; Q1–Q7; RA/STATUS sets; stated-figure semantics;
reservation picker paging; re-download `docs/testing/membership-template.xlsx`.

## Verify (from root)

```sh
pnpm test                     # canonical gate (turbo --concurrency=2 -- --maxWorkers=2)
pnpm typecheck                # turbo 7 + tsc -p supabase
pnpm lint                     # 0 errors
pnpm check:env
pnpm test:db:local            # not re-run this round; run with migration approval
pnpm test:db:harness
```

Focused:

```sh
pnpm --filter api exec vitest run _handlers/members.spec.ts                                    # 39
pnpm --filter @afhomes/contracts exec vitest run src/schemas/member.spec.ts                    # 16
pnpm --filter @afhomes/admin exec vitest run src/features/network-members/MembersPage.spec.tsx # 20
```

Last verified (this session): full `pnpm test` **GREEN** — api 2313 (119
files) · admin 846 (85 files) · contracts 286 · web 252 · ui 221 · shared 41 ·
config 6; `typecheck` 7/7; `lint` 0 errors (23 admin warnings). `check:env` +
DB suites last green in an earlier session.
