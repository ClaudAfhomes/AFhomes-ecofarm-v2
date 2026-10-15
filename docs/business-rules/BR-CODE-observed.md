# BR-CODE — Observed Application Behavior (UNAPPROVED)

> Banner: everything in this file is CODE_OBSERVED — investigation inventory only.
> Never cite this file as company policy. Never implement from this file.
> A behavior graduates out of here only when a company source is located and a
> documented rule created with that citation (history recorded in `CHANGELOG.md`).

- Status: all CODE_OBSERVED. Test commands/dates recorded where executed 2026-10-14 (all pass; helper-level, not workbook-rule conformance).

### BR-CODE-01 — Exact-decimal money text + BigInt arithmetic, no floats

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED (helper TEST_VERIFIED; no workbook rule to conform to)
- **Source document:** NOT DOCUMENTED (no workbook counterpart located)
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: money columns are exact-decimal TEXT with `CHECK (~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$')`; TS arithmetic via BigInt cents (`toCents/fromCents/add/subtract/compare/multiplyMoney/divideMoneyExact`); Postgres formats via `private.money(numeric)` = round-to-2 → text.
- **Rule explanation:** Taglish: pera, teksto at buumbilang — walang float, walang pag-ikot na palihim.
- **Formula or calculation:** `multiplyMoney` = rate→basis-points + half-away rounding (mirrors PG `round` for non-negatives); `divideMoneyExact` throws on remainder.
- **Inputs:** Decimal strings; 4dp rate strings
- **Outputs:** Decimal strings; throws on malformed input
- **Conditions:** All money paths
- **Exceptions:** Display-only `Intl en-PH` formatting (no arithmetic effect)
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** N/A (library invariant)
- **Workflow:** Parse → cents → compute → format.
- **Current code behavior:** `packages/shared/src/money.ts:33-149`; `supabase/migrations/20260927000003_afhomes_phase2_rpc.sql:20-32`; `packages/contracts/src/schemas/money.ts:12-19` (probe — NOT VERIFIED this phase).
- **Gap analysis:** No documented counterpart — validation target for Q9.
- **Related tests:** `packages/shared/src/money.spec.ts` — 14 passed 2026-10-14 (`pnpm --filter ./packages/shared exec vitest run src/money.spec.ts`).
- **Dependencies:** BR-CODE-02
- **Open questions:** Q9 (approve as policy?)
- **History:** None

### BR-CODE-02 — Only VERIFIED money counts; remaining/overpaid derived server-side

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: `recorded` is not money; `rejected`/`voided` never were. `remaining = max(price − verified, 0)`; `overpaid = max(verified − price, 0)`; `downSatisfied = verified ≥ requiredInitial`; `fullyPaid = verified ≥ price`. Client sends no figures.
- **Rule explanation:** Taglish: beripikado lang ang pera — ang kulang at sobra, server ang magtutuos.
- **Formula or calculation:** As above (observed, not sourced).
- **Inputs:** Cash price, minimum DP, payment rows by status
- **Outputs:** Totals + flags (remaining/overpaid/downSatisfied/fullyPaid)
- **Conditions:** Every sale financial summary
- **Exceptions:** None observed
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** Server-computed; tamper-proof request shape (ids only)
- **Workflow:** Record → verify → totals recomputed from verified rows.
- **Current code behavior:** `api/_lib/commerce.ts:50-114` (`summarizePayments`); `sale_financial_summary` (`phase2_rpc.sql:78-132`, probe); `toSummaryResponse` (`commerce.ts:471`).
- **Gap analysis:** Principle resembles BR-QLF-01 approval-gating; figures/meanings differ — validation target for Q9.
- **Related tests:** `api/_lib/commerce.spec.ts` — 33 passed 2026-10-14 (`pnpm --filter ./api exec vitest run _lib/commerce.spec.ts`).
- **Dependencies:** BR-CODE-01, BR-CODE-03
- **Open questions:** Q9
- **History:** None

