# AF Homes Points System — Design Specification

**Date:** 2026-10-09
**Status:** Approved design. Not yet implemented.
**Branch target:** `claud/develop`
**Scope:** Full rebuild of the AF Homes points business model.

---

## 1. Problem statement

The current points model is incompatible with the required business rules.

Today, `public.activate_card_sale` awards `card_plans.yearly_points`
(10,000 / 20,000 / 25,000 by tier) as an `annual_allocation` ledger entry at
activation. Three separate writers do this:
`20260927000003_afhomes_phase2_rpc.sql:454`,
`20261014000001_afhomes_vip_payment_schemes.sql:291`, and
`20261019000002_afhomes_customer_import_jobs.sql:380`.

The required model:

- A newly activated customer starts at **zero** points. Activation awards nothing.
- Points are earned **only** from eligible completed purchases or services.
- Balance must never exceed a per-tier annual cap.
- Points do not roll over; an annual reset zeroes the balance.
- The ledger is immutable and reconcilable.

The following do not exist today and must be built: a points period, a
per-tier cap, a purchase ledger, an earning claim, a QR/fallback claim flow,
cap accounting, annual reset, a points-to-cash conversion, and reversal debt.

---

## 2. Existing architecture (inspected, not assumed)

Verified by reading the migrations. Claims marked **[CONFLICT]** require change.

| Area | Current state | Source |
|---|---|---|
| `points_accounts` | 7 cols: `balance`, `lifetime_allocated`, `lifetime_redeemed`, all `CHECK >= 0` | `20260927000001:233-241` |
| `points_ledger` | 10 cols, append-only by privilege. `entry_type` CHECK closed to 5: `annual_allocation`, `redemption`, `adjustment`, `reversal`, `expiration` | `20260927000001:243-258` |
| Ledger writers | Only `annual_allocation`, `redemption`, `adjustment` are ever written. `reversal` and `expiration` are dead | `…00003:463`, `20261014000001:300`, `20260928000001:392`, `20261019000002:388` |
| `memberships.points_balance` | A **cache**. `points_accounts` is authoritative | `20260928000001:176-179` |
| Tier | **No tier table.** Tier = `card_plans.code`, hardcoded `CHECK in ('BRONZE','SILVER','GOLD')` in 3 places | `20261018000003:12,95,207` |
| Tier economics | On `card_plans`: `yearly_points` 10000/20000/25000, `total_loyalty_value` never read by any code, `annual_points_tranches` documented as "display metadata only; no annual scheduler is implied" | `20261018000001:23-64,41-42` |
| **[CONFLICT]** Activation award | Awards `yearly_points` — must become 0 | `20260927000003:435-466` |
| **[CONFLICT]** Annual cap | Does not exist | — |
| **[CONFLICT]** Points period | **Does not exist.** No `points_period`, no `period_start`. `renewal_due_at` is set equal to `expires_at` and has zero readers. Validity is `validity_years` 7/12/22 | `20261014000001:285-286` |
| **[CONFLICT]** Ledger types | `earned`, `annual_reset`, `promotional_bonus` missing | `20260927000001:246-248` |
| **[CONFLICT]** Reversal ceiling | `points_accounts.balance CHECK (>= 0)` and `points_ledger.balance_after CHECK (>= 0)` forbid a negative balance | `20260927000001:236,251` |
| **[CONFLICT]** Points→cash | **None.** No conversion, no points column on `payments`. Only a disclaimer string | `api/_handlers/reports.ts:1315` |
| **[CONFLICT]** Purchase ledger | **None.** No transaction/purchase/service/booking table. "Teppanyaki" appears only in test fixtures as a `redemption_items.code` | full-migration grep |
| **[CONFLICT]** `AF-TXN` / `AF-EARN` | Neither exists. 14 prefixes registered | `20261026000001:56-67` |
| Fallback code format | `private.new_fallback_code()` = `AFH-XXXX-XXXX` (8 hex from 4 bytes; slices overlap, ~24 effective bits) | `20260927000003:50-59` |
| QR token | `private.new_qr_token()` = 32 random bytes base64, no PII | `20260927000003:63-69` |
| Hashing | `private.hash_token()` = plain SHA-256 hex. Hash-only persistence | `20260927000003:37-44` |
| Business IDs | `private.af_candidate(prefix)` + `private.claim_af_id(prefix, table, column)`, hardcoded 15-triple allowlist | `20261025000001:43-69`, `20261026000001:85-125` |
| Migration runner | Records only the **filename prefix**, no content hash. A corrected body under an already-recorded version is never re-delivered | `supabase/apply-migrations.ts:334-355` |
| Redemption RPC | `redeem_membership_points(...)` — `security definer`, fixed lock order, idempotency checked **after** locks, `INSUFFICIENT_POINTS` leaks no balance. **Sound. Unchanged.** | `20260928000001:208-434` |
| Immutability enforcement | By **privilege**, not trigger: `revoke all` from `anon`/`authenticated`, all writes through `SECURITY DEFINER` | `20260928000001:441-443` |
| Idempotency precedent | `idempotency_key` + unique `(actor, key)`, re-checked after locks | `20260928000001:144-149,333-346` |
| Business timezone | **None.** Zero occurrences of `Asia/Manila` or `at time zone` in all 39 migrations. All dates are raw `now()` = UTC | full-migration grep |

### Protected files

- `20261101000001_afhomes_application_purchase_flow.sql` (1958 lines) — **immutable**, exists on `claud/develop` only. Not present on `feature/afhomes-communications`.
- `20261102000001_afhomes_customer_directory_workflow_filter.sql` — **must not be applied.**

---

