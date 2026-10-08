# Application-first Purchase Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native execution is recommended; do not spawn agents unless explicitly authorized.

**Goal:** Create an application-origin AF-RES before any sale, collect verified payments in the existing ledger, finalize one fully paid AF-CSALE, and activate through the existing membership path, with five historical printable records.

**Architecture:** Extend existing official-forms and Finance routes and transactions. An immutable purchase-terms record supplies reservation economics; the existing payments ledger supplies verified totals. Reuse identifiers, permission checks, hierarchy capture, activation and PDF infrastructure.

**Tech Stack:** React 19/Vite 8, TanStack Query, Zod 4.4.3, TypeScript 5.9, pnpm 11.22.0/Turbo, Vercel REST router, Supabase/PostgreSQL and existing pg/PDF utilities. No new dependency.

**Spec:** `docs/AFHOMES-APPLICATION-PURCHASE-FLOW-DESIGN.md`, approved by the implementation-plan gate attachment.

**Status:** READY FOR IMPLEMENTATION-PLAN REVIEW. No implementation, migration creation, commit, push, shared DB change or deployment authorized in this planning turn.

**Verified baseline:** `claud/develop`, `c165a21ad4a835b20ee71cc51eebc00d6be21d62`, `C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote`. Initial status contained only the untracked design document. Schema evidence is from the checked-in migration chain, not a shared database catalog.

## Global Constraints

- No provisional sales, parallel payment ledger, communications merge or historical migration edits.
- PHP 10,000 is INCLUDED: Bronze spot cash PHP 54,000 minus verified PHP 10,000 leaves PHP 44,000.
- Only VERIFIED payments affect paid totals, balance, finalization and activation.
- Canonical existing states, exact-decimal helpers and effective permissions remain authoritative.
- Browser may request actions; server/RPC derives actor, authority, seller, economics and eligibility. Direct browser database access remains read-only.
- Old approved applications require explicit reviewed terms; current prices never become invented historical evidence.
- Plan approval precedes implementation. Shared apply and Production deployment require separate approval.

## Review Focus

1. Plan/rule changes between preview and confirmation: reject stale proposal hashes (Task C).
2. Lost-response retries after lifecycle progression: fresh authorization, original committed result (Tasks Dâ€“H).
3. Full verified total with an undecided payment: block finalization until that payment is decided (Task G).
4. Party names/configuration changes before reprint: immutable evidence, current export authorization (Task I).
5. Null-sale payments omitted or counted twice in reports after linking: source-aware reads keyed by payment UUID (Task E).

## 1. Evidence summary

Paths are relative to the promotion worktree. Symbols are edit anchors; line numbers identify inspected entry points.

| Area | Repository evidence |
|---|---|
| Application editor/action | `apps/admin/src/features/business/OfficialFormsPages.tsx`; reservation editor at 1442, app hydration at 1466, sale guard at 1598, selector at 1741 |
| Application contracts/snapshots | `packages/contracts/src/schemas/official-forms.ts`; `api/_handlers/official-forms.ts:153` snapshot mapper |
| Submission/approval | `official-forms.ts:737,778`; submit RPC plus separate audit; approval helper at 405 performs separate read/update/audit |
| Application SQL | `20261018000003_afhomes_official_forms.sql:6`; latest save in `20261019000001_afhomes_fix_customer_application_plan_field.sql:31`; registration wrapper in `20261023000001_afhomes_ost_accreditation_workflow.sql:526` |
| Reservation contract/handler | contracts official-forms at 191 requires saleId; handler POST at 830 authorizes sale before reserve RPC |
| Reservation SQL | official-forms migration at 86/284/363; reserve wrapper in accreditation migration at 548 accepts submitted OR approved and requires sale |
| Payments | foundation migration at 241; Phase 2 business additions at 182; contracts finance.ts at 23/47/62; sales.ts handler at 681/714 |
| Verification | latest literal definition `20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql:142`: payment FOR UPDATE at 178, sale at 186 |
| Totals/queue | `api/_lib/commerce.ts:50` summarizePayments; Phase 2 sale_financial_summary; `api/_handlers/queues.ts:100` reads card_sales |
| Sale | `api/_handlers/sales.ts:315â€“564`: resolveSeller, resolveSchemeEconomics, snapshotSchemeTerms, resolve_commission_rule, sale then commission inserts |
| Hierarchy | `20261010000001_afhomes_phase14_analytics.sql:28,100`; import migration `20261019000002...:140` adds legacy-import exemption |
| Activation | activation body in `20261014000001_afhomes_vip_payment_schemes.sql:194`, later allocator rewrites; `sales.ts:790` Finance permission and activation RPC |
| Membership IDs/print | `20261021000001_afhomes_random_membership_number_allocator.sql`, `20261028000001_afhomes_membership_code_upgrade.sql`; `memberships.ts:430,516` card data/mark-printed, not confirmation PDF |
| PDFs | `api/_lib/official-forms.ts:434` officialFormPdf; `api/_lib/report-export.ts:323` toPdf; reservation export handler at 967 |
| Business IDs | `20261025000001_afhomes_business_ids.sql:93,143,200,230`; allocator replacement `20261026000001_afhomes_customer_code.sql` |
| Idempotency | `20261022000001_afhomes_mutation_idempotency.sql:8,63,79`: mutation_requests/mutation_result/complete_mutation |
| Authority/errors | `api/_lib/afhomes-access.ts`, `handler-kit.ts`; mutation_actor_role; latest has_permission_for_user in `20261029000001_afhomes_operational_access_functions.sql` |
| Adjacent reads | `reports.ts:454` filters payments through sale IDs; `analytics.ts:478` counts operational sale payments; `customer-categories.ts:41`; `customers.ts:146` payment deletion blocker |
| Tests | API official-forms-transitions/phase2/phase26-finance/queues-dashboard; admin OfficialFormsPages/finance-lifecycle; `supabase/db-integration.ts`, `idempotency-integration.ts` |

