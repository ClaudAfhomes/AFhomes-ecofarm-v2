# Rule-to-Decision Dependency Graph (Phase 8)

- Created: 2026-10-14. Direct = implementation cannot proceed correctly without the decision. Indirect = decision shapes scope/priority but unambiguous parts can proceed. None = no relation.
- Decisions: D-Q1 model authority, D-Q2 cutover scope, D-Q3 gate/product, D-Q4 instruments, D-Q5 Master List, D-Q6 C2 authority, D-Q7 VIP DSC figure.

| Rules | D-Q1 | D-Q2 | D-Q3 | D-Q4 | D-Q5 | D-Q6 | D-Q7 |
|---|---|---|---|---|---|---|---|
| BR-GEN-01, 02, 03, 06, 07 | direct | none | none | none | none | indirect | none |
| BR-GEN-04, BR-GEN-05 | direct | indirect (backfill) | direct (credit/product) | none | none | indirect | none |
| BR-ENG-01…05 | direct | none | none | none | none | indirect | none |
| BR-QLF-01, 03, 04 | direct (scope) | indirect (backfill) | direct | none | none | indirect | none |
| BR-QLF-02 | direct | indirect | direct | none | none | indirect | none |
| BR-QLF-05 | direct | none | direct | none | none | indirect | none |
| BR-QLF-06 | none | none | none | none | none | none | none |
| BR-AUTH-01, 02 | direct (console vs gates) | none | none | none | none | indirect | none |
| BR-REV-01, 02, 03 | direct | none | none | none | none | indirect | none |
| BR-PB-01, 02, 03, 04 | direct | none | none | indirect (contract text) | none | indirect | none |
| BR-ACM-01, 02, 03, 04 | direct | indirect (backfill) | direct (product) | none | none | indirect | none |
| BR-PAR-01, 02 | direct | none | none | indirect (contracts) | none | indirect | none |
| BR-DUAL-01, 02, 03 | direct | indirect (backfill) | none | none | none | indirect | none |
| BR-RATE-01, 03 | direct (DSC scope) | none | none | none | none | indirect | indirect (Q7, DSC only) |
| BR-RATE-02 | none (inapplicable: 0% legal + deterministic) | none | none | none | none | none | none |
| BR-RATE-04 | direct | none | none | none | none | indirect | none |
| BR-RATE-05 | none (no v2 target) | none | none | none | none | none | direct |
| BR-RATE-06 | none | none | none | none | none | none | none |
| BR-CTL-01, 03, 06 | direct (scope) | none | none | none | none | indirect | none |
| BR-CTL-02, 04 | direct | none | none | none | none | indirect | none |
| BR-CTL-05 | none (no v2 subject) | none | none | none | none | none | none |
| BR-CUT-01, 02 | indirect (model framing) | direct | none | direct (instruments) | none | none | none |
| BR-OPS-01, 04 | direct | none | none | none | none | indirect | none |
| BR-OPS-02 | none (equivalence recorded) | none | none | none (plan cited, not in package) | none | none | none |
| BR-OPS-03 | none (out of scope, evidenced) | none | none | none | none | none | none |

Notes: D-Q5/D-Q6 are indirect nearly everywhere because they weight authority, never behavior — deliberately not direct anywhere except via CF-03/CF-05 themselves. CTL-05's blocker is authority-absence (recorded), not any listed decision — hence none across, with the ruling-or-drop action in OPEN_QUESTIONS. RATE-02 needs no decision: v2 semantics settle it.