### BR-CODE-03 — Membership activates only on full verified payment; idempotent; mints credentials

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED (contrast BR-QLF-02 MISMATCH)
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: `activate_card_sale` allows only `payment_verified`/`activation_pending`, re-sums verified in-transaction, raises `SALE_NOT_FULLY_PAID` otherwise; idempotent (returns existing membership, no new codes); mints `MBS-######`, QR (32B base64) + fallback hashes, `expires = now + validity_months` (default 12); creates `points_accounts` + annual-allocation ledger; sale→`active`, customer→`active`, commission→`final_qualification_pending`.
- **Rule explanation:** Taglish: bayad nang buo bago magkabisa — uulitin, dating miyembro pa rin; bagong numero at code, minsan lang ipapakita.
- **Formula or calculation:** Gate: verified ≥ price (observed).
- **Inputs:** Sale ID, actor, validity months
- **Outputs:** Membership + one-time plaintext credentials + ledger rows
- **Conditions:** Full verified payment; down payment / Auth user / seller action never sufficient alone
- **Exceptions:** Already-active sale returns existing membership (no-op)
- **Effective dates:** NOT EVIDENCED (12-month default validity unevidenced as policy)
- **People and permissions:** `POST /sales/:id/activate` (`api/_handlers/sales.ts:819-820`); service-role RPC
- **Workflow:** Fully paid → activate → membership + points account → commission pending qualification.
- **Current code behavior:** `20260927000003_afhomes_phase2_rpc.sql:365-503` (gate `:418,431` VERIFIED by grep); later amendments per AGENTS.md (`20261014000001`, `20261101000001` — NOT VERIFIED this phase).
- **Gap analysis:** Direct tension with BR-QLF-02 (100% vs 25%) — see CF-02.
- **Related tests:** `api/_handlers/phase2.spec.ts`, `phase26-finance.spec.ts` — NOT RUN.
- **Dependencies:** BR-CODE-02, BR-CODE-04
- **Open questions:** Q3, Q9
- **History:** None

### BR-CODE-04 — Single-level flexible commission: account→role→0 precedence, windows, manual qualify→paid

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED (contrast DSC/DRI + PB model)
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: `calculateCommission(price, rate) = price × rate` (`commerce.ts:33`); `resolve_commission_rule` picks account-specific → role default → 0% for the sale date within effective windows, no overlaps; 0% legal (freezes zero row); Bronze/Silver/Gold 4% zeroed prospectively, history untouched. Lifecycle `pending → payment_verified → final_qualification_pending → earned → paid (+cancelled)`; `earned` only by explicit permission-gated audited decision with mandatory notes — no auto-earn rule exists; payout is a reference marker (WHEN/BY WHOM, never amount/method).
- **Rule explanation:** Taglish: isang antas lang ang komisyon — tukoy na tao, o-uri, o sera? o sero; mano-manong apruba bago kumita; ang bayad, tala lang.
- **Formula or calculation:** commission = frozen price × frozen rate (observed).
- **Inputs:** Seller + sale date → (rule_id, rate); qualification notes
- **Outputs:** Frozen expected commission; `earned`/`paid` markers
- **Conditions:** Matching rule window; explicit qualify/pay decisions
- **Exceptions:** 0% default is legal commission
- **Effective dates:** Rule rows carry `effective_from/until` (observed mechanism)
- **People and permissions:** `GET|POST /commissions/rules`, `POST /commissions/:id/qualify|pay` (`commissions.ts:137-426`, probe); mandatory notes (`commissions.ts:362-370` VERIFIED by grep)
- **Workflow:** Sale freezes rate → full payment → `final_qualification_pending` → manual qualify → manual pay marker.
- **Current code behavior:** `commerce.ts:33-35`; `20261018000002_afhomes_flexible_commission_rules.sql:3,82,111-112,130` (VERIFIED by grep); `lifecycle.ts:48-56,237-246` (VERIFIED by grep).
- **Gap analysis:** Different model from BR-PB/BR-RATE (single rate vs DSC/DRI + PB) — see CF-01.
- **Related tests:** commissions handler specs — NOT RUN.
- **Dependencies:** BR-CODE-03
- **Open questions:** Q1, Q9
- **History:** None

### BR-CODE-05 — Seller resolution: selling roles, self default, downline-only assignment, super_admin bypass

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: selling roles list; omitted seller → self; supplied seller honored only if active + selling role + in caller's downline (super_admin bypasses); else `SELLER_*` errors.
- **Rule explanation:** Taglish: sariling benta kung walang sinabi; ang italaga, dapat aktibo, puwedeng magbenta, at nasa ilalim mo — maliban sa super_admin.
- **Formula or calculation:** NONE (eligibility rule, observed).
- **Inputs:** Actor, requested seller, target status/role, downline relation
- **Outputs:** Resolved staff ID or error
- **Conditions:** Every sale creation with seller attribution
- **Exceptions:** super_admin bypass
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** Enforced in handler (`sales.ts:400`); re-checked server-side
- **Workflow:** Resolve → validate → attribute or reject.
- **Current code behavior:** `api/_lib/commerce.ts:416-470` (`SELLING_ROLES`, `isSellingRole`, `resolveSeller` — signatures VERIFIED by grep).
- **Gap analysis:** Downline concept resembles BR-GEN-05/R7; not formula-verified — Q9.
- **Related tests:** `commerce.spec.ts` — 33 passed 2026-10-14 (covers helpers incl. this file).
- **Dependencies:** BR-GEN-05 (conceptual)
- **Open questions:** Q9
- **History:** None