## 3. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| 1 | Points year = **membership anniversary year** | Ties the points cycle to the member's own card cycle. Nothing in the schema defines a points year, so this is a decision, not a discovery. |
| 2 | Timezone = **Asia/Manila**, date-based boundaries | No business timezone exists. UTC would place an Oct 9 07:00 Manila activation on the wrong calendar day. |
| 3 | Cap source = new `tier_points_config` table | Tier still resolves from `card_plans.code`; no competing tier system. |
| 4 | Activation = **forward-only**, existing activations unaffected | No mutation of existing production data. |
| 5 | Redemption = **two separate point-spend types** | Cash discount is new; the working, tested Phase 4 POS stays untouched. |
| 6 | Reversal insufficiency = **tracked debt, earning never blocked, spending blocked** | Balance stays nonnegative; nothing is deleted. |
| 7 | Period creation = **lazy**, no cron | Correctness comes from every access path invoking the reset function. |
| 8 | Legacy data = **reset to zero at cutover** with an audited adjustment | All pre-cutover points are testing-era history. |

---

## 4. Data model

### 4.1 Business timezone and the anniversary anchor

Period boundaries are **dates** in `Asia/Manila`.

The anchor is captured at activation and **stored on the membership**, so a
later timezone or `search_path` change cannot silently shift history:

```sql
v_anchor := (m.activated_at AT TIME ZONE 'Asia/Manila')::date;
v_today  := (now()      AT TIME ZONE 'Asia/Manila')::date;
```

Every boundary derives from the **original anchor**, never iteratively:

```
period_start(N) = v_anchor + N years
period_end(N)   = v_anchor + (N+1) years
```

A 2025-10-09 activation yields `[2025-10-09, 2026-10-09)`, then
`[2026-10-09, 2027-10-09)` — not calendar January boundaries.

**February 29 policy.** PostgreSQL clamps `date + interval '1 year'` to
February 28 in non-leap years. Because every period is computed from the
anchor rather than from the previous boundary, the anchor never drifts:
a 2024-02-29 activation gives `[2024-02-29, 2025-02-28)`, `[2025-02-28,
2026-02-28)`, … `[2028-02-29, …)`. A leap-day member gets a one-day-shorter
period in non-leap years and realigns on the next leap year. **This is asserted
in the database suite, not assumed.**

**Half-open intervals.** `period_start <= v_today < period_end`. No ambiguity at
the exact reset boundary.

### 4.2 `points_periods`

```sql
create table public.points_periods (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.points_accounts(id) on delete restrict,
  period_start      date not null,
  period_end        date not null,
  tier              text not null check (tier in ('BRONZE','SILVER','GOLD')),
  annual_points_cap bigint not null check (annual_points_cap > 0),
  opening_balance   bigint check (opening_balance is null or opening_balance >= 0),
  closing_balance   bigint check (closing_balance is null or closing_balance >= 0),
  status            text not null default 'open' check (status in ('open','reset')),
  reset_at          timestamptz,
  reset_source      text check (reset_source is null or reset_source in ('automatic','staff','admin')),
  reset_actor_id    uuid references public.staff_users(id) on delete set null,
  authoritative_from date,
  created_at        timestamptz not null default now(),
  constraint points_periods_half_open check (period_start < period_end),
  constraint points_periods_unique unique (account_id, period_start)
);
```

`annual_points_cap` and `tier` are **snapshots**. Changing
`tier_points_config` mid-period cannot alter a running period.

`reset_at` records when; `reset_source` and `reset_actor_id` record **who or
what** — automatic anniversary catch-up writes `automatic` with a `NULL`
actor, a staff-triggered close records both.

### 4.3 `tier_points_config`

```sql
create table public.tier_points_config (
  tier              text primary key check (tier in ('BRONZE','SILVER','GOLD')),
  annual_points_cap bigint not null check (annual_points_cap > 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.staff_users(id) on delete set null
);
-- seeded 25000 / 40000 / 60000
```

Tier resolution continues to read `card_plans.code`.

**This table is the sole annual-cap authority.** No other table, column, or
constant supplies a cap. A period's cap is copied from here at open time and
is thereafter immutable (§4.2).

**`card_plans.yearly_points` is retired from the editable admin UI and its
database column is frozen.** It is removed from the card-plans create/update
forms and from the request contracts, so it can no longer be edited and can no
longer be mistaken for the cap.

The **database column is not dropped** in this release: it is still read by
`activate_card_sale`'s existing code paths, by historical `card_sales` snapshots
(`yearly_points_snapshot`), and by legacy `annual_allocation` rows. It is
**frozen, not deleted**, and remains readable for compatibility until that is
verified. Dropping it is a separate, later decision, taken only after
compatibility has been proven.

**`card_plans.total_loyalty_value` is not reinterpreted** as points or as
pesos. It remains the declared contract string it already is — never read by
any computation, in this design or the existing one.

### 4.4 Reversal debt

```sql
alter table public.points_accounts
  add column reversal_debt bigint not null default 0 check (reversal_debt >= 0);
```

The existing `balance >= 0` CHECK is untouched, so the raw balance can never
go negative.

**Spendable = `greatest(0, balance - reversal_debt)`.** Spending is refused
while `reversal_debt > 0`. Debt is non-monetary and has no automatic expiry
(§5.8).

**Reconciliation invariant.** The binding rule for this whole design:

```
points_accounts.balance - points_accounts.reversal_debt
    = SUM(points_ledger.amount)
```

Every operation that moves the balance or the debt **must** write exactly one
ledger row, in the same transaction, with the same sign. A balance change with
no ledger row breaks the invariant; so does a ledger row with no balance
change. This is why an `available`-at-reversal case writes no row at all
(§5.7). No waiver or manual debt path exists (§5.8), so every debt change is
caused by an `earned` or `reversal` row and the invariant holds by construction
rather than by convention. The invariant is asserted against the real database
after every operation, not merely checked per row.

Invariant, proven per operation:

| Operation | Balance `B` | Debt `D` | Result |
|---|---|---|---|
| Reverse award `A` | `B - min(A,B)` | `D + (A - min(A,B))` | `B' - D' = (B - D) - A` |
| Earn `A` (debt-first) | `B + max(0, A - D)` | `max(0, D - A)` | `B' - D' = (B - D) + A` |
| Spend `S` | `B - S` | `D` | `B' - D' = (B - D) - S` |
| Annual reset | `0` | `D` (unchanged) | `-D` |

