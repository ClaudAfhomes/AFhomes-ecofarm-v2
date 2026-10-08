# AF Homes — Application-First Purchase Flow: Migration Review Package

**Purpose:** the evidence a reviewer needs to decide whether to apply
`20261101000001_afhomes_application_purchase_flow.sql` to a shared Supabase
project. This describes the **finished implementation**, not the proposal.

**Nothing in this package has been applied to a shared project. No commit, no
push, no deployment has been made.**

---

## 1. Migration artifact

| Property | Value |
|---|---|
| Filename | `supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql` |
| Line count | 1958 |
| Byte count | 139 796 |
| SHA-256 | `f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58` |
| Migration version | `20261101000001` |
| Immediately prior migration | `20261029000001_afhomes_operational_access_functions.sql` |
| Migrations in `supabase/migrations/` | 39 |
| Position | last (39 of 39) |
| Migrations before / after local apply | 38 before, 39 applied, **0 after** |

**Verified by execution:** the file applies cleanly to a disposable PostgreSQL
loaded with the Supabase shim, and re-applies cleanly as well (idempotent). Both
directions were run.

---

## 2. Schema delta (actual)

### `public.customer_application_purchase_terms` (new)
Immutable capture of the commercial offer at a point in time. PK `id`; unique
`(application_id, version)`. Columns include `application_id`, `customer_id`,
`plan_id`, `seller_staff_id`, `version`, `capture_kind` (`submission`|`review`),
`reason`, `captured_by`, `captured_at`, `tier`, `payment_scheme`, `total_price`,
`reservation_fee`, `minimum_down_payment`, `required_initial`,
`installment_months`, `monthly_amount`, `spot_cash_days`, `validity_months`,
`discount_percent`, `yearly_points`, `annual_points_tranches`, `holder_limit`,
`inclusions`, `commission_rule_id`, `commission_rate`, `commission_base`,
`expected_commission` — all money columns carry exact-decimal CHECK regexes.
Trigger `purchase_terms_application_identity` (BEFORE INSERT/UPDATE) forbids an
identity mismatch with the application.

### `public.customer_applications`
| Change | Detail |
|---|---|
| Column | `purchase_terms_id uuid` (added) |
| FK | `application_purchase_terms_fk` → `customer_application_purchase_terms(id, purchase_terms_id)`, RESTRICT |
| Constraint trigger | `application_purchase_source_consistency` (deferred), added/extended for the purchase source |
| RLS | unchanged (SELECT-only for browser roles) |

### `public.reservation_agreements`
| Change | Detail |
|---|---|
| Nullability | `sale_id` → **nullable** (an application-origin reservation has no sale until finalization) |
| Columns added | `origin` (`sale`\|`application`, default `sale`), `customer_id`, `seller_staff_id`, `purchase_terms_id`, `minimum_down_payment_snapshot`, `required_initial_snapshot`, `spot_cash_days_snapshot`, `validity_months_snapshot`, `commission_rule_id`, `commission_rate_snapshot`, `commission_base_snapshot`, `expected_commission_snapshot`, `spot_cash_started_at`, `spot_cash_deadline`, `finalized_by`, `finalized_at` |
| CHECK | `reservation_finalization_check` — a sale link without `finalized_at` is impossible |
| Triggers | `reservation_purchase_identity_fk` (BEFORE INSERT/UPDATE) — economics must equal the immutable terms row, source immutable, terms pointer immutable once a live agreement exists |
| Constraint trigger | `reservation_purchase_source_consistency` (deferred) |
| Partial unique index | `reservation_one_live_application` on `(customer_application_id) WHERE origin = 'application' AND status <> 'cancelled'` — one live agreement per application; a cancelled one frees it. *(Index name corrected against the applied catalog; the behaviour described here was always correct.)* |

### `public.payments`
| Change | Detail |
|---|---|
| Nullability | `sale_id` → **nullable** |
| Columns added | `origin` (`sale`\|`reservation`, default `sale`), `reservation_id uuid` → `reservation_agreements(id)` RESTRICT |
| Partial unique index | `payments_reservation_reference_unique` on `(reservation_id, reference) WHERE origin='reservation'` — a duplicate reference is a duplicate payment |
| Trigger | `purchase_payment_immutable` — source immutable, amount/method/customer immutable once recorded, decisions immutable once made, `RESERVATION_FINALIZED` after linking |

### `public.card_sales`
**No schema change.** The finalization path inserts into the existing table using
its existing columns.

### `public.memberships`
**No schema change.** Activation uses the existing table and allocator.