Skills inspected: writing-plans, evidence-first-engineer, architecture-guardian, secure-database-engineer/Supabase, security-reviewer, TDD, verification-gate/Superpowers verification. Database/migration/contract/authorization/concurrency/git review responsibilities appear below; no plugin install or optional agent dispatch.

## 2. Exact current dependency chain

Application link â†’ ReservationAgreementEditorPage sale guard â†’ createReservationAgreementSchema required saleId â†’ official-forms sale authorization â†’ reserve_from_customer_application_once â†’ existing sale â†’ save_reservation_agreement â†’ reservation_agreements.sale_id NOT NULL/UNIQUE.

Finance queue â†’ card_sales â†’ sale payment routes â†’ payments.sale_id NOT NULL â†’ verify_card_payment(payment lock then sale lock) â†’ sale/commission advancement â†’ activation queue â†’ activate_card_sale(sale lock, verified sum, membership/points/customer/commission writes).

Affected application/reservation read/update/audit helpers must become atomic RPC transitions. Otherwise they can race creation, review or cancellation despite the new row locks.

## 3. Current schema map

NN means NOT NULL. All public tables below enable RLS; browser write privileges are revoked. Gate 3 will verify exact catalogs after executing the baseline.

| Table | Keys/FKs/nullability/uniqueness | States, indexes and access |
|---|---|---|
| customer_applications | UUID PK; application_number NN UNIQUE; customer/plan/creator NN RESTRICT FKs; sale_id nullable UNIQUE RESTRICT FK | draft/submitted/approved/rejected/cancelled; timestamp checks; customer+created_at index; holders unique(application,holder type). Authenticated SELECT under sales.customers OR sales.card_sales. save/submit/register/reserve RPCs |
| reservation_agreements | UUID PK; reservation_number NN UNIQUE; sale_id **NN UNIQUE** RESTRICT FK; application nullable FK; plan/creator NN FKs | draft/submitted/executed/cancelled with timestamp checks; sale index, unique holder/schedule parent keys; same official-form SELECT policy; save/submit/reserve RPCs |
| payments | UUID PK; sale_id **NN** RESTRICT FK; customer nullable RESTRICT FK; recorder NN, verifier nullable staff FKs; payment_number added NN UNIQUE | recorded/verified/rejected/voided; positive decimal; down_payment/installment/full; partial unique(sale_id,reference) when reference nonnull; sale/customer/recorder/verifier/status indexes. RLS Finance or sale seller |
| card_sales | UUID PK; sale_number NN UNIQUE; customer/plan NN FKs; normal origin requires exactly one staff/OST seller; creator/referral/rule nullable FKs | draft/submitted/payment_pending/payment_in_progress/payment_verified/activation_pending/active/cancelled/overdue; partial unique(customer,plan) for open states; customer/plan/seller/status/referral/creator/origin indexes; normal/legacy_import origin; hierarchy insert trigger; staff/Finance SELECT policies |
| memberships | UUID PK; customer NN UNIQUE, sale NN UNIQUE FKs; membership_number NN UNIQUE; credential hash uniqueness; product nullable FK; activator NN FK | active/expired/suspended/cancelled; product/activator/status/hash indexes; points account unique membership; ownership/staff RLS with customer column grants; activation/reissue/redemption/card paths |
| private.mutation_requests | UUID PK; actor NN staff FK; operation/request/hash/result NN; unique(actor,operation,request) | operations payment.create/application.create/reservation.create; SHA256 check; RLS, direct PUBLIC/anon/authenticated/service_role access revoked; private definer helpers |
| audit_events | bigint identity PK; actor nullable auth FK ON DELETE SET NULL; action/entity_type/time NN; entity/reason/before/after/request/IP nullable | existing append-only code convention; authenticated SELECT under governance.audit; reuse server audit inserts without secrets/ID plaintext |

Preserve commission uniqueness/snapshots, complete historical hierarchy snapshots and all protected-history RESTRICT links. No new deletion cascades.

## 4. Proposed schema delta

One idempotent forward-only migration: `20261101000001_afhomes_application_purchase_flow.sql`. Filename is absent; latest checked-in version is 20261029000001. Recheck availability before implementation. Do not create it now.

**Terms:** public.customer_application_purchase_terms: UUID PK; NN RESTRICT application/customer/plan/seller staff FKs; positive version, unique(application_id,version); capture_kind submission/review; review reason required; captured_by/time. Explicit frozen tier/scheme/total/reservation_fee/minimum_down_payment/required_initial/installment_months/monthly_amount/spot_cash_days/validity_months/discount/yearly_points/annual_tranches/holder_limit/inclusions; nullable commission_rule FK, commission_rate/base/expected_amount. Reuse existing decimal/range checks; fee numerically 10000.00 for this path. Store canonical input evidence and offer-as-of timestamp. Append-only UPDATE/DELETE guard.

Add app.purchase_terms_id nullable, composite FK (app.id,terms_id) â†’ terms(application_id,id), corresponding terms UNIQUE. App pointer can change in draft/resubmission or explicit old review before a live reservation; reservation never follows a dynamic latest pointer.

**Reservation:** origin sale/application NN default sale; customer_id/seller_staff_id/purchase_terms_id nullable for untouched legacy rows, required for application origin; missing frozen scheme/commission parameters; finalized_by/at. Drop ONLY sale_id NOT NULL, keep UNIQUE/FK. Application origin requires app/customer/terms/seller references with exact same app/customer/plan. Sale origin requires sale. Partial unique application where origin=application and status<>cancelled; reject an existing legacy reservation linked to that app as well. No invented customer-wide restriction. Origin/terms/source/economics/date immutable; sale assignment only once, on finalization.

**Payments:** origin sale/reservation NN default sale; reservation_id nullable RESTRICT FK; drop ONLY sale_id NOT NULL. CHECK sale origin implies sale nonnull/reservation null; reservation origin requires reservation. New reservation payments derive nonnull customer. Legacy payment reservation_id remains null even if sale has an agreement. Add reservation/status index and unique(reservation,reference) for reservation origin/nonempty reference; retain legacy sale-reference uniqueness.