**The `balance >= reversal_debt` CHECK is deliberately NOT added.** A reset
makes `B - D = -D < 0` by design, and the invariant is enforced by the
reconciliation test, not by a constraint that would forbid required behavior.

### 4.5 Ledger changes

New `entry_type` values — the CHECK is widened from 5 to 9:

```
'annual_allocation', 'redemption', 'adjustment', 'reversal', 'expiration',   -- 5 existing
'earned', 'annual_reset', 'promotional_bonus', 'cutover_baseline'           -- 4 new
```

All five existing values are retained. `annual_allocation` and `expiration`
remain in the set for historical rows even though nothing new writes them.
`reversal` gains a writer for the first time. The CHECK ends up **9** values
wide. There is **no** `debt_waiver` value — the waiver was deferred
(decision 10, §5.8).

`pointsEntryTypeSchema` in `packages/contracts/src/schemas/lifecycle.ts:105-111`
is the single source for these strings and must be widened in step — it is
pinned by existing tests, so this is a deliberate contract change, not a
silent one.

New immutable attribution columns, needed because promotion rules will change
and history must stay readable:

```sql
alter table public.points_ledger
  add column counts_toward_cap boolean not null default true,
  add column origin_award_id   bigint references public.points_ledger(id),
  add column origin_period_id  uuid references public.points_periods(id),
  add column balance_before    bigint check (balance_before is null or balance_before >= 0);
```

`origin_period_id` is set on **every new-flow row** that can affect cap
accounting — `earned`, `promotional_bonus` and `reversal` — so the capacity
query in §4.6 can select a period without inferring it from a timestamp.
`origin_award_id` is set on `reversal` rows **only**, pointing at the original
`earned` row so the award's period and cap treatment stay recoverable.

`balance_before` is recorded because the existing schema only stored
`balance_after`, which makes a mid-history cap change unauditable.

Immutability is enforced by **privilege**, matching the existing architecture:
`revoke all` from `anon` and `authenticated`, all writes through
`SECURITY DEFINER` functions. No UPDATE or DELETE path exists for a browser
role.

### 4.6 Cap accounting

`tier_points_config` is the **sole** annual-cap authority. `card_plans` carries
no cap and is not consulted for one.

**Reserved capacity.** Capacity is reserved when a claim is *created*, not when
it is claimed. Without reservation, N pending claims each evaluated against
full capacity would each award in full, and a member could be pushed well past
the cap by completing several purchases in the same period.

```
used(P)      = SUM(points_ledger.amount
               WHERE origin_period_id = P AND counts_toward_cap
                 AND entry_type in ('earned','promotional_bonus','reversal'))

reserved(P)  = SUM(earning_claims.points_awarded
               WHERE period_id = P AND status = 'available'
                 AND (expires_at is null or expires_at > now() at time zone 'Asia/Manila'))

capacity(P)  = greatest(0, P.annual_points_cap - used(P) - reserved(P))
```

`used` and `reserved` are therefore two halves of one budget. A claim holds its
slice from creation until it leaves the `available` state.

**Reservation lifecycle**, every transition transactional and locked in the
order **claim → period → account**:

| Transition | Reservation effect |
|---|---|
| Claim created | `+points_awarded` to `reserved` |
| Claimed | `available → claimed`: reservation consumed, appears in `used` via the `earned` row. No gap, no double-count |
| Expired | `available → expired`: reservation released |
| Reversed | reservation already released at claim/expiry; the `reversal` row restores `used` capacity in the original period |
| Reissued | token rotation only, same claim, same reservation. Never releases and re-reserves |

Claim creation locks the period row `FOR UPDATE` before reading capacity, so
two concurrent purchases cannot both observe the same free capacity. The
`earning_claims.purchase_id UNIQUE` constraint is the second guard against a
replayed purchase.

**Excluded from both sums:** `redemption`, `annual_reset` and
`cutover_baseline`. Spending never restores earning capacity. A reset never
grants capacity beyond the new period's configured cap. The cutover adjustment
is administrative and never cap-consuming (§4.12).

**No cap exemptions in v1.** Every ordinary earning and every promotional bonus
counts toward the annual cap. There is no cap-exemption switch in promotion
administration, and the rules table exposes no field that could set one
(§4.7). The immutable `counts_toward_cap` attribution stays in the ledger, so
the distinction is recorded correctly if a use case is ever approved — but no
code path creates an exempt award today. Revisit only against an approved
business use case.

**Capacity is recomputed at claim time** against live `used` and `reserved`,
because other claims may have been created or claimed since. `points_awarded`
on the claim is the reservation figure, not the award figure.

Earning and promotional bonuses **both** count against the cap. There is no
cap-exempt award in v1 (decision 03), so `counts_toward_cap` is `true` for
every row this release creates. The column stays so the attribution is correct
if an exemption is ever approved.

**Over-cap** awards the remainder only:

```
awarded        = least(requested, greatest(0, capacity))
capped_points  = requested - awarded
```

`requested_points`, `awarded_points` and `capped_points` are all recorded. The
capped portion is never silently lost.

**Reversals restore capacity in the original award's period** (a reversal is a
negative in that period), never as an unrelated deduction elsewhere.

### 4.7 `service_catalog`, `point_earning_rules`

```sql
create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  base_price numeric(14,2) not null default 0 check (base_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.point_earning_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  points_amount bigint not null check (points_amount > 0),
  eligible_tiers text[] not null
    check (eligible_tiers <@ array['BRONZE','SILVER','GOLD']::text[]),
  effective_start date not null,
  effective_end date not null,
  is_active boolean not null default true,
  min_quantity int not null default 1 check (min_quantity > 0),
  max_award bigint check (max_award is null or max_award > 0),
  promotion_reference text,
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint point_earning_rules_dates check (effective_start < effective_end)
);
```