### `private.purchase_document_evidence` (new)
PK `id`; exactly one of `reservation_id` / `payment_id` / `sale_id` /
`membership_id` (CHECK); generated `source_id`; `kind` (`reservation`,
`payment_recorded`, `payment_verified`, `purchase_finalized`,
`membership_activated`); `revision`; `schema_version`; `actor_id`; `captured_at`;
`fields jsonb` with a per-kind **allowlist** validated by
`private.purchase_document_fields_valid`. RLS enabled; revoked from all roles.
Triggers: `prevent_purchase_evidence_mutation` (immutable) and a deferred source
consistency check.

### `private.mutation_requests`
| Change | Detail |
|---|---|
| Column | `result_receipt jsonb` (added) — the replay payload |
| CHECK | `mutation_requests_operation_check` widened to include `purchase_terms.review`, `application.submit`, `application.decide`, `reservation.transition`, `payment.verify`, `reservation.finalize`, `purchase.finalize`, `membership.activate` |
| Trigger | `prevent_mutation_receipt_rewrite` — a receipt is written once |

### RLS and grants
No browser policy or grant was added. Every new `SECURITY DEFINER` function is
`revoke`d from `public`, `anon`, `authenticated` and `grant`ed only to
`service_role`. `private.purchase_document_evidence` is revoked from all roles
including `service_role`; it is reachable only through the two private helpers.

---

## 3. RPC inventory (actual signatures)

### New public functions
```
public.purchase_terms_proposal(p_application_id uuid, p_actor_id uuid, p_seller_candidate uuid default null) returns jsonb
public.review_application_purchase_terms_once(p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text, p_reason text, p_seller_candidate uuid default null) returns uuid
public.submit_purchase_application_once(p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_expected_hash text, p_seller_candidate uuid default null) returns uuid
public.decide_purchase_application_once(p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_decision text) returns uuid
public.reserve_application_purchase_once(p_request_id uuid, p_actor_id uuid, p_application_id uuid, p_terms_id uuid, p_input jsonb) returns uuid
public.transition_purchase_reservation_once(p_request_id uuid, p_actor_id uuid, p_reservation_id uuid, p_action text, p_input jsonb default '{}'::jsonb) returns uuid
public.record_reservation_payment_once(p_request_id uuid, p_reservation_id uuid, p_input jsonb, p_actor_id uuid) returns uuid
public.verify_purchase_payment_once(p_request_id uuid, p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid) returns jsonb
public.purchase_financial_summary(p_source_id uuid) returns jsonb
public.finalize_reservation_purchase_once(p_request_id uuid, p_reservation_id uuid, p_actor_id uuid) returns uuid
public.purchase_document(p_kind text, p_source_id uuid, p_actor_id uuid, p_revision integer default null) returns jsonb
```

### Replaced public functions
```
public.verify_card_payment(p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid)
    returns table (sale_id uuid, status text, verified_total text, remaining_balance text,
                   fully_paid boolean, spot_cash_deadline timestamptz)
public.activate_card_sale(p_sale_id uuid, p_actor_id uuid, p_validity_months integer default 12)
    returns table (membership_id uuid, membership_number text, fallback_code text,
                   qr_token text, points_allocated bigint, already_active boolean)
```
Both replacements keep the **exact** signature, result columns and behaviour. The
only changes are the lock order in `verify_card_payment` and, in
`activate_card_sale`, the added `finance.card_activation:update` SQL check plus the
activation evidence row.

### Private helpers (all `SECURITY DEFINER`, revoked from every role)
```
private.purchase_terms_for_application(p_application uuid, p_seller uuid, p_capture_kind text) returns jsonb
private.build_purchase_document_fields(p_kind text, p_source_id uuid, p_actor_id uuid) returns jsonb
private.append_purchase_document(p_kind text, p_source_id uuid, p_revision integer, p_actor_id uuid) returns uuid
private.complete_purchase_mutation(p_actor uuid, p_operation text, p_request uuid, p_payload jsonb, p_result uuid, p_receipt jsonb) returns void
private.purchase_document_fields_valid(p_kind text, p_fields jsonb) returns boolean
private.purchase_test_cleanup_allowed(p_table regclass) returns boolean
private.guard_reservation_purchase_identity() returns trigger
private.guard_purchase_payment_mutation() returns trigger
private.guard_application_purchase_terms() returns trigger
private.prevent_purchase_evidence_mutation() returns trigger
private.prevent_mutation_receipt_rewrite() returns trigger
private.check_purchase_source_consistency() returns trigger
```

Every `SECURITY DEFINER` function pins `search_path` explicitly.

---

## 4. Authorization matrix (actual)

| Mutation | Permission | Re-checked in SQL |
|---|---|---|
| Terms proposal / read | `sales.customers:view`, or `:update` for a reviewer | yes, via `mutation_actor_role` on the write path |
| Old application review | `sales.customers:update` | yes — approved application, no live reservation, mandatory reason |
| Submit | `sales.customers:create` owner or `:update` reviewer | yes |
| Reserve (application-origin) | `sales.card_sales:create` | yes — frozen seller revalidated, application revalidated |
| Draft update / submit / execute / reopen / cancel | creator owner OR `sales.card_sales:update` | yes |
| Record / verify / reject / finalize | `finance.payment_verification:update` | yes |
| Activate | `finance.card_activation:update` | **added** — the old body only checked the actor was non-null |
| Document export | per-kind module `:view` | yes, fresh on every call |

