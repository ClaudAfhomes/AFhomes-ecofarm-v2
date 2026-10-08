# AF Homes — Application-First Purchase Flow: Gate 7 Shared-Migration Apply

**Target:** `ikaevepedpqygdlipsei` (AF homes, ap-northeast-1, PostgreSQL 17.6)
**Applied:** exactly one migration, on explicit operator approval.
**Post-apply verification:** read-only, SELECT-only probe. **No write smoke tests.**

---

# CLASSIFICATION: PASS — SHARED MIGRATION APPLIED AND VERIFIED

---

## 1–6. Apply facts

| Property | Value |
|---|---|
| Pre-apply SHA-256 | `f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58` |
| Post-apply SHA-256 | `f9e84638d6da58ad3ba8e20d1c27c8ce2fd8946ec136b7032b92d97903b72f58` — **unchanged** |
| Target project | `ikaevepedpqygdlipsei` (ref verified from pooler username + Management API) |
| Endpoint | `aws-0-ap-northeast-1.pooler.supabase.com:6543`, db `postgres` |
| Migration selected | `20261101000001_afhomes_application_purchase_flow.sql` |
| Command | `pnpm db:migrate -- --approve-production --only=20261101000001` |
| Exit code | **0** |
| Started (UTC) | `2026-10-07T23:24:59Z` |
| Finished (UTC) | `2026-10-07T23:25:06Z` |
| Duration | ~7 s |

Sanitized output:

```
[afhomes:migrate] PRODUCTION acknowledged by the operator. Target project: ikaevepedpqygdlipsei
[afhomes:migrate] applied 20261101000001_afhomes_application_purchase_flow.sql
[afhomes:migrate] done. 1 migration(s) applied.
```

## Pre-apply hard gate — all five conditions verified immediately before apply

| Gate | Condition | Result |
|---|---|---|
| G1 | SHA-256 == approved hash | **PASS** |
| G2 | `AFHOMES_TARGET_PROJECT_REF` == `ikaevepedpqygdlipsei` | **PASS** |
| G3 | Pooler / ap-northeast-1 / 6543 / correct ref | **PASS** |
| G4 | History: 38 applied, latest `20261029000001`, target absent | **PASS** |
| G5 | Local pending set == only `20261101000001` | **PASS** |

## 7–10. History after apply

| Property | Before | After |
|---|---|---|
| Total recorded migrations | 38 | **39** |
| Latest applied | `20261029000001` | **`20261101000001`** |
| `20261101000001` occurrences | 0 | **1** |
| Duplicate recorded versions | — | **none** |
| Local files not applied | 1 (the target) | **none** |

- **Unrelated migrations applied: NO.** Exactly one version was selected and
  applied; the log states `1 migration(s) applied`.
- **`20261024000001` still absent: YES.** Not restored, not repaired.

## 11. New tables

### `public.customer_application_purchase_terms`

Owner `postgres`. **RLS enabled**, not forced, **0 policies**. Grants:
`postgres` full, `service_role` **SELECT only**. No browser privilege.

27 columns, all present with reviewed nullability and defaults
(`id` `gen_random_uuid()`, `captured_at` `now()`). Money columns are `text` with
exact-decimal CHECK regexes.

Notable constraints — **16**, all verified:

| Constraint | Guarantee |
|---|---|
| `..._application_id_version_key` `UNIQUE (application_id, version)` | version uniqueness |
| `..._application_id_id_key` `UNIQUE (application_id, id)` | enables the composite FK from applications |
| `..._id_application_id_customer_id_plan_id_seller_staff_id_key` | 5-column identity tuple unique |
| `..._check` | `capture_kind='review'` ⇒ `reason IS NOT NULL` |
| `..._check1` | `reservation_fee <= required_initial <= total_price` |
| `..._check2` | `commission_base = total_price` |
| `..._check3` | `expected_commission = round(commission_base * commission_rate, 2)` |
| `..._check4/5/6` | payment-scheme ↔ installment/monthly coherence |
| `..._check7` | `tier <> 'GOLD'` ⇒ `holder_limit = 1` |
| `..._check8` | BRONZE excludes the two MOVE_B schemes |
| 4 × FK | `application_id`, `customer_id`, `captured_by`→`staff_users`, `commission_rule_id`→`commission_rules`, all `ON DELETE RESTRICT` |
| `..._capture_kind_check` | `submission` \| `review` |