Rule selection: `is_active`, `effective_start <= v_today < effective_end`,
tier in `eligible_tiers`. **Highest `points_amount` wins**, so a promotion
outranks a base rule automatically. No eligible rule means **no claim and no
award** — an ineligible transaction can never create a claim.

A future promotion activates with no code deployment.

**There is no cap-exemption field** (decision 03). Every rule's awards count
toward the cap. The ledger's `counts_toward_cap` is therefore always `true` for
awards created by this release; it exists so the attribution is correct if an
exemption is ever approved, not so one can be set now.

### 4.8 `purchases`, `purchase_lines`

```sql
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','completed','reversed')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  completed_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  quantity int not null default 1 check (quantity > 0),
  unit_amount numeric(14,2) not null check (unit_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
```

`purchases.total_amount` and each `line_total` are exact-decimal **text**
money, `CHECK`-validated with the money regex, matching the existing
convention. No float math.

Only `status = 'completed'` can generate an award.

### 4.9 `earning_claims`

```sql
create table public.earning_claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text not null unique,
  purchase_id uuid not null unique references public.purchases(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  account_id uuid not null references public.points_accounts(id) on delete restrict,
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  rule_id uuid not null references public.point_earning_rules(id) on delete restrict,
  period_id uuid not null references public.points_periods(id) on delete restrict,
  tier text not null check (tier in ('BRONZE','SILVER','GOLD')),
  points_requested bigint not null check (points_requested > 0),
  points_awarded bigint not null check (points_awarded >= 0),
  points_capped bigint not null default 0 check (points_capped >= 0),
  counts_toward_cap boolean not null default true,
  status text not null default 'available'
    check (status in ('available','claimed','expired','reversed')),
  qr_token_hash text,
  fallback_code_hash text,
  token_issued_at timestamptz,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
```

`points_awarded` is the **reserved** figure at creation, recomputed at claim
time (§4.6).

**Token columns are nullable and unique-partial.** They are populated at
issuance and cleared on rotation, so a rotated-away token leaves no stale
secret in the row:

```sql
create unique index earning_claims_qr_uidx on public.earning_claims (qr_token_hash)
  where qr_token_hash is not null;
create unique index earning_claims_fallback_uidx on public.earning_claims (fallback_code_hash)
  where fallback_code_hash is not null;
```

**Expiry is 24 hours, or the end of the earning period, whichever is first:**

```sql
v_expiry := least(now() + interval '24 hours', p_period.period_end::timestamptz);
```

A claim that expires releases its reservation (§4.6). An expired claim is
never awarded.

**Expired reservations stop consuming capacity with no scheduled job.** The
`reserved(P)` sum filters on `expires_at > now() at time zone 'Asia/Manila'`,
so an elapsed claim is excluded from the arithmetic the moment it lapses. No
cron, no sweep, and no reliance on a claim being touched. A claim still marked
`available` but past its expiry is therefore both unawardable and
non-reserving.

**Every new claim or reissue rechecks capacity transactionally** under the
period row lock (§4.6). A reissue never re-reserves an existing reservation,
so it cannot double-count; only a genuinely new claim or a re-reservation
takes a fresh slice.

**Reissue — two distinct cases.** There is no expiry-extension action
(decision 12), so "extend a claim" does not exist as an operation.

1. **Reissue of an unexpired `available` claim** — reuses the same claim row
   and rotates both tokens. The previous `qr_token_hash` and
   `fallback_code_hash` are overwritten, so both old credentials stop working
   immediately. **The existing `expires_at` is preserved** — a reissue buys the
   member a new token, not more time. No new reservation, no re-award, no
   second claim.
2. **Reissue of an `expired` claim** — permitted only after **renewed
   eligibility checks** (customer and membership still active, the service and
   rule still eligible at today's date, and the rule still within its effective
   window). It takes a **fresh cap reservation** and sets a **fresh standard
   expiry** (24h, or period end, whichever is first). The reservation is taken
   under the period lock, so it cannot over-allocate. It **must never duplicate
   an award**: if the claim is `claimed`, reissue is refused outright, and the
   `points_ledger_one_earned_per_claim` unique index remains the backstop.

Reissue of a `claimed`, `expired`-and-ineligible, or `reversed` claim is
refused. Reissue is permission-gated and audited. This mirrors
`reissue_membership_credentials`, which rotates rather than recovers.

**Reverse implies a claim.** A purchase with no `earning_claims` row (an
ineligible service, or no rule matched) reverses with **no** points event at
all. `reversal` stays valid for claims the member never claimed — see §5.6.

`purchase_id UNIQUE` means **one completed purchase produces at most one
claim**, which is also the purchase-level deduplication guarantee.

`points_awarded` is the **claim-time** value. The authoritative figure is
recomputed at claim time against the live cap, because capacity may have moved
between claim creation and claim.

### 4.10 Deduplication, layered

Three independent layers. **None replaces another.**

1. **Claim CAS** — the real guard. Atomic by construction:
   ```sql
   update public.earning_claims
      set status = 'claimed', claimed_at = now()
    where id = p_claim_id and status = 'available'
    returning *;
   ```
   Zero rows returned means already claimed.

2. **Ledger backstop** — survives a handler bug, a retry after a timeout, and
   a concurrent double-scan:
   ```sql
   create unique index points_ledger_one_earned_per_claim
     on public.points_ledger (reference_id)
     where entry_type = 'earned' and reference_type = 'earning_claim';
   ```

3. **Purchase level** — `earning_claims.purchase_id UNIQUE` (see §4.9).
4. **Reservation level** — the period row lock plus the `used` + `reserved`
   budget in §4.6, so N pending claims cannot each award against full capacity.

The existing `points_ledger_one_allocation_per_year` index is **retained**:
`annual_allocation` stays in the CHECK for historical rows, so its guard stays
too. It is not dropped.

`points_periods_unique` on `(account_id, period_start)` is period-level
uniqueness and is orthogonal to all four.

### 4.11 Cash discount

Existing `redeem_membership_points` and `redemption_items` are **unchanged**.
The new path sits beside them, sharing only the `operations.redemption`
module key.