### BR-CODE-06 — Spot-cash 7-day window from first verified payment

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: window starts at first VERIFIED payment (`coalesce`, never self-assigned); `deadline = start + 7d UTC`; state `fully_paid` overrides, else `not_started` / `within_deadline` / `expired`.
- **Rule explanation:** Taglish: pitong araw mula sa unang beripikadong bayad — bayad nang buo, tapos ang usapan.
- **Formula or calculation:** deadline = startedAt + 7 × 86400s (observed).
- **Inputs:** First-verified timestamp; now; fully-paid flag
- **Outputs:** Deadline + state
- **Conditions:** Sales with spot-cash semantics
- **Exceptions:** `fully_paid` overrides window state
- **Effective dates:** NOT EVIDENCED (7-day length unevidenced as policy)
- **People and permissions:** Server-computed
- **Workflow:** First verify → window opens → deadline evaluated per read.
- **Current code behavior:** `api/_lib/commerce.ts:123-140` (signatures VERIFIED by grep); `verify_card_payment` deadline set (probe).
- **Gap analysis:** No workbook counterpart — Q9.
- **Related tests:** `commerce.spec.ts` — 33 passed 2026-10-14.
- **Dependencies:** BR-CODE-02
- **Open questions:** Q9 (is 7 days policy?)
- **History:** None

### BR-CODE-07 — VIP payment schemes frozen at sale; no chaining

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED (names overlap workbook "VIP" — mechanics differ; do not conflate)
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: `spot_cash` total = cash price; `move_a` total = cash price (req = reservation, bal/4); `installment_4_month` total = installment price (bal/months); `move_b1` (40%) / `b2` (25%) DP = installment price × rate, bal/12; inexact division → `INEXACT_SCHEDULE`; missing installment price → error; Bronze B1/B2 → `SCHEME_NOT_ALLOWED`; client sends scheme code only; same→same transitions ok, `move_a→b1/b2` = `MOVE_A_CANNOT_CHAIN`, else `SCHEME_FROZEN`.
- **Rule explanation:** Taglish: pirmado ang hulugan sa bentahan — hindi na puwedeng palitan o ikadena; hatiang hindi wasto, hindi tatanggapin.
- **Formula or calculation:** As above (observed; probe-reported — NOT VERIFIED line-by-line this phase).
- **Inputs:** Plan + scheme code
- **Outputs:** Frozen economics or scheme error
- **Conditions:** Every VIP-scheme sale
- **Exceptions:** Bronze excluded from B1/B2
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** Server-resolved; client sends code only
- **Workflow:** Quote → commit frozen (`snapshotSchemeTerms`, `commerce.ts:391`) → immutable.
- **Current code behavior:** `api/_lib/commerce.ts:289-391` (signatures VERIFIED); `sales.ts:459`; `lifecycle.ts:181-190` (probe).
- **Gap analysis:** "VIP" name overlaps workbook VIP product — relationship UNKNOWN (see Q3).
- **Related tests:** `api/_handlers/vip-payment-schemes.spec.ts` — NOT RUN. `packages/contracts` purchase-flow.spec.ts — passed 2026-10-14 (in 74-test batch).
- **Dependencies:** BR-CODE-03
- **Open questions:** Q3, Q9
- **History:** None