**A caller cannot authoritatively set:** price, scheme, seller, commission,
paid amount, balance, status, activation state, credentials, or any document
evidence payload. Each is either absent from the request contract or recomputed
from the immutable terms row / payment rows inside the transaction. Verified by
handler tests that inject each field and assert a 400 before any RPC is issued.

---

## 5. Lock order (implemented)

```
request advisory lock → application → reservation → existing sale
                       → payment rows sorted by UUID → (new sale row)
```

Payment rows are locked in **UUID order** because two payments of the same
reservation have no other total order, and an unordered pair is a deadlock.

Per operation: application transitions lock the application only; reservation
create locks the application then the reservation; payment record locks the
reservation; verification discovers the source unlocked, locks parents in the
order above, then locks and **re-reads** the payment; finalization follows the
full chain; activation locks sale → new membership → customer → commission.

**No known reverse edge remains.** The deferred source-consistency triggers take
no `FOR UPDATE`, specifically so they cannot reverse the RPC order. Proven by 12
two-session races (§9) — no `40P01` in any of them.

---

## 6. Idempotency

One `private.mutation_requests` row per `(actor_id, operation, request_id)`. The
request lookup happens **before** business locks, so a retry after a lost
response replays the original result rather than racing a second one. A changed
payload under the same request id raises `MUTATION_PAYLOAD_CONFLICT`.

The replay **receipt** is stored once and is immutable
(`prevent_mutation_receipt_rewrite`). For `payment.verify` the receipt object and
the return value are the *same* jsonb, so a replay cannot answer with different
keys than the original call.

---

## 7. Legacy compatibility

| Concern | Evidence |
|---|---|
| Sale-origin reservations | `origin` defaults to `'sale'`; the purchase transition refuses them (`RESERVATION_ORIGIN_INVALID`) and the legacy wrapper still works |
| Legacy payments | `origin` defaults to `'sale'`; the immutability trigger returns early for them |
| No mass recategorization | No `UPDATE` of existing rows anywhere in the migration |
| Legacy verify path | `verify_card_payment` still exists with the same signature/result; only the lock order changed, and it is proven to still work by the existing suite |
| Legacy activation | Same function, same allocator, same behaviour; a legacy sale meets the same financial recheck (§62) |
| Membership-number allocator | `private.next_membership_number()` — the **random** allocator. A regression to the sequential `nextval` form was introduced and caught during Task H; it is fixed |
| Legacy reports | The payments report now reads a second, reservation-origin branch; every pre-existing sale-origin row still matches the first branch unchanged |

---

## 8. Financial invariants (proven)

| Invariant | Proof |
|---|---|
| ₱10,000 reservation amount **included**, not added | §61 — sale `cash_price_snapshot` equals the frozen total and `reservation_fee_snapshot` is a component of it |
| Only VERIFIED money counts | §60 — a recorded 54,000.00 reads as verified 0.00 |
| Unverified excluded | §60 |
| Rejected excluded | §60 |
| Pending blocks finalization | §61 — verified = total **and** a recorded row pending still raises `RESERVATION_UNDECIDED_PAYMENTS` |
| Same payment UUID before/after linking | §61 — sorted UUID sets are equal |
| No copied rows | §61 — payment count unchanged |
| No double counting | §61 + the report's dedupe by payment id |
| Exact-decimal | every money column carries a CHECK regex; all arithmetic is `numeric` |
| Overpayment retained | §61 — 2,500.00 over a full price still finalizes and is retained |

**Bronze spot cash, worked example (proven on real PostgreSQL):**
total 54,000.00 → verified 10,000.00 → **remaining 44,000.00** → finalize refused.
After 22,000.00 + 22,000.00 verified: verified 54,000.00, remaining 0.00 → finalize
succeeds, exactly one AF-CSALE.

---

## 9. Concurrency evidence

12 races, two independent PostgreSQL sessions each, `lock_timeout = 4s` and
`statement_timeout = 20s`, `Promise.allSettled`, no sleep-only tests. **No
deadlock in any case.** Asserted: exact row counts, exact ids, and a valid
serialized outcome.

---

## 10. Document evidence

Five kinds: `reservation`, `payment_recorded`, `payment_verified`,
`purchase_finalized`, `membership_activated`.

- Fields are built **field by field** in SQL and validated against a per-kind
  allowlist with per-key types. There is no generic caller JSON parameter.
- `public.purchase_document` authorizes fresh on every call and returns the
  captured revision; possessing a UUID grants nothing.