```sql
create table public.point_redemption_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  peso_value_per_point numeric(12,4) not null check (peso_value_per_point > 0),
  eligible_tiers text[] not null
    check (eligible_tiers <@ array['BRONZE','SILVER','GOLD']::text[]),
  min_points bigint not null default 1 check (min_points > 0),
  max_points bigint not null check (max_points > 0),
  min_purchase_amount numeric(14,2) not null default 0 check (min_purchase_amount >= 0),
  effective_start date not null,
  effective_end date not null,
  is_active boolean not null default true,
  promotion_reference text,
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint point_redemption_rules_max_min check (max_points >= min_points),
  constraint point_redemption_rules_dates check (effective_start < effective_end)
);

create table public.redemption_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  rule_id uuid not null references public.point_redemption_rules(id) on delete restrict,
  points_requested bigint not null check (points_requested > 0),
  peso_value numeric(14,2) not null check (peso_value >= 0),
  idempotency_key text not null unique,
  status text not null default 'quoted' check (status in ('quoted','committed','expired')),
  expires_at timestamptz not null,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);
```

`peso_value_per_point` is a **configured rule value**, never a constant.
1 point = ₱1 is a row, not an assumption. The hotel example — ₱50,000 stay,
25,000 points, ₱25,000 cash remaining — is a rule with
`peso_value_per_point = 1.0000`.

A quote pins `rule_id` and the computed peso value. Committing re-validates
that the rule is **still active and still in date**, so an expired promotion
cannot be cashed in from a stale quote.

### 4.12 Legacy cutover

All pre-cutover balances and ledger history are **testing-era data**. Every
existing account is reset to zero.

| Target | Value |
|---|---|
| `points_accounts.balance` | `0` |
| `points_accounts.reversal_debt` | `0` |
| `memberships.points_balance` | `0` |

Untouched: customer identities, memberships, activation dates, card products,
and all unrelated financial records.

**Ledger reconciliation.** With legacy ledger sum `S`:

| Condition | Row | Invariant |
|---|---|---|
| `S <> 0` | `cutover_baseline`, `amount = -S`, `balance_after = 0`, `counts_toward_cap = false` | `0 - 0 = 0` ✓ |
| `S = 0` | none — `CHECK (amount <> 0)` correctly forbids it | `0 - 0 = 0` ✓ |

The adjustment is derived from the **ledger total `S`**, not the cached
balance, so any `S <> B` discrepancy is recorded rather than hidden.

`cutover_baseline` is an administrative baseline event. It is **not** an
earning, a promotional bonus, or a cap-consuming transaction:
`counts_toward_cap = false`, and it is excluded from the capacity query in
§4.6 alongside `redemption` and `annual_reset`.

**Current period honesty.** For a period already in progress at cutover,
`opening_balance` is `NULL` and `authoritative_from` is the cutover date.
Historical opening balances are **never fabricated**. Authoritative period
accounting begins at cutover; at the next anniversary the normal procedure
runs with tier and cap snapshots.

**Safety.** The migration validates expected account counts, legacy totals,
and planned reset operations **before** writing. It is transactional,
idempotent, and auditable. It writes a durable audit record per account with
previous balance, previous ledger total, any discrepancy, cutover timestamp,
and reason.

---

## 5. Security model

### 5.1 QR and fallback codes

Both are **hash-only** persisted via `private.hash_token()`, matching the
established membership credential pattern (`memberships.qr_token_hash`).

The QR token is `private.new_qr_token()` — 32 random bytes, base64. It encodes
**no** customer name, email, phone, PII, points balance, tier, privilege,
sequential id, raw database id, or price. It resolves server-side to an
earning claim and nothing else.

The fallback code reuses `private.new_fallback_code()`, producing
`AFH-XXXX-XXXX`. **Known weakness, reused deliberately:** the generator slices
overlapping substrings of 4 bytes, so effective entropy is ~24 bits rather
than 32, and the format is `AFH`, not the `AF-EARN-XXXXX` in the original
request. Reusing the established format keeps normalization in
`api/_lib/identifier.ts` consistent. Claim codes are short-lived and
single-use, which bounds the exposure. Changing the generator would be a
separate decision affecting membership codes too.

Neither token is ever returned after issuance. Neither independently
authorizes anything: the server re-resolves and re-validates every time.

### 5.2 Identity derivation

The customer is **never** taken from a request parameter.

Customer-facing RPCs are declared `security invoker`, so they execute as the
authenticated role and `auth.uid()` returns the caller's JWT subject. The
function then resolves identity from the database:

```sql
select c.id into v_customer_id
  from public.customers c
 where c.auth_user_id = auth.uid();
```

`auth.uid()` returns `NULL` when there is no authenticated JWT, so an
unauthenticated call resolves to no customer and is refused. A staff caller
who also owns a customer record gets access to **that one customer** and no
staff capability — the same separation the portal already enforces.

Staff-initiated functions (`SECURITY DEFINER`) receive a staff `p_actor_id`
and **re-validate it in SQL** against `staff_users`, exactly as
`redeem_membership_points` does at `20260928000001:252-268`. The Phase 3 lesson
applies: a `SECURITY DEFINER` function must re-check every precondition the
handler checks, because the handler is not the security boundary it appears to
be.

Where any function does accept a user id — for example an administrative
workflow acting on behalf of a member — it independently verifies the supplied
id against the authenticated caller before use, and refuses when they differ.

### 5.3 Claim flow

`public.claim_earning_points(p_token text)` is a single atomic function,
`security invoker`, identity from §5.2.

1. Hash `p_token`; look up by `qr_token_hash` or `fallback_code_hash`. QR and
   fallback **resolve to the same claim** — one lookup, no second award path.
2. Lock in fixed order: **claim → period → account**.
3. Verify the claim's `customer_id` equals the customer derived in §5.2.
   Mismatch returns a **generic** refusal — the caller learns nothing about
   whether the claim exists.
