# AF Homes × JAD UI Parity — Inventory & Migration Record

Source of truth for UI/UX: JAD Realty `develop`
(`orlando-afhomes/jadrealty-platform`, inspected file-by-file via
`raw.githubusercontent.com/.../develop/...` on 2026-09-29 — never from memory).
Business/domain source: AF Homes only. JAD business modules (Properties,
Vouchers, member registration, sales logic) were never ported; only
visual/presentation architecture.

Brand rule: **JAD controls the UI system, AF Homes controls the brand.**
JAD brand blue (`#2c6aa7`) / navy (`#142b47`) / JA&D logo / realty imagery are
deliberately NOT ported. AF Homes forest green (`#174f3b`) / deep green
(`#0e2b20`) / harvest gold / "AF Homes Ecofarm" wordmark stay.

## 1. Parity matrix

| JAD component / pattern | JAD source | AF Homes equivalent (before) | Visual / behavior difference | Action taken | Risk |
|---|---|---|---|---|---|
| Design tokens | `packages/ui/src/styles/tokens.css` | `packages/ui/src/styles/tokens.css` | Structure, spacing, radii, shadows, z-scale, breakpoints **identical**; only brand/accent hexes differ (green/gold vs blue/gold) | None — verified, documented | None |
| AppShell (sidebar 240/64px, sticky topbar, drawer <1024px, bottomNav slot) | `packages/ui/.../AppShell.tsx/.module.css` | Same path | Byte-identical structure | None | None |
| Sidebar / Topbar / MobileDrawer / BottomNav / Breadcrumbs | same | Same paths | Identical (dark rail `#0e2b20` remapped to AF deep green by token, not by fork) | None | None |
| Button (primary/secondary/ghost/danger + loading) | `Button.tsx/.module.css` | Same | Identical | None | None |
| Dialog / ConfirmDialog | `Dialog.tsx`, `ConfirmDialog.tsx` | Same | Identical structure (portal, focus trap, Esc, bottom-sheet ≤639px) | None | None |
| DetailCard / Table / Pagination / Select / Tabs / Icon | same | Same | Identical incl. mobile card-rows, windowed pagination | None | None |
| Skeleton / Spinner / EmptyState / ErrorState / Forbidden / NotFound / PageHeader / StatusChip / UserMenu | same | Same | Identical | None | None |
| notify (SweetAlert2 modal wrappers) | `packages/ui/src/notify.ts` | Same | Identical (`jad-swal-*` classes kept intentionally) | None | None |
| AuthLayout (editorial split + mobile masthead) | `apps/web/.../auth/components/AuthLayout.tsx/.module.css` | **Missing** — 26rem centered panel per page | No brand panel, no masthead, raw inputs, no eye toggle, text-swap buttons, paragraph errors | **Created `AuthLayout` in `@jad/ui`** (AF brand gradient panel + wordmark, same class grammar) | Low — presentation only; auth flows untouched |
| FormField / TextField / PasswordField / Alert | `FormField.tsx`, `TextField.tsx`, `PasswordField.tsx`, `Alert.tsx` (+ css) | **Missing** — hand-rolled label/input per page | No required-marker, no 48px inputs, no focus ring wash, no `role=alert` errors | **Created all four in `@jad/ui`** (JAD structure, AF tokens) | Low |
| Staff login | `LoginPage.tsx/.module.css` | `AdminLoginPage.tsx` (centered panel) | See AuthLayout row + no validation focus mgmt | **Migrated to AuthLayout + TextField + PasswordField + Alert + loading Button** | Low — `signIn` + redirect logic unchanged |
| Staff activation `/admin/activate-account` | n/a (JAD has no invite flow; styled to login/reset grammar) | Same centered panel, raw password inputs | Looked like a separate app | **Migrated to AuthLayout**; invite→password→signout→login flow byte-preserved | Low — security flow untouched |
| Staff forgot / reset password | `ForgotPasswordPage`, `ResetPasswordPage` | Same centered panel | Same | **Migrated both to AuthLayout**; Supabase recovery logic untouched | Low |
| Customer login/activate/forgot/reset | same JAD auth grammar | Centered panel + raw inputs | Unrelated to staff login | **Migrated all four to AuthLayout** ("Customer Portal" brand lead); token-fragment handling, anti-enumeration message, recovery separation untouched | Low |
| Dashboard queue cards | `DashboardPage.tsx` (QueueCard: icon tile + StatusChip + count + label + desc) | `AfHomesDashboardPage` custom `.metric` (small+strong only) | No icon, no chip, tabular-nums missing, `1rem/0.75rem` instead of token scale | **Created canonical `MetricCard` in `@jad/ui`; dashboard renders metric grids with it** | Low — `dashboardMetrics()` pure fn unchanged (spec pins it) |
| SalesTrendChart (card + head + KPI strip + chart box) | `SalesTrendChart.tsx/.module.css` | CSS bars in unstyled section, raw `<table>` for plans | No card container, no KPI strip, raw table breaks mobile card pattern | **Restyled trend + sales-by-plan into JAD chart-card grammar** (KPI sums derived from same `trends` array; Table primitives for plans). No recharts: AF Homes has no chart dep and calculations must not change; bars keep `title` tooltips + `role=img` | Low — data mapping untouched |
| Period switching | Segmented toggles + Select | JAD `Select` in PageHeader | Already JAD UI | Kept `Select` (4 options suit a select, not a segmented row, on 390px) | None |
| Filter toolbars | Per-page JAD toolbar grammar | Hand-rolled per page | No canonical component | **Created `FilterBar` in `@jad/ui`** (search/filters/actions, wraps ≤639px); adoption per page is follow-up | Low |
| Finance queues / activation / commissions | JAD admin module grammar | Already on Table/Select/Dialog/StatusChip/ErrorState | At parity via shared primitives | Kept; activation delivery dialog stays, styled as native JAD dialog (already is) | None |
| Redemption POS / membership / genealogy / reports / audit / CMS | JAD module grammar | Already on shared primitives; POS keeps touch-friendly density | At parity | No change (POS deliberately not compressed to table density) | None |
| Customer portal (dashboard/card/points/profile) | Member `DashboardPage` (financial cards + tables + skeletons) | Portal cards + tables on shared primitives | Close; portal shell intentionally bespoke (not AppShell) | No change this pass; MetricCard available for follow-up | None |
| Public marketing site | JAD public site | AF Homes site (ported from real AF Homes site) | **Excluded by directive** | Untouched | None |