Deferred composite FK (reservation_id,sale_id) â†’ reservation(id,sale_id), with parent UNIQUE, plus deferred constraint triggers on both parents/children cover NULL semantics/customer identity: before finalization payment sale_id null; after finalization every reservation-origin payment sale_id equals that reservation sale. SQL rejects unrelated/neither/reassigned sources. Finalization links all existing rows once in the same transaction; no copy. Source-check triggers do not acquire reverse parent locks after payment locks; ordered operational RPCs own mutations. Gate 3 probes direct contradictory writes and commit-time behavior.

**Document evidence:** private.purchase_document_evidence: UUID PK; kind reservation/payment_recorded/payment_verified/purchase_finalized/membership_activated; exactly one corresponding RESTRICT FK (reservation/payment/sale/membership); positive revision; schema_version=1; actor/time; allowlisted immutable JSON payload. Partial source+kind+revision uniqueness. RLS, direct browser/service table access revoked; authorized definer read. UPDATE/DELETE denied except bounded disposable owner cleanup. This stores historical printable evidence, never an additional payment ledger or financial totals source.

Expand mutation_requests operation CHECK with purchase_terms.review/application.submit/application.decide/reservation.transition/payment.verify/reservation.finalize. Add nullable immutable result_receipt JSONB for new operations: allowlisted IDs, original status, terms/document revision and timestamps only, no PII/secrets. This pins transition responses even when the source later changes. Preserve old operation values/data and complete_mutation signature; new private.complete_purchase_mutation inserts the original result/receipt atomically using the same canonical fingerprint and store.

## 5. Lifecycle design

Keep existing enums. App submission freezes selected terms; approval preserves them. Approved required to reserve. Cancel app atomically; live reservation blocks app cancellation until existing reservation lifecycle permits resolution.

Reservation created draft; draft-only editable agreement fields; draftâ†’submittedâ†’executed, submittedâ†’draft/cancelled and draftâ†’cancelled. Execute requires received primary signature, and secondary when present. Executed remains terminal: no reopen/cancel/refund invented. Awaiting payment is a derived label, not a new stored state.

Finance collection/verification requires executed, approved source app, existing customer eligibility and no final sale. Draft/submitted never enters collection queue. Finalization requires executed, verified sum >= total and **no recorded/undecided payment**. Rejected rows neither count nor block. Finalized sources reject new money/decisions and commercial edits; activation stays separate.

Retain current >= threshold and true paid amount for overpayment; remaining=max(total-paid,0). No silent new overpayment/refund rule. Keep first-verified spot-cash window; no new repricing/deadline forgiveness or scheme conversion.

## 6. Purchase-terms capture/review

New submit uses server proposal plus expectedProposalHash, not browser figures. Lock app; validate identity/signatures/customer/plan and seller; read plan consistently under FOR SHARE; derive canonical scheme with numeric, resolve_commission_rule at capture date and frozen benefits. Compare hash, append terms, change state and audit atomically. Approval never recalculates. Reopen/resubmit appends a new version; old versions stay immutable.

SQL resolver is a narrow transactional counterpart to resolveSchemeEconomics/snapshotSchemeTerms; parity tests cover all five schemes, Bronze B1/B2 denial and rounding. Commission uses resolve_commission_rule/calculateCommission parity, default zero, no plan-rate compatibility fallback for new flow.

Old review explicitly presents a **newly confirmed offer as of review time**, preserving old snapshots and showing differences from available evidence. Missing historical values are not inferred. Any current configuration is an explicit new offer requiring reviewer confirmation/reason/hash, never silent historical conversion. If operator cannot confirm, keep PURCHASE_TERMS_REVIEW_REQUIRED; no arbitrary override-price input.

Seller candidate is a request validated by existing resolveSeller/downline authority. Recorded creator is usable only if independently eligible; reviewer/Finance/finalizer never becomes substitute seller. Capture rejects invalid seller. Review requires approved app and no live reservation. Reservation stores permanent terms UUID/version; new review cannot change it.

## 7. Reservation transaction

Proposed `reserve_application_purchase_once(p_request_id uuid,p_actor_id uuid,p_application_id uuid,p_terms_id uuid,p_input jsonb) returns uuid`.

Fresh permissionâ†’mutation_result(reservation.create, normalized source/terms/input)â†’app lockâ†’read exact immutable termsâ†’live reservation lock/checkâ†’approved/customer/seller/completeness checksâ†’duplicate checkâ†’existing AF-RES allocatorâ†’insert draft/derived holders/scheduleâ†’document evidence revision 1â†’auditâ†’complete_mutationâ†’commit. No app.sale_id yet. Browser cannot swap customer/plan through holder data. Draft changes cannot alter source/terms/date/economics.

Same request returns original even after lifecycle progression; different request against live source conflicts. Safe domain mappings through handler-kit: APPLICATION_NOT_FOUNDâ†’404 NOT_FOUND; APPLICATION_NOT_APPROVED/PURCHASE_TERMS_REVIEW_REQUIRED/PURCHASE_TERMS_VERSION_CONFLICT/RESERVATION_ALREADY_EXISTS/RESERVATION_NOT_EXECUTED/RESERVATION_FINALIZED/RESERVATION_NOT_FULLY_PAID/RESERVATION_UNDECIDED_PAYMENTS/PURCHASE_PROPOSAL_CHANGEDâ†’409 CONFLICT; PAYMENT_SOURCE_INVALIDâ†’400 VALIDATION_ERROR; MUTATION_FORBIDDENâ†’403; existing MUTATION_PAYLOAD_CONFLICTâ†’409. Include review-required reason in safe error details using existing envelope conventions.

## 8. Finance/payment transaction

/queues/finance combines existing sale rows and executed application-origin reservations without final sale. Batch source/payment reads; filter/search/order by readiness time then origin/UUID, paginate once, combined exact count. Reuse summarizePayments/frozen scheme inputs; show AF-RES/customer/tier/scheme/total/verified/remaining/app/seller/status. Fully paid reservations stay until finalized. Activation list stays sale-only.

