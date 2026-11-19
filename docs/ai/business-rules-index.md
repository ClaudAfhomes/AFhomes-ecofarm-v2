# Business-rules index (module → source)

Implement from the source text, never from this table. `docs/business-rules/INDEX.md`
states no rule there is APPROVED; owner instructions summarized in `AGENTS.md`
(§ Current owner decisions), dated in `docs/agents/mongodb-conversion-log.md`, and
`docs/mongodb/*` reports take precedence over older material.

| Module | Primary source | Supporting | Code / tests |
|---|---|---|---|
| Identifiers (customer, VIP, AA, IGP) | `docs/AFHOMES-BUSINESS-RULES.md` §3–§8, §13, §16 | `docs/mongodb/VIP-ISSUANCE-SETUP-2026-11-02.md` | `customers.mongo.ts`, `vip-issuance.mongo.ts`, `business-ids.spec.ts` |
| IST / OST / accreditation | Rules §6, §16; `docs/agents/mongodb-conversion-log.md` (26–27 Oct entries) | `MEMBER-KIND-CONVERSION-REPORT.md`, `OST-APPLICANT-CORRECTIONS-REPORT.md`, `docs/IST-PORTAL-IMPLEMENTATION.md` | `api/_handlers/members*.ts`, `ost*.ts`, `accreditation-display.spec.ts` |
| Genealogy / transfer | `docs/business-rules/BR-GEN-allowances.md` | `MEMBER-TEAM-TRANSFER-REPORT.md`, `docs/handoffs/2026-10-17-ost-team-transfer.md` | `genealogy.mongo.ts`, `network-members/` |
| Customers / import | `docs/AFHOMES-CUSTOMER-WORKBOOK-IMPLEMENTATION.md` | `docs/mongodb/IMPORT-*`, `LEGACY-*`, `HISTORICAL-IMPORT-*` | `customer-import*.ts`, `customer-workbook*.ts` |
| VIP membership / activation | AGENTS.md § Database invariants | `IDENTITY-PURCHASE-ACCEPTANCE.md`, `PURCHASE-NATIVE-VERIFICATION.md` | `customer-activation.mongo.ts` |
| Stay Points | `docs/mongodb/DAY-POINT-ALLOWANCES-REPORT.md` | `POINTS-REFERENCE-SETUP-REPORT.md`, `VIP-POINTS-SCROLL-REPAIR.md` | `customer-points.mongo.ts`, contracts `points.ts` |
| Sales lifecycle | `packages/contracts/src/schemas/lifecycle.ts` | `docs/business-rules/STATUSES.md` | `commerce.ts` + spec |
| Payments / finance | AGENTS.md invariants (verified-only money) | `docs/business-rules/BR-QLF-*`, `BR-CTL-controls.md` | `rg --files api/_lib \| rg -i "sale\|purchase"` (`*.mongo.ts`), `api/_handlers/sale-payments.spec.ts` |
| Commissions | `docs/business-rules/BR-RATE-freeze.md`, `BR-AUTH-governance.md` | `BR-PB-bonus.md`, `CONFLICTS.md` | `commissions.mongo.ts`, contracts `finance.ts` |
| Sales reporting | `docs/AFHOMES-UNIFIED-SALES-REPORTING.md` | `PORTAL-SALES-REPAIR-REPORT.md` | reports disabled by flag |
| RBAC | AGENTS.md § Authorization architecture | `packages/contracts/src/schemas/role-baseline.ts` | `authorization.regression.spec.ts` |
| Module availability | `packages/shared/src/features.ts` | `MEMBERSHIP-DISABLED-PANELS-FIX.md` | `features.spec.ts` |
| Terminology | `docs/AFHOMES-TERMINOLOGY-AUDIT-2026-10-24.md` | — | — |
| Public verification | `docs/PUBLIC-VERIFICATION-VERIFIED-2026-10-24.md` | — | `accreditation-display.spec.ts` |
| Open questions | `docs/business-rules/OPEN_QUESTIONS.md`, `CONFLICTS.md`, rules §13 | — | — |
