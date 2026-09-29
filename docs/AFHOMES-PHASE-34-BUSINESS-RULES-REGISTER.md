# AFHOMES Phase 34 — Business Rules Register

## 1. Purpose

This register separates **implemented, authoritative behavior** from **unresolved business policy** before release readiness. Every implemented rule cites its source. Every unresolved item states current behavior, risk, owner, and whether it blocks release. No policy is invented here: options are listed for management, and the decision columns are left blank.

Scope notes:

- `docs/` JAD-era documents and `legacy/` describe the retired platform and are not sources.
- `lifecycle.ts` (`packages/contracts/src/schemas/lifecycle.ts`) is the single source for status strings and legal transitions; handlers, contracts, and tests import it.
- Money is exact-decimal text; only VERIFIED payments count; snapshots freeze history. These are settled and re-proven in Phase 31.

## 2. Authoritative implemented rules

These are safe to rely on. Behavior is enforced in code/SQL, not merely documented.

### A1. Commission lifecycle state machine

- Values: `pending, payment_verified, final_qualification_pending, earned, paid, cancelled` (`lifecycle.ts:58-66`; DB CHECK `20260927000001_afhomes_phase2_business_foundation.sql:280-286`).
- Legal transitions (`lifecycle.ts:139-148`): `pending → payment_verified|cancelled`; `payment_verified → final_qualification_pending|cancelled`; `final_qualification_pending → earned|cancelled`; `earned → paid|cancelled`; terminal `paid, cancelled`.
- Automatic moves only: sale creation inserts one `pending` commission (`sales.ts:416-427`); full-payment verification advances `pending → payment_verified` (`20260927000003_afhomes_phase2_rpc.sql:322-326`); activation advances `payment_verified → final_qualification_pending` and NEVER auto-earns (`20260927000003_afhomes_phase2_rpc.sql:474-485`).
- Manual moves: qualify and pay both require `network.commissions + update` (`commissions.ts:188,252`). Qualification notes mandatory, 5–500 chars (`finance.ts:187-191`; 400 without, `commissions.ts:190-192`). Only `final_qualification_pending` is decidable (`commissions.ts:205-211`). Pay requires `earned` (idempotent when already `paid`, `commissions.ts:268-287`); records WHEN/BY WHOM/reference, never changes amount/rate/beneficiary (`commissions.ts:289-296`).

### A2. Single 4% beneficiary commission

- Rate `0.04`, one row per sale (`commissions_one_per_sale`), beneficiary exactly one of staff/OST (`20260927000001_afhomes_phase2_business_foundation.sql:312-319,326-327`). No override, split, bonus, or multi-level rule exists anywhere in code, migrations, or tests (`ost.ts:12`; `AFHOMES-PHASE-7-GENEALOGY.md:21`).

### A3. Payments: only VERIFIED money counts

- Values `recorded|verified|rejected|voided` (`lifecycle.ts:44`); `recorded → verified|rejected|voided`, all others terminal (`lifecycle.ts:125-130`). A verified payment can never be voided later. Record and verify both require `finance.payment_verification + update` (`sales.ts:541,564`). Rejection requires a reason ≥3 chars (`finance.ts:56-65`). Same-decision verify is idempotent; decided payments refuse re-decision (`sales.ts:580-597`; `PAYMENT_NOT_PENDING`).

### A4. Spot-cash window is informational

- Starts once on first VERIFIED payment; deadline = start + 7 days UTC; never resets (`constants.ts:10`; `commerce.ts:114-118`; `20260927000003_afhomes_phase2_rpc.sql:289-303`). State derived (`commerce.ts:120-131`; SQL CASE `20260927000003_afhomes_phase2_rpc.sql:125-130`). Expiry blocks nothing: payments accepted unless sale is `cancelled/active`; activation needs only full payment + activatable status; no auto-cancel, no forfeit, no sweep (only cron is `/health` daily, `vercel.json:11-16`).

### A5. Snapshots freeze history

- Sale economics, commission amount/rate/basis, hierarchy ancestors, redemption item name/code/cost are snapshotted at creation and never recomputed (`20260927000001_afhomes_phase2_business_foundation.sql:133-143,172-175,301-303,329-330`; `sales.ts:370-396`; `cards.ts:7-12`). Plan repricing/deactivation cannot move historical rows (DB §5 tripwire). Deactivation (never delete) gates future sales only (`cards.ts:86-121,246-254,304-309`).