Proposed `record_reservation_payment_once(p_request_id uuid,p_reservation_id uuid,p_input jsonb,p_actor_id uuid) returns uuid`. Existing amount/paymentType/method/reference/notes/private receipt path; mandatory requestId. Reuse down_payment for included reservation installment, no redundant payment-type enum.

Request lockâ†’ordered parentsâ†’executed/not-finalized checksâ†’derive customer/null saleâ†’compute verified balance (recording leaves before=after)â†’ONE payments insert using AF-PAY defaultâ†’recorded receipt evidenceâ†’PAYMENT_RECORDED auditâ†’complete mutation. Recording never verifies. History reads same rows by reservation, then by sale after linking.

Payments report includes authorized pre-sale rows and deduplicates by UUID after finalization. Sale/team analytics remain actual-sale-at-creation metrics; never invent pre-sale ancestry. Customer category/directory recognizes executed pre-sale reservation amounts without claiming membership or using today's plan economics. Add terms/app/reservation protected-history blockers if absent; retain customer_id payment blocker.

## 9. Verification transaction

Forward replace verify_card_payment, retaining legacy signature/result, to discover source unlocked, lock parents first then payment/re-read source. Legacy saleâ†’payment; applicationâ†’reservationâ†’sale if presentâ†’payment for reservation origin. Finalized new source denies new decision. No paymentâ†’sale lock remains.

Proposed `verify_purchase_payment_once(p_request_id uuid,p_payment_id uuid,p_decision text,p_reason text,p_actor_id uuid) returns jsonb`. Fresh finance.payment_verification:update in handler/SQL; request lookup precedes state check. Verify/reject recorded only; rejection reason required; compute exact verified total/balance before/after. Persist immutable verified receipt evidence with source IDs, actor/time/frozen economics. Rejected payments get decision audit, not verified receipt.

Reservation first verified time/deadline uses frozen spotCashDays; copy to final sale, never restart. New retries return original evidence, not current totals. Legacy no-requestId calls remain; historical decisions without original evidence are explicitly legacy, never fabricated. Changed decision/reason replay conflicts. No new void endpoint (existing RPC accepts verified/rejected only).

## 10. Sale finalization transaction

Proposed `finalize_reservation_purchase_once(p_request_id uuid,p_reservation_id uuid,p_actor_id uuid) returns uuid`.

Finance verification:updateâ†’request replayâ†’ordered parentsâ†’already-finalized replayâ†’approved/executed checksâ†’zero recorded rowsâ†’verified sum >= frozen totalâ†’seller validityâ†’existing AF-CSALE allocationâ†’normal sale with frozen scheme/price/benefits/commission/time/windowâ†’existing hierarchy triggerâ†’unique payment_verified commission (never earned)â†’reservation/app sale linkâ†’existing payment rows sale linkâ†’final evidence/auditâ†’complete mutationâ†’commit.

Create sale payment_verified, no membership/customer activation/points/onboarding. fully_paid_at derives verified evidence; balance_due_at derives carried deadline/frozen schedule, not a fresh 365-day placeholder. Existing open-sale uniqueness remains; unrelated open sale conflicts, never adopted. Fault injection after payment linking rolls back sale/commission/links/evidence/audit.

## 11. Activation integration

Final sale enters existing activation queue. /sales/:id/activate remains sole action; preserve activate_card_sale signature/result, financial recheck, private.next_membership_number, credential hashes and one-time plaintext behavior. Replay returns existing membership without new credentials or onboarding issuance.

Forward activation replacement adds SQL mutation_actor_role(finance.card_activation,update), since existing body principally checks non-null actor, and writes immutable confirmation evidence inside activation transaction. Preserve current allocator rewrites, points/customer/commission semantics. Printing confirmation never calls credential issuance/reissue/mark-printed; existing persistent card data behavior remains unchanged.

## 12. Seller/hierarchy

Freeze validated seller and capture-date commission terms. Keep creator/reviewer/finalizer distinct. At final sale insert run current complete normal-sale ancestry trigger; no inferred/backfilled hierarchy, legacy-import bypass or actor substitution. Keep authoritative referral reference if present. Current sale-time ancestry affects analytics, not frozen economics/commission. Invalid hierarchy rolls entire finalization back.

## 13. Printable architecture

Regenerate bytes using existing toPdf from immutable evidence only; no PDF blob subsystem. Source authorization is fresh and separate. Document revision is explicit; current stored revision may be default, but never read today's price/seller/balance as historical content.

| Record | Evidence/version and frozen fields | Authority/evidence actor |
|---|---|---|
| Reservation | revision on create/draft save/submit/execute; explicit draft/executed label; AF-RES/AF-APP/exact terms, holders/schedule/economics/benefits/balance at revision | sales.card_sales:view + owner or update oversight; Finance view for executed source; revision actor/time |
| Recorded receipt | payment_recorded v1; AF-PAY/original purchase/app/customer IDs, names, amount/method/reference/verified balance at recording; RECORDEDâ€”NOT VERIFIED | finance.payment_verification:view or scoped owning seller view; recorder/time |
| Verified receipt | separate payment_verified v1; stable IDs, before/after verified totals/balances, terms and VERIFIED label | same scoped read authority; recorder plus verifier/time |
| Final purchase | purchase_finalized v1; AF-CSALE/AF-RES/AF-APP, terms version, original payment IDs/totals, frozen seller/commission/benefits | Finance view or owning sales view; finalizer/time |
| Activation | membership_activated v1; membership business number/purchase links, price/verified total/points/term/expiry at activation | finance.card_activation:view; activator/time |

Never print government ID plaintext, onboarding tokens/URLs, QR/fallback/card credential payloads, hashes, protected storage URLs or raw request JSON. Explicit allowlists only. Historical pre-migration receipt fields lacking evidence say legacy/evidence unavailable; no invented before/after balance. Semantic reprint stability required; renderer metadata byte equality not promised.

## 14. Authorization matrix

Re-resolve active principal/role/restrictions per request; names Admin/Super Admin never substitute permission checks.

