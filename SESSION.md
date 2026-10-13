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
`packages/shared` (BigInt money, `formatMoney`/`formatMoneyOrDash`,
`formatCount`/`formatCountOrDash`, `formatCompactMoney`, UTC date helpers) |
`packages/config` (`VITE_`-only) | `packages/ui` (tokens + primitives +
`DateField`/`TextAreaField`/`FileField`, tier artwork + assets).
`docs/` was deleted in the working tree (unstaged); `AGENTS.md` is the
authority and now documents frontend conventions too. Branch:
`claud/develop`. All session work UNCOMMITTED.

## Standing user preferences (apply without asking)

- No em dashes (—) in user-facing copy; use colons/commas/parentheses.
- Descriptions/hints trimmed to 5–6 words.
- Primary actions green (`Button` default); secondary for alternates; destructive = `danger`.
- Content loaders = `Skeleton`; button loaders = in-button `Spinner` (`loading` + `loadingLabel`). No standalone spinners on any worked surface.
- First-load skeletons cover the WHOLE page (header, filters, table); refetches keep chrome mounted (see skeleton rule below).
- Shared primitives over raw controls (`Select`, `TextField`, `DateField`, `TextAreaField`, `FileField`, `SearchField`, `FilterBar`, `Pagination`, `StatusChip`, `Alert`, `Table` family, `OverflowMenu`, `TierBadge`, `MetricCard`).
- Dropdown options show names only (no IDs/numbers in labels).
- Money/values ALWAYS grouped (`formatMoneyOrDash` for nullable display, fail-loud core; counts via `formatCountOrDash`); never raw `₱{…}`/`₱${…}` concat; never show a sale UUID.
- Member-facing instants use shared UTC helpers (`formatUTCDate`); staff console stays browser-zone (`lib/format`, now null-tolerant). Never mix for one instant.
- Closed enums are dropdowns, never free text (Imported Tier → Select); workbook imports sanitized to the closed set.
- Field labels humanized (`Reservation Date`, `TIN Number`); never render raw state keys. Status badges capitalized (`payment_in_progress` → `Payment in progress` via `SALE_STATUS_LABEL`/`humanizeCode` + tone map; unknown codes fall back capitalized neutral, never snake_case).
- Labeled primitives mark optional fields with "(Optional)": specs assert the MARKED name. `required` must mirror the original control; adding it where none existed hard-blocks submission via native validation (proven by ost.spec regression).
- Headings are stable product titles, never role strings (`Operations Overview`, not `Super Admin Dashboard`); subtitles only when they add info the scope strip doesn't.
- Status communicates with label + icon + tone, never color alone; cancelled = red + close icon. Tiers are metallic identity (`TierBadge`), never semantic tones.
- Tables: header `--color-bg-surface`, body `--color-bg-surface-raised` (white); figures tabular-nums.
- Server is the security boundary; nav/guards are UX-only.
- CSS Modules per component; tokens in `@afhomes/ui`; Prettier (`semi/singleQuote/100/trailingComma`). Repo files are CRLF: prettier `--check` fails repo-wide on endings alone (environmental); verify new-file formatting LF-normalized instead.
- No unused vocabulary: dead code, dead CSS classes, dead exports are removed, not left.
- A test that cannot fail is not a test: new guards are proven by revert-and-fail (temporarily restore the defect, watch the guard fire, restore).
- Flake standard: pass-in-isolation is not proof; reproduce on clean tree via `git stash` before calling anything pre-existing.
- Mobile: tables become labelled cards (never sideways scroll); `overflow: clip` backstops, never `overflow: hidden` as the fix (clip hides, fit first).
- User directs page-by-page; keep scope to the named surface. No implementation without explicit `build`.

## Established patterns (follow in future tasks)