4. Verify customer and membership status, and `expires_at > now()`. An expired
   claim transitions to `expired`, releasing its reservation (§4.6).
5. Call `ensure_points_period`.
6. CAS `available → claimed`. Zero rows = already claimed.
7. Recompute capacity from live `used` + `reserved`; the claim's own
   reservation is released as part of this step, so the award draws on the
   reserved slice exactly once.
8. Insert one `earned` ledger row with `balance_before`, `balance_after`,
   `origin_period_id`, `counts_toward_cap`, and
   `requested/awarded/capped` in metadata.
9. Update `points_accounts` and the `memberships.points_balance` cache in the
   same transaction.
10. Append `audit_events`.

Two concurrent scans: exactly one wins. The loser gets a clean
"already claimed" refusal. Guaranteed by the CAS plus the ledger unique index.

### 5.4 Spending

`public.commit_point_discount(p_quote_id uuid, p_auth_user_id uuid)` locks in
order: **account → period → quote → purchase → rule**, then re-verifies:
customer identified; membership active; sufficient spendable points; service
eligible; tier eligible; rule active; within effective dates; points within
min/max; purchase amount supports the redemption; not already committed.

Peso value is recomputed server-side. **The browser never supplies a balance,
a conversion rate, or a peso value.** A tampered body cannot change what a
redemption is worth.

Spending is refused while `reversal_debt > 0`.

### 5.5 Reset as a single choke point

`private.ensure_points_period(p_account_id uuid)` locks the account and period
rows `FOR UPDATE`, walks **all** missed anniversary boundaries, closes each
superseded period and opens the current one idempotently.

It is invoked by **every** path that reads or moves spendable points: balance
reads, earning claim creation, claim redemption, cash discounts, catalog
redemption, reversals, manual adjustments, and admin operations. No path may
expose expired points without it.

### 5.6 Tier change safeguard

`ensure_points_period` is called by the card-plan and membership-product
update handler **before** the tier change is written, so the running period
snapshots the old tier. A tier change takes effect for cap purposes at the
**next anniversary**. Enforced in the handler **and re-checked in SQL** — a
`SECURITY DEFINER` function must re-verify every precondition the handler
checks, because the handler is not the security boundary it appears to be.

### 5.7 Reversal

Reversing a completed purchase produces an explicit `reversal` event linked to
the source purchase and the original `earning_claims` row, with
`origin_award_id` and `origin_period_id` set. The original `earned` row is
**never updated or deleted**.

If the award exceeds the available balance, the balance absorbs what it can and
the remainder becomes `reversal_debt`. Earning is never blocked; new earnings
pay debt first and only the surplus becomes spendable. Spending is blocked
while debt is outstanding. Debt **survives the annual reset** — a reset never
erases debt and never restores reversed points.

Reversal is atomic, concurrency-safe, and idempotent, locked in the order
**claim → period → account**. A purchase already `reversed` returns the
original reversal rather than reversing twice.

**State matrix.** The claim's state at reversal time determines what happens:

| Claim state at reversal | Points action |
|---|---|
| `claimed` | Full `reversal` row for `points_awarded`. May create debt |
| `available`, unexpired | Claim → `reversed`, reservation released, **no** `reversal` row and **no** debt. Nothing was ever awarded |
| `available`, expired | Claim → `reversed`, reservation already released, **no** `reversal` row and **no** debt |
| `reversed` | Idempotent: return the original, write nothing |
| no claim row (ineligible service) | Purchase reverses with no points event at all |

**An expired but unclaimed award can never create reversal debt.** Debt arises
only from an award that was actually granted and then spent. The
`available`-at-reversal cases are pure reservation releases, which is why they
deliberately write no ledger row — writing one would move the reconciliation
invariant with no offsetting balance change.

**Cross-period reversal.** A purchase completed in period P and reversed in
period Q writes its `reversal` with `origin_period_id = P`, so the capacity
restored belongs to P. The balance and debt effects land in the **current**
period, because that is where the balance lives. Both are recorded, and the
reconciliation invariant in §4.4 is unaffected.

### 5.8 Reversal debt

`reversal_debt` is **non-monetary**. It is a points quantity, carries no peso
value, is not a receivable, and is never treated as one. Nothing in this
system reinterprets it as money or as a `numeric` amount.

Debt has **no automatic expiry** (decision 10). It does not lapse at an annual
reset, a membership expiry, or any scheduled job. It is repaid only by future
eligible earnings, which apply to debt first (§4.4). Spending stays refused
while `reversal_debt > 0`.

**No waiver in v1.** There is no debt-waiver function, no new customer closure
status, and no `customers.status` CHECK change. The gap this leaves — a member
who never earns again carries debt indefinitely — is accepted deliberately, not
overlooked. It is recorded here so a later release can address it against a
real business case rather than a speculative one.

**Staff visibility only.** Outstanding debt is read-only for staff: surfaced in
the customer and member detail views and in the points account response, and
shown as blocking spend. There is no staff write path to debt at all — not an
adjustment, not a waiver. A manual **points** adjustment (§7) may not reduce
`reversal_debt`; it moves the balance only.

Because nothing clears debt, every debt change is a consequence of an `earned`
or `reversal` row, so the reconciliation invariant holds by construction.

---

## 6. Authorization

**No new module keys.** Earning claims and points configuration map to the
existing `operations.redemption` and `operations.catalog`. The cash-discount
path reuses `operations.redemption`.

The eight existing authorization invariants (A–H) and their regression tests
continue to apply unchanged. Restrictions remain deny-only. Super Admin
protections are untouched.

---

## 7. UX

**Admin.** Earning-rules CRUD (no cap-exemption field, decision 03),
redemption-rules CRUD, service catalog, tier-cap configuration, and points
adjustment (customer, amount, reason, explicit confirmation, audit). Manual
adjustment always writes a ledger entry — silent editing is not possible — and
it moves the balance only, never `reversal_debt` (§5.8).