- A source with no capture answers `evidenceAvailable:false` with a legacy
  reason and **no fields**, never a substituted figure.
- The renderer is a pure function of the evidence JSON, so a reprint cannot
  substitute today's price, seller, commission or balance.
- No credential, hash, token, onboarding secret, government ID or storage URL
  reaches a page; asserted by field-name pattern and by page-content assertions.

---

## 11. Final test evidence (actual, this run)

| Check | Result |
|---|---|
| contracts | **183** passed (12 files) |
| API | **1865** passed (89 files) |
| admin | **611** passed (56 files) |
| `pnpm test:db:local` | **1890/1890** — §61=56, §62=37, §63=40 |
| `pnpm test:db:harness` | **13/13** |
| concurrency cases | 12, no deadlock |
| security escalation cases | 15, all refused |
| RLS invariants | zero rows |
| `typecheck:deploy` | 7/7 |
| `typecheck` | 7/7 + `tsc -p supabase` |
| `lint` | 0 errors (10 pre-existing warnings) |
| `build` | 2/2 |
| `check:env` | 475 browser / 173 server files, PASS |
| `git diff --check` | clean |
| `git diff --cached --check` | clean (nothing staged) |

---

## 12. Known limitations — stated, not hidden

1. **Authenticated browser UAT: NOT VERIFIED.** No authenticated browser session
   was available at any point in this work. Every UI claim rests on component
   tests driving the real client, real schemas and real components — not on a
   human driving the app. The full 20-step manual walkthrough in the brief was
   **not** performed.
2. **Managed-platform proof: NOT VERIFIED.** Real Supabase Auth, PostgREST and
   Storage have never executed this code. The local PostgreSQL shim reproduces
   the objects the migrations assume but cannot prove platform behaviour.
3. **PostgreSQL worker leak: clean.** Only this worktree's embedded workers
   (port 55443) were created, and all were reaped. No unrelated `postgres.exe`
   was signalled. The harness's injected-fault run still exits non-zero and still
   runs `finally` cleanup.
4. **One UI case is asserted only in the API/DB suites:** that a *rejected* payment
   offers no verified receipt. The component-level fixture did not exercise it
   without a hand-built shape that proved nothing extra, so it is asserted where
   the evidence table is — not duplicated as a hollow test.
5. Ten pre-existing lint warnings remain; none were introduced here.

---

## 13. Recommended release order (for a future, separately approved apply)

1. Review this exact artifact — filename, line count, byte count and **SHA-256
   above**. A different hash is a different migration and must be re-reviewed.
2. Verify the target project's identity and migration history: confirm the
   project ref matches the approved one, and that `20261029000001` is the last
   recorded migration. This work never touched a shared project, so its history
   is **unverified by this package**.
3. Obtain explicit, separate approval to apply to the shared project, naming the
   exact file and target.
4. Apply that exact migration. Nothing else in this document authorizes an apply.
5. Run the post-apply validation from the migration header, plus
   `supabase/security/rls_invariants.sql` — it must return zero rows.
6. Deploy the compatible application code. **`verify_card_payment` and
   `activate_card_sale` are forward replacements:** old application code calling
   either keeps working, because the signatures, result columns and behaviour are
   unchanged, but the new code must be deployed before the purchase flow is used
   in anger.
7. Perform authenticated browser UAT against the shared project, following the
   20-step walkthrough.
8. Production deployment requires separate, explicit approval. It is not implied
   by anything in this document.

**Ordering claim, stated honestly:** the schema change is *additive* (new
columns, new tables, new nullable columns, new functions) except for the
`NULL`-relaxation on `payments.sale_id` and `reservation_agreements.sale_id`, both
of which are widening changes that existing readers tolerate. So **schema before
backend is backward compatible**, and no zero-downtime claim beyond that is
proven here.

---

## 14. Rollback and recovery limitations

**Destructive rollback is NOT safe and is not claimed.**

Once reservation-origin payments exist, an older schema and older backend cannot
represent them: `payments.origin='reservation'` with `reservation_id` set and
`sale_id` NULL has no meaning in the old code, and the linked sale cannot be
unlinked because `payments_reservation_reference_unique` and the payment
immutability trigger both refuse it.

Preferred recovery, in order:

1. **Disable the new entrypoints** — stop offering application-origin reservation,
   collection, finalization and activation. Nothing else is required first.
2. **Preserve the ledger and the evidence.** Never delete
   `private.purchase_document_evidence` or reservation-origin payment rows; they
   are the only record of what a customer was charged.
3. **Roll forward** with a corrective, idempotent migration rather than reversing.
4. Reverse the *DDL* only if no reservation-origin row has ever been written, and
   only after taking and verifying a backup. This condition is false in practice
   once the feature is used.

**Process:** commits — none. Push — no. Shared database changed — no. Production
deployed — no.