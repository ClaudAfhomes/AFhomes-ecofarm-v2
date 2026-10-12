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
`packages/shared` (BigInt money + canonical `formatMoney`) |
`packages/config` (`VITE_`-only) | `packages/ui` (tokens + primitives).
SSOT doc: `docs/AFHOMES-PHASE-1-PLAN.md` (`AGENTS.md` is stale past Phase 5).

## Standing user preferences (apply without asking)

- No em dashes (—) in user-facing copy; use colons/commas/parentheses.
- Descriptions/hints trimmed to 5–6 words.
- Primary actions green (`Button` default); secondary for alternates; destructive = `danger`.
- Content loaders = `Skeleton`; button loaders = in-button `Spinner` (`loading` + `loadingLabel`).
- First-load skeletons cover the WHOLE page (header, filters, table); refetches keep chrome mounted (see skeleton rule below).
- Shared primitives over raw controls (`Select`, `SearchField`, `FilterBar`, `Pagination`, `StatusChip`, `Alert`, `Table` family).
- Dropdown options show names only (no IDs/numbers in labels).
- Money/values ALWAYS grouped via `@afhomes/shared` `formatMoney` (`2562000.00` → `₱2,562,000.00`); never raw `₱{…}` concat; never show a sale UUID.
- Closed enums are dropdowns, never free text (Imported Tier → Select); workbook imports sanitized to the closed set.
- Field labels humanized (`Reservation Date`, `TIN Number`); never render raw state keys.
- Headings are stable product titles, never role strings (`Operations Overview`, not `Super Admin Dashboard`); subtitles only when they add info the scope strip doesn't.
- Status communicates with label + icon + tone, never color alone; cancelled = red + close icon.
- Tables: header `--color-bg-surface`, body `--color-bg-surface-raised` (white); figures tabular-nums.
- Server is the security boundary; nav/guards are UX-only.
- CSS Modules per component; tokens from `@afhomes/ui`; Prettier (`semi/singleQuote/100/trailingComma`).
- No unused vocabulary: dead code, dead CSS classes, dead exports are removed, not left.
- A test that cannot fail is not a test: new guards are proven by revert-and-fail (temporarily restore the defect, watch the guard fire, restore).
- Flake standard: pass-in-isolation is not proof; reproduce on clean tree via `git stash` before calling anything pre-existing.
- Mobile: tables become labelled cards (never sideways scroll); `overflow: clip` backstops, never `overflow: hidden` as the fix (clip hides, fit first).
- User directs page-by-page (`next: /admin/sales/reservations`); keep scope to the named surface.

## Established patterns (follow in future tasks)