| Action | Existing permission and scope |
|---|---|
| Terms proposal/read | sales.customers:view, app owner or sales.customers:update reviewer |
| Old review | sales.customers:update, approved/no live reservation, independent seller selection validation |
| Submit | existing sales.customers:create owner or update reviewer, valid identity/signatures |
| Reserve | sales.card_sales:create; app owner or sales.customers:update reviewer, frozen seller/customer validated |
| Draft update/submit/execute/reopen/cancel | sales.card_sales:create AND creator owner OR sales.card_sales:update oversight; preserve authorizeAgreementMutation, no sales.customers shortcut |
| Record/verify/reject/finalize | finance.payment_verification:update and exact source state |
| Activate | finance.card_activation:update plus SQL financial/state recheck |
| Reads/exports | corresponding Finance view or document-specific scoped seller read in section 13; UUID possession grants nothing |

SQL repeats all mutation permission/ownership checks through mutation_actor_role/has_permission_for_user. New terms RLS, browser revoked, minimal service SELECT; mutations via definer RPC. Private evidence direct access revoked. Public definer RPCs revoke PUBLIC/anon/authenticated EXECUTE, service-only; safe search_path, qualified columns. Narrow reservation-seller SELECT policy only if needed; no new browser write grant or policy.

## 15. Canonical lock order/concurrency

**Order:** outer request advisory lockâ†’applicationâ†’reservationâ†’sale if presentâ†’payments sorted UUIDâ†’membershipâ†’customerâ†’existing commission/points descendants. Immutable terms are read after app lock, not FOR UPDATE; no terms lock edge. Multiple same-class parents sort UUID. New child insert does not imply locking existing child first.

Legacy suffixes: record saleâ†’new payment; verify saleâ†’paymentâ†’commission; activation saleâ†’new membershipâ†’customerâ†’commission. Existing redemption/reissue membershipâ†’customer paths do not acquire sale/app afterwards. Do not wrap activation with membership-first lock. Discover source unlocked, revalidate under ordered locks; source origins/IDs immutable.

Baseline verify paymentâ†’sale must be replaced before enabling finalization. Affected app/reservation status handlers become RPCs. Outer wrapper owns one mutation_result key; nested cores never acquire a second request key after business locks. Replace application-first legacy reserve wrapper order when sharing cores. Existing allocators stay late; no operation acquires multiple AF-ID allocator locks in reversed order. Plan FOR SHARE reads precede reservation locks; configuration writers do not acquire purchase parents.

Two independent pg clients, barriers, lock_timeout and statement_timeout; not sleep-only tests. Required races: duplicate reserve, duplicate record, simultaneous verify, verify vs cancel, two finalizers, finalize vs late record/decision, activation replay, old review versions. Add legacy verify vs activation and different request duplicate create. Assert no deadlock/40P01, valid serialized outcomes, exact IDs/totals and cleanup. Inspect FK implicit locks/deferred source triggers; reject any new reverse edge.

## 16. Idempotency

Reuse mutation_result/complete_mutation SHA256 normalization and unique(actor,operation,request). Fresh authorizationâ†’request lookupâ†’lifecycle checks. Fingerprint normalized source/terms/input/decision/reason, never recalculated current economics for a committed replay.

| Operation | Key/result |
|---|---|
| Review | purchase_terms.review â†’ original terms UUID |
| Submit/decision | application.submit/application.decide â†’ terms/app with persisted transition evidence |
| Reserve/transition | reservation.create/reservation.transition â†’ reservation and original revision |
| Record/verify | payment.create/payment.verify â†’ original payment and immutable evidence |
| Finalize | reservation.finalize â†’ original sale |
| Activate | existing sale lock + unique membership sale, server-frozen validity; no extra wrapper needed |

Same payload returns original; changed payload conflicts; other actors/request IDs cannot bypass domain uniqueness. Failure commits no placeholder. Legacy reference-only recordings remain; new reservation mutations require request UUID.

## 17. Legacy compatibility

Existing reservations remain sale-origin and unique by sale. Existing payments remain sale-origin/reservation NULL, including sales with legacy agreements. Never recategorize or duplicate them. Explicit legacy sale creation remains, first-time application UI uses new path. Nullable sale DTOs must not turn null into fake UUID or string 'null'.

Preserve imported-origin exclusions, analytics ancestry rules, card/customer authorization, RPC signatures and legacy result shapes. New verify branch removes current-total shortcut only for request-based historical evidence. Strict requests intentionally reject authoritative extra fields; test legitimate old callers.

## 18. Migration safety

After Gate 1, draft exact migration/contract; Gate 2 approves before backend dependencies. Header includes read-only validation and forward-only down note. Idempotent guards reject incompatible drift, not silently mask it.

Baseline disposable DB + synthetic legacy rows: capture counts/IDs/snapshots/ACLs/current activation definition. Apply migration, compare unchanged history except new discriminator defaults, reapply, inspect pg_catalog nullability/uniqueness/FKs/index predicates/triggers/RPC ACLs/search_path. Probe contradictory sources/customer/app/terms and commit-deferred behavior. Verify all relevant roles/restrictions, not just text. RLS invariant query must return zero. Cleanup restores every new/existing table.

No destructive down after pre-sale payments exist: old backend cannot represent them. Disable new mutation entrypoints and roll forward correction, retaining ledger/terms/evidence. Review package states app/schema ordering and incompatibility. Shared migration history/identity verification only in separately approved apply stage; no remote repair/generic apply now.

## 19. API contracts

All routes stay in existing families and use contract exports; no new Vercel function/variable import.

