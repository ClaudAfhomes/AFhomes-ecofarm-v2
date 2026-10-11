# AF Homes Points System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild AF Homes points so activation awards zero, points accrue only from eligible completed purchases, balances are capped per VIP tier per anniversary year, expire without rollover, and are redeemable as a cash discount — with a customer-bound QR claim flow and an immutable, reconcilable ledger.

**Architecture:** One new forward-only migration adds nine tables, four columns and the SQL functions that own every points mutation. All writes go through `SECURITY DEFINER` functions with a fixed lock order; the ledger stays append-only by privilege, exactly as the existing redemption flow does. The API adds a purchase/earning-claim/quote surface; the existing catalog redemption and card-sale commerce are untouched.

**Tech Stack:** PostgreSQL (PL/pgSQL, RLS, `SECURITY DEFINER`), Supabase Auth, TanStack Query v5, React 19 + Vite, Zod contracts in `packages/contracts`, Vitest, `@afhomes/ui` design system.

**Spec:** `docs/superpowers/specs/2026-10-09-points-system-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## 2026-10-10 reconstruction checklist (current scope)

The user-approved reconstruction supersedes the old spending and QR-link-only
requirements below. Existing migrations stay immutable; all SQL changes are new
forward-only files executed only against disposable loopback PostgreSQL. No
commit, push, shared Supabase apply, legacy reset, or deployment is authorized.
Target verified: claud-promote, claud/develop, HEAD 8ffdb35e8227c63a757f8cb084a53b42e7936a0c.
Existing uncommitted changes are authorized continuation input; preserve them.
UI reference: orly/develop commit d05a453 (page skeletons and action spinners),
and the existing @afhomes/ui Button/loading, Skeleton, and SweetAlert notify APIs.

| Issue | Actual source | Root cause / tests | Correction |
|---|---|---|---|
| Earning and spending errors | points.ts; points rebuild/tier discount/idempotency SQL | Browser EXECUTE trusts customer ID; service-role claim EXECUTE absent; sale uses client unitAmount. points.spec.ts and DB sections 65-68 miss authenticated spoof | Server-only claim ACL; server catalog pricing; real denial/pricing/ledger tests |
| Customer scanning/manual claiming | CustomerPointsPage.tsx; customer-claim.spec.tsx | Typed claim exists; camera/review absent; UI still promises spending | Shared scanner, QR/code review and explicit confirmation; preserve session-derived customer |
| Redemption lookup | RedemptionWorkflowPage.tsx; redemption.spec.tsx | Old identify/catalog/spend workflow still rendered | Replace with earning-claim queue; preserve sales member resolver |
| Use Points | BusinessPointsPage.tsx; PointsDiscountPage.tsx; App.tsx | Active spend controls/routes remain despite new API retirement | Remove spend UI/routes; keep accounting/history reads |
| Redemption Catalog | navigation.ts; App.tsx; RedemptionCatalogPage.tsx | Old spending catalog remains reachable | Retire navigation/write paths; preserve historical rows/read APIs |
| Claim queue | points-services.ts; points.ts | List/reissue exists but only inside discount investigation screen; insufficient purchase/service/actor context | Available/claimed/expired/reversed tabs with authorized one-time rotation |
| Earning history | RedemptionHistoryPage.tsx; claim SQL | Screen reads legacy spends; claimed row can retain reservation figure rather than actual award | Claim history + persist final awarded/capped figures; retain read-only legacy history |
| Service creation | PointsRulesPage.tsx; points contracts; service_catalog; marketing/Experiences.tsx | Manual code, minimal fields, no edit/upload/public data binding; CMS storage upload already exists | Server identifiers, complete editor/photos/availability/publication, existing earning and tier rules |

- [x] Security gate: `20261109000001_afhomes_claim_rpc_authorization.sql` revokes browser EXECUTE on `claim_earning_points`; DB section 68 asserts every browser role is false.
- [x] Phase 1: `20261108000001_afhomes_retire_points_spending.sql` revokes the four spend functions; routes, nav and clients removed; `legacy-history` and `/redemptions/resolve` retained.
- [x] Phase 2: `20261110000001_afhomes_claim_lifecycle_repair.sql` persists the real award, renews an expired reservation, and rotates safely; `RedemptionWorkflowPage` is the claim queue.
- [x] Phase 3: `packages/ui` `useQrScanner` is the single camera lifecycle; `CustomerPointsPage` scans or types into the SAME `claim_earning_points` call.
- [x] Phase 4: `save_service_catalog` / `append_service_photo` / `manage_service_photo`, `ServiceCatalogEditor`, private bucket, and published `/experiences` binding.
- [x] Phase 5: `create_purchase` prices from the catalog and the tier discount table; `purchase_payments` verified by Finance; claim only after `PURCHASE_NOT_SETTLED` is impossible.
- [x] Phase 6 gates: `pnpm test`, `typecheck`, `lint`, `build`, `check:env`, `test:db:local`, `test:db:harness`.

### 2026-10-10 loading-state and UI/UX pass

`orly/develop` (225dad5) is the read-only UI reference. Its `packages/ui` is
**already present** on claud/develop: every named component (Button, Skeleton,
Spinner, PageHeader, EmptyState, ErrorState, StatusChip, Table, Dialog,
FilterBar) is byte-identical, and claud/develop is the newer side of the only
differences (Sidebar, Pagination). So the component layer needed no work; the
pages were using it only half-way.

- [x] Removed every hand-written `<Spinner>` that duplicated a `Button` already
      rendering one, in `BusinessPointsPage`, `PurchasePaymentsPage`, `PointsRulesPage`.
- [x] Replaced `{isPending ? 'Verifying…' : 'Verify'}` text swaps with
      `loading` + `loadingLabel`, which also restores `aria-busy` and the
      `role="status"` announcement.
- [x] Every initial-load `Skeleton` now sits inside a `role="status"` region with
      `aria-busy`, because the Skeleton itself is `aria-hidden`.
- [x] `isPending` replaced with `isLoading` wherever a skeleton is gated on it.
      A DISABLED query keeps `isPending` true forever in TanStack Query v5, so a
      skeleton gated on it is a permanent loading state; `SalesRecordsPage`
      disables its claims query and was the real instance.
- [x] Wide operational tables wrapped in the shared `.table-scroll` contract with
      `role="region"`, `aria-label` and `tabIndex`, so 360px overflows inside the
      region instead of scrolling the page, and stays keyboard-reachable.
- [x] Public Experiences skeletons mirror the editorial row, and `isPending` →
      `isLoading` so a background refetch cannot blank a visible page.
- [x] Customer claim flow names every camera state (opening, ready, detected,
      denied, unavailable, failed) and never credits on detection alone.
- [x] Service photo upload previews the chosen file with a revoked blob URL and
      reports a bad file at selection time, not only on submit.
- [x] Regression tests: `loading-states.spec.tsx` (infinite skeleton, empty-state
      flash, no premature success) and `responsive.spec.tsx` (scroll-region
      contract on the three wide operational tables).

### Open, deliberately not done

- No browser UAT was run. There is no development/staging Supabase project, so
  camera capture, Storage upload and cross-session Finance verification cannot be
  exercised against a real Auth/Storage stack. Everything below is proven against
  a disposable loopback PostgreSQL and jsdom only.
- The claim queue filters by status through a `<select>`, not tabs. Functionally
  identical; revisit only if the queue grows enough to need them.
- `service_catalog.code` is server-generated but still stored. It is an internal
  identifier, never a customer claim code, and nothing presents it to a customer.

Persistent migration history is not available through the connected Supabase
account (it exposes only an unrelated inactive project). Do not infer applied
versions or modify any existing migration. Managed Auth/Storage/deployed exposure
must be reported separately from local PostgreSQL proof.
## Global Constraints

- Work only in `C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote`, branch `claud/develop`, base commit `a42ce6b`. No new branch, worktree, or repository.
- **Never edit or re-apply an applied migration.** The runner records only the filename prefix, no content hash (`supabase/apply-migrations.ts:334-355`), so a corrected body under a recorded version is never re-delivered. Every change ships as a NEW file.
- **Immutable, never touched:** `supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql` and `supabase/migrations/20261102000001_afhomes_customer_directory_workflow_filter.sql`. The second must **not** be applied.
- No shared-production apply, no production deploy, without explicit approval.
- **Money is exact-decimal `text`** with `CHECK (amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$')`. Render via `private.money(numeric)`. Never `to_char`. Never float.
- **Points are `bigint`, never money.** No `private.money`, no `numeric`, no rounding on any points column.
- Business timezone is **Asia/Manila**, date-based, half-open `period_start <= v_today < period_end`.
- Cap authority is `tier_points_config` only. Caps are 25,000 / 40,000 / 60,000.
- Ledger invariant, asserted after every operation: `points_accounts.balance - points_accounts.reversal_debt = SUM(points_ledger.amount)`.
- `counts_toward_cap` is always `true` for rows this release creates. No exemption path exists.
- Reversal debt: non-monetary, no automatic expiry, no waiver, earning never blocked, spending blocked while `> 0`.
- `total_loyalty_value` is display-only legacy metadata. It affects nothing: not points, redemption, caps, authorization, or eligibility.
- Prettier: `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`. CSS Modules per component; tokens from `@afhomes/ui`; no hardcoded px.
- Tests colocated `<target>.spec.ts(x)`. `pnpm test:db:local` and `pnpm test:db:harness` before any deploy.

## Review Focus

Inputs the spec requires but no single task's happy path covers.

1. **Points crossed exactly to a tier cap, then another purchase completes in the same period.** The second claim must reserve `0` and record the full requested amount as capped, not silently award or silently drop.
2. **A claim is claimed, then the purchase is reversed, and the member had already spent the points.** `balance` floors at 0, the remainder becomes debt, and the ledger still reconciles.
3. **A member activated 29 February.** The period must be 28 days shorter in each non-leap year and must return to 29 February in the next leap year — never drift permanently to the 28th.
4. **Two members scan the same QR at the same instant, one legitimate.** The rightful owner must still receive the points; the interloper gets a refusal that reveals nothing about whether the claim exists.
5. **A discount is committed against a quote created before a promotion expired.** The commit must refuse even though the quote is unexpired and the points were reserved.

---

## File Structure

**New — SQL (one migration, `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`)**

| Object | Responsibility |
|---|---|
| `tier_points_config` | Sole annual-cap authority, one row per tier |
| `points_periods` | Anniversary periods with tier/cap snapshots |
| `points_accounts.reversal_debt` | Non-monetary debt, nonnegative |
| `points_ledger` CHECK + `balance_before`, `counts_toward_cap`, `origin_award_id`, `origin_period_id` | Immutable attribution |
| `service_catalog`, `point_earning_rules` | Eligible services and configurable awards |
| `purchases`, `purchase_lines` | The missing transaction ledger |
| `purchase_payments` | **Separate** purchase-receipt model (decision 2) |
| `earning_claims` | Customer-bound one-time award with hash-only tokens |
| `point_redemption_rules`, `redemption_quotes` | Configurable points→peso conversion |
| `private.ensure_points_period(uuid)` | The single reset/period choke point |
| `private.points_capacity(uuid)` | Live `used`/`reserved` capacity arithmetic |
| `public.create_earning_claim(uuid, uuid)` | Staff: purchase → claim |
| `public.claim_earning_points(text)` | Customer: token → points |
| `public.reissue_earning_claim(uuid, uuid)` | Rotate tokens, preserve or renew expiry |
| `public.reverse_purchase_points(uuid, uuid, text)` | Reversal + debt |
| `public.quote_point_discount(uuid, bigint)` | Server-side quote |
| `public.commit_point_discount(uuid)` | Atomic spend |
| `public.purchase_financial_summary_purchases(uuid)` | gross/discount/net/received |
| `private.legacy_points_cutover()` | Transactional, idempotent, audited cutover |

**New — TypeScript**

| File | Responsibility |
|---|---|
| `api/_handlers/purchases.ts` | Staff purchase CRUD + completion |
| `api/_handlers/earning-claims.ts` | Staff claim create/list/reissue/reverse |
| `api/_handlers/point-rules.ts` | Earning + redemption rule CRUD |
| `api/_lib/points.ts` | Shared token normalization and refusal-code helpers |
| `apps/admin/src/features/points/` | `PointsRulesPage`, `ServiceCatalogPage`, `PointsAdjustmentPage` |
| `apps/admin/src/features/purchases/` | `PurchaseListPage`, `PurchaseDetailPage` |
| `apps/web/src/features/customer/CustomerPointsPage.tsx` (modify) | Cap, period, capacity, claim |
| `packages/contracts/src/schemas/points.ts` (new) | All points contracts |
| `packages/ui/src/components/LoadingTable.tsx` (new) | Shared table loading/empty/error composition |

**Modified:** `api/_lib/router.ts`, `api/_handlers/cards.ts`, `api/_handlers/reports.ts`, `api/_handlers/analytics.ts`, `packages/contracts/src/schemas/lifecycle.ts`, `packages/contracts/src/schemas/sales.ts`, `packages/contracts/src/index.ts`, `apps/admin/src/app/navigation.ts`, `apps/admin/src/app/App.tsx`, `apps/web/src/app/App.tsx`.

**Untouched:** `redeem_membership_points`, `redemption_items`, `redemptions`, `card_sales`, `payments`, `api/_lib/identifier.ts`, both protected migrations.

---

## Dependency Graph

```
Task 1  (migration skeleton + no-op)
   └─ Task 2  (tier config + periods + debt)
         └─ Task 3  (ledger columns + CHECK)
               ├─ Task 4  (ensure_points_period + capacity)
               │     └─ Task 5  (cutover)  ← needs Task 6 for audit events? no: independent
               └─ Task 6  (catalog + earning rules)
                     └─ Task 7  (purchases)
                           └─ Task 8  (earning claims + create RPC)
                                 ├─ Task 9  (claim + reissue RPCs)
                                 ├─ Task 10 (reversal + debt RPC)
                                 └─ Task 13 (discount rules + quotes)  ← needs Task 4, 7
                                       └─ Task 14 (commit discount)
                                             └─ Task 18 (finance reporting)
Task 11 (contracts) ── parallel from Task 1, needed by 12/15/16/17
Task 12 (API: purchases+claims)   ← after 8
Task 15 (API: rules)              ← after 6, 11
Task 16 (Admin UI)                ← after 12, 15
Task 17 (Customer UI)             ← after 9, 14, 11
Task 19 (Loading standard)        ← after 1 (LoadingTable), before 16/17 verify
Task 20 (activation rewrite)      ← after 3, 2
```

Task 5 (cutover) is deliberately **after** Task 4 and **parallel to** Task 6 — it is the only task that mutates existing rows.

Task 11 (contracts) starts after Task 3 and runs parallel to the SQL work, since nothing in the database depends on it.

---

### Task 1: Migration skeleton and module vocabulary

**Files:**
- Create: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (add empty section 59)

**Interfaces:**
- Consumes: nothing.
- Produces: migration file `20261104000001` with a header comment, the new `modules` rows needed later, and DB-suite section 59 as the home for points-rebuild checks.

- [ ] **Step 1: Write the failing test**

Add to `supabase/db-integration.ts` a section 59 that asserts the migration version is registered and applies cleanly:

```ts
section('59 points rebuild foundation', () => {
  check('the points rebuild migration is applied', async () => {
    const r = await q(`select 1 from supabase_migrations.schema_migrations
                        where version = '20261104000001'`);
    eq(r.length, 1);
  });
  check('no points rebuild object is half-created', async () => {
    // every object the migration declares must exist OR not exist yet,
    // never a function with no table or vice versa
  });
});
```

The full table-existence check lives in Task 7, once all nine tables exist — asserting it here would leave the suite red for six tasks.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx pnpm test:db:local`
Expected: FAIL — `to_regclass` returns `null` for every table.

- [ ] **Step 3: Create the migration file with header and validation queries**

Write `supabase/migrations/20261104000001_afhomes_points_rebuild.sql` with the standard header (purpose, validation queries, down note — copy the structure of `20261031000001_afhomes_communications_foundation.sql`), then a `begin`/`commit` wrapper is **not** used: the runner already wraps each file in one transaction (`supabase/apply-migrations.ts:341-347`). End the file with a comment reserving Tasks 2–10.

- [ ] **Step 4: Run it to verify the harness is still green**

Run: `npx pnpm test:db:local`
Expected: the new section fails, everything before it passes. The runner applies the file (it is a valid no-op) and records version `20261104000001`.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 2: Tier config, periods, reversal debt

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Task 1.
- Produces: `tier_points_config(tier text pk, annual_points_cap bigint)`, `points_periods(id, account_id, period_start, period_end, tier, annual_points_cap, opening_balance, closing_balance, status, reset_at, reset_source, reset_actor_id, authoritative_from)` with `unique(account_id, period_start)`; `points_accounts.reversal_debt bigint not null default 0 check (>= 0)`; `memberships.points_anniversary date` for the stored anchor.

- [ ] **Step 1: Write the failing tests**

```ts
check('tier caps are seeded', async () => {
  const r = await q(`select tier, annual_points_cap from tier_points_config order by tier`);
  eq(r, [['BRONZE',25000n],['GOLD',60000n],['SILVER',40000n]]);
});

check('reversal debt is nonnegative', async () => {
  const r = await q(`select 1 from points_accounts where reversal_debt < 0`);
  eq(r, []);
});

check('period rejects an inverted range', async () => {
  await throws(async () => q(`insert into points_periods
    (account_id, period_start, period_end, tier, annual_points_cap)
    select id, '2026-01-01', '2025-01-01', 'GOLD', 60000
    from points_accounts limit 1`));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL, relation `tier_points_config` does not exist.

- [ ] **Step 3: Add the DDL**

Append the three objects exactly as specified in the spec §4.2, §4.3, §4.4, plus:

```sql
alter table public.memberships
  add column points_anniversary date;
```

`points_anniversary` stores `(activated_at at time zone 'Asia/Manila')::date`, set by Task 20 on activation and backfilled in Task 5. `points_periods` gets `constraint points_periods_half_open check (period_start < period_end)`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 3: Ledger attribution columns and entry types

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)
- Modify: `packages/contracts/src/schemas/lifecycle.ts:105-111`

**Interfaces:**
- Consumes: Task 2.
- Produces: `points_ledger.balance_before bigint`, `counts_toward_cap boolean not null default true`, `origin_award_id bigint references points_ledger(id)`, `origin_period_id uuid references points_periods(id)`; `entry_type` CHECK widened to 9 values; `pointsEntryTypeSchema` widened to match.

- [ ] **Step 1: Write the failing test**

```ts
check('ledger accepts earned and annual_reset', async () => {
  await q(`insert into points_ledger
    (account_id, entry_type, amount, balance_after, balance_before, origin_period_id)
    select a.id, 'earned', 5, 5, 0, p.id
    from points_accounts a join points_periods p on p.account_id = a.id limit 1`);
});
```

Plus a contracts test in `packages/contracts/src/schemas/lifecycle.spec.ts` asserting `pointsEntryTypeSchema` parses `'annual_reset'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL, CHECK constraint violation. And `pnpm --filter @afhomes/contracts exec vitest run src/schemas/lifecycle.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Widen the CHECK and add columns**

Drop and re-add the `entry_type` CHECK with all 9 values. `annual_allocation` and `expiration` are **kept** for historical rows. Add the four columns. The existing `points_ledger_one_allocation_per_year` partial unique index is **retained, not dropped**.

- [ ] **Step 4: Widen `pointsEntryTypeSchema`**

In `packages/contracts/src/schemas/lifecycle.ts`, extend the `z.enum` with `'earned' | 'annual_reset' | 'promotional_bonus' | 'cutover_baseline'`. Existing pinned tests that enumerate the five values must be updated in the same step — grep for `annual_allocation` in spec files and update each.

- [ ] **Step 5: Run to verify they pass**

Run: `npx pnpm test:db:local` and `pnpm --filter @afhomes/contracts exec vitest run`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 4: The period choke point and capacity arithmetic

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 2, 3.
- Produces:
  - `private.ensure_points_period(p_account_id uuid) returns uuid` — the period id. Locks account + period rows, walks all missed boundaries, idempotent.

`private.points_capacity` is created in **Task 8**, not here: it reads `earning_claims`, which Task 8 creates. Defining it now would fail at creation time. Task 4's capacity tests move with it.

- [ ] **Step 1: Write the failing tests**

```ts
check('ensure_points_period opens an anniversary period', async () => {
  const pid = await rpc(`select private.ensure_points_period($1)`, [accountId]);
  const r = await q(`select period_start, period_end, tier, annual_points_cap
                      from points_periods where id = $1`, [pid]);
  eq(r, [['2025-10-09', '2026-10-09', 'GOLD', 60000n]]);
});

check('ensure_points_period is idempotent', async () => {
  const a = await rpc(`select private.ensure_points_period($1)`, [accountId]);
  const b = await rpc(`select private.ensure_points_period($1)`, [accountId]);
  eq(a, b);
});

check('a Feb 29 anchor does not drift to Feb 28', async () => {
  // membership activated 2024-02-29; assert period 1 ends 2025-02-28
  // and period 4 starts 2028-02-29
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL, function does not exist.

- [ ] **Step 3: Implement `ensure_points_period`**

Lock order: `points_accounts` then `points_periods`, both `for update`. Compute `v_anchor := coalesce(m.points_anniversary, (m.activated_at at time zone 'Asia/Manila')::date)`. Loop from the current period forward while `v_today >= v_end`, closing each with an `annual_reset` ledger row of `-closing_balance`, setting `closing_balance = balance before reset`, leaving `reversal_debt` untouched. Open the current period with the tier from `card_plans.code` and the cap from `tier_points_config`, using `insert ... on conflict (account_id, period_start) do nothing`.

Every balance change writes exactly one ledger row in the same transaction — this is what keeps the invariant.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 6: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 5: Legacy cutover to zero

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 2, 3.
- Produces: `private.legacy_points_cutover()` — sets every `points_accounts.balance = 0`, `reversal_debt = 0`, `memberships.points_balance = 0`, writes a `cutover_baseline` row of `-S` where the legacy ledger sum `S <> 0`, opens the in-progress period with `opening_balance = null` and `authoritative_from = cutover date`, backfills `points_anniversary`, and appends one `audit_events` row per account recording previous balance, previous ledger total, discrepancy, cutover timestamp and reason.

- [ ] **Step 1: Write the failing tests**

```ts
check('every account is zero after cutover', async () => {
  eq(await q(`select 1 from points_accounts where balance <> 0 or reversal_debt <> 0`), []);
});
check('the ledger reconciles after cutover', async () => {
  eq(await q(`select 1 from points_accounts a
    where a.balance - a.reversal_debt <> coalesce(
      (select sum(l.amount) from points_ledger l where l.account_id = a.id), 0)`), []);
});
check('cutover history is preserved', async () => {
  // pre-cutover row count for entry_type in ('annual_allocation','redemption','adjustment')
  // is unchanged; cutover_baseline rows == accounts whose legacy sum <> 0
});
check('cutover is idempotent', async () => {
  await rpc(`select private.legacy_points_cutover()`);
  // second call writes no additional cutover_baseline rows
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Implement the cutover**

Guard with an `audit_events` marker so a second run is a no-op. Derive the adjustment from the **ledger total `S`**, never from the cached balance, so any `S <> B` discrepancy is recorded rather than hidden. Do **not** touch customer identities, memberships, activation dates, card products, or unrelated financial records.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` then `npx pnpm test:db:harness`
Expected: PASS, and the harness confirms the suite still fails closed on injected fault.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 6: Service catalog and earning rules

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Task 1.
- Produces: `service_catalog(id, code unique, name, description, base_price text money-check, is_active, created_at, updated_at)`; `point_earning_rules(id, service_id, points_amount bigint > 0, eligible_tiers text[] <@ ARRAY['BRONZE','SILVER','GOLD'], effective_start date, effective_end date, is_active, min_quantity, max_award, promotion_reference, created_by, created_at)`. **No `counts_toward_cap` column** (decision 03).

- [ ] **Step 1: Write the failing tests**

```ts
check('earning rules cannot be inverted', async () => { /* throws */ });
check('an expired rule is not eligible', async () => { /* now() outside window */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Add the DDL**

Exactly the spec §4.7 DDL, minus the cap-exemption column. Seed nothing — services and rules are admin-created, so no shipping code hardcodes "Teppanyaki = 1000".

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 7: Purchases and purchase lines

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Task 6.
- Produces: `purchases(id, purchase_number unique, customer_id, membership_id, status in ('draft','completed','reversed'), gross_amount text, points_discount_amount text not null default '0.00', net_amount text, completed_at, reversed_at, reversal_reason, created_by, created_at, updated_at)`; `purchase_lines(id, purchase_id, service_id, quantity, unit_amount text, line_total text)`; **`purchase_payments(id, payment_number unique, purchase_id, amount text money-check positive, method, reference, status in ('recorded','verified','rejected','voided'), recorded_by, verified_by, recorded_at, verified_at, rejection_reason, voided_at, created_at)`**.

**`purchase_payments` is a separate model, not a reuse of `public.payments`.** Inspection confirmed `public.payments` cannot carry purchase receipts: `payments_purchase_origin_check` (`20261101000001:119-121`) is a closed CHECK admitting only `origin='sale'` or `origin='reservation'`, and `verify_purchase_payment_once` (`20261101000001`, signature) operates on reservation agreements against `card_sales`. The card-sale payment workflow is **untouched**.

`purchases` carries the accounting triple required by decision 2 — see Task 15 for the full representation and the completion gate.

- [ ] **Step 1: Write the failing tests**

```ts
check('a purchase cannot complete twice', async () => { /* completed_at not null => no re-complete */ });
check('net equals gross minus discount', async () => {
  // CHECK (net_amount::numeric = gross_amount::numeric - points_discount_amount::numeric)
});
check('money columns reject bad decimals', async () => { /* '1.234' rejected */ });
check('completion requires verified receipts to cover the net', async () => {
  // 50,000.00 gross, 25,000.00 discount, 25,000.00 net, only 20,000.00 verified => throws
});
check('a discount is never recorded as a receipt', async () => {
  // purchase_payments has no points column; the discount reduces net only
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Add the DDL**

Per spec §4.8 plus the three money columns and the `purchase_payments` table. Every money column gets the standard money CHECK. `points_discount_amount` is money; the **points** quantity that produced it lives in `redemption_quotes.points_requested`, not here. `purchase_payments.amount` uses the **positive-only** money regex `'^[1-9][0-9]*(\.[0-9]{1,2})?$'`, matching `public.payments.amount` (`20260926023325:244`) — a receipt is never zero.

`purchase_payments` gets `unique(purchase_id, reference) where reference is not null`, mirroring `payments_sale_reference_unique`, plus a `purchase_payments_purchase_status_idx`.

Completion and claim eligibility both require `sum(purchase_payments.amount) where status='verified' and status<>'voided'` to cover `net_amount`. That sum lives in `private.purchase_verified_total(uuid)`, which Task 8 and Task 14 both call so the gate cannot drift between them.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 8: Earning claims and the staff create RPC

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 4, 7.
- Produces: `earning_claims` per spec §4.9, with **nullable** `qr_token_hash` / `fallback_code_hash` and partial unique indexes `earning_claims_qr_uidx`, `earning_claims_fallback_uidx`; index `points_ledger_one_earned_per_claim on points_ledger (reference_id) where entry_type = 'earned' and reference_type = 'earning_claim'`; `public.create_earning_claim(p_purchase_id uuid, p_actor_id uuid) returns uuid`.
- Business IDs: register `AF-TXN` and `AF-EARN` in `private.claim_af_id`'s hardcoded allowlist (`20261026000001:96-114`) and `private.af_candidate`'s prefix list (`:56-67`).
- `private.points_capacity(p_account_id uuid, p_period_id uuid) returns bigint` — `greatest(0, cap - used - reserved)`. `SECURITY DEFINER`, revoked from `public, anon, authenticated`, granted `service_role`. Defined here because it reads `earning_claims`.

- [ ] **Step 1: Write the failing tests**

```ts
check('one claim per purchase', async () => {
  // second create for the same purchase violates earning_claims_purchase_id_key
});
check('a completed purchase with no eligible rule makes no claim', async () => {
  // and no points
});
check('capacity is reserved at creation', async () => {
  // create two claims totalling more than capacity; the second reserves the remainder
});
check('a rotated-away token no longer resolves', async () => { /* reissue then old QR */ });
check('capacity subtracts used and reserved', async () => {
  // 60,000 cap, one 1,000 earned, one 5,000 available claim => 54,000
});
check('an elapsed reservation stops consuming capacity with no job', async () => {
  // set expires_at in the past; capacity returns to cap - used
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Add the DDL and the RPC**

`create_earning_claim` re-validates `p_actor_id` in SQL against `staff_users` (status `active`), requires `purchases.status = 'completed'`, requires `private.purchase_verified_total(p_purchase_id) >= net_amount` (decision 2 — verified receipts must cover the net before claim eligibility), and requires the customer and membership to be **active at purchase completion** (decision 3). It then resolves the rule (active, in date, tier eligible, **highest `points_amount` wins**), calls `private.ensure_points_period`, locks the period `for update`, reads `private.points_capacity`, reserves `least(requested, capacity)`, mints both tokens via `private.new_qr_token()` / `private.new_fallback_code()` stored through `private.hash_token()`, and returns the claim id. It never accepts a points figure from the caller.

**Decision 3 — eligibility is fixed at creation.** Active customer and active membership are required when the claim is created. Membership expiry *after* creation does **not** invalidate the claim: it remains claimable until `expires_at` or period end, whichever is first. Only customer status is re-checked at claim time.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 9: Claim and reissue RPCs

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)
- Create: `api/_lib/points.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces: `public.claim_earning_points(p_token text) returns table(claim_number text, awarded bigint, capped bigint, balance_after bigint)` — `security invoker`, identity from `auth.uid()`; `public.reissue_earning_claim(p_claim_id uuid, p_actor_id uuid) returns table(qr_token text, fallback_code text, expires_at timestamptz)` — `security definer`, staff-validated.
- `api/_lib/points.ts` exports `normalizeClaimToken(raw: string): string` reusing the `api/_lib/identifier.ts` rules: the `AFH-XXXX-XXXX` fallback is case- and separator-normalized; the base64 QR is trimmed only.

- [ ] **Step 1: Write the failing tests**

```ts
check('the rightful owner receives points', async () => { /* auth.uid() = owner */ });
check('a different customer receives zero', async () => {
  // throws CLAIM_NOT_OWNER, and the message reveals nothing about existence
});
check('a second claim awards nothing further', async () => { /* status already 'claimed' */ });
check('concurrent double-scan awards once', async () => {
  // two real concurrent rpc calls; exactly one 'earned' row
});
check('an unauthenticated call resolves to no customer', async () => { /* auth.uid() null */ });
check('reissue of an unexpired claim preserves expires_at', async () => { /* deep equal */ });
check('reissue of an expired claim takes a fresh reservation and expiry', async () => { /* >= now(), new slice */ });
check('reissue of a claimed claim is refused', async () => { /* throws */ });
check('QR and fallback resolve to the same claim', async () => { /* same claim id */ });
```

Handler spec `api/_handlers/earning-claims.spec.ts` uses the Supabase fake: assert the claim token contains no PII by checking the minted token is 32 random bytes with no substring from the customer fixture, and that the request contract has **no** `pointsAwarded` field.

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL, function does not exist.

- [ ] **Step 3: Implement `claim_earning_points`**

Lock order **claim → period → account**. Derive the customer:

```sql
select c.id into v_customer_id from public.customers c where c.auth_user_id = auth.uid();
```

`v_customer_id` is null ⇒ refuse. Compare to `v_claim.customer_id`; mismatch ⇒ generic `CLAIM_NOT_OWNER`.

**Decision 3 — what is re-checked at claim time.** The customer must be `active`. `inactive` or `suspended` refuses with `CUSTOMER_NOT_ACTIVE` until the account is eligible again. The **membership is not re-checked**: eligibility was fixed when the claim was created, so a membership that has since expired does not invalidate the claim. The claim stays claimable until `expires_at` or period end, whichever is first. An elapsed `expires_at` transitions the claim to `expired` and refuses.

**Decision 4 — the token is a URL, not a bare string.** `p_token` accepts either the opaque QR/fallback credential **or** a full AF Homes claim URL. Extract the credential from a URL whose path matches the claim route, then hash it; reject anything else before touching the database. This is a pure parse-then-verify, and the server still resolves ownership before consuming the claim.

```sql
update public.earning_claims set status = 'claimed', claimed_at = now()
 where id = v_claim.id and status = 'available'
 returning * into v_claimed;
```

Zero rows ⇒ `CLAIM_ALREADY_CLAIMED`. Insert one `earned` row with `balance_before`, `balance_after`, `origin_period_id`, `counts_toward_cap = true`, and `requested_points` / `awarded_points` / `capped_points` in metadata. Update the account and the `memberships.points_balance` cache in the same transaction. Append `audit_events`.

- [ ] **Step 4: Implement `reissue_earning_claim`**

Two cases per decision 12. **Unexpired `available`:** overwrite both hashes, keep `expires_at`, no reservation change. **Expired:** re-validate customer/membership status and re-validate the rule is still eligible today, then take a fresh reservation under the period lock and set `expires_at := least(now() + interval '24 hours', period_end)`. **`claimed` ⇒ refuse.** Every path writes an `audit_events` row. Plaintext tokens are returned exactly once.

- [ ] **Step 5: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 6: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 10: Reversal, debt, and the state matrix

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 4, 8.
- Produces: `public.reverse_purchase_points(p_purchase_id uuid, p_actor_id uuid, p_reason text) returns table(reversed_points bigint, reversal_debt bigint)`.

- [ ] **Step 1: Write the failing tests**

```ts
check('an available unexpired claim reverses with no ledger row and no debt', async () => {
  // count points_ledger rows before/after is equal; reversal_debt stays 0
});
check('an expired unclaimed claim reverses with no debt', async () => { /* debt 0 */ });
check('a claimed reversal may create debt', async () => {
  // earn 1000, spend 800, reverse 1000 => balance 0, debt 800
});
check('the invariant holds after every reversal shape', async () => { /* the §4.4 check */ });
check('reversal is idempotent', async () => { /* second call returns the original */ });
check('a cross-period reversal restores the origin period capacity', async () => {
  // origin_period_id = P while the balance effect lands in the current period
});
check('debt has no automatic expiry across a reset', async () => { /* debt survives ensure_points_period */ });
check('earning repays debt first and never blocks', async () => {
  // balance 0, debt 800, earn 1000 => debt 0, balance 200
});
check('spending is blocked while debt exists', async () => { /* throws */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Implement the state matrix**

Lock order **claim → period → account**. Branch on claim status exactly per spec §5.7. For `claimed`: write the `reversal` row with `origin_award_id` and `origin_period_id`, set `purchases.status = 'reversed'`, then deduct `min(award, balance)` and add the remainder to `reversal_debt`. For both `available` states: set the claim to `reversed`, release the reservation, write **no** ledger row. Already `reversed`: return the original. No claim row: reverse the purchase with no points event.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 11: Points contracts

**Files:**
- Create: `packages/contracts/src/schemas/points.ts`
- Create: `packages/contracts/src/schemas/points.spec.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `pointsAmountSchema` (int, non-negative), `tierSchema` (`'BRONZE'|'SILVER'|'GOLD'`), `customerPointsSummarySchema` (`membershipId`, `balance`, `annualCap`, `remainingEarningCapacity`, `spendable`, `reversalDebt`, `periodStart`, `periodEnd`, `tier`, `earnedThisPeriod`, `redeemedThisPeriod`), `earningClaimSchema`, `redemptionQuoteSchema` (`pointsRequested`, `pesoValue`, `ruleId`, `expiresAt`), `purchaseSchema`, `pointEarningRuleSchema`, `pointRedemptionRuleSchema`. Re-export all from `index.ts`.

`redemptionQuoteSchema` has **no** peso value supplied by the client — it is a response type. The request contract `createDiscountQuoteSchema` carries only `purchaseId` and `pointsRequested`.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects a client-supplied peso value on a quote request', () => {
  expect(createDiscountQuoteSchema.safeParse({ purchaseId: '…', pointsRequested: 100, pesoValue: '1.00' }).success).toBe(false);
});
it('rejects a non-integer point amount', () => { /* 1.5 */ });
it('parses the nine ledger entry types', () => { /* annual_reset */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @afhomes/contracts exec vitest run src/schemas/points.spec.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write the schemas**

Reuse `exactDecimalStringSchema` from `./money.js` for every money field. `remainingEarningCapacity` is `bigint`-backed but travels as `number` in JSON, matching `customerPointsSummarySchema` today.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @afhomes/contracts exec vitest run` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 12: Purchases, claims and rules API

**Files:**
- Create: `api/_handlers/purchases.ts`, `api/_handlers/earning-claims.ts`, `api/_handlers/point-rules.ts`
- Modify: `api/_lib/router.ts` (add three `BUSINESS_FAMILIES` entries)
- Create: `api/_handlers/purchases.spec.ts`, `api/_handlers/earning-claims.spec.ts`, `api/_handlers/point-rules.spec.ts`

**Interfaces:**
- Consumes: Tasks 8, 9, 10, 11.
- Produces router families: `purchases` → module `sales.customers`; `earning-claims` → module `operations.redemption`; `point-rules` → module `operations.catalog`. **No new module keys** (spec §6).

- [ ] **Step 1: Write the failing tests**

```ts
// authorization matrix per module, using the existing PERMISSIONS_* pattern
it('refuses claim creation without operations.redemption create', …);
it('refuses rule edits without operations.catalog update', …);
it('never sends a points figure to the server', () => {
  // POST /earning-claims body is only { purchaseId, serviceId }
});
it('refuses to read another customer claim', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @afhomes/api exec vitest run api/_handlers/purchases.spec.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the handlers**

Follow `api/_handlers/redemptions.ts` exactly: `authorizeAfHomes(req, module, action)`, `REFUSALS` map, `okList`/`ok` helpers from `handler-kit.ts`. Every handler calls the SQL RPC; no handler computes a points figure or a balance. Add the three families to `BUSINESS_FAMILIES` in `api/_lib/router.ts` with the same comment style as the `redemptions` entry.

- [ ] **Step 4: Run the route-coverage guard**

Run: `pnpm --filter @afhomes/api exec vitest run api/_lib/route-coverage.spec.ts` — Expected: PASS, no unreachable handler.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @afhomes/api exec vitest run` — Expected: PASS.

- [ ] **Step 6: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 13: Discount rules and quotes

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 4, 7, 11.
- Produces: `point_redemption_rules` and `redemption_quotes` per spec §4.11; `public.quote_point_discount(p_purchase_id uuid, p_points_requested bigint) returns table(quote_id uuid, quote_number text, points_requested bigint, peso_value text, remaining_after text, expires_at timestamptz)`.

- [ ] **Step 1: Write the failing tests**

```ts
check('an expired promotion yields no quote', async () => { /* now() outside window */ });
check('a quote never exceeds the purchase net', async () => { /* discount <= net amount due */ });
check('min and max are enforced', async () => { /* both bounds */ });
check('an ineligible tier yields no quote', async () => { /* BRONZE on a Silver/Gold rule */ });
check('peso value is computed from the rule, not the request', async () => {
  // 25,000 points at peso_value_per_point 1.0000 on a 50,000.00 purchase => '25000.00'
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Add the DDL and RPC**

`peso_value_per_point numeric(12,4) check (> 0)` is the **configured** conversion — 1 point = ₱1 is a row, never a constant. `peso_value` is computed as `private.money(p_points_requested * peso_value_per_point)`, so it is a money `text`. The quote pins `rule_id`; commit re-validates the rule is still active and in date.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 14: Commit the discount atomically

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 4, 13.
- Produces: `public.commit_point_discount(p_quote_id uuid) returns table(quote_number text, points_spent bigint, peso_value text, net_amount text, balance_after bigint)`, `security invoker`, identity from `auth.uid()`.

- [ ] **Step 1: Write the failing tests**

```ts
check('commit deducts atomically and writes one ledger row', …);
check('commit is refused when the rule expired after the quote', …);
check('commit is refused for an ineligible tier', …);
check('commit is refused below min points', …);
check('commit is refused above max points', …);
check('commit is refused when the purchase cannot support it', …);
check('commit is refused while reversal debt exists', …);
check('concurrent commits cannot double-spend', async () => {
  // two real concurrent commits; balance falls by exactly one quote's points
});
check('a quote cannot be committed twice', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL.

- [ ] **Step 3: Implement the commit**

Lock order **account → period → quote → purchase → rule**, matching the spec. Re-verify all eleven conditions. Recompute `peso_value` server-side from the rule; never read it from the quote request. Write one `redemption` ledger row, update `points_accounts` and the `memberships.points_balance` cache, update `purchases.points_discount_amount` and `net_amount`, and set the quote to `committed` — all in one transaction.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 15: Finance reporting distinguishes gross, discount, net, received

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `api/_handlers/reports.ts`
- Modify: `packages/contracts/src/schemas/reports.ts`
- Modify: `api/_handlers/phase30-reports.spec.ts`

**Interfaces:**
- Consumes: Tasks 7, 14.
- Produces: `public.purchase_financial_summary_purchases(p_purchase_id uuid) returns jsonb` returning exactly `grossAmount`, `pointsDiscountAmount`, `netAmount`, `recordedTotal`, `verifiedTotal`, `rejectedTotal`, `remainingBalance`, `overpaidAmount`, `fullyPaid`. A new `buildPurchasePoints` report and a `pointsDiscountTotal` field added to `buildSales`'s summary.

- [ ] **Step 1: Write the failing tests**

```ts
it('reports gross, discount, net and received separately', …);
it('the discount is never counted as a payment', async () => {
  // a 50,000.00 purchase with a 25,000.00 discount and one 25,000.00 verified payment
  // => grossAmount 50000.00, pointsDiscountAmount 25000.00, netAmount 25000.00, verifiedTotal 25000.00, fullyPaid true
});
it('a zero-discount purchase reports a zero discount, not a null', …);
```

Critically: assert `payments` is **never** written by the discount path — the discount is a purchase adjustment, not a payment row.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @afhomes/api exec vitest run api/_handlers/phase30-reports.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the summary RPC and report**

Mirror the shape of `public.purchase_financial_summary` (`20261101000001:807-883`) exactly, including the `recorded/verified/rejected` triple filtered on `status <> 'voided'`. `net_amount` is **not** derived from payments: it is `purchases.net_amount`, which is `gross − points_discount`. `fullyPaid` compares `verifiedTotal` against `netAmount`, so a discount genuinely reduces what must be paid.

All sums use `private.money` and the existing BigInt helpers (`sumMoney` in `api/_lib/report-scope.ts:109`). Never `Number()` on money.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @afhomes/api exec vitest run` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 16: Admin points UI

**Files:**
- Create: `apps/admin/src/features/points/PointsRulesPage.tsx` + `.module.css`, `ServiceCatalogPage.tsx`, `PointsAdjustmentPage.tsx`, `points.spec.tsx`
- Create: `apps/admin/src/features/purchases/PurchaseListPage.tsx`, `PurchaseDetailPage.tsx`, `purchases.spec.tsx`
- Modify: `apps/admin/src/app/App.tsx`, `apps/admin/src/app/navigation.ts`
- Modify: `apps/admin/src/features/business/BusinessProductsPage.tsx` (remove `yearlyPoints` from the form)

**Interfaces:**
- Consumes: Tasks 12, 13, 19.
- Produces: routes `/admin/points/rules`, `/admin/points/services`, `/admin/points/adjust`, `/admin/purchases`, `/admin/purchases/:id`. Nav entries keyed to `operations.catalog` (rules) and `operations.redemption` (adjustment).

- [ ] **Step 1: Write the failing tests**

```tsx
// points.spec.tsx — loading, pending, failure, duplicate click per §11
it('shows a skeleton while rules load', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  render('/admin/points/rules');
  expect(await screen.findByLabelText('Loading the point rules')).toBeInTheDocument();
});
it('disables the initiating button and blocks a duplicate save', async () => { /* loading= */ });
it('preserves form data after a failed save', async () => { /* ErrorState, inputs intact */ });
it('asserts aria-busy on the pending region', …);
it('does not offer a cap-exemption control', () => {
  expect(screen.queryByLabelText(/exempt/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/points/points.spec.tsx` — Expected: FAIL, no route.

- [ ] **Step 3: Implement the pages**

Use `Skeleton` from `@afhomes/ui` in a `role="status"` wrapper with an `aria-label`, following `CmsPagesPage.tsx:23-34` exactly. Use `Button loading={…} loadingLabel="Saving…"` — the prop exists and self-disables (`Button.tsx:39-48`), so **do not** hand-roll `disabled={isPending}` the way the older pages do. Use `ErrorState`, `EmptyState`, `ConfirmDialog` with `confirmLoading`. Remove `yearlyPoints` from the card-plan form while leaving the column in place (decision 01).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @afhomes/admin exec vitest run` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 17: Customer portal points UI

**Files:**
- Modify: `apps/web/src/features/customer/CustomerPointsPage.tsx`
- Create: `apps/web/src/features/customer/CustomerClaimPage.tsx` + `.module.css`
- Modify: `apps/web/src/features/customer/queries.ts`, `services.ts`, `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/features/customer/customer-portal.spec.tsx`

**Interfaces:**
- Consumes: Tasks 9, 11, 14, 19.
- Produces: `CustomerClaimPage` at `/customer/points/claim`, reached by **QR-first** claiming. The customer scans a QR that encodes a secure AF Homes claim URL (`https://<web>/customer/points/claim?c=<credential>`), lands on the claim route authenticated, and the server validates ownership before consuming the claim. The **fallback code path stays** as a typed entry on the same route. **No browser camera library** is added — the QR is scanned by staff POS hardware or the member's own phone camera app, which opens the URL. Do not add `jsqr` to `apps/web`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows a skeleton while the balance loads, never an empty state', …);
it('shows cap, period and remaining earning capacity', …);
it('labels earning capacity as not spendable', () => {
  expect(screen.getByText(/earning capacity/i).closest('section'))
    .toHaveTextContent(/not spendable/i);
});
it('groups the ledger by point year', …);
it('never renders a token hash', …);
it('a rejected claim shows a neutral message', async () => { /* no existence leak */ });
it('a claim URL is accepted on the claim route', …);
it('a bare credential and a claim URL resolve to the same claim', …);
it('a suspended customer cannot claim', …);
it('a claim stays claimable after its membership expires', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @afhomes/web exec vitest run src/features/customer/customer-portal.spec.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the bare `<p role="status">Loading your points…</p>` at `CustomerPointsPage.tsx:19` with the `Skeleton` + `role="status"` + `aria-label` pattern already used by its sibling `CustomerDashboardPage.tsx:50-59`. Show balance, cap, period, earned/redeemed this period, remaining **earning capacity** explicitly labelled as not spendable, and reversal debt when non-zero, labelled as blocking spend. Group the ledger by point year. The claim page posts the scanned or typed token and renders the server's award; it never computes a figure.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @afhomes/web exec vitest run` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 18: Activation awards zero

**Files:**
- Modify: `supabase/migrations/20261104000001_afhomes_points_rebuild.sql`
- Modify: `supabase/db-integration.ts` (section 59)

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces: `activate_card_sale` redefined so it inserts `points_accounts(balance, lifetime_allocated) = (0, 0)`, writes **no** `annual_allocation` row, sets `memberships.points_anniversary = (now() at time zone 'Asia/Manila')::date`, and calls `private.ensure_points_period` so the first period exists immediately.

There are **three** activation writers in the existing code (`20260927000003:454`, `20261014000001:291`, `20261019000002:380`). All three must be redefined; the new `activate_card_sale` covers the first two, and the import path gets its own `create or replace`.

- [ ] **Step 1: Write the failing tests**

```ts
check('a newly activated membership starts at zero', …);
check('activation awards no points ledger row', …);
check('activation cannot create a non-zero balance', …);
check('points_anniversary is set in Manila, not UTC', async () => {
  // activate at 2025-10-09 07:00+08:00 => anniversary 2025-10-09
});
check('the import activation path also awards zero', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx pnpm test:db:local` — Expected: FAIL, balance is `yearly_points_snapshot`.

- [ ] **Step 3: Redefine the three writers**

Preserve every other behaviour exactly — full verified payment re-check, idempotency, commission advance, audit events. Change only the points allocation. The `annual_allocation` entry type stays in the CHECK for historical rows.

- [ ] **Step 4: Run to verify they pass**

Run: `npx pnpm test:db:local` and `npx pnpm test:db:harness` — Expected: PASS, and every pre-existing section 1–58 still passes.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

### Task 19: Shared loading-state composition

**Files:**
- Create: `packages/ui/src/components/LoadingTable.tsx` + `.module.css`
- Modify: `packages/ui/src/index.ts`
- Create: `packages/ui/src/components/LoadingTable.spec.tsx`
- Modify: `apps/admin/src/features/redemption/RedemptionWorkflowPage.tsx`, `RedemptionHistoryPage.tsx`
- Modify: `apps/web/src/features/customer/CustomerPointsPage.tsx` (skeleton block only)

**Interfaces:**
- Consumes: nothing from the points tasks.
- Produces: `LoadingTable({ loading, error, isEmpty, emptyTitle, emptyDescription, colSpan, label, children })` — renders the existing `Skeleton` inside `role="status"` + `aria-label`, then `ErrorState`, then `EmptyState`, then children. One component so list pages stop copy-pasting a ten-line block.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows a labelled skeleton while loading', () => {
  render(<LoadingTable loading label="Loading the catalog" colSpan={5}><tr /></LoadingTable>);
  expect(screen.getByLabelText('Loading the catalog')).toBeInTheDocument();
});
it('shows an empty state only when not loading', () => { /* never both */ });
it('shows an error state with retry', …);
it('exposes aria-busy while loading', …);
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @afhomes/ui exec vitest run src/components/LoadingTable.spec.tsx` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement and adopt**

Compose the **existing** `Skeleton`, `ErrorState` and `EmptyState` — do not write new styles beyond the CSS Module for layout. `Skeleton.module.css` already provides the only skeleton fill (`--color-skeleton`) and `base.css:131-140` already honours `prefers-reduced-motion`, so reduced-motion needs no new work. Adopt it in the two redemption pages, which today render bare `<p role="status">Loading…</p>` text.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @afhomes/ui exec vitest run` and `pnpm --filter @afhomes/admin exec vitest run src/features/redemption` — Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit here. Run the task's verification command, confirm it passes, and stop for review. Everything is staged once, at the end.

---

## Rollback and Recovery

**No destructive history rewrites, ever.** The points ledger is append-only; a correction is a new row.

| Failure | Recovery |
|---|---|
| Migration fails midway | The runner wraps each file in one transaction (`apply-migrations.ts:341-347`), so a failure rolls back the DDL **and** the version row. Fix forward in a new file; never re-apply a recorded version. |
| Cutover produced wrong zeroes | The `cutover_baseline` rows make the change visible as history. Recovery is a new forward migration writing a reasoned `adjustment` row per affected account. **Never** `update` or `delete` a `cutover_baseline` or `earned` row. |
| A cap value is wrong | `tier_points_config` is data. `update` the row; open periods keep their **snapshot** and are unaffected by design (spec §4.2). |
| An award was granted in error | `reverse_purchase_points`, never a ledger delete. |
| A claim was issued in error | Reissue to rotate the tokens, or let it expire. `earning_claims` rows are never deleted. |
| A discount was committed in error | A new forward migration writing a compensating `redemption` row plus restoring `purchases.net_amount`. No `update` of the original. |
| Debt blocks a legitimate member | Debt is repayable by earning. There is no waiver in v1 (decision 10) — this is a known, accepted limitation, not an oversight. |

Pre-deploy gate: `npx pnpm test:db:local` **and** `npx pnpm test:db:harness` **and** `pnpm typecheck` **and** `pnpm lint` **and** `pnpm build`, all green. Post-migration, verify `supabase/security/rls_invariants.sql` returns empty.

---

## Test Case Map

All 91 cases from the spec §8. `DB` = a new check in `supabase/db-integration.ts` section 59. `H` = handler spec against the Supabase fake. `C` = contracts. `UI` = component spec.

| Spec # | Suite | Task |
|---|---|---|
| 1, 2, 3 | DB | 18 |
| 4, 5, 8 | DB · 5 H | 8, 12 |
| 6, 11, 12, 30 | H | 9, 12 |
| 7, 9, 10, 13 | DB | 9 |
| 14, 15, 16, 17 | DB | 4, 8 |
| 18, 19, 20, 21 | DB | 4 |
| 22, 23, 25, 26, 27, 28, 29 | DB | 13, 14 |
| 24 | DB | 14 |
| 31 | DB | 14 |
| 32 | DB | 9 |
| 33 | DB | 14 |
| 34, 36 | DB | 4, 10 |
| 35 | H · DB | 16 |
| 37–41 | existing authorization suites, must stay green | — |
| 42–47 | DB | 10 |
| 48, 49 | DB | 4, 6 |
| 50 | DB | 10 |
| 51, 52 | DB | 2, 4 |
| 53 | DB | 4, and card-plan handler |
| 54–57 | DB | 5 |
| 58 | DB | 4 |
| 59, 60, 61, 62, 63, 83, 84 | DB | 4, 8, 10 |
| 64, 65 | DB · H | 9, 12 |
| 66, 67, 68, 69, 70, 71 | DB | 9 |
| 72, 73, 74, 75, 76 | DB | 10 |
| 77, 78, 79 | DB · H | 10, 16 |
| 80 | H | 16 |
| 81 | DB | 2 |
| 82 | H | 16 |
| 85–91 | UI | 16, 17, 19 |

**Not yet assigned:** spec case **5** ("ineligible transaction creates no award") is split above; case **35** is both H and DB. Every case 1–91 maps to at least one task.

---

## Unresolved Technical Blockers and Assumptions

**Blockers — resolve before the relevant task starts.**

1. **`customers.status` has no closed value** (`CHECK (status in ('active','inactive','suspended'))`, `20260926023325:160`). No longer blocking: the waiver is deferred (decision 10), so no code needs a closed state. Recorded because a future waiver will.
2. **Which customer status permits an earning claim** is unspecified. The plan assumes `active` only, matching `redemptionBlocker` in `api/_lib/identifier.ts:306-313`. If a suspended member should still earn, Task 9 changes.
3. **Membership expiry and earning.** `memberships.expires_at` is enforced as a refusal in redemption (`20260928000001:290-293`) but nothing ever writes `status='expired'`. The plan assumes a claim requires `status='active'` **and** `expires_at > now()`. Confirm.

**Assumptions — stated so a reviewer can challenge them.**

4. `purchases.gross_amount` / `net_amount` are new frozen money columns on the new table. `card_sales` is untouched, because a points discount applies to a **service purchase**, not to a membership sale.
5. `fullyPaid` on a points purchase compares verified payments against `netAmount`, not `grossAmount`. This is a behavioural choice: a discounted purchase is paid when cash covers the **net**. Finance must confirm.
6. **Resolved (decision 4).** Claiming is **QR-first** via a secure AF Homes claim URL that opens the customer claim route in an authenticated session; the fallback code remains a typed path on the same route. **No browser camera library** is added to `apps/web` — the member's own phone camera app scans, or staff POS hardware does. `jsqr` stays an admin-only dependency.
7. The unique business-ID prefixes are `AF-TXN` and `AF-EARN`, matching the request. `private.claim_af_id` requires editing its hardcoded 15-entry allowlist, and the generated code length must be chosen to match the existing 5-char/4-byte convention.
8. `points_anniversary` is added to `memberships` and backfilled in the cutover from `activated_at`. Members whose `activated_at` predates the migration get the correct Manila date; none get a fabricated one.
9. Polling. The customer points query keeps its existing 30s `refetchInterval` (`apps/web/src/features/customer/queries.ts:39-40`) because a staff claim or redemption in another session moves the balance. Admin claim lists poll at 15s, matching `finance/activation/history`.

---

## Execution Order

Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → {9, 10, 13} → 11 → 12 → 14 → 15 → 19 → 16 → 17 → 18.

Task 18 runs last deliberately: it redefines `activate_card_sale`, so it should land only once the points tables it depends on exist and the cutover has run. Task 19 precedes 16 and 17 because both consume `LoadingTable`, and Task 17 also modifies `CustomerPointsPage.tsx` that Task 19 touches — 19 must finish first.
