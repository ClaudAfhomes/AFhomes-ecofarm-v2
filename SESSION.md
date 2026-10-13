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
`packages/shared` (BigInt money + canonical `formatMoney`, new `formatCount`) |
`packages/config` (`VITE_`-only) | `packages/ui` (tokens + primitives).
SSOT doc: `docs/AFHOMES-PHASE-1-PLAN.md` (`AGENTS.md` is stale past Phase 5).
Branch: `orly/develop`. All session work UNCOMMITTED (see file list below).

## Standing user preferences (apply without asking)

- No em dashes (—) in user-facing copy; use colons/commas/parentheses.
- Descriptions/hints trimmed to 5–6 words.
- Primary actions green (`Button` default); secondary for alternates; destructive = `danger`.
- Content loaders = `Skeleton`; button loaders = in-button `Spinner` (`loading` + `loadingLabel`). No standalone spinners on any worked surface.
- First-load skeletons cover the WHOLE page (header, filters, table); refetches keep chrome mounted (see skeleton rule below).
- Shared primitives over raw controls (`Select`, `SearchField`, `FilterBar`, `Pagination`, `StatusChip`, `Alert`, `Table` family, `OverflowMenu`, `TierBadge`, `MetricCard`).
- Dropdown options show names only (no IDs/numbers in labels).
- Money/values ALWAYS grouped (`formatMoney`; counts via `formatPoints`/`formatCount`: `8000` → `8,000`); never raw `₱{…}` concat; never show a sale UUID.
- Closed enums are dropdowns, never free text (Imported Tier → Select); workbook imports sanitized to the closed set.
- Field labels humanized (`Reservation Date`, `TIN Number`); never render raw state keys. Status badges capitalized (`payment_in_progress` → `Payment in progress` via `SALE_STATUS_LABEL`/`humanizeCode` + tone map; unknown codes fall back capitalized neutral, never snake_case).
- Headings are stable product titles, never role strings (`Operations Overview`, not `Super Admin Dashboard`); subtitles only when they add info the scope strip doesn't.
- Status communicates with label + icon + tone, never color alone; cancelled = red + close icon. Tiers are metallic identity (`TierBadge`), never semantic tones.
- Tables: header `--color-bg-surface`, body `--color-bg-surface-raised` (white); figures tabular-nums.
- Server is the security boundary; nav/guards are UX-only.
- CSS Modules per component; tokens from `@afhomes/ui`; Prettier (`semi/singleQuote/100/trailingComma`).
- No unused vocabulary: dead code, dead CSS classes, dead exports are removed, not left.
- A test that cannot fail is not a test: new guards are proven by revert-and-fail (temporarily restore the defect, watch the guard fire, restore).
- Flake standard: pass-in-isolation is not proof; reproduce on clean tree via `git stash` before calling anything pre-existing.
- Mobile: tables become labelled cards (never sideways scroll); `overflow: clip` backstops, never `overflow: hidden` as the fix (clip hides, fit first).
- User directs page-by-page; keep scope to the named surface. No implementation without explicit `build`.

## Established patterns (follow in future tasks)