Outstanding reversal debt is **read-only** for staff: shown in the member
detail view and the points account, labelled as blocking spend. There is no
staff write path to debt, and no waiver (§5.8).

**`card_plans.yearly_points` is removed from the card-plans admin forms and
from the card-plans request contracts** (§4.3). The column stays in the
database, frozen. Card-plan screens must not display it as a points figure,
because it is not one any more.

**Customer.** Current balance, annual cap, current point period, points earned
this period, points redeemed this period, remaining **earning capacity**
labelled distinctly from spendable points, ledger history grouped by point
year, and "points available to claim" with the QR/code workflow.

The customer never sees secret tokens, hashes, or internal authorization
data.

**No NFC.**

---

## 8. Testing

RED → GREEN throughout. Handler specs use the in-memory Supabase fake in
`api/_lib/testing/`; anything needing real locking goes into new numbered
sections of `supabase/db-integration.ts`, matching sections 19 and 29.

| # | Requirement | Where |
|---|---|---|
| 1 | New membership starts at 0 | DB |
| 2 | Activation awards 0 points | DB |
| 3 | Activation cannot create a balance | DB |
| 4 | Completed eligible purchase creates a claim | handler + DB |
| 5 | Ineligible purchase creates no award | handler + DB |
| 6 | Rule selection, incl. date and tier | handler |
| 7 | Claim is customer-specific | DB |
| 8 | Correct customer receives points | DB |
| 9 | Wrong customer receives zero | DB |
| 10 | Reused claim awards nothing further | DB |
| 11 | QR and fallback resolve to the same claim | handler |
| 12 | Claim token contains no PII | handler |
| 13 | Concurrent double-scan awards once | DB, two real concurrent RPCs |
| 14 | Balance never exceeds cap | DB |
| 15 | Partial award on remaining capacity | DB |
| 16 | Capped points recorded | DB |
| 17 | Concurrent claims cannot bypass the cap | DB |
| 18 | Reset sets balance to 0 | DB |
| 19 | No rollover | DB |
| 20 | Historical ledger intact | DB |
| 21 | New year earns from 0 | DB |
| 22 | Sufficient-points redemption works | DB |
| 23 | Partial redemption works | DB |
| 24 | Insufficient points rejected | DB |
| 25 | Ineligible product rejected | DB |
| 26 | Ineligible tier rejected | DB |
| 27 | Expired promotion rejected | DB |
| 28 | Active promotion accepted | DB |
| 29 | Min/max enforced | DB |
| 30 | Browser cannot forge a balance | handler |
| 31 | Concurrent redemption cannot double-spend | DB |
| 32 | Every earn writes an immutable entry | DB |
| 33 | Every redemption writes an immutable entry | DB |
| 34 | Reset writes its event | DB |
| 35 | Manual adjustment audited | handler + DB |
| 36 | Reversal adds an event, deletes nothing | DB |
| 37–41 | Authorization regressions A–H | existing suites, must stay green |
| 42 | Partial reversal after spending | DB |
| 43 | Full reversal after spending | DB |
| 44 | Debt repaid by future earnings | DB |
| 45 | Debt survives annual reset | DB |
| 46 | Spending blocked while debt outstanding | DB |
| 47 | `balance - reversal_debt = SUM(ledger.amount)` holds | DB |
| 48 | Reset does not grant cap capacity | DB |
| 49 | Every earning and bonus counts toward the cap (no exemption path) | DB |
| 51 | Feb 29 anniversary arithmetic | DB |
| 52 | Manila-vs-UTC boundary | DB |
| 53 | Lazy creation snapshots the correct tier | DB |
| 54 | Every account begins at zero after cutover | DB |
| 55 | Cutover ledger reconciles | DB |
| 56 | Pre-cutover points cannot be reclaimed | DB |
| 57 | Post-cutover earning and cap work normally | DB |
| 58 | Multi-period catch-up in one call | DB |
| 59 | Two pending claims cannot both draw full capacity | DB |
| 60 | N concurrent claim creations stay within the cap | DB, N real concurrent RPCs |
| 61 | Claiming releases the reservation exactly once | DB |
| 62 | Expiry releases the reservation | DB |
| 63 | Reversal releases the reservation | DB |
| 64 | Unauthenticated call resolves to no customer | DB |
| 65 | Supplied user id not matching the caller is refused | handler + DB |
| 66 | Claim expires at 24h or period end, whichever is first | DB |
| 67 | Reissue reuses the claim and invalidates both old tokens | DB |
| 68 | Reissue of an unexpired claim preserves its expiry | DB |
| 69 | Reissue of an expired claim needs renewed eligibility | DB |
| 70 | Reissue of an expired claim takes a fresh reservation and expiry | DB |
| 71 | Reissue of a `claimed` claim is refused; no duplicate award | DB |
| 72 | Expired-unclaimed reversal creates no debt | DB |
| 73 | Claimed reversal may create debt | DB |
| 74 | Idempotent reversal of an already-reversed purchase | DB |
| 75 | Cross-period reversal restores the original period's capacity | DB |
| 76 | Debt has no automatic expiry across a reset | DB |
| 77 | No debt-waiver or debt-write RPC exists | DB |
| 78 | Manual adjustment cannot reduce `reversal_debt` | handler + DB |
| 79 | Staff can read outstanding debt (visibility) | handler |
| 80 | `yearly_points` is not editable via the admin API | handler |
| 81 | Only `tier_points_config` supplies a cap | DB |
| 82 | No cap-exemption field exists on earning rules | handler |
| 83 | An elapsed reservation stops consuming capacity with no job | DB |
| 84 | Every new claim and reissue rechecks capacity under lock | DB |

### 11.7 UI loading-state tests (§11.5)

| # | Requirement | Where |
|---|---|---|
| 85 | Skeleton shows while initial data loads; no empty-state flash | component |
| 86 | Loading, empty, success, error are distinct | component |
| 87 | Mutation button shows spinner and disables while pending | component |
| 88 | Duplicate click does not fire two requests | component |
| 89 | Failure re-enables the action and preserves form data | component |
| 90 | `aria-busy` and status announcement on the pending region | component |
| 91 | No full-page spinner for a single-panel mutation | component |

