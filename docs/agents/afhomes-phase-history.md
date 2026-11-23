# AF Homes phase history (Phases 1-5)

> Relocated verbatim from `AGENTS.md` (section "Current state") on 2026-11-13 to reduce
> always-loaded context. `AGENTS.md` remains the authority; it keeps every
> invariant and points here. Package names updated from `@jad/*` to `@afhomes/*`.

The phase summaries describe the original foundation; current source,
contracts and migrations contain subsequent work imported from `develop`.
`docs/AFHOMES-PHASE-1-PLAN.md` and `docs/AFHOMES-PHASE-5-READINESS.md` were
removed in `14b99d3`; recover them with `git show 14b99d3^:<path>`.

## Current state (Phase 2 — business foundation delivered)

### Phase 1 (complete)

- **Database** — `supabase/migrations/20260926023325_afhomes_phase1_foundation.sql`:
  21 tables, `private.has_permission()`, SELECT-only RLS, 3 private storage
  buckets, append-only `audit_events`.
- **AuthZ** — `api/_lib/afhomes-access.ts`; principal re-resolved per request.
- **API** — `admin/afhomes/{session,roles,departments,staff,dashboard}`, `/health`.
- **Admin SPA** — Dashboard, Staff, Departments, Roles & Permissions.

### Phase 2 (complete — foundation only, no consumer portals)

Four new migrations, all prefixed `20260927…afhomes_phase2_*`:

| File | Contents |
|---|---|
| `…_business_foundation.sql` | `referral_relationships`, `points_accounts`, `points_ledger`, `customer_onboarding_tokens`; customer/sale/payment/membership/commission columns; the new sale, customer and commission status CHECKs; partial unique indexes; 2 new modules |
| `…_rls.sql` | RLS on every new table, SELECT-only grants, and the four narrowed/widened Phase 1 policies |
| `…_rpc.sql` | `private.money`, `private.hash_token`, `private.new_fallback_code`, `private.new_qr_token`, `public.sale_financial_summary`, `record_card_payment`, `verify_card_payment`, `activate_card_sale`, `correct_referral_upline` |
| `…_support_functions.sql` | `next_customer_number`, `next_sale_number`, `issue_customer_onboarding_token` |

API families (`api/_lib/router.ts`, data-driven `BUSINESS_FAMILIES`):
`card-products`, `customers`, `sales` (+`payments`), `memberships` (+`points`),
`commissions`, `referrals`, `queues`. Handlers in `api/_handlers/`.

Contracts: `packages/contracts/src/schemas/{lifecycle,sales,finance}.ts`.
`lifecycle.ts` is the **single source for every status string and every legal
transition** in the system — handlers, contracts and tests all import it.

Pure rules: `api/_lib/commerce.ts` (commission, totals, spot cash, sellability,
seller resolution). `api/_lib/handler-kit.ts` is the shared handler plumbing.

Admin screens: `apps/admin/src/features/business/` — Card Products, Customers,
Card Sales, Payment Queue, Activation Queue (+ commission qualification).

### Phase 3 (complete — customer account activation and the customer portal)

One migration, `20260927000005_afhomes_phase3_customer_portal.sql`:

- `public.claim_customer_onboarding_token(p_token_hash, p_auth_user_id, p_purpose)`
  — the atomic redemption. Locks the token row **and** the customer row, then in
  one transaction links `customers.auth_user_id`, consumes the token, and appends
  `CUSTOMER_AUTH_ACTIVATED`, `CUSTOMER_ONBOARDING_TOKEN_CONSUMED` and
  `CUSTOMER_ACCOUNT_LINKED`. Idempotent (`CLAIMED` / `ALREADY_LINKED`), and
  `FOR UPDATE` is load-bearing: without it the compare-and-set on `consumed_at`
  is a read-then-write race.
- `public.reissue_membership_credentials(p_membership_id, p_customer_id, p_actor_id)`
  — **rotates** the QR token and fallback code rather than recovering them, and
  returns the new plaintext exactly once. Ownership and the customer's own
  status are re-checked in SQL so a handler bug cannot rotate someone else's card.
- **Column-level SELECT grants** on `customers`, `memberships`, `points_ledger`
  and `points_accounts`. RLS picks the ROW; only the grants pick the COLUMNS.
  Without this, `authenticated` held a table-wide `SELECT` and a customer could
  read their own `government_id_number` through PostgREST.