### BR-CODE-08 — Points engine: integer points, tier caps, debt-first earning, spendable, peso conversion, tier discounts

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED (entire engine — no workbook counterpart)
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: points are integers (`0..1e9`); annual caps sole-sourced from `tier_points_config` (BRONZE 25000 / SILVER 40000 / GOLD 60000); `card_plans.yearly_points` frozen, not live; `spendable = greatest(0, balance − reversal_debt)`; earning pays debt first; snapshots not live joins (mid-period config edits cannot rewrite history); peso value from `point_redemption_rules.peso_value_per_point` with tier/window/min/max gates; per-(service,tier,window) discounts `0 < rate ≤ 100`, snapshotted per line, `net = gross − tier − points`; stacking forbidden unless promotion allows.
- **Rule explanation:** Taglish: puntos, buumbilang — may taunang kisame bawat antas; utang muna bago gastos; diskuwento, nakatatak bawat linya.
- **Formula or calculation:** As above (observed; caps + spendable VERIFIED by grep at `20261104000001_afhomes_points_rebuild.sql:88-98,155-169`; remainder probe-reported).
- **Inputs:** Tier, balances, debts, catalog/rules rows, purchase lines
- **Outputs:** Caps, spendable, quotes/commits, frozen discounts
- **Conditions:** Membership lifecycle; earning/quote/commit paths
- **Exceptions:** Spending refused while `reversal_debt > 0` on points-discount path (probe)
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** Server-priced; `earning` + `redemptions` families
- **Workflow:** Earn (debt first) → cap-checked balance → quote/commit → frozen snapshots.
- **Current code behavior:** `20261104000001_afhomes_points_rebuild.sql`; `20261105000001_afhomes_service_tier_discounts.sql`; `20261106000001_afhomes_operational_service_payments.sql` (latter two probe-reported); `api/_handlers/points.ts` (`earning` routes, probe).
- **Gap analysis:** Entire engine unapproved — highest-volume Q9 item.
- **Related tests:** `packages/contracts` points.spec.ts — passed 2026-10-14 (in 74-test batch; contract shape only). `api/_handlers/points.spec.ts`, `phase26-finance.spec.ts` — NOT RUN. DB sections (probe) — NOT RUN.
- **Dependencies:** BR-CODE-03, BR-CODE-09
- **Open questions:** Q9, Q10
- **History:** None

### BR-CODE-09 — Staff redemption is one server-priced transaction with fixed lock order and idempotency

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: scanning spends nothing (`GET /redemptions/resolve` is a read); `POST /redemptions` runs `redeem_membership_points` with lock order membership → customer → item → account; staff re-validated; customer/membership active + unexpired + item active required; price from catalog; `total = points_cost × qty` (bigint, CHECKed); `INSUFFICIENT_POINTS` guard; snapshots frozen; one ledger row + debit + `points_balance` cache sync + audit; idempotent per `(redeemed_by, key)` checked after locks.
- **Rule explanation:** Taglish: tingin lang ang scan — ang gastos, isang transaksyon sa server; uulitin, dating resibo pa rin.
- **Formula or calculation:** total = points_cost × qty; after = before − total (CHECKed, observed).
- **Inputs:** Membership, item, qty 1–99, idempotency key ≥ 8 chars, staff actor
- **Outputs:** Receipt with frozen snapshots or typed error
- **Conditions:** All status/expiry/permission checks pass
- **Exceptions:** Replay returns original receipt (post-lock idempotency check)
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** Staff permission `operations.redemption`; no figures from client
- **Workflow:** Resolve (read) → choose item → confirm → single RPC → receipt.
- **Current code behavior:** `20260928000001_afhomes_phase4_redemption.sql:149,168-187,208,334,359,374` (VERIFIED by grep); `api/_handlers/redemptions.ts` (probe).
- **Gap analysis:** No workbook counterpart — Q9. Denormalized `points_balance` cache is a known drift risk (migration header `:168-187` documents backfill).
- **Related tests:** `redemptions.spec.ts`, `redemption-pos/catalog.spec.ts`, `phase4-migration.spec.ts` — NOT RUN.
- **Dependencies:** BR-CODE-08, BR-CODE-10
- **Open questions:** Q9, Q10
- **History:** None