### A6. Points: allocation in, redemption out, nothing else

- Ledger types `annual_allocation|redemption|adjustment|reversal|expiration` exist, but the only producers are activation allocation and redemption debit (`20260927000003_afhomes_phase2_rpc.sql:458-466`; `20260928000001_afhomes_phase4_redemption.sql:388-397`). No expiry producer, no manual adjustment endpoint (`memberships.ts` exposes only `GET accounts|ledger`; portal ledger is read-only). Redemption bounds: cost 1–1,000,000,000; quantity 1–99; inactive items refused; idempotent per `(redeemed_by, key)`.

### A7. Credentials rotate, prints don't

- Reissue mints fresh QR + fallback, kills old codes immediately, returns plaintext once (`20260927000005_afhomes_phase3_customer_portal.sql:192-228`); requires `finance.card_activation + update` and a 5+ char reason (`memberships.ts:329-332`; `card.ts:42-45`). Print only bumps `print_count/last_printed_at`, unlimited and free (`memberships.ts:387-430`; `20261004000001_afhomes_phase10_card_management.sql:36-60`).

### A8. Customer isolation and suspension semantics

- Portal is ownership-pinned; suspended/cancelled customers may read their own profile but nothing else (membership/points/ledger/payments/credentials all 403; `customer-portal.ts:104-139,142-338`). Customer status is staff-writable (`PATCH customers/:id`, `customers.ts:171-199`); there is no self-edit route and no customer delete/unlink endpoint.

### A9. Referral codes are bounded and hash-addressed

- `expires_at` mandatory, `max_uses` 1–1000 (default 1), max 10 live codes per issuer, sponsor frozen from the code (payload spoof ignored), self-referral refused, raw code returned once and never re-exposed (`ost.ts:121-176,240-269,822-895`).

### A10. Genealogy moves preserve history

- Correction requires `sales.uplines + update` (handler + RPC `has_permission_for_user` check); sellers can never move themselves (`referrals.ts:1-9,117-119,193-195`; `20261002000001_afhomes_phase7_genealogy.sql:102-103`). Cycle/direction/role pre-checks in SQL; old edge retired + new inserted atomically with mandatory reason; sales keep pointing at the creation-time relationship; earned commissions never move.

### A11. Duplicates actually prevented