API: `POST /auth/customer/activate` (unauthenticated) and `GET /customer`,
`/customer/membership`, `/customer/points`, `/customer/points/ledger`,
`POST /customer/membership/credentials` (authenticated). `api/_lib/customer-access.ts`
resolves a customer from **ownership only** and imports nothing from the staff
authorization path.

Portal: `apps/web/src/features/customer/` — login, activate, dashboard, card,
points, profile. `/customer` and `/customer/login` are real routes in the
existing public SPA, so no Vercel output or `vercel.json` change was needed.

### Phase 4 (complete — staff redemption of customer points)

One migration, `20260928000001_afhomes_phase4_redemption.sql`:

- `redemption_items` — the catalog. **Database-backed**, so no item is ever
  hardcoded in a component. `points_cost bigint`, not money: no decimal text, no
  `private.money`, no rounding. Deactivated, never deleted.
- `redemptions` — the auditable transaction, with **snapshots** of the item code,
  name, price and of the balance before/after. Snapshots are why a catalog edit
  cannot rewrite history. `status` includes `voided` and the void columns exist so
  a future rule has a home, but **nothing writes them** and a CHECK makes a
  half-recorded void impossible.
- `public.redeem_membership_points(...)` — the whole transaction in one function,
  because PostgREST cannot span statements and a handler cannot hold a row lock
  across requests. **Lock order is fixed and total: membership → customer → item
  → points account.** The points-account lock is taken *before* the balance is
  read, which is the concurrency control; the price is read from the catalog, and
  the acting staff member is re-validated inside the function.
- Idempotent per `(redeemed_by, idempotency_key)`, checked **after** the locks so
  a retry returns the original receipt even once the token/balance has moved.
- **Column-level repair:** `memberships.points_balance` was written as `0` by
  Phase 2's activation and never maintained, so the staff identifier lookup had
  been reporting `pointsBalance: 0` for a member holding 60,000. The Phase 4
  migration backfills it from `points_accounts` (the authoritative balance) and
  the redemption function keeps it in step.

**No new module keys.** `operations.redemption` and `operations.catalog` already
existed from Phase 1, so redemption adds no authorization vocabulary.

API: `GET /redemptions/resolve`, `GET|POST /redemptions/items`,
`PATCH /redemptions/items/:id`, `GET|POST /redemptions`, `GET /redemptions/:id`.

Staff screens: `/admin/redemption` (identify → price → confirm, with a real
browser QR camera scanner), `/admin/redemption/history`, `/admin/redemption/items`.
The camera decoder is `jsqr`, run **locally**; no frame is ever uploaded.

**Still not built (deliberately):** OST standalone app, NFC (none exists and
none is planned), point redemption *by the customer*, genealogy UI, commission
payout, email, refunds, renewal automation, OCR, notifications, marketing site.
**No final-commission-qualification rule exists in this codebase** — the
`final_qualification_pending → earned` transition is deliberately a manual,
permission-gated, audited decision with mandatory notes. Do not invent it.

### Phase 5 (complete — production readiness, no product change)

One migration, `20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql`, and
one new command. No business rule changed.

The two Phase 2 migrations `…0001` and `…0003` were corrected in the working
tree *after* being first written. A runner **skips any version it has already
recorded**, so a database that recorded the defective versions will never
receive the corrected bodies. Migration 9 therefore re-delivers the four
execution-found fixes as a new, forward-only, **idempotent** file:
`private.money()` (no `rpad` truncation), `verify_card_payment()` (every column
qualified, because its `OUT` parameters are named `sale_id`/`status`),
`spot_cash_started_at` (`coalesce`, not a self-assignment), and
`commissions.ost_id` (nullable, so a staff beneficiary is legal).

It is safe to apply to a database of unknown provenance: applying it to an
already-correct database changes nothing.

`pnpm test:db:harness` is new. It runs the real suite **twice** against a
disposable loopback PostgreSQL — once normally (must exit 0, must run section 37,
must restore every table) and once with `AFHOMES_DB_TEST_INJECT_FAILURE`
armed (must exit **non-zero**, must report the abort, and must **still** run
`finally` cleanup). The flag is refused for any remote target, so it can never
be aimed at a development or production database.

Current readiness status, blockers, and the full production runbook:
`docs/AFHOMES-PHASE-5-READINESS.md`. **Verdict: NOT READY** — there is no
development/staging Supabase project, so the managed stack (PostgREST, GoTrue,
Storage) has never been executed.