Triggers: `customer_application_purchase_terms_guard` (identity), plus the
deferred `application_purchase_source_consistency`.

### `private.purchase_document_evidence`

Owner `postgres`. **RLS enabled**, not forced, **0 policies**.
Grants: **`postgres` only** — `service_role` has **no** privilege on it.

| Constraint | Guarantee |
|---|---|
| `..._kind_check` | exactly 5 kinds: `reservation`, `payment_recorded`, `payment_verified`, `purchase_finalized`, `membership_activated` |
| `..._check1` | `num_nonnulls(reservation_id, payment_id, sale_id, membership_id) = 1` — exactly one source |
| `..._check2` | kind ↔ source-column correspondence |
| `..._check` | `private.purchase_document_fields_valid(kind, fields)` — **per-kind field allowlist** |
| `..._kind_source_id_revision_key` | `UNIQUE (kind, source_id, revision)` — revision uniqueness |
| `..._revision_check` | `revision > 0` |
| `..._schema_version_check` | `schema_version = 1` |
| 4 × FK | `reservation_id`, `payment_id`, `sale_id`, `membership_id`, `actor_id`→`staff_users`, all `ON DELETE RESTRICT` |

## 12. Altered tables

| Property | Actual |
|---|---|
| `reservation_agreements.sale_id` | **nullable = true** |
| **`reservation_agreements_sale_id_key` `UNIQUE (sale_id)`** | **still present** — survives, and is safe because PostgreSQL treats NULLs as distinct |
| `payments.sale_id` | **nullable = true** |
| `payments.reservation_id` | present, nullable |
| `private.mutation_requests.result_receipt` | present, nullable |
| `payments_payment_number_unique` | preserved |
| `payments_sale_reference_unique (sale_id, reference) WHERE reference IS NOT NULL` | preserved — legacy rows keep their guarantee |
| `reservation_id_sale_unique UNIQUE (id, sale_id)` | **new** |
| `reservation_one_live_application` | **new** — `UNIQUE (customer_application_id) WHERE origin='application' AND status<>'cancelled'` |
| `payments_reservation_reference_unique` | **new** — `UNIQUE (reservation_id, reference) WHERE origin='reservation' AND reference IS NOT NULL` |
| `payments_reservation_status_idx (reservation_id, status)` | **new** |

**7 new triggers** on altered tables:
`reservation_agreements.reservation_purchase_identity`,
`reservation_agreements.reservation_purchase_source_consistency` *(DEFERRED)*,
`payments.purchase_payment_immutable`,
`payments.payment_purchase_source_consistency` *(DEFERRED)*,
`customer_applications.application_purchase_terms_guard`,
`customer_applications.application_purchase_source_consistency` *(DEFERRED)*,
`mutation_requests.purchase_mutation_receipt_immutable`.

**Source-integrity constraints:**
- `reservation_agreements_reservation_purchase_origin_check` —
  `origin='sale'` ⇒ `sale_id IS NOT NULL AND purchase_terms_id IS NULL`;
  `origin='application'` ⇒ the application-source shape.
- `payments_payments_purchase_origin_check` —
  `origin='sale'` ⇒ `sale_id IS NOT NULL AND reservation_id IS NULL`;
  `origin='reservation'` ⇒ the reservation-source shape.
- `reservation_finalization_check` — a sale link without
  `finalized_by`/`finalized_at` is impossible.
- `customer_applications.application_purchase_terms_fk` —
  `FOREIGN KEY (id, purchase_terms_id) REFERENCES customer_application_purchase_terms(application_id, id) ON DELETE RESTRICT`.