- Staff email, customer email (case-insensitive), government-ID (partial unique where present), customer number, one-open-application per customer+plan (cancelled/active don't block repurchase), referral code hash, onboarding token hash, payment reference per sale, one commission per sale, one annual allocation per membership (`20260927000001_afhomes_phase2_business_foundation.sql:69-71,165-170,196-199,265-267,326-327`; `customers.ts:138,204-205`; `sales.ts:405-413`). Phone is NOT unique. OST emails blocked against staff/OST/reviewable applications (`ost.ts:178-189,249-266`).

### A12. Audit is append-only and redacted

- No delete/purge endpoint or retention job; browser roles hold SELECT-only; `sanitizeAuditValue` redacts tokens, secrets, hashes, QR/fallback, government ID, storage paths, API keys (Phase 32, all green).

### A13. CMS is draft/published only; public site is decoupled

- No approval chain, no scheduling; publish/unpublish flips snapshots with audit (`cms.ts:287-336,436-486`). Public marketing pages are hardcoded copy with no live operational prices (e.g. `VIPPrivilege.tsx:35-36`), so plan repricing can never stale the public site — and public edits never touch operations.

## 3. Unresolved P0 decisions

P0 = must be decided before production; money, access, or legal state can otherwise become ambiguous. None of these are resolved by coding in this phase.

| ID | Question | Current behavior | Options | Effect | Blocker? |
|----|----------|------------------|---------|--------|----------|
| D-01 | What qualifies a commission (`final_qualification_pending → earned`)? | Manual authorized decision only; notes (5–500) mandatory; zero objective thresholds (`commissions.ts:4-15` states the rule is not defined). | (a) Keep manual-admin qualification as the permanent rule. (b) Define objective criteria (e.g. verification + activation + cooling period) and keep manual sign-off. (c) Define criteria for a future automated path. | Determines when commission money is earned; affects payout timing and disputes. | No — the manual gate with mandatory notes + audit is accountable and fails closed. Decide the rule, but launch is not unsafe without it. |
| D-03 | What is the refund policy (payment refund, post-payment cancel, membership reversal, points rollback, commission reversal)? | No refund/void/reversal path exists for payments, sales, memberships, or commissions. `voided` payment values and redemption `voided` columns exist but have no writers. | (a) No refunds, stated in member terms (manual goodwill handled off-system with accounting procedure). (b) Define a refund/cancellation workflow as a future build. | Without a policy, any real-world refund happens outside the system and is unaccounted. | No — the system fails closed (no wrong path exists). A written operating procedure is required before launch. |
| D-04 | Do points expire? | Never. No expiry producer; balances persist indefinitely; reports state "no expiry inferred" (`reports.ts:154`). | (a) Confirm persist-forever. (b) Define expiry/rollover (requires a new build + member notice). | If marketing or terms promise expiry, current behavior over-awards. | No — behavior is self-consistent; confirm (a) or schedule (b). |
| D-05 | Is there membership renewal? What happens at `expires_at`/`renewal_due_at`? | Expiry enforced as redemption refusal only; no renewal payment, card, re-allocation, or commission. Portal now says "Valid until" (Phase 34 wording fix). | (a) 12-month terminal validity, repurchase for a new card. (b) Define a renewal offering as a future build. | Members reaching expiry lose redemption with no path back. | No — behavior is defined and consistent. Decide and communicate before first expiries (~12 months post-launch). |
| D-12 | May one customer own multiple cards over time? | Schema enforces ONE membership per customer (`memberships.customer_id unique`, `20260926023325_afhomes_phase1_foundation.sql:266-269`). A second purchase can proceed through payment, then activation fails on the unique constraint. | **Launch policy: ONE MEMBERSHIP PER CUSTOMER** (operational restriction, pending formal sign-off — the software fails safe either way). Sale creation refuses a second application while any membership row exists, before any sale row or payment: 409 "This customer already has an active membership. Only one membership per customer is supported at launch." (`api/_handlers/sales.ts`; proven in `phase26-finance.spec.ts` D-12 block incl. direct-API bypass). Alternative (b): allow multiples (requires a schema change + points/credential decisions). | A fully-paid second sale that can never activate is stuck money and certain customer harm — prevented at creation by the guard. | **Resolved for launch under (a) as an operational restriction; formal management sign-off still recorded as pending. If repeat purchase enters scope, (b) is a P0 build.** |

## 4. Unresolved P1 decisions

P1 = should be decided soon; the system operates safely (manually) meanwhile.

| ID | Question | Current behavior |
|----|----------|------------------|
| D-02 | Spot-cash expiry consequence | Informational only (A4). Decide: keep as a nudge, define a consequence, or remove the affordance. UI "Expired/danger" styling suggests a consequence that doesn't exist — accepted as attention flagging, revisit if the rule is defined. |
| D-06 | Sale cancellation policy | `cancelled` transitions exist; no sale-cancel endpoint writes them (only commission-side cancel via qualification decision). One-open-application excludes `cancelled/active`. Decide who may cancel at which stage and with what money effect. |
| D-10/D-11 | Points correction and redemption reversal | No manual credit/debit; `adjustment`/`reversal` ledger types exist without writers; redemption `voided` columns exist without writers. Decide the correction path (at minimum a manual, audited procedure). |
| D-14 | Login-email source of truth | Staff can edit customer email (`customers.ts:194`) but `auth.users` is never updated. Decide: sync on change, prohibit email change post-link, or document the drift. |
| D-15 | Document retention and deletion requests | Replacements add rows; rejected rows persist; no delete path, no retention duration. Decide retention years + privacy-deletion procedure (legal/compliance owner). |
| D-16 | OCR provider for launch | Manual-only default; optional generic HTTP provider; never blocking, never finalizing. Decide whether manual review capacity suffices or a provider must be contracted (management preference, not code). |
| D-17 | Commission payout mechanics | Manual mark-as-paid with optional reference; no method, schedule, batching, bank details, tax, or deductions. Decide the payout operating procedure (currently the code records WHEN/BY WHOM only). |
| D-18 | Confirm no overrides/multi-level | Only the 4% beneficiary commission exists (A2). Confirm in writing that no VD/SSM/SM override, split, or bonus is owed; otherwise this becomes a P0 feature gap. |
| D-07 | OST 3rd-person / excess-cost rule | Zero implementation or definition found anywhere (searched `3rd`, `third person`, `excess`). Confirm whether any historical SM cost-sharing obligation exists; if yes it is an off-system ops matter. |
| D-24 | Receipt requirements | Optional for every method. Decide whether receipts become mandatory (per method) as a fraud control. |
| D-30 | Membership-level suspension | `memberships.status` has `suspended/cancelled/expired` values but no app writer; suspension is effectively customer-status-driven (which is enforced end-to-end). Decide whether membership-level suspension is ever needed. |

## 5. Unresolved P2 decisions

Future enhancements and hygiene; no launch impact.

- D-09 `overdue` sale status: legal value with no writer (dashboard counts it, queue includes it, nothing sets it). Define the trigger or remove the value.
- D-13 Phone uniqueness: no constraint; decide if operationally needed.
- D-19 Role-transition genealogy effect: promoted sellers keep old edges (a new SSM still hangs off an SM edge until manually corrected). Correction path exists; decide whether promotion should auto-propose re-parenting.
- D-20 Staff-termination downline handling: deactivation blocks login; restrict FKs prevent deletion; edges still point at inactive staff. Decide a re-parenting procedure.
- D-21 Customer unlinking: no path; linkage is terminal by design. Confirm acceptable.
- D-22 CMS approval workflow: single-editor publish; decide if review chain is ever needed.
- D-23 Audit retention: append-only forever; decide a retention horizon for compliance.
- D-25 Payment method values: free text (max 40). Decide a controlled list for reporting hygiene.
- D-26 Referral code deactivation/regeneration: no explicit route (expiry + max_uses + 10-live cap cover it). Decide if needed.
- D-27 Print limits/fees: unlimited, free, reasonless. Decide cost control if abuse appears.
- D-28 Lost/stolen explicit status: none; rotation covers the need. Confirm coverage sufficient.
- D-31 Government-ID duplicate flagging: `possibleDuplicate` defaults null and is never auto-rejected by design. Confirm acceptable.

## 6. Explicit non-features

The system deliberately does not include, and nothing implies otherwise in code: commission overrides/bonuses/splits; payout processing; points expiry; renewals; refunds/reversals; manual points adjustments; inventory/stock; multi-membership per customer; membership-status admin mutation; customer self-edit or account deletion; document deletion; CMS scheduling/approvals; tax computation; payment gateways; NFC.

## 7. Known manual controls

Safe to operate: commission qualification/pay by `network.commissions + update` holders with mandatory notes; genealogy correction by `sales.uplines + update` holders with mandatory reason; customer suspend/cancel by `sales.customers + update` holders; credential rotation with reason; referral code issuance within live-code caps; CMS publish/unpublish with audit. Every manual control is permission-gated, reasoned/named, and audited.

## 8. Contradictions found

| # | Observation | Classification |
|---|-------------|----------------|
| C-1 | Portal showed `renewalDueAt` as "Renews" while no renewal flow exists (print page already said "Valid until"). | B — UI wording bug. **Fixed in Phase 34**: both portal screens now say "Valid until" with an explanatory comment; `customer-portal.spec.tsx` updated. |
| C-2 | `overdue` is a legal sale status counted by the dashboard and included in the finance queue, but nothing in code, SQL, or cron ever writes it. | D — genuine rule gap (D-09). No code change: behavior is nil, not wrong. |
| C-3 | Spot-cash "Expired" renders in a danger tone while expiry has no consequence. | C — accepted presentation (the state is factually expired); revisit only if D-02 defines a consequence. No change. |
| C-4 | `memberships.status` offers `expired/suspended/cancelled` but no app path writes them; expiry is check-time refusal. | D — genuine gap (D-30). No change: refusal behavior is correct; suspension works via customer status. |
| C-5 | `voided` payment status and redemption `voided` columns exist without writers. | D — genuine gaps (D-03, D-11). No change: placeholders, not promises. |

No class-A (implementation) bug was found: every enforced behavior matches its authoritative definition.

## 9. Decisions required from AF Homes management

In priority order: D-12 (resolved for launch under the one-card policy with a creation-time guard; formal sign-off pending — escalate to a P0 build only if repeat purchase enters scope), D-01, D-03, D-04, D-05, D-06, D-10/D-11, D-14, D-15, D-16, D-17, D-18, D-07, D-24, D-30, then the P2 list. Owners: D-01/D-17/D-18 finance lead; D-03/D-06/D-10/D-11 operations + finance; D-04/D-05/D-12/D-24 product/management; D-14/D-15/D-23 legal/compliance + engineering; D-16 operations; D-07/D-30 management.

## 10. Release recommendation based on unresolved rules

Release can proceed once management (a) signs off the one-card-per-customer launch restriction in D-12 (the software already enforces it as an operational restriction, so repeat purchase is out of launch scope by default) and (b) accepts the written operating procedures for refunds (D-03), commission qualification (D-01, manual gate already enforced), and payouts (D-17) in `docs/AFHOMES-LAUNCH-OPERATING-PROCEDURES.md`. All other items are safely manual or future work. The system fails closed everywhere a rule is absent: no absent rule can be violated through the software, because no path implements it.

---

## Management decision sheet

| Decision ID | Question | Current system behavior | Options | Financial/operational effect | Required before launch? | Management decision | Date approved | Approved by |
|-------------|----------|-------------------------|---------|------------------------------|-------------------------|---------------------|---------------|-------------|
| D-01 | What qualifies a commission as earned? | Manual admin decision, notes mandatory, no objective criteria | (a) Keep manual (b) Define criteria + manual sign-off (c) Criteria for future automation | Payout timing; dispute surface | No (gate is accountable) | | | |
| D-03 | Refund policy? | No refund path of any kind | (a) No refunds + written procedure (b) Future build | Unaccounted off-system refunds if unaddressed | Procedure yes; build no | | | |
| D-04 | Do points expire? | Never expire | (a) Confirm persist-forever (b) Define expiry (new build) | Over-award if expiry was promised | Confirm only | | | |
| D-05 | Membership renewal? | 12-month enforced expiry, no renewal path | (a) Terminal validity + repurchase (b) Future renewal build | Members lose redemption at expiry | Decide + communicate | | | |
| D-12 | Multiple cards per customer? | Schema allows exactly one membership; second activation fails | (a) One-card policy + creation guard (b) Multi-card build | Stuck fully-paid sales if undecided; guard now prevents creation | **Launch under (a); formal sign-off pending** | | | |
| D-06 | Sale cancellation policy? | No cancel endpoint | (a) Define stage/actor/money rules (b) Keep terminal-only via commission decision | Stuck pre-payment applications | No | | | |
| D-10/D-11 | Points correction / redemption reversal? | No writers | (a) Manual audited procedure (b) Future build | No recovery from erroneous debit | Procedure yes | | | |
| D-14 | Login-email source of truth? | Staff email edit does not sync Auth identity | (a) Sync (b) Prohibit post-link change (c) Document drift | Sign-in confusion | No | | | |
| D-15 | Document retention / deletion? | Retain everything, no delete path | Define years + privacy procedure | Compliance exposure | Procedure yes | | | |
| D-16 | OCR provider for launch? | Manual-only works | (a) Manual suffices (b) Contract provider | Review staffing | Preference only | | | |
| D-17 | Payout mechanics? | Mark-paid + optional reference | Define method/schedule/batching procedure | Payroll ops | Procedure yes | | | |
| D-18 | Any overrides/bonuses owed? | None exist | Confirm none in writing | Payroll liability if promised elsewhere | Confirm only | | | |
| D-07 | OST 3rd-person / excess-cost obligation? | Nothing in system | Confirm existence + off-system handling | SM cost disputes | Confirm only | | | |
| D-24 | Mandatory receipts? | Optional always | (a) Keep optional (b) Mandate per method | Fraud control | No | | | |
| D-30 | Membership-level suspension needed? | No writer; customer suspension covers | (a) Covered (b) Future build | Abuse response | No | | | |