- Paged lists: service `getXPage()` via `requestListEnvelope` → `{data,total}`; page state in queryKey, `placeholderData` previous, shrink-clamp, shared `Pagination` (`page={safePage+1}`), stacked footer (controls over range text).
- Business query keys come ONLY from `features/business/queryKeys.ts` (pinned by `queryKeys.spec.ts`, incl. scope-prefix invariants); invalidation uses the matching scope, never a literal. Known quirk: `['business','activation-queue']` invalidation matches nothing (kept as-is, pending review).
- Mutations use `useBusinessMutation` (`apps/admin/src/lib/`): same-payload double submits coalesce, different payloads run concurrently; `mutate`/`mutateAsync`/`on*` semantics unchanged. Manual `useSingleFlight` wrappers in FinanceQueue/OfficialForms left in place (harmless, money-path caution).
- Services split per domain (`services-{card-plans,customers,applications,reservations,sales,commissions}.ts`, each with local `post`/`patch` per `points-services` precedent) + `services.ts` barrel. Dropped: business `getMemberships`/`getReferrals` (zero importers).
- OfficialForms split: `official-forms-fields.tsx` (exported kit) + `-applications` + `-reservations` + barrel. Reservations imports `humanizeApplicationIssues` from applications (one-way).
- Admin routes split per feature (`React.lazy` + `.then(m => ({default}))` in `App.tsx`; auth/layout/guards eager; shell-mounted `Suspense` + skeleton fallback at `AdminLayout` Outlet). Recharts loads behind its own skeleton (`AfHomesTrendChartSkeleton.tsx` split out). Dashboard chunk 392KB → 14KB.
- Tier artwork lives in `@afhomes/ui` (`tier-artwork.ts` + assets); admin/web/marketing import from there. No cross-app `apps/**` source imports (only comments reference across).
- Clickable rows: `tr[tabIndex=0][role=link]` + Enter/Space + plain-text first cell + `.clickable` hover + focus-visible outline. Row-menu wrapper stops propagation (`data-row-menu` + closest guard) so menu use never activates the row.
- Row actions live in `OverflowMenu` (`Actions for {number}` trigger; `menuitem` roles; icons per action; disabled mirrors permission). Tests open the menu, then pick the `menuitem` (helpers: `openRowMenu`/`pickMenuItem`).
- Read-only detail dialogs + actions in the menu (reservation details pattern): dialogs never mutate what they display; Record/Verify/Print/Finalize stay in row menus or dialog footers fed by parent state.
- Sidebar highlight is longest-match; hidden routes keep explicit guards in `navigation.ts: canAccessNavTarget`.
- `FilterBar` bottom-aligns so bare search inputs sit level with labeled controls. Search placeholders name the searchable fields (verified against the handler's `matchesSearch` list).
- Invalid fields turn red via global `aria-invalid` rule in `apps/admin/src/styles/global.css` (stays AFTER base control rules — all `:where()`, source order decides).
- Editor save/submit: `loading` + `loadingLabel`, disable-gates preserved (`loading` auto-disables); blocker lists render as inline warning Alerts; never silent grey buttons.
- File inputs: hidden native input + `Button` trigger + `Selected: {name}` status (kept in CustomerImportExport, OfficialForms); IST import uses `::file-selector-button` restyle (kept); elsewhere `FileField` with `status` slot.
- `Select` has no `multiple` and no label of its own: multi-selects stay native; outer `<label>` wrappers are REQUIRED (do not nest labeled primitives inside `<label>`, it doubles the accessible name).
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
- **Specs vs lazy routes:** App-rendering specs must await the chunk (`findBy*`, never sync queries post-render; chart tests need longer timeouts for first-transform). Never stub the global `URL` constructor with a plain object: dynamic `import()` needs `new URL()` — subclass it (`reports-audit.spec.tsx` beforeEach is the reference).
- **vi.stubGlobal mid-test anomaly (unexplained):** re-stubbing `fetch` mid-test provoked zero subsequent fetches in the finance queue suite (two independent reproductions); pre-installed conditional mocks work deterministically. For slow/hung-fetch tests, install the conditional behavior BEFORE render, never re-stub mid-test.
- **CRLF repo:** the `edit` tool fights CRLF (verify every edited region; use node script repairs with `\r\n`-aware matching). Never `git stash` mid-build with hundreds of changed files (noisy, risky); bisect by reverting single files instead.
- **Headless CSS debugging:** `playwright-core` (global) + system Chrome + `vite build` dist CSS + static HTML using real hashed classes; measure `scrollWidth` vs viewport per element. Caveats: CSS-module hashes rotate per build (name AND numeric suffix) — re-extract after every build; LightningCSS merges rules, strips attribute-selector quotes, and rewrites media queries (`width<=639px`) — grep loosely. Scratch lives in `AppData/Local/Temp/opencode/` (outside repo, never committed). `dist/` is gitignored.

## This session's work (UNCOMMITTED on `claud/develop`)

Cleanup (user-verified list): deleted root junk (`C:Users…log`, `e staff invite…`, `tatus`), `legacy/` (680 files), `CHANGELOG.md`, `scripts/gen-phase5-reconciliation.mjs`, `AfHomesQueueCards.tsx` + spec. Updated `AGENTS.md` (authority rewritten for cleanup + frontend conventions) and `README.md` (legacy/docs refs removed). Description trims (5 words): activation queue, commissions.

Frontend best-practices build (all phases): shared `formatMoneyOrDash`/`formatCount[OrDash]`/`formatCompactMoney`/`formatUTCDate[Time]` + specs; 17-file importer migration; 9 raw-₱ sites fixed; `queryKeys.ts` + pinning spec with full business migration; `useBusinessMutation` + 35-file rollout; services 6-way split + barrel (export parity checked); OfficialForms 3-way split + barrel; ui `DateField`/`TextAreaField`/`FileField` + `Select` disabled options; ~100 control migrations (select/date/file/textarea/labeled-text) with required-mirroring + spec updates; admin lazy routes + chart split; ost/reports/account inline styles → modules; tierArtwork → `@afhomes/ui`; 6 ad-hoc admin date sites centralized.

New files: `packages/shared/{numbers,dates}.ts` + specs, `business/queryKeys.ts` + spec, `business/services-{card-plans,customers,applications,reservations,sales,commissions}.ts`, `business/official-forms-{fields,applications,reservations}.tsx`, `lib/useBusinessMutation.ts` + spec, `ui/{tier-artwork,tier-artwork.spec}`, `ui/components/{DateField,TextAreaField,FileField,field-kit.spec}`, `AfHomesTrendChartSkeleton.tsx`, 5 CSS modules (MyAccount, Ost×3, AuditPage).

Revert-and-fail proofs done: shared fail-loud guard, queryKeys pinning, required-default convention, URL-subclass necessity (plain object breaks lazy).

## Open threads (need user input or a follow-up task)

- Business-feature inline styles (~100 sites) remain native; convert per page when touched.
- Checkboxes, number/url/datetime-local inputs, multi-selects, dynamic-type mapped inputs: no primitives, intentionally native (global styles cover).
- Marketing CMS numbers stay `toLocaleString()` (content-driven resilience over strictness).
- Customer portal claim/camera controls stay portal-styled (deliberate surface design).
- Dead `['business','activation-queue']` invalidation (no-op, commented, pending review).
- Full pagination UI for the finance queue (still capped by design).
- `supabase/` operator half of `pnpm typecheck` not re-run (untouched); api suite not run (untouched).
- Reservation-detail em-dash removal (prior session, still pending).

## Known load-sensitive flakes (all pass in isolation; sets rotate run to run)

- `business/CustomerDetailPage.spec.tsx`, `business/final-blockers.spec.tsx`, `documents.spec.tsx` (35/37), `reports-audit.spec.tsx`, `reports-live.spec.tsx`, `responsive.spec.tsx`, `RequireRole.spec.tsx` (auth redirects), `staff-lifecycle.spec.tsx` (gating), `analytics-dashboard.spec.tsx` (chart-chunk timing; 39/40 has 5s timeout).
- Pre-existing, unrelated: `api/_lib/customer-import-security.spec.ts` (tiny-ZIP zip-bomb).

## Verify (from root)

```sh
pnpm typecheck:deploy                                         # 7/7 at handoff
pnpm --filter @afhomes/admin test                             # 775/775 at handoff
pnpm --filter @afhomes/web test                               # 240/240 at handoff
pnpm --filter @afhomes/ui test                                # 202/202 at handoff
pnpm --filter @afhomes/shared test                            # 40/40 at handoff
pnpm --filter @afhomes/contracts test                         # 226/226 at handoff
pnpm --filter @afhomes/admin exec vite build                  # per-page chunks; dashboard 14KB
pnpm --filter @afhomes/web exec vite build                    # card webp emits from ui assets
pnpm --filter @afhomes/admin exec eslint src/features src/lib src/app  # 0 errors
# For any new guard: revert the defect, watch it fail, restore.
```