- Paged lists: service `getXPage()` via `requestListEnvelope` → `{data,total}`; page state in queryKey, `placeholderData` previous, shrink-clamp, shared `Pagination` (`page={safePage+1}`), stacked footer (controls over range text).
- Clickable rows: `tr[tabIndex=0][role=link]` + Enter/Space + plain-text first cell + `.clickable` hover + focus-visible outline. Row-menu wrapper stops propagation (`data-row-menu` + closest guard) so menu use never activates the row.
- Row actions live in `OverflowMenu` (`Actions for {number}` trigger; `menuitem` roles; icons per action; disabled mirrors permission). Tests open the menu, then pick the `menuitem` (helpers: `openRowMenu`/`pickMenuItem`).
- Read-only detail dialogs + actions in the menu (reservation details pattern): dialogs never mutate what they display; Record/Verify/Print/Finalize stay in row menus or dialog footers fed by parent state.
- Sidebar highlight is longest-match; hidden routes keep explicit guards in `navigation.ts: canAccessNavTarget`.
- `FilterBar` bottom-aligns so bare search inputs sit level with labeled controls. Search placeholders name the searchable fields (verified against the handler's `matchesSearch` list).
- Invalid fields turn red via global `aria-invalid` rule in `apps/admin/src/styles/global.css` (stays AFTER base control rules — all `:where()`, source order decides).
- Editor save/submit: `loading` + `loadingLabel`, disable-gates preserved (`loading` auto-disables); blocker lists render as inline warning Alerts; never silent grey buttons.
- File inputs: hidden native input + `Button` trigger + `Selected: {name}` status; IST import uses `::file-selector-button` restyle + filename/size status + `aria-labelledby` to the visible title.
- Local image thumbnails via `URL.createObjectURL` in `useMemo` + cleanup-only revoke effect (never setState-in-effect; jsdom lacks it → guarded try/catch).
- Editor error states branch per cause (401/403/404/parse/network) with actionable text; never render server internals or stored values.
- **Skeletons must never replace live controls.** Re-keying a query flips `isPending`, which unmounts whatever the skeleton replaces — losing focus/caret mid-keystroke. First load may replace the screen; refetches must keep chrome (tabs, search, filters) mounted. Use `placeholderData: keepPreviousData` so `isPending` only ever means a genuine first load (`BusinessProductsPage.tsx` is the reference). Focus-preservation regression test included there.
- Closed-tier selects use an `isVipTier` type guard + workbook sanitization, so a value with no matching `<option>` can never leave state out of step with the display.
- Bar-in-cell (`ShareCell`): decorative share bar behind the exact formatted figure; ratio via `Number()` is display-only geometry, never a stored/compared figure (comment says so). Same rule for `progressPercent` on the finance queue.
- Money max across rows via `compareMoney` reduce with `'0.00'` seed + `?? '0.00'` (query data may be undefined); dynamic CSS-module lookup needs a `cls(...names: (string|undefined)[])` joiner because `styles[key]` types as `string | undefined`.
- Plan tone inferred from published plan NAME (`GOLD/SILVER/BRONZE` substring); schemes mapped by frozen code. Unknown → neutral; never guessed. `tierFromProductName` feeds the shared `TierBadge`.
- Tests asserting paid/loaded state must wait for hydration first (page seeds state from the loaded record via effect; importing/acting before it lands races it).
- **Raw-table mobile cards:** `data-label` per `td` + ≤639px collapse grammar mirroring `@afhomes/ui` Table (thead hidden, labelled flex rows, card chrome, lead cell unlabeled as title) + `responsive-cards.spec.tsx` pins every cell's label per table.
- **Global 640px scroll floor** (`apps/admin/src/styles/global.css`, `.table-scroll > table:not([class])` under ≤639px) overrules card layouts — card tables opt out in their own modules with a winning `div.<scope>.<scope> > table { min-width: 0 }` (doubled class + element beats it regardless of bundle order). Never remove the global rule: legacy scroll-tables rely on it. Comment in `global.css` documents the opt-out.
- **No-clipping fit rule:** cards fit by wrapping/compressing content (`min-width: 0` chains, wrapping text, compressed chrome), never by `overflow: hidden` on rows (it reads as cut content). `overflow-x: clip` is a backstop only.
- **Grid min-width propagation:** layout grids need `.content > * { min-width: 0 }` (`AdminLayout.module.css`) + page shells (`display: grid; min-width: 0; max-width: 100%`); otherwise one nowrap descendant props the whole page sideways.
- **`FilterBar` collapsible filters (opt-in):** `filtersToggleLabel` (+ `filtersCollapseLabel`, default `Collapse Filters`) collapses filters behind a disclosure toggle on phones only; desktop always shows filters; pages without the prop render exactly as before.
- **Lookup UX model** (`CustomerLookupPage`): typing fills SUGGESTIONS only (prefix-first rank over latest fetched page, zero extra network; matched letters in `<mark>`; codes match behind the scenes, never printed); cards render solely for a picked suggestion (`selected` state; typing clears it); empty match = `Customer does not exist` (dropdown row + empty panel); Enter takes highlighted else top match; Escape closes with no card.
- **`SearchField` combobox prop (additive):** optional `combobox: { controlsId, expanded, activeOptionId?, onKeyDown? }` turns the input into `role=combobox`. Consequence: spec queries switch `searchbox` → `combobox` for wired inputs; unwired inputs unchanged.
- **TanStack v5 gotcha:** a DISABLED query reports `isPending: true` — gate skeletons/loaders on the debounced term too, not `isPending` alone.
- **Spec hygiene:** this repo never clears mocks between tests — assert mock counts relative to a per-test baseline, or leftover `mockImplementationOnce` queues poison later tests. Prefer `findBy*` over sync queries after any debounce/fetch boundary (pending-state UI renders first). Sync queries right after `fireEvent` race the fetch; use `findBy*`.
- **vi.stubGlobal mid-test anomaly (unexplained):** re-stubbing `fetch` mid-test provoked zero subsequent fetches in the finance queue suite (two independent reproductions); pre-installed conditional mocks work deterministically. For slow/hung-fetch tests, install the conditional behavior BEFORE render, never re-stub mid-test.
- **Headless CSS debugging:** `playwright-core` (global) + system Chrome + `vite build` dist CSS + static HTML using real hashed classes; measure `scrollWidth` vs viewport per element. Caveats: CSS-module hashes rotate per build (name AND numeric suffix) — re-extract after every build; LightningCSS merges rules, strips attribute-selector quotes, and rewrites media queries (`width<=639px`) — grep loosely. Scratch lives in `AppData/Local/Temp/opencode/` (outside repo, never committed). `dist/` is gitignored.

## This session's work (UNCOMMITTED on `orly/develop`)

Files touched: `apps/admin` (RequireRole, dashboard ×4, business finance ×6 incl. new module CSS, memberships lookup ×3, responsive + filterbar specs), `api/_handlers/{queues,phase26-finance.spec}.ts`, `packages/shared` (new `numbers.ts` + spec + index export).

1. **Dashboard gating + formatting:** Sales Overview (chart, heading, scheme/plan tables, headline sales cards) hides without `sales.card_sales` view (`filterSalesMetrics`, `canViewModule` precedent from queue cards). New `@afhomes/shared` `formatCount` (`8000` → `8,000`, fail-loud like `formatMoney`) applied to headline cards, breakdown cells, trend KPIs/tooltips/axis, unattributed notice.
2. **Dashboard skeleton-only:** hero text skeletonized during load; `Spinner` removed from `AfHomesTrendChart` (early `TrendChartSkeleton` return) and `RequireRole` gate (hero + card skeleton grid); trend/chart/panel skeletons re-spaced to loaded rhythm; specs pin absence of all static text + spinners during load.
3. **Customer lookup skeletons:** spinners + loading lines removed (status `aria-label` announces); skeleton matched to card layout (32px fact-icon tiles, pill chip, 26px title, mirrored suggestion rows using real `suggestOption` layout); mobile art keeps 16/9; final count = **2 skeleton cards** per user call.
4. **Finance payments redesign** (`BusinessFinanceQueuePage`, new dedicated module CSS): forest hero (readable light ink) + count chips; compact `MetricCard` strip; `FilterBar` (search guide placeholder verified against `matchesSearch` + client-side status filter + honest counts); 10→6 columns (Record pill, Name, TierBadge Plan, Balance + progress paint, Status, menu); clickable rows (role=link, keyboard, hover); all actions in `OverflowMenu`; capitalized toned badges (`SALE_STATUS_LABEL/TONE`, `humanizeCode` fallback); read-only `ReservationDetails` dialog; row click opens Record; Record/Verify dialogs redesigned (identity heroes, grouped sections); skeleton-only loading everywhere incl. dialog bodies/timelines.
5. **Perf/correctness audit:** API capped the queue at 50 rows while the client dropped `meta.total` (silent tail loss) → client reads at `FINANCE_QUEUE_LIMIT=200` via envelope, shows "N of M" + `Queue capped` Alert; server `buildReservationQueue` now counts pre-slice (mirrors `buildQueue`); `keepPreviousData` kills search flashes; `formatPoints` formatter hoisted. Security pass clean (no `innerHTML`, server-authoritative mutations, no excess PII).
6. **Revert-and-fail proofs done:** api `13b` (4-vs-6 on old code), `keepPreviousData` test (fails with option off), truncation + no-flash UI tests.

## Open threads (need user input or a follow-up task)

- Full pagination UI for the finance queue (still capped at 200 with an alert, by design for now).
- `AfHomesQueueCards` is exported + tested but rendered nowhere — delete it if it stays unused.
- Interactive element nested in `role=link` rows (menu button inside clickable `tr`): works via propagation guards, but flagged as an a11y smell.
- `SearchField` `busy` intentionally NOT passed on polling pages (would SR-announce every 15s poll).
- Em-dash removal on reservation detail (from prior session, still pending).

## Known load-sensitive flakes (all pass in isolation; intermittent under parallel load)

- `business/CustomerDetailPage.spec.tsx`, `business/reservation-detail-panel.spec.tsx`: reproduced on stashed trees; green solo.
- `api/_lib/customer-import-security.spec.ts` (tiny-ZIP zip-bomb): reproduced on a FULLY stashed clean tree → pre-existing, unrelated.
- `afhomes/role-access-review.spec.tsx`: one failure in a full run, clean on re-run.

## Verify (from root)

```sh
pnpm --filter @afhomes/admin exec tsc --noEmit
pnpm --filter @afhomes/admin exec eslint src/features/<dir>   # 0 errors expected
pnpm --filter @afhomes/admin exec vitest run src/features/<dir>
pnpm --filter @afhomes/admin test                             # full suite: 759/759 at handoff
pnpm --filter api exec vitest run phase26-finance             # incl. 13b meta.total guard
pnpm typecheck:deploy                                         # all 7 workspaces
# For any new guard: revert the defect, watch it fail, restore.
```