**`mutation_requests_operation_check` widened** to exactly 11 values:
`payment.create`, `application.create`, `reservation.create`,
`purchase_terms.review`, `application.submit`, `application.decide`,
`reservation.transition`, `payment.verify`, `reservation.finalize`,
`purchase.finalize`, `membership.activate` — all 3 legacy values retained plus
8 new. `mutation_requests_actor_id_operation_request_id_key UNIQUE
(actor_id, operation, request_id)` preserved.

## 13. Constraints / indexes / triggers — summary

48+ new or altered constraints across 4 tables, 4 new indexes, 7 new triggers
plus the new-table triggers, 3 deferred source-consistency triggers. Every object
present and matching the reviewed artifact.

## 14. RPC inventory — 11 of 11 new, both replacements intact

All 11 new public RPCs exist with **exactly** the reviewed signatures:
`purchase_terms_proposal`, `review_application_purchase_terms_once`,
`submit_purchase_application_once`, `decide_purchase_application_once`,
`reserve_application_purchase_once`, `transition_purchase_reservation_once`,
`record_reservation_payment_once`, `verify_purchase_payment_once`,
`purchase_financial_summary`, `finalize_reservation_purchase_once`,
`purchase_document`.

| Replaced function | Signature after apply | Result after apply | Compatible |
|---|---|---|---|
| `verify_card_payment` | `(p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid)` | `TABLE(sale_id uuid, status text, verified_total text, remaining_balance text, fully_paid boolean, spot_cash_deadline timestamptz)` | **YES — identical** |
| `activate_card_sale` | `(p_sale_id uuid, p_actor_id uuid, p_validity_months integer)` | `TABLE(membership_id uuid, membership_number text, fallback_code text, qr_token text, points_allocated bigint, already_active boolean)` | **YES — identical** |

Both remain `SECURITY DEFINER`. **The pre-existing deployed backend keeps working
against the new definitions.**

## 15. Private helper inventory

Present: `purchase_document_fields_valid`, `build_purchase_document_fields`,
`append_purchase_document`, `complete_purchase_mutation`,
`purchase_terms_for_application`, `purchase_test_cleanup_allowed`, plus the
pre-existing `mutation_result`, `complete_mutation`, `has_permission`, `money`,
`next_membership_number`.

## 16. RLS result

| Table | RLS | Forced | Policies | Browser grant |
|---|---|---|---|---|
| `customer_application_purchase_terms` | enabled | no | 0 | **none** (`service_role` SELECT only) |
| `private.purchase_document_evidence` | enabled | no | 0 | **none** — `postgres` only |

No browser policy was added. No browser write privilege exists anywhere.

## 17. ACL result — **PUBLIC execute verified ABSENT**

All 13 new/replaced functions carry an **explicit** ACL:

```
{postgres=X/postgres, service_role=X/postgres}
```

`anon EXECUTE = false`, `authenticated EXECUTE = false`, `service_role EXECUTE =
true`, **on every one**. Zero functions rely on the built-in default.

This mattered: the shared project carries a **default ACL on the `public` schema**
of `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}`
for functions. Had the migration relied on that default, `anon` and
`authenticated` would have been able to call every purchase-flow mutation
directly. The explicit revokes defeated it.

No `GRANT EXECUTE ON ALL FUNCTIONS` was introduced.

## 18. search_path result

12 of 13 functions: `search_path = pg_catalog, extensions, private, public, pg_temp` — hardened.

**1 exception:** `activate_card_sale` retains `search_path = public, private, pg_temp`.

- **No regression:** this is exactly its pre-apply value (see Gate 7 preflight).
- **Not exploitable:** `CREATE` on schema `public` is `false` for `anon`,
  `authenticated` **and** `service_role`, so no unprivileged role can shadow an
  object into that path.
- Recorded as **Finding B** below — cosmetic inconsistency, worth a forward-only
  cleanup, not a deployment blocker.

## 19. service_role execution result

