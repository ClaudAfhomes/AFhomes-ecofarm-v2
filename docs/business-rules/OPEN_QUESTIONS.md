# Open Questions Register

## Blocks implementation

- Q1 — Which model governs v2: workbook payroll, v2 card/points model, both side by side, or payroll superseded? (President.) Blocks all authority.
- Q2 — Does the 27-Sept no-grandfathering cutover bind v2 data? (President.) Blocks BR-CUT-01 application.
- Q3 — Resolve CF-02 with effective dates; are v2 VIP cards the workbook VIP product? (President.)
- Q4 — Absent C3–C7 contracts and D1–D7 QA archive: produce or confirm unneeded? (President / QA holder.) Blocks CF-04 corroboration and the 30-case test claim.
- Q5 — What is the "Master List"? (Package author / Finance Director.) Blocks reading-order completeness.
- Q6 — C2 version authority (CF-03)? (Document owner.)

## Does not block implementation (documented portion proceeds)

- Q7 — VIP DSC default rate missing from B8 §2 (only DRI 5%/4% + DSC IGP 8% listed). (Finance Director.) BR-RATE-05 marked PARTIAL.
- Q8 — Confirm Table A values, B19 = 0% posture, assumed-credit rates, anniversary/early-performer practice. (Finance Director.)
- Q9 — Validate each BR-CODE behavior before any write-up as a rule. (President / Finance Director.)

## Verification needed

- Q10 — Approve running the wider suites (`pnpm test`, `pnpm test:db:local`) so rule-level test evidence can become TEST_VERIFIED. So far executed 2026-10-14 (all pass, helper-level only, not rule conformance): `packages/shared` money.spec (14), `api` commerce.spec (33), `packages/contracts` input + purchase-flow + redemption + points specs (74).
- Q10 update (Phase 6, 2026-10-14): full offline suites executed — api 2131, shared 41, contracts 226, web 245, admin 799 (+1 load flake, solo-green); `test:db:local` 2464/2464 on inspected disposable loopback Postgres (torn down by design). Per-rule DB conformance mapping still open.
- Q11 — Cell-level verification of workbook formulas beyond B2 `QualFormula` (:660) and `FreezeSaleRates` (:534); Control Panel exact cells (B10/B11/B13/E10–E13/B19/B20/E20, audit C4); B5/B6 matrices unread.
- Q12 — JAD-side files (A1/A3/A5/B1/B3/B5/B7) inventoried only; confirm they stay out of scope per repo JAD exclusion.