### BR-CODE-10 — Credentials rotate, never recover; QR/fallback are hashed identifiers; gov IDs write-only

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: `qr_token_hash`/`fallback_code_hash` are SHA-256, 256-bit random, no customer data; plaintext returned exactly once at issuance; reissue mints fresh values (old stop immediately); resolve endpoint carries no PII; fallback normalized by case/separator, QR never case-folded; government ID numbers stored, never returned (`governmentIdMasked`); browser column grants exclude them.
- **Rule explanation:** Taglish: code, hindi na maibabalik — palit-bago kapag nawala; ang ID ng gobyerno, tago.
- **Formula or calculation:** NONE (identity/security mechanics, observed).
- **Inputs:** Membership + customer + actor (reissue); presented identifier (resolve)
- **Outputs:** New one-time plaintext (reissue) / PII-free membership ref (resolve)
- **Conditions:** Ownership + active customer re-checked in SQL
- **Exceptions:** None observed
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** Owner via portal (`POST /customer/membership/credentials`); staff via identifier resolve (no PII)
- **Workflow:** Issue once → present → resolve (read-only) → reissue rotates on request.
- **Current code behavior:** Phase 3 migration (`20260927000005_afhomes_phase3_customer_portal.sql`, AGENTS.md); `api/_lib/identifier.ts` (probe); `customers.ts:77-79` masked field (probe).
- **Gap analysis:** No workbook counterpart — Q9.
- **Related tests:** `phase3-migration.spec.ts`, `customer-security.spec.ts`, `member-lookup-authorization.spec.ts` — NOT RUN.
- **Dependencies:** BR-CODE-03
- **Open questions:** Q9
- **History:** None

### BR-CODE-11 — Dual authorization: staff permissions vs customer ownership (never mixed)

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED (governance-adjacent; closest to BR-AUTH/BR-OPS-05 in spirit, different mechanics)
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: staff path (`auth.users → staff_users(active) → assignments → roles(active) → role_permissions MINUS restrictions`, per-request, no cache, super_admin = all, invariants A–H); customer path (ownership only, imports nothing staff; suspended/cancelled read profile but refused membership/points); frontend guards UX-only, server re-checks everything.
- **Rule explanation:** Taglish: dalawang daan — tauhan sa pahintulot, kustomer sa pagmamay-ari; hindi naghahalo.
- **Formula or calculation:** NONE (authorization architecture, observed).
- **Inputs:** Session JWT / service role
- **Outputs:** Effective permission set or single-customer scope
- **Conditions:** Every staff API call / every portal call
- **Exceptions:** `mustChangePassword` blocks module endpoints; MFA for admin/super_admin paths (probe)
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** All roles (24 module keys, probe); no customer-portal module by design
- **Workflow:** Resolve principal → compute scope → enforce per action.
- **Current code behavior:** `api/_lib/afhomes-access.ts`, `customer-access.ts`; `private.has_permission()` (AGENTS.md); `apps/admin/src/app/navigation.ts` (probe).
- **Gap analysis:** Authorization, not business policy — keep separate from rule approvals; Q9-adjacent only.
- **Related tests:** `authorization.regression.spec.ts` (both suites) — NOT RUN.
- **Dependencies:** None
- **Open questions:** None (architecture, see system audit)
- **History:** None

### BR-CODE-12 — Sellability guard + input normalization (validation, not policy)

- **Documentation status:** CODE_OBSERVED
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** NOT DOCUMENTED
- **Source location:** NOT DOCUMENTED
- **Source authority:** UNKNOWN
- **Original rule:** NOT DOCUMENTED — observed: reject sale if category inactive / product inactive / price ≤ 0 / minDP > price (`PRODUCT_CATEGORY_INACTIVE`, `PRODUCT_INACTIVE`, `ZERO_PRICE`, `DOWN_PAYMENT_EXCEEDS_PRICE`); names Unicode-letters-only UPPERCASE, PH mobile `09→+63`, emails lowercase, money exact-decimal, birth past + ≤120y; frontend normalizes on submit, handlers on write, imports per row; history never rewritten.
- **Rule explanation:** Taglish: hindi mabebenta kung hindi aktibo o mali ang presyo; ang datos, lilinisin sa pasukan — luma, hindi na gagalawin.
- **Formula or calculation:** Guard predicates (observed).
- **Inputs:** Product + category + raw person fields
- **Outputs:** Rejection code or normalized record
- **Conditions:** Sale creation; every person/data write
- **Exceptions:** None observed
- **Effective dates:** NOT EVIDENCED
- **People and permissions:** N/A (validation layer)
- **Workflow:** Normalize → validate → reject or persist.
- **Current code behavior:** `api/_lib/commerce.ts:173-184` (guard VERIFIED by grep); `packages/contracts/src/schemas/input.ts` (probe); `apps/admin/src/lib/normalize.ts` (probe).
- **Gap analysis:** Validation hygiene, not business policy — do not promote without Q9.
- **Related tests:** `commerce.spec.ts` — 33 passed 2026-10-14. `packages/contracts` input.spec.ts — passed 2026-10-14 (in 74-test batch). `input-normalization.spec.ts` — NOT RUN.
- **Dependencies:** None
- **Open questions:** Q9 (only if any normalization is claimed as policy)
- **History:** None
