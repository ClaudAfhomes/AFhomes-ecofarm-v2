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

## This session's work (uncommitted; Dashboard + Products + Guide + Reservations)

1. **Reservations list** (`OfficialFormsPages.tsx`): header copy → 5 words (`Only agreements needing reservation work.`); Sale column removed entirely (earlier `saleNumber` enrichment in contracts + handler + specs was fully reverted as dead); `ReservationStatusBadge` (new): pipeline track + per-status icons, cancelled = red `close` icon; TierBadge in tier column; header `--color-bg-surface`, rows `--color-bg-surface-raised`; queue summary counts; clearer empty-state copy.
2. **Reservation detail/editor**: full redesign on `panel`/`formRoot`/`editorGrid`/`stickyFooter`; `fieldLabel()` humanizer (camelCase → Title Case, `tinNumber` → `TIN Number` override); `Imported tier context…` → 2-word `Imported Tier` dropdown (closed set + `isVipTier` + workbook sanitization); IST import control restyle with status line + `aria-labelledby`; Export XLSX green (primary); description → 6-word `Server-derived snapshots. Schedule rows are obligations.`
3. **Products page** (`BusinessProductsPage` + new own stylesheet; shared `WorkflowCards` untouched): Search button removed (live debounced search; form wrapper gone; `busy={refreshing}`); View Details modal → hero (artwork/code/status/category), benefit/option pills, footer hierarchy (Edit primary, Deactivate danger, Close ghost); full `CatalogSkeleton` + `keepPreviousData` (fixes the focus-destruction bug above).
4. **Payment Scheme Guide**: numbered section cards, internal-flow stepper (rail + nodes), golden-rules checklist, move pills, table captions, Print guide button, `GuideSkeleton`; confidentiality `Alert` deliberately kept ABOVE the loading branch (a warning must not blink in with the data it warns about).
5. **Dashboard**: target layout = 4 cards + 1 graph + 2 tables. Removed: quick actions (+ `dashboardActions`/`ACTIONS` export and its 2 unit tests — no other caller), queue-cards render (component + its 15 specs untouched, still tested in isolation), More-metrics/Team/Commission strips, header subtitle, 4 metric descriptions, both table captions. Kept: static `Operations Overview` title, period select inside Key metrics (`aside` slot), scope strip, conditional notices. All figures via shared `formatMoney`. Tables colored by data (scheme tones, plan metallic tones, share bars). Dead CSS pruned (`.strip*`, `.actions`, `.scope`, `.timeframe`, `.tableWrap` + hover rule). `useSession` removed from the page.

## Open threads (need user input or a follow-up task)

- **Em-dash removal on reservation detail** (explicitly pending): ~8 remain, incl. `'Not created — created when the purchase is finalized'`, which `reservation-detail-panel.spec.tsx:220` asserts verbatim — update both together.
- **Self-scope metric descriptions** (`My customers`, `My sales`) were NOT removed; only the 4 quoted globals were.
- Removed dashboard figures (metrics tail, commission states, team, queue entry points) now live only in queues/reports — no dashboard surface shows them.
- Conditional notices (upperline / unattributed-sale) deliberately kept; user may want them cut too.
- `AfHomesQueueCards` is exported + tested but rendered nowhere — delete it if it stays unused.

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