## 2. Files changed (this pass)

- `packages/ui/src/components/{AuthLayout,FormField,TextField,PasswordField,Alert,MetricCard,FilterBar}.tsx` + `.module.css` (new)
- `packages/ui/src/index.ts` (exports)
- `packages/ui/src/components/parity.spec.tsx` (new, 10 tests)
- `apps/admin/src/features/auth/{AdminLoginPage,AdminActivateAccountPage,AdminForgotPasswordPage,AdminResetPasswordPage}.tsx` + `AdminLoginPage.module.css` (JAD login grammar)
- `apps/admin/src/app/{AdminLayout.tsx,AdminLayout.module.css}` (mobile topbar wordmark = JAD `topbarLeading` slot)
- `apps/admin/src/features/afhomes/{AfHomesDashboardPage.tsx,AfHomesDashboardPage.module.css}` (MetricCard grids, chart-card, Table primitives, card skeletons)
- `apps/web/src/features/customer/{CustomerLoginPage,CustomerActivatePage,CustomerForgotPasswordPage,CustomerResetPasswordPage}.tsx` + `auth.module.css` (AuthLayout; legacy `.auth/.panel` classes kept for OST register page)

## 3. Preserved (regression-checked by existing suites)

- Staff invite → setup → own password → sign out → normal login (`staff-activation.spec`, 7 tests)
- Recovery request/classify/redirect, reset session gating, no secret sinks (`auth-recovery.spec`, customer `customer-recovery.spec`)
- Anti-enumeration login message, token-from-fragment + strip, activation→signIn (`customer-portal.spec`, 48 tests)
- `dashboardMetrics`/`dashboardActions` pure contracts (`AfHomesDashboardPage.spec`, `analytics-dashboard.spec` incl. 390px `.table-scroll` assertion — class retained)
- No backend, contract, migration, or permission change: `git status` shows UI + docs only.

## 4. Remaining differences (honest ledger)

1. No `recharts` dependency: trend visual is JAD-card grammar around the existing bar geometry, not the JAD SVG line/area chart. Deliberate (no new heavy dep; calculations unchanged).
2. JAD `fieldStyles.ts` shared-input module was folded into `FormField.module.css` (same values, one file).
3. JAD brand panel uses CMS property imagery; AF Homes uses a CSS deep-green gradient + text wordmark (no image asset, no CMS dependency).
4. `FilterBar` created but not yet adopted page-by-page; tables otherwise already use JAD Table grammar.
5. Customer portal cards not yet switched to `MetricCard`; POS intentionally keeps touch density.
6. No browser visual UAT captured this pass (no side-by-side harness); parity asserted by source-structural comparison + tests at 390/768/1440 via existing responsive specs.

## 5. Completion pass (2026-09-29 — closes items 1, 4, 5 above)

- **Chart (item 1 closed):** `recharts@^3.10.1` added to `@jad/admin` — the exact
  JAD implementation dependency, not a new chart stack. New
  `AfHomesTrendChart` reuses the JAD SalesTrendChart grammar verbatim
  (ComposedChart + Area + Line, 280px ResponsiveContainer, CartesianGrid,
  11px muted ticks, `preserveStartEnd` XAxis, abbreviated-money YAxis,
  styled Tooltip, segmented metric toggle, KPI strip, chartState
  loading/error, EmptyState no-data) over AF Homes role-scoped buckets
  (sale value / verified payments / count). Old bar geometry and its CSS
  removed. AF Homes keeps its day/week/month/year period Select as the
  granularity control (server buckets by it); no calculation changed.
- **FilterBar (item 4 closed):** new canonical `SearchField` (JAD search
  grammar: icon, 44px, raised surface, brand focus ring) and adoption on
  Staff, Sales, Customers, Card Plans, Commissions, Catalog, History,
  OST Applications, Memberships, Genealogy, Reports, Audit, Documents.
  Queues carry no FilterBar by design (status-defined, not filterable); the
  internal guide has no filterable surface. All query/apply/clear/pagination
  semantics preserved. `window.confirm` replaced by ConfirmDialog on the OST
  approve and credential-reissue actions (source-scanned by test).
- **Portal (item 5 closed):** customer dashboard restructured to the JAD
  member-dashboard grammar (PageHeader, KPI MetricCard grid with links,
  membership panel, recent activity) on existing data only; the membership
  card itself stays bespoke. Skeleton KPI loading, EmptyState for empty
  ledger.
- **Loading sweep:** CMS pages, catalog, reports, and audit now render
  JAD-style skeleton rows instead of text-only loaders.
- **Item 6 (browser UAT) remains open:** no desktop browser is connected in
  this environment (`browser.disconnected`), so live side-by-side screenshots
  were impossible. Substituted: source-structural comparison against the
  re-fetched JAD `develop` files + responsive specs (320/390/768/1024/1440)
  + FilterBar/chart/portal focused tests. Full PASS requires a connected
  browser run.
