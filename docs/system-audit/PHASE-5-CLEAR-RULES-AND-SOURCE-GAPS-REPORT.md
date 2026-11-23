# Phase 5 Report — Clear Rules Implemented, Source Gaps Closed

- Date: 2026-10-14 (UTC). One behavior-changing fix (sales.ts reorder, backward-compatible: same statuses, fewer burned numbers); one new rule extracted (BR-RATE-06); no migrations run/written; no production data touched; ZIP preserved; user deletions under `docs/security/` untouched.
- Tests: new/updated spec 3/3 green; 8 affected suites 226 green; `tsc --noEmit` (api) clean; sales.ts prettier warning verified pre-existing on HEAD (left untouched — no unrelated churn).

## 1. Chosen feature S2 and why (Steps 2–4)

**Invalid inputs generate no sale number (new BR-RATE-06).** Source: A2 Control Panel A23 (v10.1 remediation: "invalid inputs generate NO number") + A25 (duplicate prevention at freeze). Why it won: fully specified (validate-then-issue + no-duplicates), applies to the v2 workflow without payroll semantics or model decisions, needed a real code change (scheme failures burned numbers), testable offline, no migration. Impact over ease: numbering integrity is audit-critical (every gap is an un объяснимый hole in the sequence the auditors reconcile).

## 2. Source evidence and rule IDs

BR-RATE-06 (A23/A25) + BR-RATE-01 lineage (A4 §3.1, A6 §2.1, C1 §5.4). Duplicate-prevention mechanism differs by platform (workbook module vs DB unique `phase1:227`) — recorded, not conflated. Workbook series caps (99,999/9,999) intentionally not transferred (format-specific).

## 3. Files changed

- `api/_handlers/sales.ts`: scheme-resolution block moved above `next_sale_number` + BR-RATE-06 comment; old comment relocated intact beside `snapshotSchemeTerms`. No status, shape, or error-code change.
- `api/_handlers/sale-creation-order.spec.ts`: 3rd test (unconfigured scheme → 409 + zero number calls + no row); docblock cites BR-RATE-06.
- Docs: new BR-RATE-06 section; INDEX (55 rules, TEST_VERIFIED 1); MATRIX (MATCH 1, applicable 53); ROADMAP (Lane 1 DONE note); TEST-PLAN; CONFLICTS CF-06 (below); BR-QLF-04 (A24 + Reference R44–R63 mechanics); BR-CTL-01 (A12/A14/A20 nuance); BR-OPS-02 (A17 FD2026 placeholder evidence); CHANGELOG (3 entries). This report.

## 4. Tests: commands and results

- `pnpm --filter ./api exec vitest run _handlers/sale-creation-order.spec.ts` — 3 passed (3rd test fails on pre-fix order by construction: number consumed before scheme check).
- Affected suites (phase2, phase26-finance, sale-payments, sale-cancel, vip-payment-schemes, application-purchase-flow, purchase-flow-migration, queues-dashboard) — 226 passed.
- `pnpm --filter ./api exec tsc --noEmit` — clean. Prettier: spec clean; sales.ts warning pre-existing (HEAD-verified).

## 5. Implemented vs still missing

Implemented: validation-before-numbering for v2's full validation set (Zod, seller, product/customer, scheme) + duplicate guarantee via existing unique constraint. Still missing (out of v2 scope by evidence): workbook series caps, module freeze-time checks, per-sale DSC/DRI freeze (no DSC/DRI in v2), qualification-date mechanics. Rule stays honestly scoped — no whole-rule overclaim.

## 6. Source-dependent blockers (Step 3 deepening results)

- VIP DSC default: exhaustively searched (B8 §2, B2 `ParamInfo` all 30 cases, Control Panel staged history, A4/A6) — confirmed absent, Q7 stands with search locations recorded.
- CF-06 (NEW): Reference R55 (UPGRADED counts in reports) vs A24/R15 (stop counting + strip). Resolved by document hierarchy with citations (C2 §1 precedence; A24 corrects v5.0 text; R15 confirms) — recorded in CONFLICTS, not silent. R55's "counts" read as completed-sale history (row kept per R47), TCP per A24/R15.
- Corroborated without change: thresholds/stages (A28/A32), auto-qualification + refund-strip (A29), reviews/ledger (A30), B19 reversal lineage (A31), dual/chain/back-date (A33), assumed-credit OPEN POINT → resolution lineage (A34→A35, matches RV-37), FD2026 placeholder (A17), reference-required approvals (A20), upgrade/status/dual-identity mechanics (Reference R44–R63).
- Unchanged blockers: Q1 (Lane 4), Q3+Q2 (W1), Q4 (CF-04), Q5/Q6 (B4), Q10 (DB proof). W1–W4, B1–B3 still gated as recorded.

## 7. Ranked remaining backlog

1. W1 qualification gate (Q3+Q2) — highest impact, fully specified once rulings land.
2. W3 approval/close conformance gaps (needs Q1 scope: console vs gates).
3. W2 rate governance (needs Q1; Q7 only if DSC ever enters v2).
4. W4 genealogy completion (needs Q1/Q3).
5. Lane 4 X1→X4 (needs Q1). Next unblocked verification: apps jsdom suites + Q10 DB suite.