`service_role` may execute all 13 new/replaced functions — intended, since the API
resolves principals with the service role. `service_role` may **not** touch
`private.purchase_document_evidence` directly (`SELECT=false, INSERT=false`); it
reaches evidence only through the private helper. This is the designed posture.

## 20. Browser mutation privileges — **NONE**

| Role | Table writes | Function execute |
|---|---|---|
| `anon` | none | none |
| `authenticated` | none | none of the 13 purchase-flow functions |

`private.has_permission` remains executable by `authenticated` — **pre-existing
and intentional**, because RLS policies call it. Not created or altered by this
migration.

## 21. Historical row preservation — **exact, zero drift**

| Table | Gate 7 baseline | After apply | Verdict |
|---|---|---|---|
| `reservation_agreements` | 5 | **5** | MATCH |
| `payments` | 14 | **14** | MATCH |
| `card_sales` | 15 | **15** | MATCH |
| `memberships` | 6 | **6** | MATCH |
| `audit_events` | 223 | **223** | MATCH |
| `private.mutation_requests` | 2 | **2** | MATCH |
| `customer_application_purchase_terms` | — | **0** | new, empty |
| `private.purchase_document_evidence` | — | **0** | new, empty |

Backfill correctness:

| Check | Count | Verdict |
|---|---|---|
| reservations `origin='sale'` | 5 / 5 | all legacy rows categorised correctly |
| payments `origin='sale'` | 14 / 14 | all legacy rows categorised correctly |
| reservations with `origin` outside sale/application | 0 | clean |
| payments with `origin` outside sale/reservation | 0 | clean |
| reservations with NULL `sale_id` | 0 | no legacy row disturbed |
| payments with NULL `sale_id` | 0 | no legacy row disturbed |
| payments with NULL `reservation_id` | 14 | correct — all legacy sale-origin |
| duplicate live reservations per application | 0 | new partial unique index is satisfiable |

**No production row was created, modified or deleted by this gate.** The new
tables are empty, which is the proof that no write smoke test ran.

## 22. Mutation operations

Existing rows unchanged: 2 rows, 1 distinct operation, `application.create` ×2.
The widened CHECK retains that value. **No historical row was rewritten.**

## 23. Membership allocator lineage — **RANDOM, NO GATE 5 REGRESSION**

Verified by reading the deployed definition, not by executing it:

```sql
perform pg_advisory_xact_lock(19000002,1);
for attempt in 1..64 loop
  raw := upper(encode(gen_random_bytes(16), 'hex'));
  candidate := 'MBS-' || substring(raw,1,8) || '-' || substring(raw,9,8)
    || '-' || substring(raw,17,8) || '-' || substring(raw,25,8);
  if not exists (select 1 from public.memberships m where m.membership_number=candidate)
    then return candidate; end if;
end loop;
raise exception 'MEMBERSHIP_NUMBER_ALLOCATION_FAILED' using errcode='55000';
```

128 bits from `gen_random_bytes(16)`, uppercase hex, 4×8 grouped. Collision-checked
against `memberships`, retried 64 times, hard-fails after that. Serialised by an
advisory transaction lock. **No sequential counter. No customer data encoded.**
`search_path` hardened. This is the approved allocator lineage.

`activate_card_sale` calls it: `v_membership_number := private.next_membership_number();`

## 24. Payment verify lineage

`verify_card_payment` present, `SECURITY DEFINER`, identical signature and result
shape, contains `FOR UPDATE` locking and a `status = 'verified'` filter. The
reviewed parent-first-compatible implementation is deployed. **No payment was
mutated.**

## 25. Activation lineage — all required elements confirmed in the body

| Requirement | Evidence in deployed body |
|---|---|
| Financial recheck | `select coalesce(sum((amount)::numeric),0) into v_verified where sale_id = v_sale.id and status='verified'` |
| Full-payment gate | `if v_verified < v_price then raise exception 'SALE_NOT_FULLY_PAID:verified=% price=%'` |
| Secure allocator | `v_membership_number := private.next_membership_number();` |
| SQL permission gate | `perform private.mutation_actor_role(p_actor_id,'finance.card_activation','update');` |
| Immutable evidence | `v_receipt := private.append_purchase_document('membership_activated', v_membership_id, 1, p_actor_id);` |
| Row locking | `FOR UPDATE` present |

