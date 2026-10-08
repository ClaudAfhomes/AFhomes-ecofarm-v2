# AF Homes application-first purchase flow — Gate 3 execution review

**PASS — GATE 3 POSTGRESQL EXECUTION VERIFIED**

Date: 2026-10-07. Mode: native; no subagents. Branch: claud/develop.
Baseline commit: c165a21ad4a835b20ee71cc51eebc00d6be21d62.
Scope: disposable PostgreSQL contract execution only. **Task C has not started.**
The migration remains an unreleased contract draft, without the future operational transaction RPCs. This verdict is local PostgreSQL proof, not approval to apply or release it.

## Artifact and target

| Required item | Verified value |
|---|---|
| Migration filename | supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql |
| SHA-256 | 0d2d1c5ad301c85dc4c986208dd2e1ccedca8ee8d77f4e10be8d44f3302b4431 |
| Lines | 556 |
| Bytes | 44501 |
| Baseline migrations | 38 |
| Latest baseline | 20261029000001_afhomes_operational_access_functions.sql |
| After migration | 39 |
| Direct reapply | Succeeded; catalog snapshot unchanged; no duplicate tables/constraints/indexes/policies/grants |
| Target | 127.0.0.1:55449, database postgres |
| PostgreSQL | Embedded PostgreSQL 18.4.0-beta.17 package; real loopback engine plus repository Supabase shim |
| Shared connection variables | None set in execution shell; no remote credentials/configuration read by this harness |
| Migration version | Exactly one file with prefix 20261101000001 |

The local fixture harness records applied filenames; it does not create or modify shared Supabase migration history. Counts above describe successfully executed local migration files, not a fabricated remote migration ledger. Only the one new draft was directly reapplied; historical migration files were untouched.

## Execution and preservation

Existing harness startDisposablePostgres gained an optional exclusive beforeMigration boundary and non-secret host/port/database/PID metadata. Default full-suite behavior still applies all files. New test runner: packages/db-testing/scripts/test-purchase-gate3.mjs.
Reproduce from this worktree using AFHOMES_TEST_PG_PORT=55449 and node packages/db-testing/scripts/test-purchase-gate3.mjs. Boot is always disposable loopback; no supplied DATABASE_URL is consumed.

Before the draft, synthetic legacy fixtures contained four card sales (active/member-linked and open), one sale-origin payment, one membership, three customer applications, one sale-origin reservation linked to an application, and three mutation requests covering every old operation. Reservation save and payment recording used existing supported RPCs; synthetic customer/sale/member rows were owner-created SQL fixtures, not proof of a newly implemented activation path.
Before/after comparison covered every pre-existing column of every legacy fixture row: IDs, links, statuses, monetary strings and timestamps matched exactly. Only intended new nullable/default columns were added. Old payment/reservation origins became sale; no copied payment, fake reservation reference, historical recalculation or deleted legacy row.
Synthetic legacy IDs: {"app":"5ff38465-673d-4600-a8f4-6c305ef5fc1f","reservation":"1f7d844c-c1b1-43d7-89f9-58173057452b","payment":"d0893ed5-83f0-494a-ae77-f25bb5f73885","sales":["7122ad72-bbdb-4d4d-9cb3-8717679281e9","6802b951-ead8-463a-b913-e399434146ad","3e3d1158-e09b-4c96-8c0d-b3fd71ba54cb","c51b90e7-158b-4c95-a801-5369f0acb93f"],"membership":"fd71fca7-80c9-49b4-8f12-1ed876530d98"}.

The baseline captured relevant table counts, constraints, indexes, signatures/definitions, grants, RLS/policies and triggers before fixtures/application. Every baseline constraint/index was preserved except the two deliberately removed sale_id NOT NULL constraints and the deliberately expanded mutation operation CHECK. PostgreSQL 18 exposes NOT NULL in pg_constraint, so the comparison explicitly excludes only those two expected removals.
The full definitions/signatures/grants of activate_card_sale, verify_card_payment, complete_mutation, mutation_result were unchanged byte-for-byte.

## Schema delta and exact catalog

- Immutable public.customer_application_purchase_terms: UUID PK; application/customer/plan/seller/capture-actor FKs; version and unique(application,version); review reason; frozen scheme/economics/benefits/commission. Valid insert succeeds; update/delete/version duplication and invalid review reason fail.
- Application purchase_terms_id binds to the exact same application's terms. Insert capture now checks the application's actual customer/plan. A current pointer must continue matching those identities; a live reservation also prevents switching versions. Clearing a pointer when no live reservation exists permits future explicit re-review; historical terms remain immutable.
- Reservation sale_id is nullable, preserving its old FK and uniqueness. Legacy sale-origin remains valid. Application-origin binds exact terms identity and snapshots, preserves immutable source/date, enforces final link metadata together and once-only sale linkage, and permits only one live reservation per application.
- Payments keep one ledger and source origin permanently. Reservation-origin rows can exist with NULL sale_id, then acquire the same finalized sale reference without changing UUID/count. Old sale-origin reference uniqueness is retained.
- private.purchase_document_evidence: exactly one matching source FK, five kinds, revision/schema version, actor/time, generated source_id and unique(kind,source_id,revision). Mutation, wrong kind/source, missing source and duplicate revision are denied.
- private.mutation_requests remains the only idempotency registry. Old operations remain; all six new values validate. Existing mutation_result/complete_mutation work unchanged. New receipts require matching result UUID and typed allowlisted values, and cannot be rewritten.