| Proposed route | Contract |
|---|---|
| GET /official-forms/customer-applications/:id/purchase-terms/proposal?sellerCandidateId=UUID | optional untrusted candidate selection; PurchaseTermsProposal: server offer/hash/asOf/scope |
| POST .../:id/purchase-terms/review | strict {requestId,expectedProposalHash,reason,sellerCandidateId?} â†’ PurchaseTerms |
| POST existing app submit | strict {requestId,expectedProposalHash,sellerCandidateId?} â†’ app/exact terms ID |
| POST /official-forms/reservations | strict origin application {requestId,appId via customerApplicationId,purchaseTermsId,agreement fields} OR explicit sale legacy request |
| GET .../reservations/:id/finance | ReservationFinanceSummary |
| GET/POST .../reservations/:id/payments | Payment[] / mandatory-requestId existing payment fields â†’ {id} |
| POST /payments/:id/verify | strict decision/reason/requestId; required for reservation, optional legacy â†’ shared verification result, nullable sale/reservation IDs |
| POST .../reservations/:id/finalize | strict {requestId} â†’ Sale |
| GET /queues/finance | discriminated FinanceCollectionQueueItem; activation retains nonnull financeQueueItemSchema |
| GET /payments/:id/export/pdf?version=recorded\|verified | existing generated file envelope |
| GET /sales/:id/export/pdf | final purchase envelope |
| GET /memberships/:id/activation/export/pdf | confirmation envelope |
| GET existing reservation export/pdf?revision=N | selected historical revision envelope |

Owners official-forms.ts/finance.ts/index.ts. Separate update schema forbids commercial/source changes. Strict nested mutation objects; no any/unsafe casts/suppressions. Shared verify result replaces services inline Zod. Domain errors use existing envelope. Candidate ID is selection only, not trusted seller assertion.

## 20. Admin/Finance UI

Existing application detail shows old evidence versus explicitly new review offer, reason/asOf/hash and validated seller-selection scope. No free price field. Stale proposal refreshes before confirmation. Approved eligible app opens reservation without sale selector; read-only source/terms/tier/scheme/total/included fee/seller, editable allowed agreement fields; Create Reservation Agreement then detail navigation. Preserve non-draft actions and explicit legacy mode.

Finance queue/history supports AF-RES collection, record/verify prints and full-paid/no-pending finalization. Then link AF-CSALE and existing activation queue, never implicit activation. Reuse typed services, Query invalidation/polling and safe retry/loading patterns. Invalidate app/reservation/payment/queues/reports/customer lookup, activation on finalization. Real authenticated UI + reload/network/console required; build is not workflow proof.

## 21. Test matrix

C=contracts, A=API, D=real PostgreSQL, U=admin, P=PDF. Assert persisted IDs/states/counts, not just HTTP status.

| Required cases | Assertions/owners |
|---|---|
| 1â€“5 | approved succeeds; draft/submitted/rejected/cancelled denied, zero new rows (A,D,U) |
| 6â€“8 | incomplete old requires review; authorized reviewed succeeds; exact original terms FK frozen (A,D,U) |
| 9 | live duplicate blocked; same key original; different key/actor no second AF-RES (A,D) |
| 10â€“12 | executed AF-RES queued without sale; 10000.00 recorded; AF-PAY allocated, no sale (A,D,U) |
| 13â€“15 | unverified excluded; verified 10000.00 leaves 44000.00; +22000.00+22000.00 fully paid; rejected excluded (A,C,D) |
| 16â€“17 | recording replay one row; neither/unrelated source rejected at commit (A,D) |
| 18â€“23 | no early sale; full verified exactly one; partial/unverified blocks; bad hierarchy rollback; replay same ID (A,D,U) |
| 24â€“27 | sale alone no member; authorized activation one; replay no new secrets; wrong financial state denied (A,D,U) |
| 28â€“32 | all five valid nonempty PDFs with expected IDs/amounts/status/actors (A,P,U) |
| 33â€“34 | live plan/name/rule/balance edits do not alter old semantic reprint; secrets absent (A,D,P) |
| 35â€“38 | unauthorized/restricted/inactive review/record/verify/finalize denied, no mutation (A,D) |
| 39â€“40 | extra authoritative browser fields rejected; contradictory source/customer/app/terms denied (C,A,D) |

Also: no pre-execution collection; no executed cancellation/reopen; app cancellation blocked with live reservation; stale hash; immutable terms; source/date/economic edits denied; all-scheme SQL/TS rounding parity; zero commission; overpayment retained; pending blocks finalization; first-window retained; reports before/after linking once; labelled legacy missing evidence; ACL denial; partial-failure rollback; eight races/legacy race; every-table cleanup/harness injection.

## 22. Implementation phases/tasks

Each task uses REDâ†’observe expected failureâ†’minimal changeâ†’GREEN. No task starts now. Commits are grouped in section 24 after corresponding gates, not automatically every test.

### A. Contracts/invariants
Files: contracts official-forms.ts/finance.ts/lifecycle.ts/index.ts; new schemas/purchase-flow.spec.ts.
Interfaces: PurchaseTerms/Proposal, ReviewPurchaseTermsRequest, SubmitPurchaseApplicationRequest, source-discriminated ReservationCreate, ReservationUpdate, nullable-source Payment, ReservationFinanceSummary, FinanceCollectionQueueItem, PurchasePaymentVerificationResult, PurchaseDocumentEvidence.
- [ ] Test application/no sale parses, unknown price/seller/status rejects, contradictory sources reject, activation still requires sale.
- [ ] Run contract focus, confirm baseline FAIL.
- [ ] Implement section 19, derived eligibility only, no states added.
- [ ] Rerun PASS and type consistency check.

### B. Forward-only SQL contract/migration
Files: proposed migration; new API purchase-flow-migration.spec.ts, supabase/purchase-flow-integration.ts; db-integration.ts/security/rls_invariants.sql.
Interfaces: section 4 tables/constraints; section 7â€“11 RPCs; proposed private.purchase_terms_for_application(application uuid,seller uuid) returns jsonb; private.append_purchase_document(kind text,source uuid,revision integer,actor uuid,payload jsonb) returns uuid; public.purchase_document(kind text,source uuid,revision integer,actor uuid) returns jsonb with fresh scoped authorization; private.complete_purchase_mutation(actor uuid,operation text,request uuid,payload jsonb,result uuid,receipt jsonb) returns void. Existing mutation_result yields original result ID; wrapper reads matching immutable result_receipt under its request lock. No extra idempotency table.
- [ ] Add catalog/source/ACL tests, demonstrate missing baseline features.
- [ ] Draft exact DDL/RPC signatures; STOP Gate 2.
- [ ] After approval implement ordered transaction cores and same migration RPCs, preserve current allocator definitions.
- [ ] Execute/reapply on synthetic legacy baseline, inspect catalogs, probe source errors; Gate 3.