---

## 9. Migration

**One new forward-only migration.** Applied migrations are never edited —
including `20261101000001_afhomes_application_purchase_flow.sql`, which is
present and immutable at `claud/develop` @ `a42ce6b`.

The migration runner records only the **filename prefix**, with no content
hash (`supabase/apply-migrations.ts:334-355`). A corrected body under an
already-recorded version is never re-delivered, so every change ships as a new
file.

Order:

1. `tier_points_config` (seeded 25000/40000/60000)
2. `points_periods`
3. `points_accounts.reversal_debt`
4. `points_ledger` CHECK widening to 9 values + new attribution columns
5. `service_catalog`, `point_earning_rules` (no cap-exemption column),
   `purchases`, `purchase_lines`
6. `earning_claims` (nullable token columns, partial unique indexes) +
   `points_ledger_one_earned_per_claim`
7. `point_redemption_rules`, `redemption_quotes`
8. `AF-TXN` and `AF-EARN` prefixes registered in the `claim_af_id` allowlist
9. `activate_card_sale` redefinition awarding **0**
10. Legacy cutover (transactional, idempotent, audited)
11. RLS + column-level grants, staff-only and unexposed for claims
12. `pointsEntryTypeSchema` widened in `packages/contracts` in step with 4
13. `yearly_points` removed from card-plan request contracts (column frozen,
    not dropped)

**Deployment boundary.** Tested against disposable local PostgreSQL
(`pnpm test:db:local`) and the full harness (`pnpm test:db:harness`) first.
**No shared-production apply, no production deploy, without explicit
approval.** `20261102000001_afhomes_customer_directory_workflow_filter.sql` is
not applied.

---

## 10. Decisions taken and open items

### Closed

| # | Decision |
|---|---|
| 1 | **`card_plans.yearly_points`** — retired from the UI, request contracts removed, **database column frozen and retained** until compatibility is verified (§4.3) |
| 3 | **Cap-exempt promotions** — **none in v1**. All earnings and bonuses count toward the cap; no exemption switch is exposed. Ledger attribution retained (§4.6, §4.7) |
| 10 | **Debt waiver** — **deferred**. No waiver function, no new closure status, no `customers.status` change. Debt never auto-expires, earnings repay it, spending stays blocked. Staff get read-only visibility (§5.8) |
| 11 | **24-hour reservation** — **accepted**. Expired reservations stop consuming capacity with no scheduled job; every new claim or reissue rechecks capacity transactionally (§4.6, §4.9) |
| 12 | **Expiry-extension action** — **not in v1**. Reissue preserves an existing expiry; reissuing an expired claim needs renewed eligibility plus a fresh reservation, and can never duplicate an award (§4.9) |
| 4 | Reversal debt recovery — resolved by decision 10 |
| 5 | Claim expiry — resolved: 24h or period end, whichever is first |
| 6 | Tier change mid-period — running period keeps its original cap; new tier applies at the next anniversary |
| 7 | February 29 — leap-day member's period is one day shorter in non-leap years, realigning on the next leap year |

### Still open

1. **`total_loyalty_value`** (50000/200000/500000) is a never-read contract
   string. It remains unused and is **not** reinterpreted as points or pesos.
   Confirm it should stay decorative.
2. **Cash-discount accounting.** A redeemed discount reduces the customer's
   cash balance on a purchase. It does **not** write to `public.payments`,
   which is card-sale money. Confirm the discount is recorded against
   `purchases` only, and whether finance reporting must reflect it.
3. **The deferred debt waiver's residual gap** (decision 10) means a member who
   never earns again carries debt indefinitely with no write-off path. Flagged
   so it is a known, accepted outcome rather than an oversight.

---

## 11. UI loading-state standard (mandatory)

Applies to every new page, dialog, form, data table, card list, and interactive
workflow in this implementation, and to all future AF Homes features.

### 11.1 Skeleton loaders for page and content loading

- Skeletons while initial page data, tables, cards, customer balances, rules,
  claims, or ledger entries are being fetched.
- Skeleton dimensions approximate the final content to minimise layout shift.
- Reuse existing AF Homes design-system loading components. No one-off skeleton
  styles.
- **Never flash an incorrect empty state while a query is still loading.**
- A lazy query that has not started must not show a misleading indefinite
  loading message.
- Loading, empty, success, and error states are visually distinct.

### 11.2 Spinners for asynchronous button actions

- Any button triggering an async mutation shows a spinner while pending.
- The initiating button is disabled while in flight, preventing duplicate
  submission.
- Keep a clear action label, or use an explicit progress label ("Saving…",
  "Processing…").
- Multi-step transactions give understandable progress without implying success
  before the server confirms.
- On success: established AF Homes success feedback, then invalidate the
  relevant queries.
- On failure: stop the spinner, re-enable the action when safe, **preserve
  entered form data**, show an actionable error.
- Applies to create, save, update, approve, reject, activate, claim, redeem,
  reverse, reissue, and manual-adjustment actions.

### 11.3 Accessibility

- Expose loading via `aria-busy` and appropriate status announcements.
- Never rely on animation or colour alone to communicate state.
- Disabled buttons and progress labels stay understandable to keyboard and
  screen-reader users.
- Respect `prefers-reduced-motion`.

### 11.4 Avoid unnecessary blocking

- No full-page spinner when only one panel or button is processing.
- Unrelated page interactions stay available when safe.
- Navigation-only buttons need no spinner unless the navigation itself is async.
- **A spinner is not an idempotency mechanism.** Duplicate financial or points
  mutations are prevented on both the UI and the server (§4.10).

### 11.5 Tests

Tests for loading, pending, success, failure, and duplicate-click behaviour on
new pages and mutations, following existing component conventions.

### 11.6 Scope

Requirements are identified here and carried into the implementation plan. No
code is written at the specification stage.