New catalog totals: 104 constraints (including PostgreSQL 18 NOT NULL catalog entries), 10 indexes, 11 triggers, 11 functions, of which four SECURITY DEFINER.

### New CHECK, FK and UNIQUE definitions

- private.purchase_document_evidence.purchase_document_evidence_actor_id_fkey: FOREIGN KEY (actor_id) REFERENCES staff_users(id) ON DELETE RESTRICT
- private.purchase_document_evidence.purchase_document_evidence_check: CHECK (private.purchase_document_fields_valid(kind, fields))
- private.purchase_document_evidence.purchase_document_evidence_check1: CHECK ((num_nonnulls(reservation_id, payment_id, sale_id, membership_id) = 1))
- private.purchase_document_evidence.purchase_document_evidence_check2: CHECK ((((kind = 'reservation'::text) AND (reservation_id IS NOT NULL)) OR ((kind = ANY (ARRAY['payment_recorded'::text, 'payment_verified'::text])) AND (payment_id IS NOT NULL)) OR ((kind = 'purchase_finalized'::text) AND (sale_id IS NOT NULL)) OR ((kind = 'membership_activated'::text) AND (membership_id IS NOT NULL))))
- private.purchase_document_evidence.purchase_document_evidence_kind_check: CHECK ((kind = ANY (ARRAY['reservation'::text, 'payment_recorded'::text, 'payment_verified'::text, 'purchase_finalized'::text, 'membership_activated'::text])))
- private.purchase_document_evidence.purchase_document_evidence_kind_source_id_revision_key: UNIQUE (kind, source_id, revision)
- private.purchase_document_evidence.purchase_document_evidence_membership_id_fkey: FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE RESTRICT
- private.purchase_document_evidence.purchase_document_evidence_payment_id_fkey: FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
- private.purchase_document_evidence.purchase_document_evidence_pkey: PRIMARY KEY (id)
- private.purchase_document_evidence.purchase_document_evidence_reservation_id_fkey: FOREIGN KEY (reservation_id) REFERENCES reservation_agreements(id) ON DELETE RESTRICT
- private.purchase_document_evidence.purchase_document_evidence_revision_check: CHECK ((revision > 0))
- private.purchase_document_evidence.purchase_document_evidence_sale_id_fkey: FOREIGN KEY (sale_id) REFERENCES card_sales(id) ON DELETE RESTRICT
- private.purchase_document_evidence.purchase_document_evidence_schema_version_check: CHECK ((schema_version = 1))
- public.card_sales.sale_purchase_source_consistency: TRIGGER DEFERRABLE INITIALLY DEFERRED
- public.customer_application_purchase_terms.customer_application_purchase_id_application_id_customer_id_key: UNIQUE (id, application_id, customer_id, plan_id, seller_staff_id)
- public.customer_application_purchase_terms.customer_application_purchase_term_annual_points_tranches_check: CHECK ((annual_points_tranches > 0))
- public.customer_application_purchase_terms.customer_application_purchase_terms_application_id_fkey: FOREIGN KEY (application_id) REFERENCES customer_applications(id) ON DELETE RESTRICT
- public.customer_application_purchase_terms.customer_application_purchase_terms_application_id_id_key: UNIQUE (application_id, id)
- public.customer_application_purchase_terms.customer_application_purchase_terms_application_id_version_key: UNIQUE (application_id, version)
- public.customer_application_purchase_terms.customer_application_purchase_terms_capture_kind_check: CHECK ((capture_kind = ANY (ARRAY['submission'::text, 'review'::text])))
- public.customer_application_purchase_terms.customer_application_purchase_terms_captured_by_fkey: FOREIGN KEY (captured_by) REFERENCES staff_users(id) ON DELETE RESTRICT
- public.customer_application_purchase_terms.customer_application_purchase_terms_check: CHECK (((capture_kind <> 'review'::text) OR (reason IS NOT NULL)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check1: CHECK ((((reservation_fee)::numeric <= (required_initial)::numeric) AND ((required_initial)::numeric <= (total_price)::numeric)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check2: CHECK (((commission_base)::numeric = (total_price)::numeric))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check3: CHECK (((expected_commission)::numeric = round(((commission_base)::numeric * (commission_rate)::numeric), 2)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check4: CHECK ((((payment_scheme = 'spot_cash'::text) AND (installment_months IS NULL) AND (monthly_amount IS NULL)) OR ((payment_scheme <> 'spot_cash'::text) AND (installment_months IS NOT NULL) AND (monthly_amount IS NOT NULL) AND (((monthly_amount)::numeric * (installment_months)::numeric) = ((total_price)::numeric - (required_initial)::numeric)))))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check5: CHECK ((((payment_scheme = ANY (ARRAY['spot_cash'::text, 'move_a'::text, 'installment_4_month'::text])) AND ((required_initial)::numeric = (reservation_fee)::numeric)) OR ((payment_scheme = 'move_b1_40_12'::text) AND ((required_initial)::numeric = round(((total_price)::numeric * 0.40), 2)) AND (installment_months = 12)) OR ((payment_scheme = 'move_b2_25_12'::text) AND ((required_initial)::numeric = round(((total_price)::numeric * 0.25), 2)) AND (installment_months = 12))))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check6: CHECK (((payment_scheme <> ALL (ARRAY['move_a'::text, 'installment_4_month'::text])) OR (installment_months = 4)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check7: CHECK (((tier = 'GOLD'::text) OR (holder_limit = 1)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_check8: CHECK (((tier <> 'BRONZE'::text) OR (payment_scheme <> ALL (ARRAY['move_b1_40_12'::text, 'move_b2_25_12'::text]))))
- public.customer_application_purchase_terms.customer_application_purchase_terms_commission_base_check: CHECK ((commission_base ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text))
- public.customer_application_purchase_terms.customer_application_purchase_terms_commission_rate_check: CHECK ((commission_rate ~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'::text))
- public.customer_application_purchase_terms.customer_application_purchase_terms_commission_rule_id_fkey: FOREIGN KEY (commission_rule_id) REFERENCES commission_rules(id) ON DELETE RESTRICT
- public.customer_application_purchase_terms.customer_application_purchase_terms_customer_id_fkey: FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
- public.customer_application_purchase_terms.customer_application_purchase_terms_discount_percent_check: CHECK (((discount_percent >= 0) AND (discount_percent <= 100)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_expected_commission_check: CHECK ((expected_commission ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text))
- public.customer_application_purchase_terms.customer_application_purchase_terms_holder_limit_check: CHECK (((holder_limit >= 1) AND (holder_limit <= 2)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_inclusions_check: CHECK ((jsonb_typeof(inclusions) = 'array'::text))
- public.customer_application_purchase_terms.customer_application_purchase_terms_installment_months_check: CHECK ((installment_months > 0))
- public.customer_application_purchase_terms.customer_application_purchase_terms_minimum_down_payment_check: CHECK ((minimum_down_payment ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text))
- public.customer_application_purchase_terms.customer_application_purchase_terms_monthly_amount_check: CHECK (((monthly_amount IS NULL) OR (monthly_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_payment_scheme_check: CHECK ((payment_scheme = ANY (ARRAY['spot_cash'::text, 'move_a'::text, 'installment_4_month'::text, 'move_b1_40_12'::text, 'move_b2_25_12'::text])))
- public.customer_application_purchase_terms.customer_application_purchase_terms_pkey: PRIMARY KEY (id)
- public.customer_application_purchase_terms.customer_application_purchase_terms_plan_id_fkey: FOREIGN KEY (plan_id) REFERENCES card_plans(id) ON DELETE RESTRICT
- public.customer_application_purchase_terms.customer_application_purchase_terms_reason_check: CHECK (((reason IS NULL) OR ((length(btrim(reason)) >= 5) AND (length(btrim(reason)) <= 500))))
- public.customer_application_purchase_terms.customer_application_purchase_terms_required_initial_check: CHECK ((required_initial ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text))
- public.customer_application_purchase_terms.customer_application_purchase_terms_reservation_fee_check: CHECK (((reservation_fee ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text) AND ((reservation_fee)::numeric = (10000)::numeric)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_seller_staff_id_fkey: FOREIGN KEY (seller_staff_id) REFERENCES staff_users(id) ON DELETE RESTRICT
- public.customer_application_purchase_terms.customer_application_purchase_terms_spot_cash_days_check: CHECK ((spot_cash_days > 0))
- public.customer_application_purchase_terms.customer_application_purchase_terms_tier_check: CHECK ((tier = ANY (ARRAY['BRONZE'::text, 'SILVER'::text, 'GOLD'::text])))
- public.customer_application_purchase_terms.customer_application_purchase_terms_total_price_check: CHECK (((total_price ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'::text) AND ((total_price)::numeric > (0)::numeric)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_validity_months_check: CHECK (((validity_months > 0) AND ((validity_months % 12) = 0)))
- public.customer_application_purchase_terms.customer_application_purchase_terms_version_check: CHECK ((version > 0))
- public.customer_application_purchase_terms.customer_application_purchase_terms_yearly_points_check: CHECK ((yearly_points >= 0))
- public.customer_applications.application_purchase_source_consistency: TRIGGER DEFERRABLE INITIALLY DEFERRED
- public.customer_applications.application_purchase_terms_fk: FOREIGN KEY (id, purchase_terms_id) REFERENCES customer_application_purchase_terms(application_id, id) ON DELETE RESTRICT
- public.payments.payment_purchase_source_consistency: TRIGGER DEFERRABLE INITIALLY DEFERRED
- public.payments.payments_purchase_origin_check: CHECK ((((origin = 'sale'::text) AND (sale_id IS NOT NULL) AND (reservation_id IS NULL)) OR ((origin = 'reservation'::text) AND (reservation_id IS NOT NULL) AND (customer_id IS NOT NULL))))
- public.payments.payments_reservation_id_fkey: FOREIGN KEY (reservation_id) REFERENCES reservation_agreements(id) ON DELETE RESTRICT
- public.payments.payments_reservation_sale_fk: FOREIGN KEY (reservation_id, sale_id) REFERENCES reservation_agreements(id, sale_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
- public.reservation_agreements.reservation_agreements_commission_rule_id_fkey: FOREIGN KEY (commission_rule_id) REFERENCES commission_rules(id) ON DELETE RESTRICT
- public.reservation_agreements.reservation_agreements_customer_id_fkey: FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
- public.reservation_agreements.reservation_agreements_finalized_by_fkey: FOREIGN KEY (finalized_by) REFERENCES staff_users(id) ON DELETE RESTRICT
- public.reservation_agreements.reservation_agreements_seller_staff_id_fkey: FOREIGN KEY (seller_staff_id) REFERENCES staff_users(id) ON DELETE RESTRICT
- public.reservation_agreements.reservation_finalization_check: CHECK (((origin = 'sale'::text) OR (((sale_id IS NULL) AND (finalized_by IS NULL) AND (finalized_at IS NULL)) OR ((sale_id IS NOT NULL) AND (finalized_by IS NOT NULL) AND (finalized_at IS NOT NULL) AND (status = 'executed'::text)))))
- public.reservation_agreements.reservation_id_sale_unique: UNIQUE (id, sale_id)
- public.reservation_agreements.reservation_purchase_identity_fk: FOREIGN KEY (purchase_terms_id, customer_application_id, customer_id, plan_id, seller_staff_id) REFERENCES customer_application_purchase_terms(id, application_id, customer_id, plan_id, seller_staff_id) ON DELETE RESTRICT
- public.reservation_agreements.reservation_purchase_origin_check: CHECK ((((origin = 'sale'::text) AND (sale_id IS NOT NULL) AND (purchase_terms_id IS NULL)) OR ((origin = 'application'::text) AND (customer_application_id IS NOT NULL) AND (customer_id IS NOT NULL) AND (seller_staff_id IS NOT NULL) AND (purchase_terms_id IS NOT NULL) AND (minimum_down_payment_snapshot IS NOT NULL) AND (required_initial_snapshot IS NOT NULL) AND (spot_cash_days_snapshot IS NOT NULL) AND (validity_months_snapshot IS NOT NULL) AND (commission_rate_snapshot IS NOT NULL) AND (commission_base_snapshot IS NOT NULL) AND (expected_commission_snapshot IS NOT NULL))))
- public.reservation_agreements.reservation_purchase_source_consistency: TRIGGER DEFERRABLE INITIALLY DEFERRED
- public.reservation_agreements.reservation_purchase_terms_fk: FOREIGN KEY (customer_application_id, purchase_terms_id) REFERENCES customer_application_purchase_terms(application_id, id) ON DELETE RESTRICT

### New indexes and query support

- purchase_document_evidence_kind_source_id_revision_key: CREATE UNIQUE INDEX purchase_document_evidence_kind_source_id_revision_key ON private.purchase_document_evidence USING btree (kind, source_id, revision)
- purchase_document_evidence_pkey: CREATE UNIQUE INDEX purchase_document_evidence_pkey ON private.purchase_document_evidence USING btree (id)
- customer_application_purchase_id_application_id_customer_id_key: CREATE UNIQUE INDEX customer_application_purchase_id_application_id_customer_id_key ON public.customer_application_purchase_terms USING btree (id, application_id, customer_id, plan_id, seller_staff_id)
- customer_application_purchase_terms_application_id_id_key: CREATE UNIQUE INDEX customer_application_purchase_terms_application_id_id_key ON public.customer_application_purchase_terms USING btree (application_id, id)
- customer_application_purchase_terms_application_id_version_key: CREATE UNIQUE INDEX customer_application_purchase_terms_application_id_version_key ON public.customer_application_purchase_terms USING btree (application_id, version)
- customer_application_purchase_terms_pkey: CREATE UNIQUE INDEX customer_application_purchase_terms_pkey ON public.customer_application_purchase_terms USING btree (id)
- payments_reservation_reference_unique: CREATE UNIQUE INDEX payments_reservation_reference_unique ON public.payments USING btree (reservation_id, reference) WHERE ((origin = 'reservation'::text) AND (reference IS NOT NULL))
- payments_reservation_status_idx: CREATE INDEX payments_reservation_status_idx ON public.payments USING btree (reservation_id, status)
- reservation_id_sale_unique: CREATE UNIQUE INDEX reservation_id_sale_unique ON public.reservation_agreements USING btree (id, sale_id)
- reservation_one_live_application: CREATE UNIQUE INDEX reservation_one_live_application ON public.reservation_agreements USING btree (customer_application_id) WHERE ((origin = 'application'::text) AND (status <> 'cancelled'::text))

Application/version lookup and document source/revision lookup use the corresponding unique indexes. Payment history/source checks use reservation_id/status; reference uniqueness uses reservation_id/reference. Final sale lookup retains sale_id uniqueness. Composite id/sale and terms identity unique keys are logically redundant with the UUID PK for uniqueness but are required targets of the composite FKs, so they were retained.
No speculative Finance-queue index was added: the queue implementation/workload does not exist yet. Its query plan and volume should be measured in Task E. Named-index drift guards validate columns, owning relation, uniqueness, predicate and validity before accepting an existing index. A deliberately wrong same-name source index is rejected with 55000 PURCHASE_SCHEMA_DRIFT and the test transaction rolls back.

### Triggers

- private.mutation_requests.purchase_mutation_receipt_immutable: CREATE TRIGGER purchase_mutation_receipt_immutable BEFORE UPDATE ON private.mutation_requests FOR EACH ROW EXECUTE FUNCTION private.guard_purchase_mutation_receipt()
- private.purchase_document_evidence.purchase_document_immutable: CREATE TRIGGER purchase_document_immutable BEFORE DELETE OR UPDATE ON private.purchase_document_evidence FOR EACH ROW EXECUTE FUNCTION private.prevent_purchase_evidence_mutation()
- public.card_sales.sale_purchase_source_consistency: CREATE CONSTRAINT TRIGGER sale_purchase_source_consistency AFTER UPDATE ON public.card_sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_purchase_source_consistency()
- public.customer_application_purchase_terms.purchase_terms_application_identity: CREATE TRIGGER purchase_terms_application_identity BEFORE INSERT ON public.customer_application_purchase_terms FOR EACH ROW EXECUTE FUNCTION private.guard_application_purchase_terms()
- public.customer_application_purchase_terms.purchase_terms_immutable: CREATE TRIGGER purchase_terms_immutable BEFORE DELETE OR UPDATE ON public.customer_application_purchase_terms FOR EACH ROW EXECUTE FUNCTION private.prevent_purchase_evidence_mutation()
- public.customer_applications.application_purchase_source_consistency: CREATE CONSTRAINT TRIGGER application_purchase_source_consistency AFTER UPDATE ON public.customer_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_purchase_source_consistency()
- public.customer_applications.application_purchase_terms_guard: CREATE TRIGGER application_purchase_terms_guard BEFORE UPDATE OF purchase_terms_id, customer_id, plan_id ON public.customer_applications FOR EACH ROW EXECUTE FUNCTION private.guard_application_purchase_terms()
- public.payments.payment_purchase_source_consistency: CREATE CONSTRAINT TRIGGER payment_purchase_source_consistency AFTER INSERT OR UPDATE ON public.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_purchase_source_consistency()
- public.payments.purchase_payment_immutable: CREATE TRIGGER purchase_payment_immutable BEFORE DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.guard_purchase_payment_mutation()
- public.reservation_agreements.reservation_purchase_identity: CREATE TRIGGER reservation_purchase_identity BEFORE INSERT OR UPDATE ON public.reservation_agreements FOR EACH ROW EXECUTE FUNCTION private.guard_reservation_purchase_identity()
- public.reservation_agreements.reservation_purchase_source_consistency: CREATE CONSTRAINT TRIGGER reservation_purchase_source_consistency AFTER INSERT OR UPDATE ON public.reservation_agreements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_purchase_source_consistency()

Deferred triggers inspect final transaction state without explicit reverse-order parent FOR UPDATE locks. They do not substitute for future canonical operational locks. New workflow race tests remain later gates; the existing full DB suite still verifies its existing concurrency scenarios.

## Valid cases and actual COMMIT proof

Application-origin reservation and reservation-origin payment with no sale both commit successfully. In a linking transaction, payments temporarily reference the intended final sale before the reservation/application are updated; the intermediate mismatch succeeds, and real COMMIT succeeds after all parents agree. The same payment UUIDs persist and payment count is unchanged.
Five invalid cross-source cases below explicitly reached COMMIT before failure; statement success was not counted as deferred proof. A valid alternate seller row was used so the parent-sale probe exercised the new deferred consistency trigger rather than an unrelated baseline CHECK.

| Probe | Failure stage | SQLSTATE | Actual PostgreSQL message |
|---|---|---|---|
| incompatible named index drift rejected | statement | 55000 | PURCHASE_SCHEMA_DRIFT:payments_reservation_status_idx |
| captured terms customer must match actual application | statement | 23514 | APPLICATION_TERMS_IDENTITY_INVALID |
| neither-source payment rejected | statement | 23514 | new row for relation "payments" violates check constraint "payments_purchase_origin_check" |
| reservation payment requires reservation | statement | 23514 | new row for relation "payments" violates check constraint "payments_purchase_origin_check" |
| sale payment requires sale | statement | 23514 | new row for relation "payments" violates check constraint "payments_purchase_origin_check" |
| sale payment cannot also reference reservation | statement | 23514 | new row for relation "payments" violates check constraint "payments_purchase_origin_check" |
| unrelated payment sale fails at COMMIT | COMMIT | 23503 | insert or update on table "payments" violates foreign key constraint "payments_reservation_sale_fk" |
| payment customer must equal reservation customer at COMMIT | COMMIT | 23514 | PAYMENT_SOURCE_INVALID |
| reservation application/customer mismatch rejected | statement | 23514 | RESERVATION_TERMS_CONFLICT |
| reservation terms/application mismatch rejected | statement | 23514 | RESERVATION_TERMS_CONFLICT |
| duplicate live application reservation rejected | statement | 23505 | duplicate key value violates unique constraint "reservation_one_live_application" |
| duplicate reservation payment reference rejected | statement | 23505 | duplicate key value violates unique constraint "payments_reservation_reference_unique" |
| terms UPDATE rejected | statement | 55000 | PURCHASE_TERMS_IMMUTABLE |
| terms DELETE rejected | statement | 55000 | PURCHASE_TERMS_IMMUTABLE |
| duplicate terms version rejected | statement | 23505 | duplicate key value violates unique constraint "customer_application_purchase_terms_application_id_version_key" |
| review terms require reason | statement | 23514 | new row for relation "customer_application_purchase_terms" violates check constraint "customer_application_purchase_terms_check" |
| current terms pointer freezes application customer identity | statement | 23514 | APPLICATION_TERMS_IDENTITY_INVALID |
| existing reservation freezes application terms pointer | statement | 55000 | PURCHASE_TERMS_VERSION_FROZEN |
| wrong application terms pointer rejected | statement | 23514 | APPLICATION_TERMS_IDENTITY_INVALID |
| reservation terms identity cannot change | statement | 55000 | RESERVATION_TERMS_IMMUTABLE |
| stored receipt immutable | statement | 55000 | MUTATION_RECEIPT_IMMUTABLE |
| receipt unknown key injection rejected | statement | 22023 | MUTATION_RECEIPT_INVALID |
| receipt cannot hide sensitive object under allowed status key | statement | 22023 | MUTATION_RECEIPT_INVALID |
| changed fingerprint still conflicts | statement | P0001 | MUTATION_PAYLOAD_CONFLICT |
| document key governmentIdNumber rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| document key qrToken rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| document key onboardingToken rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| document key tokenHash rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| document key privateStorageUrl rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| document key extra rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| nested schedule injection rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check" |
| evidence UPDATE rejected | statement | 55000 | PURCHASE_DOCUMENT_IMMUTABLE |
| evidence DELETE rejected | statement | 55000 | PURCHASE_DOCUMENT_IMMUTABLE |
| evidence duplicate revision rejected | statement | 23505 | duplicate key value violates unique constraint "purchase_document_evidence_kind_source_id_revision_key" |
| document wrong source kind rejected | statement | 23514 | new row for relation "purchase_document_evidence" violates check constraint "purchase_document_evidence_check2" |
| document missing source FK rejected | statement | 23503 | insert or update on table "purchase_document_evidence" violates foreign key constraint "purchase_document_evidence_payment_id_fkey" |
| invalid final linked sale fails at COMMIT | COMMIT | 23514 | RESERVATION_SALE_SOURCE_INVALID |
| final purchase builder refuses unpaid/nonverified sale state | statement | 55000 | PURCHASE_DOCUMENT_STATE_CONFLICT |
| finalized reservation sale cannot be reassigned | statement | 55000 | RESERVATION_SALE_IMMUTABLE |
| linked payment sale cannot be reassigned | statement | 55000 | PAYMENT_SOURCE_IMMUTABLE |
| application cannot diverge from finalized sale at COMMIT | COMMIT | 23514 | RESERVATION_SALE_SOURCE_INVALID |
| sale cannot diverge from frozen seller at COMMIT | COMMIT | 23514 | RESERVATION_SALE_SOURCE_INVALID |
| append refuses recomputed historical receipt revision | statement | 55000 | PURCHASE_DOCUMENT_VERSION_CONFLICT |
| anon cannot append evidence | statement | 42501 | permission denied for schema private |
| anon cannot write evidence table | statement | 42501 | permission denied for schema private |
| anon cannot change terms | statement | 42501 | permission denied for table customer_application_purchase_terms |
| authenticated cannot append evidence | statement | 42501 | permission denied for function append_purchase_document |
| authenticated cannot write evidence table | statement | 42501 | permission denied for table purchase_document_evidence |
| authenticated cannot change terms | statement | 42501 | permission denied for table customer_application_purchase_terms |
| service_role cannot append evidence | statement | 42501 | permission denied for function append_purchase_document |
| service_role cannot write evidence table | statement | 42501 | permission denied for table purchase_document_evidence |
| service_role cannot change terms | statement | 42501 | permission denied for table customer_application_purchase_terms |

## Document and receipt injection proof

All five kinds were constructed on PostgreSQL. The four-argument append helper has no JSON document parameter. Its builder constructs explicit jsonb_build_object fields; no whole-row to_jsonb copy is used in the migration. Top-level government ID, QR token, onboarding token, hash, private storage URL and arbitrary keys are denied. Unknown keys in nested schedule lines are denied too. Browser/service roles cannot call the helper or access the evidence table.
Recorded receipt captures zero newly verified money. Verified receipt freezes 10000.00 verified and 44000.00 remaining. Final record freezes 54000.00 verified, zero remaining and the two contributing payment numbers. Activation confirmation uses the persisted membership/points/expiry. Historical receipt content stays unchanged after finalization/activation; trying to recompute an existing revision against later totals is rejected, not substituted for the original.
Future request replay wrappers must retrieve original immutable receipts/evidence before lifecycle rechecks, after fresh authorization. Those wrappers are deliberately not implemented in this turn.
Receipt allowlisting now validates VALUES as well as keys: matching result UUID; UUID fields; positive integer revision/version; known status tokens; timestamp string format. A nested government-ID object disguised as status is denied with 22023. Generic mutation payload is used only to fingerprint a request, never as document JSON.

## RLS, ACLs, search_path and SECURITY DEFINER review

RLS is enabled on both new tables. Terms expose only service-role SELECT; all writes/browser access are revoked. Evidence exposes no direct SELECT/write grant to PUBLIC/anon/authenticated/service_role. Browser mutation denial was executed under anon/authenticated; service_role denial was executed too. Repository rls_invariants.sql returned zero rows in every statement. No EXECUTE ON ALL FUNCTIONS was introduced.

| New function/signature | Security | search_path | Runtime ACL |
|---|---|---|---|
| private.append_purchase_document(p_kind text, p_source_id uuid, p_revision integer, p_actor_id uuid) | DEFINER | search_path=pg_catalog, public, private, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.build_purchase_document_fields(p_kind text, p_source_id uuid, p_actor_id uuid) | DEFINER | search_path=pg_catalog, public, private, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.check_purchase_source_consistency() | DEFINER | search_path=pg_catalog, public, private, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.complete_purchase_mutation(p_actor uuid, p_operation text, p_request uuid, p_payload jsonb, p_result uuid, p_receipt jsonb) | DEFINER | search_path=pg_catalog, extensions, private, public, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.guard_application_purchase_terms() | INVOKER | search_path=pg_catalog, public, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.guard_purchase_mutation_receipt() | INVOKER | search_path=pg_catalog, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.guard_purchase_payment_mutation() | INVOKER | search_path=pg_catalog, public, private, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.guard_reservation_purchase_identity() | INVOKER | search_path=pg_catalog, public, private, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.prevent_purchase_evidence_mutation() | INVOKER | search_path=pg_catalog, private, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.purchase_document_fields_valid(p_kind text, p_fields jsonb) | INVOKER | search_path=pg_catalog, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |
| private.purchase_test_cleanup_allowed(p_table regclass) | INVOKER | search_path=pg_catalog, pg_temp | No EXECUTE for PUBLIC/anon/authenticated/service_role |

Four definer functions:
- check_purchase_source_consistency(): invoked by a row trigger, not caller parameters; verifies payment/reservation/application/sale identity. No actor/economic/status/seller input is exposed.
- build_purchase_document_fields(kind,source,actor): derives all document data from qualified source tables. Actor must be active; recording/verifying/finalizing/activating actors must match the source where applicable. Final evidence requires a financially complete verified sale with no recorded payments; activation evidence requires active membership/sale and matching customer. Caller cannot submit prices/status/seller or document JSON.
- append_purchase_document(kind,source,revision,actor): calls that builder; enforces immutable revision uniqueness. Does not grant business authority.
- complete_purchase_mutation(actor,operation,request,payload,result,receipt): stores the existing canonical fingerprint plus a typed immutable receipt; does not mutate commercial entities.

**Boundary finding:** these internal helpers accept an actor UUID from a future trusted transaction core; they do not independently resolve an HTTP principal or grant business permission. All runtime-role EXECUTE privileges are revoked, so this is not an API-only public authorization path. Do not grant them standalone service execution. Future public transaction cores must repeat the existing SQL permission/ownership checks before invoking them. No new public protected RPC was installed at Gate 3.
All new functions have pg_catalog first and pg_temp last; relation references are schema-qualified. Source checks preserve frozen economics/seller, rather than accepting assertions from a browser.

## Execution-discovered corrections

1. **Nested receipt smuggling:** key-only allowlist accepted an object under status. RED: valid-looking receipt with nested governmentIdNumber committed. Fix: typed value checks and required matching result UUID/status. GREEN: 22023 MUTATION_RECEIPT_INVALID; valid receipt/replay/changed-fingerprint behavior still passes. An omitted PL/pgSQL variable declaration during this edit produced 42601; corrected before the passing run.
2. **False final purchase evidence:** builder accepted a linked sale still payment_pending. RED: invalid final evidence succeeded. Fix: verified/complete sale, no undecided recorded rows, and active/matching membership checks for activation. GREEN: 55000 PURCHASE_DOCUMENT_STATE_CONFLICT; legitimate final/activation records construct.
3. **Silent index drift:** IF NOT EXISTS accepted a same-name index on sale_id instead of reservation_id. RED: wrong index survived reapply. Fix: explicit semantic catalog guard. GREEN: 55000 PURCHASE_SCHEMA_DRIFT; clean direct reapply leaves the entire catalog identical.
4. **Terms/application identity gap:** a terms row could claim another customer while referencing a real application ID. RED: contradictory capture succeeded. Fix: capture identity trigger plus current-pointer customer/plan validation; live-version freeze remains. GREEN: 23514 APPLICATION_TERMS_IDENTITY_INVALID; valid capture/version/reservation cases still pass.

Only this unapplied migration and test files were corrected. No historical migration, business handler or application transition RPC changed.

Test corrections: legacy recording fixture initially targeted an active sale (correctly refused with SALE_NOT_ACCEPTING_PAYMENTS); moved to an open sale. Comparisons account for the two intended NOT NULL removals. Denial helper records statement versus COMMIT stage. Runner now exits explicitly nonzero on failures: relying only on process.exitCode initially produced a misleading OS exit despite a failed probe. Single-client queries run sequentially.

## Final verification

| Check | Exact result |
|---|---|
| Focused PostgreSQL contract/probes | 1286/1286, exit 0 |
| Focused migration text guards | 4 tests, 1 file, exit 0 |
| Contracts | 183 tests, 12 files, exit 0 |
| API | 1790 tests, 85 files, exit 0 |
| test:db:local | 1547/1547 checks, exit 0; 39 migrations |
| test:db:harness | 13/13 harness checks, exit 0 |
| Harness normal DB run | 1547 passed, 0 failed |
| Harness injected DB run | 1039 checks; 1037 passed, 2 failures; intentionally NONZERO |
| typecheck:deploy | PASS, exit 0 |
| typecheck | PASS, exit 0, including supabase scripts |
| lint | PASS, exit 0; 18 existing app warnings (web 8, admin 10), 0 errors |
| build | PASS, exit 0; 2 cached Turbo tasks; existing bundle-size warnings |
| check:env | PASS, exit 0; 473 browser and 162 server source files scanned |
| git diff --check | PASS |

The injected run reports the deliberate exception plus a secondary LEGACY_ID_ALIAS_MISSING from later sections continuing after injection. This is not hidden or counted as a green DB run. The harness explicitly proves the nonzero exit and every-table cleanup; the normal runs are clean. PowerShell wraps some ordinary stderr in NativeCommandError formatting; command exit codes above were captured separately.

## Cleanup and remaining findings

Every focused fixture table returned to its pre-run count; new terms/evidence tables were empty. Full database and injected runs proved their every-table cleanup. Disposable directories were removed.
**Separate harness defect:** embedded Windows PostgreSQL can leave an io_worker after server.stop(), even when the data directory is removed. One premature focused rerun also overlapped directory release and was interrupted; subsequent database runs were serial. Orphaned workers were matched to recorded server PIDs before forced cleanup; unrelated PostgreSQL instances were untouched. The underlying embedded harness shutdown leak remains; this work does not claim to fix it.
Final scoped cleanup records: [{"removedWorkers":[22428],"serverPid":4680,"log":".tmp-bin/gate3-run.log"},{"removedWorkers":[9572],"serverPid":15108,"log":".tmp-bin/gate3-db-local.log"},{"removedWorkers":[19644],"serverPid":18144,"log":".tmp-bin/gate3-db-harness.log"}].
After cleanup, live process inspection found no PostgreSQL process from this worktree and no disposable pg-integration directory. Original unrelated servers remained running.

No unresolved migration-contract failure remains in the executed scope. Unverified/out of scope: managed Supabase/PostgREST/Auth/Storage behavior, operational transaction cores, new workflow lock/concurrency proof, UI/PDF rendering and production readiness. Future legacy verification lock-order replacement is still mandatory before enabling finalization. The Gate 2 checksum described the earlier reviewed draft; the checksum in this package supersedes it after these corrections.

| Protected action | Performed? |
|---|---|
| Shared Supabase changed | NO |
| Production credentials used | NO |
| Historical migrations changed | NO |
| Commit/push | NO |
| Production deployment | NO |
| Communications merged | NO |
| Task C / application transitions | NO |

**STOP. Await explicit Gate 3 approval.**

Evidence logs and catalog snapshot are local, ignored .tmp-bin artifacts: purchase-gate3-evidence.json, gate3-run.log, gate3-db-local.log, gate3-db-harness.log, gate3-check-results.json, gate3-process-cleanup.json and gate3-<check>.log. They contain no connection URL/password or production data. Primary trigger semantics reference: [PostgreSQL CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html). Supabase changelog markdown was unavailable via the documentation fetch; no Supabase client/API change was made.