### C. Terms/atomic application transitions
Files: official-forms handler/SQL; new purchase-terms.spec.ts.
Interfaces: review_application_purchase_terms_once(request uuid,actor uuid,application uuid,expected_hash text,reason text,seller_candidate uuid default null) returns uuid; submit_purchase_application_once(request uuid,actor uuid,application uuid,expected_hash text,seller_candidate uuid default null) returns uuid; decide_purchase_application_once(request uuid,actor uuid,application uuid,decision text) returns uuid.
- [ ] Test oldâ†’review conflict, stale hash, immutable approved terms, unauthorized review/price assertion.
- [ ] Run focused A/D and observe expected failures.
- [ ] Implement atomic capture/review/transitions with existing identity and seller checks.
- [ ] Verify all five SQL/TS schemes, review race, original snapshots unchanged.

### D. Application-origin reservation
Files: official-forms handler/SQL; existing transitions spec; new application-purchase-flow.spec.ts.
Interfaces: reserve_application_purchase_once; transition_purchase_reservation_once(request uuid,actor uuid,reservation uuid,action text,input jsonb default '{}') returns uuid (draft save/submit/decision/reopen).
- [ ] Test approved/no saleâ†’AF-RES, duplicate conflict, received signatures and ownership denial, exact terms readback.
- [ ] Run A/D, confirm baseline failure.
- [ ] Implement source modes and atomic transitions/audit; replace affected legacy wrapper lock ordering.
- [ ] Verify legacy editor lifecycle/export and cancellation races.

### E. Finance ledger/queue/report
Files: queues.ts/sales.ts/reports.ts/customer-categories.ts/customers.ts, affected customer_directory SQL; queues-dashboard spec; new reservation-finance.spec.ts.
Interfaces: record_reservation_payment_once; summary/history/source queue contracts.
- [ ] Test executed queue pre-sale, recorded 10000.00 leaves verified='0.00'/remaining='54000.00', AF-PAY/replay, report row once before/after link.
- [ ] Confirm baseline omission/failure.
- [ ] Implement batched reads/one-ledger recording/source reports/categories/blockers.
- [ ] Verify search/pagination/counts/legacy scopes.

### F. Verification/evidence
Files: sales.ts/handler-kit.ts, phase26-finance spec; SQL.
Interfaces: verify_purchase_payment_once and parent-first compatible verify_card_payment.
- [ ] Test exact 44000.00 remaining, replay original result/changed reason conflict, window retention and legacy verify/activate overlap.
- [ ] Observe current baseline failures.
- [ ] Implement parent-first core, wrappers/evidence/SQL actor checks; new request path avoids current-total shortcut.
- [ ] Real concurrent verifies plus legacy checks; Gate 4.

### G. Atomic finalization
Files: official-forms handler/SQL; new purchase flow spec/DB module.
Interface: finalize_reservation_purchase_once returns sale UUID, existing Sale mapper result.
- [ ] Test partial/unverified/pending/hierarchy blocks, full one sale with original payments, injected post-link rollback.
- [ ] Confirm missing baseline operation failures.
- [ ] Implement section 10, no activation.
- [ ] Two finalizers/late mutations: one sale, zero membership.

### H. Activation integration
Files: activation SQL/sales.ts as needed, phase2 spec/DB module.
Interface: unchanged activate_card_sale(UUID,UUID,integer) result.
- [ ] Test finalized queue, SQL actor denial, one membership/confirmation/replay no new credentials.
- [ ] Confirm evidence/SQL actor baseline gaps.
- [ ] Add permission/evidence within existing transaction, preserve allocator and rules.
- [ ] Verify points/customer/commission/card/portal neighbors.

### I. Historical PDFs
Files: new api/_lib/purchase-documents.ts/.spec.ts; official-forms/sales/memberships export routes.
Interface: purchaseDocumentPdf(evidence: PurchaseDocumentEvidence): Uint8Array, existing toPdf/file envelope.
- [ ] Five content assertions, recorded/verified labels, semantic stability after live edits, forbidden fields absent.
- [ ] Run/observe missing renderer/export failure.
- [ ] Implement immutable-only allowlisted renderer and authorized read RPC; legacy absence labelled.
- [ ] Verify all export denial/source scope/revision cases.

### J. Admin/Finance UI
Files: OfficialFormsPages, BusinessFinanceQueuePage, BusinessActivationQueuePage, BusinessSalesPage, services and existing specs.
Interfaces: section 19 contracts only, no ad-hoc fetch.
- [ ] Test review/stale offer/no-sale creation/read-only derived fields, executeâ†’recordâ†’verifyâ†’finalizeâ†’activate, print buttons and denials.
- [ ] Observe current required-sale UI failure.
- [ ] Implement section 20, preserve non-draft actions/invalidation/polling.
- [ ] Authenticated interaction/reload/network/console and legacy smoke; record unavailable managed-platform proof honestly.

### K. Security/concurrency/regressions
Files: new DB module, suite cleanup, listed regression specs.
- [ ] Add barrier races/40-case matrix, every-table cleanup tracking.
- [ ] DB local proves no deadlocks/duplicates/double counts, denied actors and rollback.
- [ ] Harness injection nonzero and finally cleanup; no shared target.
- [ ] Full gates/scoped security review; STOP Gate 5 on unresolved findings.

### L. Migration review package
File: future docs/AFHOMES-APPLICATION-PURCHASE-FLOW-MIGRATION-REVIEW.md.
- [ ] Actual DDL/RPC/ACL/source diff, checksum, validation outputs, preservation/recovery/release-order evidence.
- [ ] Forty-case results and all local/managed/browser limitations.
- [ ] STOP Gate 6; no shared apply/Production/push inferred.

## 23. File-by-file expected changes

