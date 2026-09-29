# AFHOMES Launch Operating Procedures

This document separates **implemented behavior** (enforced by code/SQL) from **manual procedure** (done by people) from **future enhancement** (not built). It introduces no new business rules; every statement traces to the implementation or to the Phase 34 register (`docs/AFHOMES-PHASE-34-BUSINESS-RULES-REGISTER.md`).

## 0. Launch restriction (operational, pending formal sign-off)

**ONE MEMBERSHIP PER CUSTOMER AT LAUNCH.** The schema enforces a single membership row per customer, and sale creation now refuses a second application while any membership row exists (server-side, `api/_handlers/sales.ts`, 409: "This customer already has an active membership. Only one membership per customer is supported at launch."). Staff must not attempt workarounds; a second card for the same person is not supported until management decides D-12 otherwise. Status: operational launch restriction, pending formal sign-off — the software fails safe either way.

## 1. Commission qualification (implemented + manual)

- Implemented: `pending → payment_verified → final_qualification_pending` move automatically on full payment and activation; nothing auto-earns. Qualification and pay require `network.commissions + update`.
- Manual procedure: an authorized qualifier opens the commission, reviews whatever evidence management requires (no objective thresholds exist in the system), records a decision of `earned` or `cancelled` with notes of at least 5 characters, then marks `earned` commissions paid with an optional payout reference. Each step is audited (`COMMISSION_QUALIFIED`, `COMMISSION_PAID`).
- Future: objective qualification criteria, if management defines them (D-01).

## 2. Refunds (no software path)

- Implemented: none. There is no refund, void, or reversal endpoint for payments, sales, memberships, or commissions.
- Manual procedure: decline in-system refunds. Record any goodwill handling entirely off-system (accounting records + member communication), and never hand-edit snapshots, ledger rows, or commission rows. Direct database edits by ordinary staff are prohibited.
- Future: a defined refund/cancellation workflow (D-03).

## 3. Points (implemented)

- Implemented: points never expire automatically; balances persist; the points report states no expiry is inferred. Allocation happens once at activation; spending happens only through redemption.
- Manual procedure: none required. If a balance looks wrong, escalate to engineering — there is no staff correction endpoint by design.
- Future: manual adjustments and reversal tooling (D-10/D-11).

## 4. Membership expiry (implemented)

- Implemented: memberships carry `expires_at`/`renewal_due_at` (default 12 months); past expiry, redemption and credential rotation are refused while the portal still shows the member's own profile. The portal says "Valid until".
- Manual procedure: tell members their card is valid until the shown date. There is no renewal workflow yet (D-05).
- Future: renewal offering (payment, re-allocation, card, commission).

## 5. Spot cash (implemented)

- Implemented: the 7-day deadline from first verified payment is informational only. It never blocks payment, activation, or qualification, and nothing is forfeited or auto-cancelled.
- Manual procedure: use the deadline as a follow-up nudge for the seller, not as an enforcement deadline (D-02).
- Future: a defined expiry consequence, if management wants one.

## 6. Commission payout (implemented + manual)

- Implemented: marking paid records timestamp, actor, and optional reference; amount, rate, basis, and beneficiary are immutable.
- Manual procedure: pay through the existing payroll channel, then mark paid with the payroll reference in the system so the two agree.
- Future: payout method, schedule, batching, and tax handling (D-17).

## 7. Customer activation (implemented + manual)

- Implemented: staff issues a single-use hashed token (default 72h, 1–168h configurable); the customer sets their own password through it; reuse is idempotent and safe.
- Manual procedure: convey the token to the customer through the approved channel and confirm activation; reissue if expired. No automated email/SMS delivery exists at launch.
- Future: automated delivery (needs management decision + messaging provider).

## 8. OCR and documents (implemented)

- Implemented: manual entry always works; OCR is optional assistance that never finalizes — a human must confirm. Rejected and replaced documents are retained; nothing is deleted.
- Manual procedure: if OCR is unavailable or low-confidence, complete onboarding by manual entry and human review. Retention and privacy-deletion handling follow the D-15 decision once recorded.
- Future: contracted OCR provider (resourcing preference, D-16).

## 9. Sale cancellation (implemented)

- Implemented: there is no sale-cancel endpoint. Open applications are unique per customer+plan; `cancelled`/`active` sales do not block a later purchase, but a customer with any membership row cannot open a second application (§0).
- Manual procedure: do not promise cancellations the system cannot record. Escalate post-payment cancellation requests to management under the D-06 decision.
- Future: a defined cancellation workflow.