**No activation was called.**

## 26. rls_invariants result — **ZERO — PASS**

`supabase/security/rls_invariants.sql` executed read-only against the shared
project. All 6 statements were verified to be `SELECT`/`WITH` before execution;
non-SELECT statements would have been skipped and reported. **Zero violation
rows.** No fix was applied because there was nothing to fix.

---

## Findings

### Finding A — documentation defect (corrected, non-blocking)

`docs/AFHOMES-APPLICATION-PURCHASE-FLOW-MIGRATION-REVIEW.md` line 63 named the
partial unique index `reservations_one_live_per_application`. The actual index is
**`reservation_one_live_application`**.

The documented *behaviour* was correct — the real index is the partial index
described (`WHERE origin='application' AND status <> 'cancelled'`). Only the name
was wrong. **The migration was always correct; the document was not.** Corrected
in place with a note. This is why the applied catalog was checked rather than the
document being trusted.

### Finding B — cosmetic inconsistency (non-blocking)

`activate_card_sale` uses `search_path = public, private, pg_temp` while the other
12 functions use the hardened `pg_catalog, extensions, private, public, pg_temp`.
No regression (unchanged from pre-apply), and not exploitable because no
unprivileged role can `CREATE` in `public`. A forward-only corrective migration
would make it uniform. **Not a deployment blocker.**

### Finding C — pre-existing, informational

`private.has_permission` is executable by `authenticated`. Pre-existing and
intentional (RLS policies call it). Unchanged by this migration.

### Two probe defects found and corrected before reporting

1. **False PUBLIC-EXECUTE alarm.** My first ACL check used the regex `=[^,]*(X/)`,
   which matches role-qualified grants such as `=postgres=X/postgres`. All 13
   functions were reported `PUBLIC_EXEC=true`. Re-measured from raw `proacl`, the
   true state is **no PUBLIC entry at all**. Reporting the first result would have
   been a false security finding.
2. **False allocator-regression alarm.** The Phase 11 marker probe searched for
   `random()` and for `nextval`, found neither, and printed
   "POSSIBLE SEQUENTIAL REGRESSION". The allocator uses `gen_random_bytes(16)` and
   no sequence at all. Reading the definition proved it random. A keyword guess
   nearly produced a false stop on the one check the brief flagged as critical.

Both are recorded because each would have changed the conclusion, and because a
guard that fails for the wrong reason is indistinguishable from a real defect.

---

## 27–32. Actions taken

| Action | Performed |
|---|---|
| Shared DB changed | **YES — exact migration `20261101000001` only.** 1 migration, no others |
| Write smoke tests | **NO** — no production application, terms, reservation, payment, sale, membership or evidence row created |
| `git push` | **NO** |
| Application deployment (Vercel Preview/Production, admin, API) | **NO** |
| Production application deployment | **NO** |
| Commits created | **NO** |
| Secrets printed | **NO** — URL, username and password withheld throughout |
| PII printed | **NO** — counts and catalog metadata only |
| Destructive rollback | **NOT RUN**, not needed |
| Migration history repaired | **NO** |

## 33. Final schema readiness classification

# SHARED SCHEMA READY FOR COMPATIBLE APPLICATION CODE

Every reviewed object is present and correct, all historical rows are byte-for-byte
preserved in count and categorised correctly, no browser privilege exists, the
`rls_invariants` audit is clean, and both forward-replaced functions keep
byte-identical signatures and result shapes so the currently deployed backend
keeps working.

Two non-blocking findings are recorded. Neither blocks application deployment.

**Next step, not taken:** commit the implementation, push `claud/develop`, and
deploy to Vercel Preview for authenticated browser UAT. Each requires separate
authorization.