- Paged lists: service `getXPage()` via `requestListEnvelope` → `{data,total}`; page state in queryKey, `placeholderData` previous, shrink-clamp, shared `Pagination` (`page={safePage+1}`), stacked footer (controls over range text).
- Clickable rows: `tr[tabIndex=0][role=link]` + Enter/Space + plain-text first cell + `.clickable` hover + focus-visible outline.
- Sidebar highlight is longest-match; hidden routes keep explicit guards in `navigation.ts: canAccessNavTarget`.
- `FilterBar` bottom-aligns so bare search inputs sit level with labeled controls.
- Invalid fields turn red via global `aria-invalid` rule in `apps/admin/src/styles/global.css` (stays AFTER base control rules — all `:where()`, source order decides).
- Editor save/submit: `loading` + `loadingLabel`, disable-gates preserved (`loading` auto-disables); blocker lists render as inline warning Alerts; never silent grey buttons.
- File inputs: hidden native input + `Button` trigger + `Selected: {name}` status; IST import uses `::file-selector-button` restyle + filename/size status + `aria-labelledby` to the visible title.
- Local image thumbnails via `URL.createObjectURL` in `useMemo` + cleanup-only revoke effect (never setState-in-effect; jsdom lacks it → guarded try/catch).
- Editor error states branch per cause (401/403/404/parse/network) with actionable text; never render server internals or stored values.
- **Skeletons must never replace live controls.** Re-keying a query flips `isPending`, which unmounts whatever the skeleton replaces — losing focus/caret mid-keystroke. First load may replace the screen; refetches must keep chrome (tabs, search, filters) mounted. Use `placeholderData: keepPreviousData` so `isPending` only ever means a genuine first load (`BusinessProductsPage.tsx` is the reference). Focus-preservation regression test included there.
- Closed-tier selects use an `isVipTier` type guard + workbook sanitization, so a value with no matching `<option>` can never leave state out of step with the display.
- Bar-in-cell (`ShareCell`): decorative share bar behind the exact formatted figure; ratio via `Number()` is display-only geometry, never a stored/compared figure (comment says so).
- Money max across rows via `compareMoney` reduce with `'0.00'` seed + `?? '0.00'` (query data may be undefined); dynamic CSS-module lookup needs a `cls(...names: (string|undefined)[])` joiner because `styles[key]` types as `string | undefined`.
- Plan tone inferred from published plan NAME (`GOLD/SILVER/BRONZE` substring); schemes mapped by frozen code. Unknown → neutral; never guessed.
- Tests asserting paid/loaded state must wait for hydration first (page seeds state from the loaded record via effect; importing/acting before it lands races it).
- **Raw-table mobile cards:** `data-label` per `td` + ≤639px collapse grammar mirroring `@afhomes/ui` Table (thead hidden, labelled flex rows, card chrome, lead cell unlabeled as title) + `responsive-cards.spec.tsx` pins every cell's label per table.
- **Global 640px scroll floor** (`apps/admin/src/styles/global.css`, `.table-scroll > table:not([class])` under ≤639px) overrules card layouts — card tables opt out in their own modules with a winning `div.<scope>.<scope> > table { min-width: 0 }` (doubled class + element beats it regardless of bundle order). Never remove the global rule: legacy scroll-tables rely on it. Comment in `global.css` documents the opt-out.
- **No-clipping fit rule:** cards fit by wrapping/compressing content (`min-width: 0` chains, wrapping text, compressed chrome), never by `overflow: hidden` on rows (it reads as cut content). `overflow-x: clip` is a backstop only.
- **Grid min-width propagation:** layout grids need `.content > * { min-width: 0 }` (`AdminLayout.module.css`) + page shells (`display: grid; min-width: 0; max-width: 100%`); otherwise one nowrap descendant props the whole page sideways.
- **`FilterBar` collapsible filters (opt-in):** `filtersToggleLabel` (+ `filtersCollapseLabel`, default `Collapse Filters`) collapses filters behind a disclosure toggle on phones only; desktop always shows filters; pages without the prop render exactly as before.
- **Lookup UX model** (`CustomerLookupPage`): typing fills SUGGESTIONS only (prefix-first rank over latest fetched page, zero extra network; matched letters in `<mark>`; codes match behind the scenes, never printed); cards render solely for a picked suggestion (`selected` state; typing clears it); empty match = `Customer does not exist` (dropdown row + empty panel); Enter takes highlighted else top match; Escape closes with no card.
- **`SearchField` combobox prop (additive):** optional `combobox: { controlsId, expanded, activeOptionId?, onKeyDown? }` turns the input into `role=combobox`. Consequence: spec queries switch `searchbox` → `combobox` for wired inputs; unwired inputs unchanged.
- **TanStack v5 gotcha:** a DISABLED query reports `isPending: true` — gate skeletons/loaders on the debounced term too, not `isPending` alone.
- **Spec hygiene:** this repo never clears mocks between tests — assert mock counts relative to a per-test baseline, or leftover `mockImplementationOnce` queues poison later tests. Prefer `findBy*` over sync queries after any debounce/fetch boundary (pending-state UI renders first).
- **Headless CSS debugging:** `playwright-core` (global) + system Chrome + `vite build` dist CSS + static HTML using real hashed classes; measure `scrollWidth` vs viewport per element. Caveats: CSS-module hashes rotate per build (name AND numeric suffix) — re-extract after every build; LightningCSS merges rules, strips attribute-selector quotes, and rewrites media queries (`width<=639px`) — grep loosely. Scratch lives in `AppData/Local/Temp/opencode/` (outside repo, never committed). `dist/` is gitignored.

