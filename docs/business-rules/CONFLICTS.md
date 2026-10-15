# Conflicts Register

Unresolved. Nothing selected silently. Each entry needs its named owner before it can move.

## CF-01 — Which commercial model governs v2 (Q1)

- Rules affected: all BR-GEN/ENG/QLF/PB/ACM/REV/RATE/CTL rules vs all BR-CODE rules.
- Source A: Generator package (C2 + A4 + A6 + B8) — payroll model: BA/PA/PB allowances, DSC/DRI commissions, QP/EP, Equivalent TCP, Close Month.
- Source B: v2 codebase — membership-card model: verification-gated activation, points, single-level commission (`commerce.ts`, `phase2_rpc.sql`, `lifecycle.ts`).
- Impact: the two models share terminology (VIP, commission, genealogy, threshold) but different mechanics. Building from either side alone misdescribes the other.
- Unambiguous now: each side's internals (documented faithfully here). Blocked: any cross-model conformance claim.
- Owner: company president. Opened: 2026-10-14.

## CF-02 — Qualification gate: 25%/10% approved vs 100% verified (Q3)

- Rules: BR-QLF-02 vs BR-CODE-03.
- Source A: C2 §3 R13 + B8 §2 (VIP 25%, IGP 10% of TCP on approved collections).
- Source B: `20260927000003_afhomes_phase2_rpc.sql:418,431` (`SALE_NOT_FULLY_PAID` unless verified ≥ price).
- Impact: a VIP sale at 30% collected counts in the workbook, activates nothing in v2.
- Unambiguous now: both gates as stated. Blocked: whether v2 cards are the workbook VIP product.
- Owner: company president. Opened: 2026-10-14.

## CF-03 — C2 version authority (Q6)

- Rules: all C2-sourced rules.
- Source A: filename dates the memo 2026-08-20 (+21 Aug rulings inside).
- Source B: in-ZIP mtime 2026-10-11, ten days after every other entry.
- Impact: cannot tell signed version from later edit/re-export.
- Owner: document owner. Opened: 2026-10-14.

## CF-04 — Thresholds stricter-than-contract (resolved in-source, externally unverifiable)

- Rules: BR-QLF-02, BR-PB-01.
- Source A (earlier draft, quoted inside C2 §3): contracts allegedly required 40% before a sale counts.
- Source B (C2 §3 correction + 21 Aug resolution): JA&D DST contracts contain no collection-percentage requirement; the 10% threshold was written into the contracts via the 21 Aug Addendum.
- Impact: resolution depends on absent instruments (C3–C7). Recorded as DOCUMENTED FACT, not corroborated.
- Owner: company president (produce C3–C7 or confirm). Opened: 2026-10-14.

## CF-06 — UPGRADED counting: Reference R55 vs A24/R15 (resolved by document hierarchy)

- Rules: BR-QLF-04.
- Source A: A2 Reference R55 (Guidelines v5.0 text): UPGRADED "still counts as a completed sale in all reports (its payments and commission were a real deal)".
- Source B: A2 Control Panel A24 (v10.1.1 correction, 20 Jul 2026) + C2 R15 (20 Aug 2026): UPGRADED old row and receipts stop counting; receipts moved to the new number; qualification stripped outright.
- Resolution (NOT silent): newer + higher authority governs — C2 §1 establishes the ruling addendum governs where it differs from earlier memoranda, and B8 establishes the 20–21 Aug rulings as build authority. A24 postdates the v5.0 guideline text it corrects ("status-policy correction per management"); R15 confirms it a month later. R55's "counts" is read as completed-sale history (the deal was real; row kept, never reused — consistent with R47), while TCP/statistics follow A24/R15. Recorded 2026-10-14 with this evidence; reopen if a newer source contradicts.
- Owner: none further (resolved). Opened + resolved: 2026-10-14.

## CF-05 — "Master List" identity (Q5)

- Prescribed reading order step 1 unresolvable: no file/sheet named Master List in the 18 present files (A2's 25 sheets enumerated in traceability §2).
- Candidates rejected: MASTER_FILE_INDEX (distribution index, explicitly not a pack member), Reference/Table A (parameter table), Accreditation/AATS (registers).
- Owner: package author / Finance Director. Opened: 2026-10-14.