| Files | Ownership |
|---|---|
| contracts schemas official-forms/finance/lifecycle; index.ts | source/terms/document/result interfaces and strictness |
| new contracts schemas/purchase-flow.spec.ts | contract invariants |
| future 20261101000001 migration | single tables/constraints/RPCs/ACLs/lock correction/evidence |
| API official-forms.ts | capture/review/atomic transitions/reserve/finalize/export |
| API sales.ts | source-aware history/verify/purchase export |
| API queues.ts | combined Finance count/dashboard, activation sale-only |
| API reports.ts/customer-categories.ts/customers.ts | payment report/category accuracy/protected history |
| API handler-kit.ts/memberships.ts | domain mappings/confirmation export |
| new api/_lib/purchase-documents.ts/.spec.ts | immutable-only PDF |
| new API purchase-flow-migration/purchase-terms/application-purchase-flow/reservation-finance specs | behavior contracts |
| existing API official-forms-transitions/phase2/phase26-finance/queues-dashboard/report/category/analytics specs | legacy and adjacent regression |
| fake/fixtures only if required query shape missing | faithful handler tests, never SQL lock proof |
| new supabase/purchase-flow-integration.ts; db-integration.ts/security/rls_invariants.sql/idempotency-integration.ts | real SQL/races/cleanup/grants |
| admin business OfficialFormsPages/FinanceQueue/ActivationQueue/Sales/services + existing specs | requested workflow/print UI |
| future migration review doc | Gate 6 evidence |

Router already supports these family subpaths; add dispatch tests only if assumptions fail. No package/lockfile/Vercel/public customer authorization/communications edits planned.

## 24. Commit boundaries

Proposals only. Explicit paths and staged diff review; never git add . or -A. Coherent dependency groups, no release of incompatible intermediate commits:

1. `feat: add application purchase terms and reservation finance transactions` â€” migration/contracts/DB invariants after Gates 2/3.
2. `fix: create reservations directly from approved applications` â€” capture/review/atomic application/reservation handlers/tests.
3. `fix: finalize paid reservations before membership activation` â€” ledger/queue/report/verify/finalize/activate/tests.
4. `feat: add historical printable purchase records` â€” exports/renderer/privacy tests.
5. `feat: connect application-first reservation and finance actions` â€” typed services/UI/tests.
6. `docs: add purchase flow migration review evidence` â€” actual package after full gates.

Combine inseparable SQL/backend evidence boundaries if review requires it. Stage exact filenames from section 23 and actual git diff. No commit or push this turn; later commit authorization comes from approved execution scope, push remains separately scoped.

## 25. Verification commands

Planned, not executed as implementation proof this turn. Promotion root; existing dependencies installed. Reuse corepack/pnpm shim if Turbo lacks PATH binary. DB suites sequential, isolated loopback port/data directory.

```powershell
corepack pnpm --filter @afhomes/contracts exec vitest run src/schemas/purchase-flow.spec.ts --pool=threads --maxWorkers=1
corepack pnpm --filter api exec vitest run _handlers/purchase-terms.spec.ts _handlers/application-purchase-flow.spec.ts _handlers/reservation-finance.spec.ts _handlers/official-forms-transitions.spec.ts _handlers/phase26-finance.spec.ts _handlers/queues-dashboard.spec.ts _lib/purchase-documents.spec.ts --pool=threads --maxWorkers=1
corepack pnpm --filter @afhomes/admin exec vitest run src/features/business/OfficialFormsPages.spec.tsx src/features/business/finance-lifecycle.spec.tsx src/features/business/BusinessSalesPage.spec.tsx --pool=threads --maxWorkers=1
corepack pnpm test:db:local
corepack pnpm test:db:harness
corepack pnpm typecheck:deploy
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test -- --pool=threads --maxWorkers=1
corepack pnpm check:env
git diff --check
git diff --cached --check
git status --short
```

Execute rls_invariants.sql through disposable suite, zero rows. Capture current counts/exit status/races/cleanup. Harness outer checks pass while injected inner run fails. Distinguish preexisting warnings. Authenticated browser/reload is required workflow evidence; if unavailable, NOT VERIFIED. No remote test:db/db:migrate substitute without target approval.

## 26. Risks/open questions

- Nullable sale IDs propagate to reports/queues/customer reads; source unions and tested readers precede UI.
- Parent-first verification/status RPC replacements are mandatory, not an optional refactor. Real races must cover FK/trigger implicit locks.
- Scheme/commission parity and 0% commission need PostgreSQL execution, not text assertions.
- Old review confirms an explicitly new offer; it never asserts missing historical terms. Unconfirmable records stay blocked.
- Executed is terminal; this task creates no executed cancel/refund workflow.
- Undecided payments block finalization; no silent discarded receipt.
- Pure PostgreSQL does not prove managed PostgREST/GoTrue/Storage; separately authorized environment needed.
- Version available locally; recheck exact target history before future approved apply.
- Tasks are one coupled purchase lifecycle with sequential interface gates, not independent finance systems.

No unresolved business rule is required to review this plan. Execution method and gate approvals remain user decisions. Runtime SQL/browser/shared-schema results are unverified at this planning stage.

## 27. STOP gates

1. **Plan approval:** STOP now; approve exact plan and choose execution before code/test/migration creation.
2. **Migration contract review:** STOP after concrete local DDL/contracts before backend depends on them.
3. **Disposable PostgreSQL execution:** STOP on migration/reapply/catalog/history/cleanup failure.
4. **Backend/Finance verification:** STOP on inaccurate totals/IDs/links/states/replays.
5. **Security/concurrency review:** STOP on authorization/leak/deadlock/race/double-count/reprint finding; agents only if explicitly authorized.
6. **Migration review package:** STOP and deliver actual evidence/limitations.
7. **Shared Supabase:** separately approved exact file and target required; no auto apply.
8. **Production deployment:** separate explicit approval; never inferred from plan/migration approval.

**Classification: READY FOR IMPLEMENTATION-PLAN REVIEW.** Planning documents only; no implementation, migration, commit, push, shared change or deployment performed.