## This session's work (all committed; HEAD `c6c3576`)

1. **Dashboard** (`2e025cd` + follow-ups): Sales Overview latest-point-centered trend (`buildCenteredSeries`: `n-1` future axis slots, null plots, shaded upcoming zone, `ReferenceDot`, footnote); hero + elevated panels + KPI strip redesign; breadcrumb `Dashboard` crumb removed on `/admin` (returns null, deeper trails keep home link); page full-width (no max-width); `MetricCard` single-row fluid figures (nowrap + ellipsis + length tiers + `cqw` clamp); titles → `Payment Schemes` / `Card Plans`; top strips removed; fixed 4 headline cards (`Total Customers`, `New Applications`, `Card Sales`, `Total Sales` for all operational scopes; org/redemption keep own sets); hover lift removed; per-card color stories without left spine; topbar wordmark (`topbarLeading`) removed.
2. **Sales module mobile** (`c93bae4`): card-collapse + labels + floor-kill on customers/applications/reservations/categories/ledger tables; `responsive-cards.spec.tsx` guard; identity cell (avatar + brand name) on customers; `appRef`/`resRef` pills on application/reservation refs; Actions trigger docked into Name row on phones (absolute, label dropped, separator removed); content-sized badges (`flex: 0 1 auto`); `Expand Filters` on customers/applications/reservations; Import/Export → primary green; list-section shells + clip backstops; reservations detail already responsive (no change).
3. **Customer lookup** (`c6c3576`): live debounced search, no button; skeleton + `Looking for Customer…` line (first load only); tier-artwork cards (`tierArtwork()`, contain-fit, prospects get cardless placeholder), per-tier `data-tier` themes, fact icons; 5-word header description; Title-Case fact labels; suggestion dropdown (prefix-first, `<mark>` highlight, keyboard + ARIA listbox, no codes); pick-to-view cards; `Customer does not exist` states; `SearchField` combobox wiring; 22/22 specs.

## Open threads (need user input or a follow-up task)

- **Em-dash removal on reservation detail** (explicitly pending): ~8 remain, incl. `'Not created — created when the purchase is finalized'`, which `reservation-detail-panel.spec.tsx:220` asserts verbatim — update both together.
- `AfHomesQueueCards` is exported + tested but rendered nowhere — delete it if it stays unused.
- Conditional dashboard notices (upperline / unattributed-sale) deliberately kept; user may want them cut too.
- Suggestion dropdown shows `Searching…` during the ~300ms debounce gap (fetch not yet started); harmless.
- Picked lookup card holds its row object across the 30s poll (accepted); a background poll error while a pick is shown stays invisible (accepted).
- Payment Scheme Guide + detail/editor screens verified responsive by inspection only (no headless pass); same for post-fix customers page beyond the measured table subtree.

## Known load-sensitive flakes (all pass in isolation; intermittent under parallel load)

- `business/CustomerDetailPage.spec.tsx` (`renders the full record…`): "Loading customer" skeleton still showing. Reproduced on a stashed (business-dir) tree; also passed a later full clean run. Flake.
- `features/documents/documents.spec.tsx` #37 (retry/recovers).
- `api/_lib/customer-import-security.spec.ts` (tiny-ZIP zip-bomb): reproduced on a FULLY stashed clean tree (`git stash push -u`, 0 files modified) → pre-existing.
- `afhomes/role-access-review.spec.tsx`: one failure in a full run, clean on re-run.

## Verify (from root)

```sh
pnpm --filter @afhomes/admin exec tsc --noEmit
pnpm --filter @afhomes/admin exec eslint src/features/<dir>   # 0 errors expected
pnpm --filter @afhomes/admin exec vitest run src/features/<dir>
pnpm --filter @afhomes/admin test                             # full suite
pnpm typecheck:deploy                                         # all 7 workspaces
# For any new guard: revert the defect, watch it fail, restore.
```
