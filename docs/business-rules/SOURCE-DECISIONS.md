# Source-Decision Register (Phase 8)

- Created: 2026-10-14. Each entry asks only for the missing fact the sources do not establish — never broad re-approval of clearly stated rules.
- Authority key: C2 = ruling addendum; C1 = go-live checklist; A4/A6 = guides; B8 = build note; A2 = workbook; IDX = index.

## D-Q1 — Which commercial model governs v2 (CF-01)

- Question: Is the Generator payroll (BA/PA/PB, DSC/DRI, QP/EP, Equivalent TCP, Close Month) operative alongside v2, superseded by it, or out of scope for it?
- Authoritative documents: C2 + A4 + A6 + B8 (payroll fully specified) vs v2 codebase (card/points model implemented). Neither side references the other.
- Documented: both models internally coherent (payroll BUILD 2026-09-10a; v2 per AGENTS.md phases).
- Missing: any statement of relationship. No supersession memo, no integration spec, no retirement notice located in the 18 present files (C3–C7/D1–D7 absent).
- Depends on answer: all 32 NOT_IMPLEMENTED builds, PARTIAL build halves, MISMATCH scope, Lane 4.
- Independent: BR-RATE-06, issuance ordering, verification-gate tests, secret hygiene, audit mapping, conformance evidence.
- Smallest fact needed: one presidential sentence (alongside / superseded / out-of-scope) + effective date.

## D-Q2 — Cutover scope for v2 data (BR-CUT-01/02)

- Question: Does the 27 Sept 2026 no-grandfathering decision bind v2 sales/collections data?
- Authoritative: C1 §3 + IDX Pack C (decision text, deciding body unnamed beyond go-live context).
- Documented: sub-threshold sales never count whenever entered; credited Closed Deals contract-protected; 15%-VIP boundary case.
- Missing: applicability to v2 rows (which hold no per-sale qualification); protection instruments (C3–C7 absent).
- Depends: historical backfill semantics in W1–W4. Forward-only behavior independent.
- Smallest fact: yes/no on v2-data binding + credited-row handling.

## D-Q3 — Qualification gate and product identity (BR-QLF-02; CF-02)

- Question: Are v2 VIP cards the workbook VIP product, and which gate (25% approved vs 100% verified) governs?
- Authoritative: C2 R13 + B8 §2 + RV-20 (25%/10%) vs `phase2_rpc.sql:431` (100%).
- Documented: both gates fully specified in their own systems.
- Missing: product identity + governing gate for v2 sales.
- Depends: W1 builds. Independent: current 100% gate stays (do not weaken without ruling).
- Smallest fact: yes/no on product identity + governing gate + effective date.

## D-Q4 — Missing instruments (CF-04; BR-CUT-02)

- Question: Produce C3–C7 (service contracts + 21 Aug addendum) and D1–D7 (QA archive), or confirm unneeded.
- Missing: 12 of 30 indexed files; Rev B/C originals; contract-gap cure evidence.
- Depends: CF-04 corroboration, 30-case test-claim proof, CUT-02 protection mechanics.
- Smallest fact: files produced, or written confirmation of non-necessity per item.

## D-Q5 — Master List identity (CF-05)

- Question: What artifact is the prescribed reading order's "Master List"?
- Searched: all 18 filenames + 25 A2 sheets — no match; candidates rejected with reasons (CONFLICTS CF-05).
- Depends: documentation-completeness only; no build blocked.
- Smallest fact: artifact name or confirmation none exists.

## D-Q6 — C2 version authority (CF-03)

- Question: Is the in-ZIP C2 (mtime 2026-10-11 vs pack 2026-10-01) the signed version, a later edit, or a re-export?
- Depends: authority weight of all C2-sourced rules; no build blocked (content internally consistent + corroborated by B8/A2 cells).
- Smallest fact: owner confirmation of signed version.

## D-Q7 — VIP DSC default figure (BR-RATE-05)

- Question: What is the VIP DSC default?
- Searched: B8 §2, B2 `ParamInfo` (all 30 cases), A2 Control Panel staged history, A4/A6 — absent everywhere.
- Depends: RATE-05 only, which has no v2 target regardless — lowest priority.
- Smallest fact: figure or confirmation never defined.
