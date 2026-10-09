# SESSION.md — Chat Handoff Context

> **Protocol:** This file holds the latest handoff only. When the user says
> `handoff context to @SESSION.md`, REPLACE this entire file with the new
> session's context (do not append; delete stale sections). Keep it dense:
> decisions, patterns, open threads, and verification state. No prose essays.

## Stack (unchanging)

pnpm + Turborepo. `apps/web` (:5173, `/` + `/customer/**` + `/ost/**`) |
`apps/admin` (:5174, `/admin/`) | single Vercel Function `api/router.ts` →
`api/_lib/router.ts` → `api/_handlers/**` → Supabase Postgres + Auth.
`packages/contracts` (Zod SSOT, `lifecycle.ts` owns all statuses) |
`packages/shared` (BigInt money) | `packages/config` (`VITE_`-only) |
`packages/ui` (tokens + primitives). Branch: `orly/develop`.
SSOT doc: `docs/AFHOMES-PHASE-1-PLAN.md` (`AGENTS.md` is stale past Phase 5).

## Standing user preferences (apply without asking)

- No em dashes (—) in user-facing copy; use colons/commas/parentheses.
- Descriptions/hints trimmed to 5–6 words.
- Primary actions green (`Button` default); secondary for alternates.
- Content loaders = `Skeleton`; button loaders = in-button `Spinner` (`loading` + `loadingLabel`).
- First-load skeletons cover the WHOLE page (header, filters, table).
- Shared primitives over raw controls (`Select`, `SearchField`, `FilterBar`, `Pagination`, `StatusChip`, `Alert`).
- Dropdown options show names only (no IDs/numbers in labels).
- Server is the security boundary; nav/guards are UX-only.
- CSS Modules per component; tokens from `@afhomes/ui`; Prettier
  (`semi/singleQuote/100/trailingComma`).

## Established patterns (follow in future tasks)

- Paged lists: service `getXPage()` via `requestListEnvelope` → `{data,total}`;
  page state in queryKey, `placeholderData` previous, shrink-clamp, shared
  `Pagination` (`page={safePage+1}`), stacked footer (controls over range text).
- Clickable rows: `tr[tabIndex=0][role=link]` + Enter/Space + plain-text first
  cell + `.clickable` hover (`--color-state-hover`) + focus-visible outline.
- Sidebar highlight is longest-match (`Sidebar.tsx: longestActiveSubTo`);
  hidden routes keep explicit guards in `navigation.ts: canAccessNavTarget`.
- `FilterBar` bottom-aligns (`align-items:end`) so bare search inputs sit level
  with labeled controls.
- Invalid fields turn red via global `aria-invalid` rule in
  `apps/admin/src/styles/global.css` (must stay AFTER base control rules —
  all `:where()`, source order decides).
- Editor save/submit: `loading` + `loadingLabel`, disable-gates preserved
  (`loading` auto-disables); blocker lists (`submitBlockers`/`saveBlockers`)
  render as inline warning Alerts; never silent grey buttons.
- File inputs: hidden native input + `Button` trigger + `Selected: {name}`
  status (see import-export page, XLSX import).
- Local image thumbnails via `URL.createObjectURL` in `useMemo` + cleanup-only
  revoke effect (never setState-in-effect; jsdom lacks it → guarded try/catch).
- Editor error states branch per cause (401/403/404/parse/network) with
  actionable text; never render server internals or stored values.

## This session's work (all committed; `orly/develop` +1 ahead of origin)

1. **Customers page**: `Import/Export Data` button (secondary + download icon,
   `governance.customer_import` gated) → `/admin/customers/import-export`;
   sidebar `Import / Export` link removed (direct URL still guarded).
2. **Import/export page**: full tabbed rework (`Import|Export|Job history`),
   panels, tone-aware alerts, preview pagination, `Select`/`FilterBar` filters,
   styled file pickers, `CustomerImportExportPage.module.css` (new).
3. **Sidebar**: longest-match exclusive sub-link highlight (+ regression test);
   `Pagination` Next chevron got a bordered container, then mirrored to
   Previous for symmetry (+ disabled-container fade).
4. **Applications list**: same treatment as customers (button, selects,
   dates, clickable rows, `tableWrap`); `Submitted`/`Created` columns removed;
   number plain text; server-side paging (`getCustomerApplicationsPage`).
5. **Reservations list**: same treatment + paging (`getReservationAgreementsPage`);
   `Submitted`/`Created` removed; editor buttons to spinners (lifecycle-panel
   `busy`-shared buttons deliberately left — needs per-action state surgery).
6. **Application form (new + edit), phases A–C**: numbered panels, real
   `.editorGrid` (old `form-grid` class was undefined), header + sticky-footer
   Save, checklist alert, shared selects, human scheme labels, explicit
   recommender labels, ID sub-panels, save-blocker Alerts, searchable→dropdown
   customer picker (name-only, bounded page), mobile rules, facts-card plan
   benefits, ID thumbnail + modal, pre-upload local thumbnail, required-empty
   notices, `HumanInput` name-message removed (red via `aria-invalid`).
7. **Copy pass**: descriptions/hints to 5–6 words; status tones explicit
   (cancelled/rejected danger); scheme labels colon-form (shared source +
   guide copy + 1 API spec); ID-type options title-cased; province-first
   hints removed; XLSX/Upload-ID buttons green.
8. **Load-error debug**: traced 10 failure modes for `Application could not be
   loaded`; shipped cause-independent fixes (branched error messages,
   uppercase-ID route accept + test). Root row still unidentified.

## Open threads (need user input or a follow-up task)

- **Load-error root cause**: needs the DevTools console `ApiParseError` line
  (or Network status) for the failing id on local dev. Prime suspect remains a
  legacy-shaped row failing strict Zod (missing PRIMARY holder / bad
  phone-email-date). Then: data repair + read-path hardening.
- Lifecycle-panel buttons share one `busy` flag (Print/Finalize/record/
  activate) — per-button spinners need state surgery there.
- `IdCapturePicker` inner-button mobile stacking (shared component, affects
  other pages if touched).
- No `Pagination` on import-export preview (client-side, 10/page) — fine as is.

## Known pre-existing failures (not ours — verified via `git stash`)

- `navigation.spec.ts`: `Membership Lookup` vs `Customer Lookup` label.
- `CardPlans.spec.tsx` onboarding-recovery block (flaky; passed in full runs).

## Verify (from root)

```sh
pnpm --filter @afhomes/admin exec vitest run src/features/business/  # 19 files
pnpm --filter @afhomes/admin exec tsc --noEmit
pnpm --filter @afhomes/admin exec eslint <touched files>
pnpm exec prettier --write <touched files>
pnpm --filter @afhomes/ui exec vitest run src/components/<spec>
pnpm --filter api exec vitest run _handlers/<spec>
```
